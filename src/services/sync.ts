import type { FieldConflict, FieldOp, InspectionRecord, SyncBatch } from '../types'

/** 结论相关字段：这些字段被合并或改动时，需要重算判定结论 */
export const CONCLUSION_FIELDS = /^(stopped|risk|items\.[^.]+\.result)$/

export const RECORD_FIELD_LABELS: Record<string, string> = {
  risk: '风险等级',
  stopped: '设备状态',
  assignedTo: '整改责任人',
  dueDate: '截止日期'
}

export function fieldLabel(record: InspectionRecord, field: string): string {
  if (RECORD_FIELD_LABELS[field]) return RECORD_FIELD_LABELS[field]
  const match = field.match(/^items\.([^.]+)\.(result|reading|note)$/)
  if (!match) return field
  const item = record.items.find((entry) => entry.id === match[1])
  const part = { result: '结果', reading: '实测值', note: '备注' }[match[2] as 'result' | 'reading' | 'note']
  return `${item?.name ?? match[1]}·${part}`
}

export function getFieldValue(record: InspectionRecord, field: string): string {
  if (field === 'stopped') return String(record.stopped)
  if (field === 'risk' || field === 'assignedTo' || field === 'dueDate') return String(record[field])
  const match = field.match(/^items\.([^.]+)\.(result|reading|note)$/)
  const item = match ? record.items.find((entry) => entry.id === match[1]) : undefined
  if (!item || !match) return ''
  return String(item[match[2] as 'result' | 'reading' | 'note'])
}

export function setFieldValue(record: InspectionRecord, field: string, value: string): void {
  if (field === 'stopped') { record.stopped = value === 'true'; return }
  if (field === 'risk') { record.risk = value as InspectionRecord['risk']; return }
  if (field === 'assignedTo' || field === 'dueDate') { record[field] = value; return }
  const match = field.match(/^items\.([^.]+)\.(result|reading|note)$/)
  const item = match ? record.items.find((entry) => entry.id === match[1]) : undefined
  if (!item || !match) return
  const key = match[2] as 'result' | 'reading' | 'note'
  if (key === 'result') item.result = value as InspectionRecord['items'][number]['result']
  else item[key] = value
}

export interface MergeOutcome {
  applied: FieldOp[]
  deduped: FieldOp[]
  conflicts: FieldConflict[]
}

/**
 * 断网包按字段合并：
 * 1. 现行值已等于包内值 → 重复提交去重，幂等跳过；
 * 2. 现行值仍等于基线值 → 无人动过该字段，直接落值；
 * 3. 设备存在生效放行结论时，结论相关字段一律转入值班长确认，防止旧包把已放行设备改回停用；
 * 4. 其余（值班室已改过同字段）→ 同字段保留两版，等值班长确认。
 */
export function mergeBatchIntoRecord(record: InspectionRecord, batch: SyncBatch, releaseProtected: boolean): MergeOutcome {
  const outcome: MergeOutcome = { applied: [], deduped: [], conflicts: [] }
  for (const op of batch.ops) {
    const current = getFieldValue(record, op.field)
    if (current === op.value) {
      outcome.deduped.push(op)
      continue
    }
    const protectedField = releaseProtected && CONCLUSION_FIELDS.test(op.field)
    if (current !== op.baseValue || protectedField) {
      outcome.conflicts.push({
        id: `CF-${batch.id}-${op.field}`,
        recordId: record.id,
        deviceCode: record.deviceCode,
        batchId: batch.id,
        field: op.field,
        label: op.label || fieldLabel(record, op.field),
        baseValue: op.baseValue,
        currentValue: current,
        currentSource: protectedField && current === op.baseValue ? '生效放行结论保护' : '值班室现行版',
        incomingValue: op.value,
        incomingInspector: batch.inspector,
        collectedAt: op.collectedAt,
        status: '待确认'
      })
      continue
    }
    setFieldValue(record, op.field, op.value)
    outcome.applied.push(op)
  }
  return outcome
}

/** 依据当前逐项结果汇总判定口径 */
export function deriveVerdict(record: InspectionRecord): string {
  const abnormal = record.items.filter((item) => item.result === '异常')
  if (!abnormal.length) return record.stopped ? '判定：检验通过，待放行复核' : '判定：检验通过'
  const names = abnormal.map((item) => item.name).join('、')
  return record.stopped ? `判定：停用整改（${names}）` : `判定：限期整改（${names}）`
}
