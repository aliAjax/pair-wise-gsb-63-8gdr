import type { FieldConflict, InspectionRecord, SyncBatch } from '../types'
import { getFieldValue, mergeableFields, setFieldValue, valuesEqual } from './sync'

/**
 * 模拟值班室服务端（权威端）。
 * 独立 localStorage 命名空间，按字段维护版本元数据，
 * 支持幂等接收批次、基线比对合并与对端改动模拟。
 */

const SERVER_KEY = 'gsb63:inspection-server'

export interface ServerFieldMeta {
  value: string | boolean
  updatedAt: string
  updatedBy: string
}

interface ServerRecordState {
  record: InspectionRecord
  fields: Record<string, ServerFieldMeta>
}

interface ServerState {
  records: Record<string, ServerRecordState>
  receivedBatchIds: string[]
}

export interface ReceiveResult {
  ack: boolean
  conflicts: FieldConflict[]
  applied: string[]
  deduplicated: boolean
}

function buildState(records: InspectionRecord[]): ServerState {
  const state: ServerState = { records: {}, receivedBatchIds: [] }
  for (const record of records) {
    const fields: Record<string, ServerFieldMeta> = {}
    for (const field of mergeableFields(record)) {
      fields[field] = { value: getFieldValue(record, field), updatedAt: record.updatedAt, updatedBy: '系统基线' }
    }
    state.records[record.id] = { record: structuredClone(record), fields }
  }
  return state
}

function readState(): ServerState {
  try {
    const raw = localStorage.getItem(SERVER_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    /* 落回重新初始化 */
  }
  return buildState([])
}

function writeState(state: ServerState): void {
  localStorage.setItem(SERVER_KEY, JSON.stringify(state))
}

interface DivergenceEdit {
  recordId: string
  field: string
  value: string | boolean
  by: string
}

function applyDivergence(state: ServerState, divergence: DivergenceEdit[]): void {
  for (const edit of divergence) {
    const target = state.records[edit.recordId]
    if (!target) continue
    setFieldValue(target.record, edit.field, edit.value)
    target.fields[edit.field] = { value: edit.value, updatedAt: '2026-09-28T09:40:00', updatedBy: edit.by }
    target.record.version += 1
  }
}

/** 首次启动用种子记录初始化服务端，并叠加值班室预置改动制造基线分叉 */
export function ensureServerSeed(records: InspectionRecord[], divergence: DivergenceEdit[]): void {
  if (localStorage.getItem(SERVER_KEY)) return
  const state = buildState(records)
  applyDivergence(state, divergence)
  writeState(state)
}

export function resetServer(records: InspectionRecord[], divergence: DivergenceEdit[] = []): void {
  localStorage.removeItem(SERVER_KEY)
  const state = buildState(records)
  applyDivergence(state, divergence)
  writeState(state)
}

/**
 * 接收断网包：按字段三路合并。
 * - 服务端字段自基线以来未变 → 应用现场值；
 * - 两端收敛同值 → 视为已合并；
 * - 双方同字段不同值 → 保留两版，生成冲突待值班长确认。
 * 批次号幂等：已接收批次重投直接回 ACK，不重复落库。
 */
export function receiveBatch(batch: SyncBatch, options: { fail?: boolean } = {}): ReceiveResult {
  if (options.fail) throw new Error('模拟网络写入失败')
  const state = readState()
  if (state.receivedBatchIds.includes(batch.id)) {
    return { ack: true, conflicts: [], applied: [], deduplicated: true }
  }

  const now = new Date().toISOString()
  const conflicts: FieldConflict[] = []
  const applied: string[] = []
  let target = state.records[batch.recordId]

  if (!target) {
    if (!batch.snapshot) throw new Error(`服务端缺少记录 ${batch.recordId} 且批次无快照`)
    const fields: Record<string, ServerFieldMeta> = {}
    for (const field of mergeableFields(batch.snapshot)) {
      fields[field] = { value: getFieldValue(batch.snapshot, field), updatedAt: now, updatedBy: batch.inspector }
    }
    target = { record: structuredClone(batch.snapshot), fields }
    state.records[batch.recordId] = target
    state.receivedBatchIds.push(batch.id)
    writeState(state)
    return { ack: true, conflicts, applied: mergeableFields(batch.snapshot), deduplicated: false }
  }

  for (const op of batch.ops) {
    const meta = target.fields[op.field]
    if (!meta || valuesEqual(meta.value, op.baseline)) {
      setFieldValue(target.record, op.field, op.value)
      target.fields[op.field] = { value: op.value, updatedAt: now, updatedBy: batch.inspector }
      applied.push(op.field)
    } else if (!valuesEqual(meta.value, op.value)) {
      conflicts.push({
        id: `CFL-${batch.id}-${op.field}`,
        recordId: batch.recordId,
        deviceCode: batch.deviceCode,
        batchId: batch.id,
        field: op.field,
        label: op.label,
        localValue: op.value,
        localCollectedAt: op.collectedAt,
        localBy: batch.inspector,
        serverValue: meta.value,
        serverUpdatedAt: meta.updatedAt,
        serverBy: meta.updatedBy,
        status: '待确认'
      })
    }
  }

  if (applied.length) {
    target.record.version += 1
    target.record.updatedAt = now
  }
  state.receivedBatchIds.push(batch.id)
  writeState(state)
  return { ack: true, conflicts, applied, deduplicated: false }
}

/** 拉取服务端权威记录，用于回连后的下行合并 */
export function fetchServerRecords(): InspectionRecord[] {
  return Object.values(readState().records).map((entry) => structuredClone(entry.record))
}

/** 值班长确认后把最终值写回服务端，保持权威端一致 */
export function applyResolution(recordId: string, field: string, value: string | boolean, by: string): void {
  const state = readState()
  const target = state.records[recordId]
  if (!target) return
  const now = new Date().toISOString()
  setFieldValue(target.record, field, value)
  target.fields[field] = { value, updatedAt: now, updatedBy: by }
  target.record.version += 1
  target.record.updatedAt = now
  writeState(state)
}

/** 演示工具：模拟值班室/另一台平板在权威端直接改动，制造合并分叉 */
export function simulateExternalEdit(recordId: string, by: string, edits: Array<{ field: string; value: string | boolean }>): string[] {
  const state = readState()
  const target = state.records[recordId]
  if (!target) return []
  const now = new Date().toISOString()
  const changed: string[] = []
  for (const edit of edits) {
    setFieldValue(target.record, edit.field, edit.value)
    target.fields[edit.field] = { value: edit.value, updatedAt: now, updatedBy: by }
    changed.push(edit.field)
  }
  target.record.version += 1
  target.record.updatedAt = now
  writeState(state)
  return changed
}
