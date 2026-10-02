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
  /** 结论失效待重核：来源批次结论变更后置位，值班长重核确认后清除 */
  recheckNeeded: boolean
  /** 最近一次产生变更的批次号，用于沿批次追溯判定来源 */
  lastBatchId: string
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

/* ---------- 断网同步链 ---------- */

export type BatchStatus = '待上传' | '上传中' | '已接收' | '部分冲突' | '待重试'

/** 字段级变更：断网包内保留采集时刻与基线值，回连后按字段三路合并 */
export interface FieldOp {
  field: string
  label: string
  value: string | boolean
  baseline: string | boolean
  collectedAt: string
}

export interface SyncBatch {
  id: string
  recordId: string
  deviceCode: string
  deviceName: string
  inspector: string
  /** 采集时记录版本，作为合并基线 */
  baseVersion: number
  ops: FieldOp[]
  createdAt: string
  status: BatchStatus
  attempts: number
  ackedAt?: string
  note?: string
  /** 新建任务的完整快照，服务端缺失该记录时整体落库 */
  snapshot?: InspectionRecord
}

export type ConflictStatus = '待确认' | '已采纳现场' | '已采纳值班室'

/** 同字段两版并存，等值班长确认 */
export interface FieldConflict {
  id: string
  recordId: string
  deviceCode: string
  batchId: string
  field: string
  label: string
  localValue: string | boolean
  localCollectedAt: string
  localBy: string
  serverValue: string | boolean
  serverUpdatedAt: string
  serverBy: string
  status: ConflictStatus
  resolvedAt?: string
}

export type ConclusionType = '放行' | '停用'

/** 检验/复测结论：旧结论保留可查，失效原因可追溯来源批次 */
export interface Conclusion {
  id: string
  recordId: string
  deviceCode: string
  batchId: string
  baseVersion: number
  type: ConclusionType
  effective: boolean
  createdAt: string
  invalidatedAt?: string
  invalidatedReason?: string
}
