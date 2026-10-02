import type { ConclusionType, FieldOp, InspectionRecord } from '../types'

/** 参与字段级合并的标量字段 */
export const SCALAR_FIELDS = ['status', 'risk', 'stopped', 'assignedTo', 'dueDate'] as const

const SCALAR_NAMES: Record<string, string> = {
  status: '任务状态',
  risk: '风险等级',
  stopped: '设备隔离',
  assignedTo: '责任人',
  dueDate: '截止日期'
}

const ITEM_NAMES: Record<string, string> = {
  wear: '结构磨损',
  noise: '运行异响',
  brake: '制动装置',
  lock: '锁止机构',
  safety: '安全装置'
}

const SUBFIELD_NAMES: Record<string, string> = { result: '结果', reading: '实测值', note: '备注' }

export function fieldLabel(field: string): string {
  if (field.startsWith('items.')) {
    const [, itemId, sub] = field.split('.')
    return `${ITEM_NAMES[itemId] ?? itemId}·${SUBFIELD_NAMES[sub] ?? sub}`
  }
  return SCALAR_NAMES[field] ?? field
}

export function formatValue(field: string, value: unknown): string {
  if (field === 'stopped') return value === true || value === 'true' ? '停用隔离' : '正常开放'
  return String(value ?? '—')
}

export function getFieldValue(record: InspectionRecord, field: string): string | boolean {
  if (field.startsWith('items.')) {
    const [, itemId, sub] = field.split('.')
    const item = record.items.find((entry) => entry.id === itemId)
    const value = item ? (item as unknown as Record<string, string>)[sub] : ''
    return value ?? ''
  }
  return (record as unknown as Record<string, string | boolean>)[field] ?? ''
}

export function setFieldValue(record: InspectionRecord, field: string, value: string | boolean): void {
  if (field.startsWith('items.')) {
    const [, itemId, sub] = field.split('.')
    const item = record.items.find((entry) => entry.id === itemId)
    if (item) (item as unknown as Record<string, string>)[sub] = String(value)
    return
  }
  ;(record as unknown as Record<string, string | boolean>)[field] = value
}

export function valuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** 记录的全部可合并字段路径 */
export function mergeableFields(record: InspectionRecord): string[] {
  const itemFields = record.items.flatMap((item) => [
    `items.${item.id}.result`,
    `items.${item.id}.reading`,
    `items.${item.id}.note`
  ])
  return [...SCALAR_FIELDS, ...itemFields]
}

/** 对比保存前后两份记录，生成带采集时刻与基线值的字段级变更 */
export function diffRecord(before: InspectionRecord, after: InspectionRecord, collectedAt: string): FieldOp[] {
  const ops: FieldOp[] = []
  for (const field of mergeableFields(before)) {
    const baseline = getFieldValue(before, field)
    const value = getFieldValue(after, field)
    if (!valuesEqual(baseline, value)) {
      ops.push({ field, label: fieldLabel(field), value, baseline, collectedAt })
    }
  }
  return ops
}

/** 由逐项结果推导结论：任一异常即判定停用 */
export function computeConclusionType(record: InspectionRecord): ConclusionType {
  return record.items.some((item) => item.result === '异常') ? '停用' : '放行'
}

let sequence = 0
export function makeId(prefix: string): string {
  sequence = (sequence + 1) % 1000
  return `${prefix}-${Date.now().toString(36).toUpperCase()}${String(sequence).padStart(3, '0')}`
}
