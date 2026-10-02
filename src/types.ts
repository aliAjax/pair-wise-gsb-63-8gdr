export type InspectionStatus = '待检验' | '需整改' | '整改中' | '待复测' | '已关闭' | '停用'
export type RiskLevel = '低' | '中' | '高' | '紧急'
export type CheckResult = '正常' | '异常' | '不适用'

export interface InspectionItem {
  id: string
  name: string
  result: CheckResult
  reading: string
  limit: string
  note: string
}

export interface InspectionRecord {
  id: string
  deviceCode: string
  deviceName: string
  area: string
  shift: string
  inspector: string
  inspectedAt: string
  status: InspectionStatus
  risk: RiskLevel
  stopped: boolean
  assignedTo: string
  dueDate: string
  items: InspectionItem[]
  evidenceCount: number
  version: number
  createdAt: string
  updatedAt: string
}

// ---------- 离线同步链 ----------

/** 字段级变更操作：保留采集时刻与基线值，是断网包的最小合并单元 */
export interface FieldOp {
  field: string
  label: string
  baseValue: string
  value: string
  collectedAt: string
}

export type BatchKind = '检验' | '复测'
/** 待同步/发送失败 = 未接收批次，重试只针对这两类；已合并/冲突待裁决 = 已接收 */
export type BatchStatus = '待同步' | '发送失败' | '已合并' | '冲突待裁决'

export interface SyncBatch {
  id: string
  recordId: string
  deviceCode: string
  deviceName: string
  kind: BatchKind
  inspector: string
  shift: string
  baseVersion: number
  ops: FieldOp[]
  createdAt: string
  status: BatchStatus
  attempts: number
  syncedAt?: string
  note?: string
}

/** 同字段两版并存，等值班长确认 */
export interface FieldConflict {
  id: string
  recordId: string
  deviceCode: string
  batchId: string
  field: string
  label: string
  baseValue: string
  currentValue: string
  currentSource: string
  incomingValue: string
  incomingInspector: string
  collectedAt: string
  status: '待确认' | '已确认'
  keptValue?: string
  resolvedBy?: string
  resolvedAt?: string
}

export type ConclusionKind = '检验判定' | '复测判定' | '放行结论'
export type ConclusionState = '生效' | '失效待重核' | '已作废'

/** 判定结论：按批次出具，来源批次结论一变即失效重核，旧结论保留可查 */
export interface Conclusion {
  id: string
  recordId: string
  deviceCode: string
  batchId: string
  kind: ConclusionKind
  verdict: string
  state: ConclusionState
  version: number
  dependsOn: string[]
  decidedBy: string
  decidedAt: string
  invalidatedAt?: string
  invalidatedReason?: string
  supersededBy?: string
}

export type DefectStatus = '待处置' | '处置中' | '待复测' | '复测通过' | '已闭环' | '失效待重核'

export interface Defect {
  id: string
  recordId: string
  deviceCode: string
  deviceName: string
  itemId: string
  itemName: string
  title: string
  risk: RiskLevel
  status: DefectStatus
  sourceBatchId: string
  sourceConclusionId: string
  preInvalidationStatus?: DefectStatus
  createdAt: string
  updatedAt: string
}

export interface AuditEntry {
  id: string
  recordId: string
  action: string
  operator: string
  detail: string
  createdAt: string
  deviceCode?: string
  batchId?: string
  conclusionId?: string
  defectId?: string
}

export interface InspectionDraft {
  deviceCode: string
  deviceName: string
  area: string
  shift: string
  inspector: string
  risk: RiskLevel
  assignedTo: string
  dueDate: string
}

/** 详情页离线打包时提交的字段变更 */
export interface PendingChange {
  field: string
  label: string
  value: string
  collectedAt: string
}
