import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { seedAudit, seedBatches, seedConclusions, seedRecords, seedServerDivergence } from '../data/seed'
import { createOfflineInspection } from '../services/api'
import {
  applyResolution,
  ensureServerSeed,
  fetchServerRecords,
  receiveBatch,
  resetServer,
  simulateExternalEdit
} from '../services/server'
import {
  computeConclusionType,
  diffRecord,
  fieldLabel,
  formatValue,
  getFieldValue,
  makeId,
  mergeableFields,
  setFieldValue,
  valuesEqual
} from '../services/sync'
import type {
  AuditEntry,
  Conclusion,
  FieldConflict,
  InspectionDraft,
  InspectionRecord,
  InspectionStatus,
  SyncBatch
} from '../types'

const STORAGE_KEY = 'gsb63:inspection-platform'

interface PersistedState {
  records: InspectionRecord[]
  audit: AuditEntry[]
  batches: SyncBatch[]
  conflicts: FieldConflict[]
  conclusions: Conclusion[]
}

function seedState(): PersistedState {
  return {
    records: structuredClone(seedRecords),
    audit: structuredClone(seedAudit),
    batches: structuredClone(seedBatches),
    conflicts: [],
    conclusions: structuredClone(seedConclusions)
  }
}

function readPersisted(): PersistedState {
  const fallback = seedState()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<PersistedState>
    const records = parsed.records ?? fallback.records
    for (const record of records) {
      record.recheckNeeded ??= false
      record.lastBatchId ??= ''
    }
    return {
      records,
      audit: parsed.audit ?? fallback.audit,
      batches: parsed.batches ?? fallback.batches,
      conflicts: parsed.conflicts ?? [],
      conclusions: parsed.conclusions ?? fallback.conclusions
    }
  } catch {
    return fallback
  }
}

/** 未接收批次占用的字段，下行合并时这些字段以本地为准不被覆盖 */
const OUTBOX_STATUS = new Set(['待上传', '待重试', '上传中'])

export const useInspectionStore = defineStore('inspection', () => {
  ensureServerSeed(seedRecords, seedServerDivergence)

  const initial = readPersisted()
  const records = ref<InspectionRecord[]>(initial.records)
  const audit = ref<AuditEntry[]>(initial.audit)
  const batches = ref<SyncBatch[]>(initial.batches)
  const conflicts = ref<FieldConflict[]>(initial.conflicts)
  const conclusions = ref<Conclusion[]>(initial.conclusions)
  const online = ref(true)
  const failWrites = ref(false)
  const keyword = ref('')
  const status = ref<InspectionStatus | '全部'>('全部')
  const area = ref('全部')
  const liveMessage = ref('本地实时通道已就绪')

  const filtered = computed(() => records.value.filter((record) => {
    const haystack = `${record.id} ${record.deviceCode} ${record.deviceName} ${record.inspector} ${record.assignedTo}`.toLowerCase()
    return (!keyword.value || haystack.includes(keyword.value.toLowerCase()))
      && (status.value === '全部' || record.status === status.value)
      && (area.value === '全部' || record.area === area.value)
  }))

  const stats = computed(() => ({
    total: records.value.length,
    blocked: records.value.filter((item) => item.stopped).length,
    overdue: records.value.filter((item) => item.dueDate < '2026-09-29' && !['已关闭'].includes(item.status)).length,
    closed: records.value.filter((item) => item.status === '已关闭').length
  }))

  const pendingBatches = computed(() => batches.value.filter((batch) => OUTBOX_STATUS.has(batch.status)))
  const pendingConflicts = computed(() => conflicts.value.filter((item) => item.status === '待确认'))
  const recheckRecords = computed(() => records.value.filter((item) => item.recheckNeeded))

  function addAudit(recordId: string, action: string, operator: string, detail: string, batchId?: string) {
    const record = records.value.find((item) => item.id === recordId)
    audit.value.unshift({
      id: makeId('AUD'),
      recordId,
      action,
      operator,
      detail,
      createdAt: new Date().toISOString(),
      deviceCode: record?.deviceCode,
      batchId
    })
  }

  /**
   * 结论链：批次结论变化时，旧的缺陷与放行结论立即失效待重核，
   * 旧结论保留可查；已复测放行的任务结论翻转为停用时回退待复测。
   */
  function recomputeConclusion(record: InspectionRecord, batchId: string) {
    const nextType = computeConclusionType(record)
    const current = conclusions.value.find((item) => item.recordId === record.id && item.effective)
    if (current && current.type === nextType && current.batchId === batchId) return
    const now = new Date().toISOString()
    const flipped = current && current.type !== nextType
    if (current) {
      current.effective = false
      current.invalidatedAt = now
      current.invalidatedReason = flipped
        ? `批次 ${batchId} 结论变更（${current.type}→${nextType}），缺陷与放行结论失效待重核`
        : `被批次 ${batchId} 新结论取代`
    }
    conclusions.value.unshift({
      id: makeId('CON'),
      recordId: record.id,
      deviceCode: record.deviceCode,
      batchId,
      baseVersion: record.version,
      type: nextType,
      effective: true,
      createdAt: now
    })
    record.lastBatchId = batchId
    if (!flipped || !current) return
    record.recheckNeeded = true
    addAudit(record.id, '结论失效重核', '同步引擎', `批次 ${batchId} 结论由${current.type}变为${nextType}，相关缺陷处置与放行结论已失效，待值班长重核`, batchId)
    if (record.status === '已关闭' && nextType === '停用') {
      record.status = '待复测'
      addAudit(record.id, '放行失效回退', '同步引擎', `批次 ${batchId} 结论变更为停用，已复测放行失效，任务回退待复测`, batchId)
    }
  }

  /** 本地变更落库并生成断网包：包内保留采集时刻与基线版本 */
  function applyPatchWithBatch(record: InspectionRecord, patch: Partial<InspectionRecord>, action: string, operator: string, note?: string) {
    const before = structuredClone(record)
    Object.assign(record, patch, { version: record.version + 1, updatedAt: new Date().toISOString() })
    const ops = diffRecord(before, record, new Date().toISOString())
    if (!ops.length) return null
    const batch: SyncBatch = {
      id: makeId('BATCH'),
      recordId: record.id,
      deviceCode: record.deviceCode,
      deviceName: record.deviceName,
      inspector: operator,
      baseVersion: before.version,
      ops,
      createdAt: new Date().toISOString(),
      status: '待上传',
      attempts: 0,
      note,
      snapshot: structuredClone(record)
    }
    batches.value.unshift(batch)
    record.lastBatchId = batch.id
    recomputeConclusion(record, batch.id)
    addAudit(record.id, action, operator, `记录更新至版本 V${record.version}，生成断网包 ${batch.id}（${ops.length} 个字段，基线 V${before.version}）`, batch.id)
    return batch
  }

  function addRecord(draft: InspectionDraft) {
    const record = createOfflineInspection(draft)
    records.value.unshift(record)
    const batch: SyncBatch = {
      id: makeId('BATCH'),
      recordId: record.id,
      deviceCode: record.deviceCode,
      deviceName: record.deviceName,
      inspector: draft.inspector,
      baseVersion: 0,
      ops: [],
      createdAt: new Date().toISOString(),
      status: '待上传',
      attempts: 0,
      note: '新任务建档',
      snapshot: structuredClone(record)
    }
    batches.value.unshift(batch)
    record.lastBatchId = batch.id
    conclusions.value.unshift({
      id: makeId('CON'),
      recordId: record.id,
      deviceCode: record.deviceCode,
      batchId: batch.id,
      baseVersion: 1,
      type: computeConclusionType(record),
      effective: true,
      createdAt: new Date().toISOString()
    })
    addAudit(record.id, '创建检验记录', draft.inspector, `新建设备班次检验任务，建档批次 ${batch.id}`, batch.id)
    return record
  }

  function updateRecord(id: string, patch: Partial<InspectionRecord>, action = '保存检验记录') {
    const record = records.value.find((item) => item.id === id)
    if (!record) return
    applyPatchWithBatch(record, patch, action, '当前用户')
  }

  function transition(id: string, next: InspectionStatus, detail: string) {
    const record = records.value.find((item) => item.id === id)
    if (!record) return { ok: false, message: '记录不存在' }
    if (next === '已关闭' && record.items.some((item) => item.result === '异常')) {
      return { ok: false, message: '仍有异常项，不能关闭任务' }
    }
    if (next === '待复测' && !record.stopped && record.risk === '紧急') {
      return { ok: false, message: '紧急风险缺陷必须先执行停用' }
    }
    applyPatchWithBatch(record, { status: next, ...(next === '已关闭' ? { recheckNeeded: false } : {}) }, `状态流转：${next}`, '当前用户')
    addAudit(id, `状态流转：${next}`, '当前用户', detail, record.lastBatchId)
    return { ok: true, message: `已流转至${next}` }
  }

  /** 单批上传：写入失败仅标记待重试，已接收批次绝不重投 */
  function syncBatch(batch: SyncBatch) {
    batch.status = '上传中'
    batch.attempts += 1
    try {
      const result = receiveBatch(batch, { fail: failWrites.value })
      batch.ackedAt = new Date().toISOString()
      const record = records.value.find((item) => item.id === batch.recordId)
      if (result.deduplicated) {
        batch.status = '已接收'
        addAudit(batch.recordId, '批次重复投递已忽略', '同步引擎', `批次 ${batch.id} 服务端已接收，幂等去重`, batch.id)
        return { conflicted: false }
      }
      if (record) {
        for (const conflict of result.conflicts) {
          conflicts.value.unshift(conflict)
          setFieldValue(record, conflict.field, conflict.serverValue)
          addAudit(
            batch.recordId,
            '字段冲突待确认',
            '同步引擎',
            `字段「${conflict.label}」现场版 ${formatValue(conflict.field, conflict.localValue)}（${conflict.localBy} ${conflict.localCollectedAt.slice(11, 16)}）与值班室版 ${formatValue(conflict.field, conflict.serverValue)}（${conflict.serverBy}）并存，待值班长确认`,
            batch.id
          )
        }
        record.updatedAt = new Date().toISOString()
        recomputeConclusion(record, batch.id)
      }
      batch.status = result.conflicts.length ? '部分冲突' : '已接收'
      addAudit(
        batch.recordId,
        '批次已接收',
        '同步引擎',
        `批次 ${batch.id} 按字段合并完成：应用 ${result.applied.length} 个字段，冲突 ${result.conflicts.length} 个字段（基线 V${batch.baseVersion}）`,
        batch.id
      )
      return { conflicted: result.conflicts.length > 0 }
    } catch {
      batch.status = '待重试'
      addAudit(batch.recordId, '批次写入失败', '同步引擎', `批次 ${batch.id} 未被服务端接收（第 ${batch.attempts} 次尝试），仅未接收批次会重试`, batch.id)
      return { conflicted: false }
    }
  }

  /** 下行合并：服务端权威值回写本地，未接收批次占用的字段除外 */
  function pullMerge() {
    const heldFields = new Map<string, Set<string>>()
    for (const batch of batches.value) {
      if (!OUTBOX_STATUS.has(batch.status)) continue
      const held = heldFields.get(batch.recordId) ?? new Set<string>()
      batch.ops.forEach((op) => held.add(op.field))
      heldFields.set(batch.recordId, held)
    }
    for (const serverRecord of fetchServerRecords()) {
      const local = records.value.find((item) => item.id === serverRecord.id)
      if (!local) {
        records.value.unshift(serverRecord)
        continue
      }
      const held = heldFields.get(local.id) ?? new Set<string>()
      const merged: string[] = []
      for (const field of mergeableFields(local)) {
        if (held.has(field)) continue
        const serverValue = getFieldValue(serverRecord, field)
        if (!valuesEqual(getFieldValue(local, field), serverValue)) {
          setFieldValue(local, field, serverValue)
          merged.push(fieldLabel(field))
        }
      }
      if (merged.length) {
        local.version = Math.max(local.version, serverRecord.version)
        local.updatedAt = serverRecord.updatedAt
        addAudit(local.id, '合并值班室改动', '同步引擎', `下行合并字段：${merged.join('、')}`)
        recomputeConclusion(local, 'DUTY-ROOM')
      }
    }
  }

  /** 回连同步：只重试未接收批次，已接收/部分冲突批次不重投 */
  function syncAll() {
    if (!online.value) return { synced: 0, failed: 0, conflicted: 0 }
    let synced = 0
    let failed = 0
    let conflicted = 0
    const outbox = batches.value
      .filter((batch) => batch.status === '待上传' || batch.status === '待重试')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    for (const batch of outbox) {
      const result = syncBatch(batch)
      if (batch.status === '待重试') failed += 1
      else if (result.conflicted) conflicted += 1
      else synced += 1
    }
    pullMerge()
    return { synced, failed, conflicted }
  }

  function retryBatch(id: string) {
    const batch = batches.value.find((item) => item.id === id)
    if (!batch || batch.status === '已接收' || batch.status === '部分冲突' || !online.value) return
    syncBatch(batch)
    pullMerge()
  }

  /** 值班长确认：采纳一版写回本地与权威端，并触发结论链重核 */
  function resolveConflict(conflictId: string, adopt: 'local' | 'server') {
    const conflict = conflicts.value.find((item) => item.id === conflictId)
    if (!conflict || conflict.status !== '待确认') return
    const record = records.value.find((item) => item.id === conflict.recordId)
    if (!record) return
    const value = adopt === 'local' ? conflict.localValue : conflict.serverValue
    setFieldValue(record, conflict.field, value)
    record.version += 1
    record.updatedAt = new Date().toISOString()
    conflict.status = adopt === 'local' ? '已采纳现场' : '已采纳值班室'
    conflict.resolvedAt = new Date().toISOString()
    applyResolution(conflict.recordId, conflict.field, value, '值班长')
    recomputeConclusion(record, conflict.batchId)
    addAudit(record.id, '冲突确认', '值班长', `字段「${conflict.label}」采纳${adopt === 'local' ? '现场' : '值班室'}版本：${formatValue(conflict.field, value)}`, conflict.batchId)
  }

  function confirmRecheck(id: string) {
    const record = records.value.find((item) => item.id === id)
    if (!record || !record.recheckNeeded) return
    record.recheckNeeded = false
    addAudit(id, '重核确认', '值班长', `依据批次 ${record.lastBatchId} 完成缺陷与放行结论重核`, record.lastBatchId)
  }

  /** 演示工具：值班室在权威端直接改动，等待回连合并 */
  function simulateDutyRoom(recordId: string) {
    const script: Record<string, Array<{ field: string; value: string | boolean }>> = {
      'INS-240821-01': [
        { field: 'items.wear.reading', value: '7.4 mm' },
        { field: 'items.wear.note', value: '值班室复核：磨损持续加剧' },
        { field: 'risk', value: '紧急' }
      ]
    }
    const edits = script[recordId] ?? [
      { field: 'assignedTo', value: '值班室调度' },
      { field: 'dueDate', value: '2026-10-05' }
    ]
    const changed = simulateExternalEdit(recordId, '值班室·刘工', edits)
    if (changed.length) addAudit(recordId, '值班室改动待合并', '值班室·刘工', `权威端修改字段：${changed.map(fieldLabel).join('、')}，等待回连合并`)
    return changed.length
  }

  /** 演示工具：另一台平板先回连，提交了复测放行结果 */
  function simulatePeer(recordId: string) {
    const edits = [
      { field: 'items.lock.result', value: '正常' },
      { field: 'items.lock.reading', value: '闭合良好' },
      { field: 'stopped', value: false }
    ]
    const changed = simulateExternalEdit(recordId, '李琪（另一台平板）', edits)
    if (changed.length) addAudit(recordId, '对端平板已提交', '李琪（另一台平板）', `另一台平板先回连提交字段：${changed.map(fieldLabel).join('、')}`)
    return changed.length
  }

  function resetDemo() {
    const fresh = seedState()
    records.value = fresh.records
    audit.value = fresh.audit
    batches.value = fresh.batches
    conflicts.value = fresh.conflicts
    conclusions.value = fresh.conclusions
    resetServer(seedRecords, seedServerDivergence)
  }

  watch([records, audit, batches, conflicts, conclusions], () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      records: records.value,
      audit: audit.value,
      batches: batches.value,
      conflicts: conflicts.value,
      conclusions: conclusions.value
    }))
  }, { deep: true })

  return {
    records, audit, batches, conflicts, conclusions, online, failWrites,
    keyword, status, area, liveMessage,
    filtered, stats, pendingBatches, pendingConflicts, recheckRecords,
    addRecord, updateRecord, transition, syncAll, retryBatch, resolveConflict,
    confirmRecheck, simulateDutyRoom, simulatePeer, resetDemo
  }
})
