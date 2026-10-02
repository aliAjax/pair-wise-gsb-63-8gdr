import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { seedAudit, seedBatches, seedConclusions, seedConflicts, seedDefects, seedRecords } from '../data/seed'
import { createOfflineInspection } from '../services/api'
import { CONCLUSION_FIELDS, deriveVerdict, getFieldValue, mergeBatchIntoRecord, setFieldValue } from '../services/sync'
import type {
  AuditEntry, Conclusion, Defect, DefectStatus, FieldConflict, FieldOp, InspectionDraft,
  InspectionRecord, InspectionStatus, PendingChange, SyncBatch
} from '../types'

const STORAGE_KEY = 'gsb63:inspection-platform'
const DUTY_LEADER = '值班长·陈默'
/** 值班室直改等非批次来源的占位批次号 */
const DIRECT_BATCH = 'DIRECT'

interface PersistedState {
  records: InspectionRecord[]
  audit: AuditEntry[]
  batches: SyncBatch[]
  conflicts: FieldConflict[]
  defects: Defect[]
  conclusions: Conclusion[]
}

function readPersisted(): PersistedState {
  const fallback: PersistedState = {
    records: seedRecords,
    audit: seedAudit,
    batches: seedBatches,
    conflicts: seedConflicts,
    defects: seedDefects,
    conclusions: seedConclusions
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<PersistedState>
    return {
      records: parsed.records ?? fallback.records,
      audit: parsed.audit ?? fallback.audit,
      batches: parsed.batches ?? fallback.batches,
      conflicts: parsed.conflicts ?? fallback.conflicts,
      defects: parsed.defects ?? fallback.defects,
      conclusions: parsed.conclusions ?? fallback.conclusions
    }
  } catch {
    return fallback
  }
}

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
}

export const useInspectionStore = defineStore('inspection', () => {
  const initial = readPersisted()
  const records = ref<InspectionRecord[]>(initial.records)
  const audit = ref<AuditEntry[]>(initial.audit)
  const batches = ref<SyncBatch[]>(initial.batches)
  const conflicts = ref<FieldConflict[]>(initial.conflicts)
  const defects = ref<Defect[]>(initial.defects)
  const conclusions = ref<Conclusion[]>(initial.conclusions)
  const keyword = ref('')
  const status = ref<InspectionStatus | '全部'>('全部')
  const area = ref('全部')
  const liveMessage = ref('本地实时通道已就绪')
  /** 断网演练：开启后所有批次写入失败，只保留在待重试队列 */
  const offline = ref(false)

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

  const syncStats = computed(() => ({
    pendingBatches: batches.value.filter((item) => item.status === '待同步' || item.status === '发送失败').length,
    pendingConflicts: conflicts.value.filter((item) => item.status === '待确认').length,
    invalidConclusions: conclusions.value.filter((item) => item.state === '失效待重核').length,
    invalidDefects: defects.value.filter((item) => item.status === '失效待重核').length
  }))

  function addAudit(recordId: string, action: string, operator: string, detail: string, links: Partial<Pick<AuditEntry, 'deviceCode' | 'batchId' | 'conclusionId' | 'defectId'>> = {}) {
    const record = records.value.find((item) => item.id === recordId)
    audit.value.unshift({
      id: uid('AU'),
      recordId,
      action,
      operator,
      detail,
      createdAt: new Date().toISOString(),
      deviceCode: links.deviceCode ?? record?.deviceCode,
      batchId: links.batchId,
      conclusionId: links.conclusionId,
      defectId: links.defectId
    })
  }

  function activeJudgment(recordId: string) {
    return conclusions.value.find((item) => item.recordId === recordId && item.kind !== '放行结论' && item.state === '生效')
  }

  function activeRelease(recordId: string) {
    return conclusions.value.find((item) => item.recordId === recordId && item.kind === '放行结论' && item.state === '生效')
  }

  /** 结论一变，依赖它的放行结论与来源它的缺陷随即失效待重核，旧结论保留可查 */
  function cascadeInvalidation(old: Conclusion, reason: string) {
    const now = new Date().toISOString()
    for (const item of conclusions.value) {
      if (item.state === '生效' && item.dependsOn.includes(old.id)) {
        item.state = '失效待重核'
        item.invalidatedAt = now
        item.invalidatedReason = reason
        addAudit(item.recordId, '放行结论失效', '系统', `${item.id} 因${reason}失效，需值班长重核`, { conclusionId: item.id })
      }
    }
    for (const defect of defects.value) {
      if (defect.sourceConclusionId === old.id && defect.status !== '已闭环' && defect.status !== '失效待重核') {
        defect.preInvalidationStatus = defect.status
        defect.status = '失效待重核'
        defect.updatedAt = now
        addAudit(defect.recordId, '缺陷失效待重核', '系统', `${defect.id} 来源结论 ${old.id} 已变更，需重核`, { defectId: defect.id, conclusionId: old.id })
      }
    }
  }

  /** 依据记录当前字段重算判定；结论变化时作废旧结论并级联失效 */
  function recomputeConclusion(record: InspectionRecord, batchId: string, actor: string, kind?: Conclusion['kind']) {
    const verdict = deriveVerdict(record)
    const active = activeJudgment(record.id)
    if (active && active.verdict === verdict) return active
    const now = new Date().toISOString()
    const batch = batches.value.find((item) => item.id === batchId)
    const next: Conclusion = {
      id: uid('CJ'),
      recordId: record.id,
      deviceCode: record.deviceCode,
      batchId,
      kind: kind ?? (batch?.kind === '复测' ? '复测判定' : '检验判定'),
      verdict,
      state: '生效',
      version: (active?.version ?? 0) + 1,
      dependsOn: [],
      decidedBy: actor,
      decidedAt: now
    }
    if (active) {
      active.state = '已作废'
      active.invalidatedAt = now
      active.invalidatedReason = `来源批次 ${batchId} 结论变更，由 ${next.id} 替代`
      active.supersededBy = next.id
      cascadeInvalidation(active, `来源结论 ${active.id} 被 ${next.id} 替代`)
    }
    conclusions.value.unshift(next)
    addAudit(record.id, `出具${next.kind}`, actor, `${next.id}：${verdict}`, { batchId, conclusionId: next.id })
    return next
  }

  /** 合并或裁决后按当前逐项结果同步缺陷：新异常登记缺陷，恢复正常的缺陷转复测通过 */
  function syncDefectsFromItems(record: InspectionRecord, batchId: string, conclusion: Conclusion | null) {
    const now = new Date().toISOString()
    for (const item of record.items) {
      const open = defects.value.find((entry) => entry.recordId === record.id && entry.itemId === item.id && entry.status !== '已闭环')
      if (item.result === '异常' && !open) {
        const defect: Defect = {
          id: uid('DF'),
          recordId: record.id,
          deviceCode: record.deviceCode,
          deviceName: record.deviceName,
          itemId: item.id,
          itemName: item.name,
          title: item.note ? `${item.name}：${item.note}` : `${item.name}检验异常`,
          risk: record.risk,
          status: '待处置',
          sourceBatchId: batchId,
          sourceConclusionId: conclusion?.id ?? '',
          createdAt: now,
          updatedAt: now
        }
        defects.value.unshift(defect)
        addAudit(record.id, '缺陷登记', '系统', `${defect.id} ${defect.title}`, { batchId, defectId: defect.id, conclusionId: defect.sourceConclusionId })
      }
      if (item.result === '正常' && open && ['待处置', '处置中', '待复测'].includes(open.status)) {
        open.status = '复测通过'
        open.updatedAt = now
        addAudit(record.id, '缺陷复测通过', '系统', `${open.id} 对应检验项已恢复正常`, { batchId, defectId: open.id })
      }
    }
  }

  function touchRecord(record: InspectionRecord) {
    record.version += 1
    record.updatedAt = new Date().toISOString()
  }

  // ---------- 检验任务 ----------

  function addRecord(draft: InspectionDraft) {
    const record = createOfflineInspection(draft)
    records.value.unshift(record)
    addAudit(record.id, '创建检验记录', draft.inspector, '新建设备班次检验任务')
    return record
  }

  /** 值班室直改：立即生效，同样触发结论重算与级联 */
  function updateRecord(id: string, patch: Partial<InspectionRecord>, action = '保存检验记录') {
    const record = records.value.find((item) => item.id === id)
    if (!record) return
    const touchesConclusion = 'items' in patch || 'risk' in patch || 'stopped' in patch
    Object.assign(record, patch)
    touchRecord(record)
    addAudit(id, action, '值班室', `记录更新至版本 V${record.version}`)
    if (touchesConclusion) {
      const conclusion = recomputeConclusion(record, DIRECT_BATCH, '值班室')
      syncDefectsFromItems(record, DIRECT_BATCH, conclusion)
    }
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
    record.status = next
    touchRecord(record)
    addAudit(id, `状态流转：${next}`, '当前用户', detail)
    return { ok: true, message: `已流转至${next}` }
  }

  // ---------- 离线同步链 ----------

  /** 断网打包：字段级操作保留采集时刻与基线值，包记录基线版本 */
  function packOfflineBatch(recordId: string, changes: PendingChange[], kind: SyncBatch['kind'], inspector: string) {
    const record = records.value.find((item) => item.id === recordId)
    if (!record || !changes.length) return null
    const ops: FieldOp[] = changes.map((change) => ({
      field: change.field,
      label: change.label,
      value: change.value,
      baseValue: getFieldValue(record, change.field),
      collectedAt: change.collectedAt
    }))
    const batch: SyncBatch = {
      id: uid('B'),
      recordId,
      deviceCode: record.deviceCode,
      deviceName: record.deviceName,
      kind,
      inspector,
      shift: record.shift,
      baseVersion: record.version,
      ops,
      createdAt: new Date().toISOString(),
      status: '待同步',
      attempts: 0,
      note: '断网打包，待回连同步'
    }
    batches.value.unshift(batch)
    addAudit(recordId, '离线打包', inspector, `批次 ${batch.id} 装入 ${ops.length} 项字段变更，基线版本 V${record.version}`, { batchId: batch.id })
    return batch
  }

  /** 回连同步：只重试未接收批次（待同步/发送失败），已接收批次不重发 */
  function flushOutbox() {
    const pending = batches.value.filter((item) => item.status === '待同步' || item.status === '发送失败')
    const summary = { total: pending.length, failed: 0, merged: 0, conflicted: 0 }
    for (const batch of pending) {
      batch.attempts += 1
      const record = records.value.find((item) => item.id === batch.recordId)
      if (offline.value || !record) {
        batch.status = '发送失败'
        summary.failed += 1
        addAudit(batch.recordId, '批次写入失败', '系统', `批次 ${batch.id} 第 ${batch.attempts} 次写入未获接收，保留在重试队列`, { batchId: batch.id })
        continue
      }
      const releaseProtected = Boolean(activeRelease(record.id))
      const outcome = mergeBatchIntoRecord(record, batch, releaseProtected)
      touchRecord(record)
      batch.syncedAt = new Date().toISOString()
      batch.status = outcome.conflicts.length ? '冲突待裁决' : '已合并'
      conflicts.value.unshift(...outcome.conflicts)
      if (outcome.applied.some((op) => CONCLUSION_FIELDS.test(op.field))) {
        const conclusion = recomputeConclusion(record, batch.id, batch.inspector)
        syncDefectsFromItems(record, batch.id, conclusion)
      }
      const parts = [`合并 ${outcome.applied.length} 项`]
      if (outcome.deduped.length) parts.push(`重复提交去重 ${outcome.deduped.length} 项`)
      if (outcome.conflicts.length) parts.push(`${outcome.conflicts.length} 个字段两版待值班长确认`)
      addAudit(record.id, `离线包合并（${batch.kind}）`, batch.inspector, `批次 ${batch.id}：${parts.join('，')}`, { batchId: batch.id })
      if (outcome.conflicts.length) summary.conflicted += 1
      else summary.merged += 1
    }
    return summary
  }

  /** 值班长裁决：同字段两版二选一，采用现场版时触发结论重算 */
  function resolveConflict(conflictId: string, keep: 'current' | 'incoming', resolver = DUTY_LEADER) {
    const conflict = conflicts.value.find((item) => item.id === conflictId)
    if (!conflict || conflict.status !== '待确认') return { ok: false, message: '冲突不存在或已确认' }
    const record = records.value.find((item) => item.id === conflict.recordId)
    if (!record) return { ok: false, message: '记录不存在' }
    conflict.status = '已确认'
    conflict.resolvedBy = resolver
    conflict.resolvedAt = new Date().toISOString()
    conflict.keptValue = keep === 'incoming' ? conflict.incomingValue : conflict.currentValue
    if (keep === 'incoming') {
      setFieldValue(record, conflict.field, conflict.incomingValue)
      touchRecord(record)
      if (CONCLUSION_FIELDS.test(conflict.field)) {
        const conclusion = recomputeConclusion(record, conflict.batchId, resolver)
        syncDefectsFromItems(record, conflict.batchId, conclusion)
      }
    }
    const batch = batches.value.find((item) => item.id === conflict.batchId)
    if (batch && batch.status === '冲突待裁决' && !conflicts.value.some((item) => item.batchId === batch.id && item.status === '待确认')) {
      batch.status = '已合并'
    }
    addAudit(record.id, '冲突裁决', resolver, `${conflict.label} 采用${keep === 'incoming' ? `现场版（${conflict.incomingInspector} 采集）` : '值班室现行版'}：${conflict.keptValue}`, { batchId: conflict.batchId })
    return { ok: true, message: `已确认保留：${conflict.keptValue}` }
  }

  // ---------- 缺陷处置与复测 ----------

  const defectFlow: Array<[DefectStatus, DefectStatus, string]> = [
    ['待处置', '处置中', '开始处置'],
    ['处置中', '待复测', '提交整改'],
    ['复测通过', '已闭环', '闭环确认']
  ]

  function advanceDefect(defectId: string, operator: string) {
    const defect = defects.value.find((item) => item.id === defectId)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    const step = defectFlow.find(([from]) => from === defect.status)
    if (!step) return { ok: false, message: '当前状态不可流转' }
    defect.status = step[1]
    defect.updatedAt = new Date().toISOString()
    addAudit(defect.recordId, `缺陷${step[2]}`, operator, `${defect.id} 流转至${step[1]}`, { defectId: defect.id })
    return { ok: true, message: `已${step[2]}` }
  }

  /** 缺陷重核：锚定到当前生效结论，按检验项现状恢复状态 */
  function revalidateDefect(defectId: string, operator = DUTY_LEADER) {
    const defect = defects.value.find((item) => item.id === defectId)
    if (!defect || defect.status !== '失效待重核') return { ok: false, message: '缺陷不在待重核状态' }
    const record = records.value.find((item) => item.id === defect.recordId)
    const item = record?.items.find((entry) => entry.id === defect.itemId)
    const active = record ? activeJudgment(record.id) : undefined
    if (active) defect.sourceConclusionId = active.id
    const fallback = defect.preInvalidationStatus && defect.preInvalidationStatus !== '失效待重核' ? defect.preInvalidationStatus : '待处置'
    defect.status = item?.result === '异常' ? fallback : '复测通过'
    defect.preInvalidationStatus = undefined
    defect.updatedAt = new Date().toISOString()
    addAudit(defect.recordId, '缺陷重核', operator, `${defect.id} 重核后恢复为${defect.status}，锚定结论 ${defect.sourceConclusionId}`, { defectId: defect.id, conclusionId: defect.sourceConclusionId })
    return { ok: true, message: `重核完成：${defect.status}` }
  }

  // ---------- 放行结论 ----------

  /** 签发放行结论：无异常项才允许，联动设备开放并闭环已复测缺陷 */
  function issueRelease(recordId: string, operator = DUTY_LEADER) {
    const record = records.value.find((item) => item.id === recordId)
    if (!record) return { ok: false, message: '记录不存在' }
    if (activeRelease(recordId)) return { ok: false, message: '已存在生效放行结论' }
    if (record.items.some((item) => item.result === '异常')) return { ok: false, message: '仍存在异常项，不能放行' }
    if (defects.value.some((item) => item.recordId === recordId && item.status === '失效待重核')) {
      return { ok: false, message: '存在失效待重核缺陷，请先完成重核' }
    }
    const judgment = activeJudgment(recordId)
    const release: Conclusion = {
      id: uid('CJ'),
      recordId,
      deviceCode: record.deviceCode,
      batchId: judgment?.batchId ?? DIRECT_BATCH,
      kind: '放行结论',
      verdict: '准予开放运行',
      state: '生效',
      version: 1,
      dependsOn: judgment ? [judgment.id] : [],
      decidedBy: operator,
      decidedAt: new Date().toISOString()
    }
    conclusions.value.unshift(release)
    record.stopped = false
    if (record.status !== '已关闭') record.status = '已关闭'
    touchRecord(record)
    for (const defect of defects.value) {
      if (defect.recordId === recordId && defect.status === '复测通过') {
        defect.status = '已闭环'
        defect.updatedAt = new Date().toISOString()
      }
    }
    addAudit(recordId, '签发放行结论', operator, `${release.id} 依据 ${release.dependsOn.join('、') || '值班室复核'} 准予开放运行`, { conclusionId: release.id, batchId: release.batchId })
    return { ok: true, message: `放行结论 ${release.id} 已生效` }
  }

  /** 放行重核：旧放行作废，按当前生效判定重新签发 */
  function revalidateRelease(recordId: string, operator = DUTY_LEADER) {
    const stale = conclusions.value.find((item) => item.recordId === recordId && item.kind === '放行结论' && item.state === '失效待重核')
    if (!stale) return { ok: false, message: '没有待重核的放行结论' }
    const record = records.value.find((item) => item.id === recordId)
    if (!record) return { ok: false, message: '记录不存在' }
    if (record.items.some((item) => item.result === '异常')) return { ok: false, message: '仍存在异常项，请先完成缺陷重核' }
    const judgment = activeJudgment(recordId)
    const next: Conclusion = {
      id: uid('CJ'),
      recordId,
      deviceCode: record.deviceCode,
      batchId: stale.batchId,
      kind: '放行结论',
      verdict: '准予开放运行（重核恢复）',
      state: '生效',
      version: stale.version + 1,
      dependsOn: judgment ? [judgment.id] : [],
      decidedBy: operator,
      decidedAt: new Date().toISOString()
    }
    stale.state = '已作废'
    stale.invalidatedAt = new Date().toISOString()
    stale.invalidatedReason = `重核后由 ${next.id} 替代`
    stale.supersededBy = next.id
    conclusions.value.unshift(next)
    record.stopped = false
    touchRecord(record)
    addAudit(recordId, '放行重核恢复', operator, `${stale.id} 作废，${next.id} 依据 ${next.dependsOn.join('、') || '值班室复核'} 恢复放行`, { conclusionId: next.id })
    return { ok: true, message: `放行已恢复：${next.id}` }
  }

  // ---------- 溯源 ----------

  /** 沿设备与批次找到判定来源：批次 → 结论 → 缺陷 → 冲突 全链 */
  function lineageOf(recordId: string) {
    return {
      batches: batches.value.filter((item) => item.recordId === recordId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      conclusions: conclusions.value.filter((item) => item.recordId === recordId).sort((a, b) => a.decidedAt.localeCompare(b.decidedAt)),
      defects: defects.value.filter((item) => item.recordId === recordId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      conflicts: conflicts.value.filter((item) => item.recordId === recordId).sort((a, b) => a.collectedAt.localeCompare(b.collectedAt))
    }
  }

  function resetDemo() {
    records.value = structuredClone(seedRecords)
    audit.value = structuredClone(seedAudit)
    batches.value = structuredClone(seedBatches)
    conflicts.value = structuredClone(seedConflicts)
    defects.value = structuredClone(seedDefects)
    conclusions.value = structuredClone(seedConclusions)
  }

  watch([records, audit, batches, conflicts, defects, conclusions], () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      records: records.value,
      audit: audit.value,
      batches: batches.value,
      conflicts: conflicts.value,
      defects: defects.value,
      conclusions: conclusions.value
    }))
  }, { deep: true })

  return {
    records, audit, batches, conflicts, defects, conclusions,
    keyword, status, area, liveMessage, offline,
    filtered, stats, syncStats,
    addRecord, updateRecord, transition,
    packOfflineBatch, flushOutbox, resolveConflict,
    advanceDefect, revalidateDefect, issueRelease, revalidateRelease,
    lineageOf, activeJudgment, activeRelease, resetDemo
  }
})
