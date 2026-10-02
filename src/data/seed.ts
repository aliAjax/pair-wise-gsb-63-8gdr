import type { AuditEntry, Conclusion, InspectionItem, InspectionRecord, SyncBatch } from '../types'

const standardItems = (abnormal = false): InspectionItem[] => [
  { id: 'wear', name: '结构磨损', result: abnormal ? '异常' : '正常', reading: abnormal ? '6.8 mm' : '2.1 mm', limit: '≤ 5.0 mm', note: abnormal ? '主支撑连接处磨损超限' : '' },
  { id: 'noise', name: '运行异响', result: '正常', reading: '68 dB', limit: '≤ 75 dB', note: '' },
  { id: 'brake', name: '制动装置', result: '正常', reading: '制动距离 2.3 m', limit: '≤ 3.0 m', note: '' },
  { id: 'lock', name: '锁止机构', result: abnormal ? '异常' : '正常', reading: abnormal ? '存在间隙' : '闭合可靠', limit: '无可见间隙', note: abnormal ? '安全压杠锁止存在回弹' : '' },
  { id: 'safety', name: '安全装置', result: '正常', reading: '联锁有效', limit: '动作可靠', note: '' }
]

export const seedRecords: InspectionRecord[] = [
  {
    id: 'INS-240821-01', deviceCode: 'AM-014', deviceName: '高空飞翔', area: 'A区北侧', shift: '早班', inspector: '周宁',
    inspectedAt: '2026-09-28T08:20:00', status: '需整改', risk: '高', stopped: true, assignedTo: '维修一组', dueDate: '2026-09-29',
    items: standardItems(true), evidenceCount: 4, version: 3, createdAt: '2026-09-28T08:20:00', updatedAt: '2026-09-28T09:35:00',
    recheckNeeded: false, lastBatchId: 'BATCH-0928-00'
  },
  {
    id: 'INS-240821-02', deviceCode: 'RC-007', deviceName: '家庭过山车', area: 'B区', shift: '早班', inspector: '李琪',
    inspectedAt: '2026-09-28T09:05:00', status: '整改中', risk: '中', stopped: false, assignedTo: '电气班组', dueDate: '2026-09-30',
    items: standardItems(true), evidenceCount: 2, version: 2, createdAt: '2026-09-28T09:05:00', updatedAt: '2026-09-28T11:10:00',
    recheckNeeded: false, lastBatchId: 'BATCH-0928-00'
  },
  {
    id: 'INS-240821-03', deviceCode: 'CR-021', deviceName: '旋转木马', area: '亲子区', shift: '中班', inspector: '王璟',
    inspectedAt: '2026-09-27T15:40:00', status: '待复测', risk: '低', stopped: false, assignedTo: '检验二组', dueDate: '2026-09-29',
    items: standardItems(), evidenceCount: 3, version: 4, createdAt: '2026-09-27T15:40:00', updatedAt: '2026-09-28T10:25:00',
    recheckNeeded: false, lastBatchId: 'BATCH-0927-02'
  },
  {
    id: 'INS-240821-04', deviceCode: 'WF-003', deviceName: '摩天轮', area: '湖景区', shift: '早班', inspector: '赵帆',
    inspectedAt: '2026-09-27T07:55:00', status: '已关闭', risk: '低', stopped: false, assignedTo: '维修二组', dueDate: '2026-09-28',
    items: standardItems(), evidenceCount: 5, version: 5, createdAt: '2026-09-27T07:55:00', updatedAt: '2026-09-28T16:20:00',
    recheckNeeded: false, lastBatchId: 'BATCH-0928-03'
  }
]

export const seedAudit: AuditEntry[] = seedRecords.flatMap((record) => [
  { id: `${record.id}-A1`, recordId: record.id, action: '创建检验记录', operator: record.inspector, detail: `${record.deviceName}完成班前检验`, createdAt: record.createdAt, deviceCode: record.deviceCode },
  ...(record.version > 1 ? [{ id: `${record.id}-A${record.version}`, recordId: record.id, action: record.status, operator: '系统流转', detail: `记录更新至版本 V${record.version}`, createdAt: record.updatedAt, deviceCode: record.deviceCode }] : [])
])

/** 预置断网包：李琪的平板在早班离线采集，尚未回连上传 */
export const seedBatches: SyncBatch[] = [
  {
    id: 'BATCH-0928-01',
    recordId: 'INS-240821-01',
    deviceCode: 'AM-014',
    deviceName: '高空飞翔',
    inspector: '李琪',
    baseVersion: 3,
    createdAt: '2026-09-28T09:50:00',
    status: '待上传',
    attempts: 0,
    note: '早班断网复测包',
    ops: [
      { field: 'items.wear.reading', label: '结构磨损·实测值', value: '7.0 mm', baseline: '6.8 mm', collectedAt: '2026-09-28T09:48:00' },
      { field: 'items.wear.note', label: '结构磨损·备注', value: '复测磨损 7.0 mm，建议继续停用', baseline: '主支撑连接处磨损超限', collectedAt: '2026-09-28T09:48:30' },
      { field: 'risk', label: '风险等级', value: '紧急', baseline: '高', collectedAt: '2026-09-28T09:49:00' }
    ]
  }
]

/** 结论链：含一条已被取代的旧结论，演示旧结论仍可查 */
export const seedConclusions: Conclusion[] = [
  { id: 'CON-0928-04', recordId: 'INS-240821-04', deviceCode: 'WF-003', batchId: 'BATCH-0928-03', baseVersion: 5, type: '放行', effective: true, createdAt: '2026-09-28T16:20:00' },
  { id: 'CON-0927-09', recordId: 'INS-240821-04', deviceCode: 'WF-003', batchId: 'BATCH-0927-07', baseVersion: 3, type: '停用', effective: false, createdAt: '2026-09-27T14:05:00', invalidatedAt: '2026-09-28T16:20:00', invalidatedReason: '被批次 BATCH-0928-03 新结论取代' },
  { id: 'CON-0928-03', recordId: 'INS-240821-03', deviceCode: 'CR-021', batchId: 'BATCH-0927-02', baseVersion: 4, type: '放行', effective: true, createdAt: '2026-09-28T10:25:00' },
  { id: 'CON-0928-02', recordId: 'INS-240821-02', deviceCode: 'RC-007', batchId: 'BATCH-0928-00', baseVersion: 2, type: '停用', effective: true, createdAt: '2026-09-28T11:10:00' },
  { id: 'CON-0928-01', recordId: 'INS-240821-01', deviceCode: 'AM-014', batchId: 'BATCH-0928-00', baseVersion: 3, type: '停用', effective: true, createdAt: '2026-09-28T09:35:00' }
]

/** 服务端预置分叉：值班室在李琪离线期间改动了同一台设备 */
export const seedServerDivergence = [
  { recordId: 'INS-240821-01', field: 'items.wear.reading', value: '7.2 mm', by: '值班室·刘工' },
  { recordId: 'INS-240821-01', field: 'items.wear.note', value: '值班室复核：磨损加剧，维持停用', by: '值班室·刘工' }
]
