import type { AuditEntry, Conclusion, Defect, FieldConflict, InspectionItem, InspectionRecord, SyncBatch } from '../types'

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
    items: standardItems(true), evidenceCount: 4, version: 3, createdAt: '2026-09-28T08:20:00', updatedAt: '2026-09-28T09:35:00'
  },
  {
    id: 'INS-240821-02', deviceCode: 'RC-007', deviceName: '家庭过山车', area: 'B区', shift: '早班', inspector: '李琪',
    inspectedAt: '2026-09-28T09:05:00', status: '整改中', risk: '中', stopped: false, assignedTo: '电气班组', dueDate: '2026-09-30',
    items: standardItems(true), evidenceCount: 2, version: 2, createdAt: '2026-09-28T09:05:00', updatedAt: '2026-09-28T11:10:00'
  },
  {
    id: 'INS-240821-03', deviceCode: 'CR-021', deviceName: '旋转木马', area: '亲子区', shift: '中班', inspector: '王璟',
    inspectedAt: '2026-09-27T15:40:00', status: '待复测', risk: '低', stopped: false, assignedTo: '检验二组', dueDate: '2026-09-29',
    items: standardItems(), evidenceCount: 3, version: 4, createdAt: '2026-09-27T15:40:00', updatedAt: '2026-09-28T10:25:00'
  },
  {
    id: 'INS-240821-04', deviceCode: 'WF-003', deviceName: '摩天轮', area: '湖景区', shift: '早班', inspector: '赵帆',
    inspectedAt: '2026-09-27T07:55:00', status: '已关闭', risk: '低', stopped: false, assignedTo: '维修二组', dueDate: '2026-09-28',
    items: standardItems(), evidenceCount: 5, version: 5, createdAt: '2026-09-27T07:55:00', updatedAt: '2026-09-28T16:20:00'
  }
]

export const seedBatches: SyncBatch[] = [
  {
    id: 'B-0929-01', recordId: 'INS-240821-01', deviceCode: 'AM-014', deviceName: '高空飞翔', kind: '复测',
    inspector: '周宁', shift: '早班', baseVersion: 3, status: '待同步', attempts: 0, createdAt: '2026-09-29T07:46:00',
    note: '断网点位采集，回连后同步',
    ops: [
      { field: 'items.wear.result', label: '结构磨损·结果', baseValue: '异常', value: '正常', collectedAt: '2026-09-29T07:31:00' },
      { field: 'items.wear.reading', label: '结构磨损·实测值', baseValue: '6.8 mm', value: '4.2 mm', collectedAt: '2026-09-29T07:31:00' },
      { field: 'items.lock.result', label: '锁止机构·结果', baseValue: '异常', value: '正常', collectedAt: '2026-09-29T07:38:00' },
      { field: 'items.lock.reading', label: '锁止机构·实测值', baseValue: '存在间隙', value: '闭合可靠', collectedAt: '2026-09-29T07:38:00' }
    ]
  },
  {
    id: 'B-0927-03', recordId: 'INS-240821-04', deviceCode: 'WF-003', deviceName: '摩天轮', kind: '检验',
    inspector: '赵帆', shift: '早班', baseVersion: 2, status: '待同步', attempts: 1, createdAt: '2026-09-27T07:58:00',
    note: '旧停用包：打包时拟停用观察，设备此后已复测放行',
    ops: [
      { field: 'stopped', label: '设备状态', baseValue: 'false', value: 'true', collectedAt: '2026-09-27T07:57:00' },
      { field: 'items.noise.reading', label: '运行异响·实测值', baseValue: '68 dB', value: '71 dB', collectedAt: '2026-09-27T07:56:00' }
    ]
  },
  {
    id: 'B-0928-05', recordId: 'INS-240821-02', deviceCode: 'RC-007', deviceName: '家庭过山车', kind: '检验',
    inspector: '李琪', shift: '晚班', baseVersion: 1, status: '冲突待裁决', attempts: 1, createdAt: '2026-09-28T20:15:00',
    syncedAt: '2026-09-28T20:40:00', note: '晚班复测包，回连时值班室已改过同字段',
    ops: [
      { field: 'items.wear.reading', label: '结构磨损·实测值', baseValue: '待录入', value: '5.9 mm', collectedAt: '2026-09-28T20:02:00' },
      { field: 'risk', label: '风险等级', baseValue: '低', value: '高', collectedAt: '2026-09-28T20:05:00' }
    ]
  },
  {
    id: 'B-0928-01', recordId: 'INS-240821-01', deviceCode: 'AM-014', deviceName: '高空飞翔', kind: '检验',
    inspector: '周宁', shift: '早班', baseVersion: 1, status: '已合并', attempts: 1, createdAt: '2026-09-28T08:24:00',
    syncedAt: '2026-09-28T08:26:00',
    ops: [
      { field: 'items.wear.result', label: '结构磨损·结果', baseValue: '正常', value: '异常', collectedAt: '2026-09-28T08:21:00' },
      { field: 'items.lock.result', label: '锁止机构·结果', baseValue: '正常', value: '异常', collectedAt: '2026-09-28T08:23:00' },
      { field: 'stopped', label: '设备状态', baseValue: 'false', value: 'true', collectedAt: '2026-09-28T08:24:00' }
    ]
  },
  {
    id: 'B-0928-02', recordId: 'INS-240821-02', deviceCode: 'RC-007', deviceName: '家庭过山车', kind: '检验',
    inspector: '李琪', shift: '早班', baseVersion: 1, status: '已合并', attempts: 1, createdAt: '2026-09-28T09:12:00',
    syncedAt: '2026-09-28T09:13:00',
    ops: [
      { field: 'items.wear.result', label: '结构磨损·结果', baseValue: '正常', value: '异常', collectedAt: '2026-09-28T09:08:00' },
      { field: 'items.lock.result', label: '锁止机构·结果', baseValue: '正常', value: '异常', collectedAt: '2026-09-28T09:10:00' }
    ]
  },
  {
    id: 'B-0927-01', recordId: 'INS-240821-03', deviceCode: 'CR-021', deviceName: '旋转木马', kind: '检验',
    inspector: '王璟', shift: '中班', baseVersion: 1, status: '已合并', attempts: 1, createdAt: '2026-09-27T15:48:00',
    syncedAt: '2026-09-27T15:52:00',
    ops: [
      { field: 'items.wear.result', label: '结构磨损·结果', baseValue: '正常', value: '异常', collectedAt: '2026-09-27T15:44:00' }
    ]
  },
  {
    id: 'B-0928-03', recordId: 'INS-240821-03', deviceCode: 'CR-021', deviceName: '旋转木马', kind: '复测',
    inspector: '王璟', shift: '中班', baseVersion: 3, status: '已合并', attempts: 1, createdAt: '2026-09-28T10:20:00',
    syncedAt: '2026-09-28T10:25:00',
    ops: [
      { field: 'items.wear.result', label: '结构磨损·结果', baseValue: '异常', value: '正常', collectedAt: '2026-09-28T10:18:00' }
    ]
  },
  {
    id: 'B-0927-02', recordId: 'INS-240821-04', deviceCode: 'WF-003', deviceName: '摩天轮', kind: '检验',
    inspector: '赵帆', shift: '早班', baseVersion: 4, status: '已合并', attempts: 1, createdAt: '2026-09-28T15:50:00',
    syncedAt: '2026-09-28T15:58:00',
    ops: [
      { field: 'items.noise.result', label: '运行异响·结果', baseValue: '异常', value: '正常', collectedAt: '2026-09-28T15:44:00' }
    ]
  }
]

export const seedConflicts: FieldConflict[] = [
  {
    id: 'CF-B-0928-05-items.wear.reading', recordId: 'INS-240821-02', deviceCode: 'RC-007', batchId: 'B-0928-05',
    field: 'items.wear.reading', label: '结构磨损·实测值', baseValue: '待录入',
    currentValue: '6.8 mm', currentSource: '值班室现行版', incomingValue: '5.9 mm', incomingInspector: '李琪',
    collectedAt: '2026-09-28T20:02:00', status: '待确认'
  },
  {
    id: 'CF-B-0928-05-risk', recordId: 'INS-240821-02', deviceCode: 'RC-007', batchId: 'B-0928-05',
    field: 'risk', label: '风险等级', baseValue: '低',
    currentValue: '中', currentSource: '值班室现行版', incomingValue: '高', incomingInspector: '李琪',
    collectedAt: '2026-09-28T20:05:00', status: '待确认'
  }
]

export const seedConclusions: Conclusion[] = [
  {
    id: 'CJ-01', recordId: 'INS-240821-01', deviceCode: 'AM-014', batchId: 'B-0928-01', kind: '检验判定',
    verdict: '判定：停用整改（结构磨损、锁止机构）', state: '生效', version: 1, dependsOn: [],
    decidedBy: '周宁', decidedAt: '2026-09-28T08:26:00'
  },
  {
    id: 'CJ-02', recordId: 'INS-240821-02', deviceCode: 'RC-007', batchId: 'B-0928-02', kind: '检验判定',
    verdict: '判定：限期整改（结构磨损、锁止机构）', state: '生效', version: 1, dependsOn: [],
    decidedBy: '李琪', decidedAt: '2026-09-28T09:13:00'
  },
  {
    id: 'CJ-03', recordId: 'INS-240821-03', deviceCode: 'CR-021', batchId: 'B-0927-01', kind: '检验判定',
    verdict: '判定：限期整改（结构磨损）', state: '已作废', version: 1, dependsOn: [],
    decidedBy: '王璟', decidedAt: '2026-09-27T15:52:00',
    invalidatedAt: '2026-09-28T10:25:00', invalidatedReason: '复测批次 B-0928-03 结论变更', supersededBy: 'CJ-04'
  },
  {
    id: 'CJ-04', recordId: 'INS-240821-03', deviceCode: 'CR-021', batchId: 'B-0928-03', kind: '复测判定',
    verdict: '判定：检验通过', state: '生效', version: 2, dependsOn: [],
    decidedBy: '王璟', decidedAt: '2026-09-28T10:25:00'
  },
  {
    id: 'CJ-05', recordId: 'INS-240821-04', deviceCode: 'WF-003', batchId: 'B-0927-02', kind: '检验判定',
    verdict: '判定：检验通过', state: '生效', version: 3, dependsOn: [],
    decidedBy: '赵帆', decidedAt: '2026-09-28T15:58:00'
  },
  {
    id: 'CJ-06', recordId: 'INS-240821-04', deviceCode: 'WF-003', batchId: 'B-0927-02', kind: '放行结论',
    verdict: '准予开放运行', state: '生效', version: 1, dependsOn: ['CJ-05'],
    decidedBy: '值班长·陈默', decidedAt: '2026-09-28T16:20:00'
  }
]

export const seedDefects: Defect[] = [
  {
    id: 'DF-01', recordId: 'INS-240821-01', deviceCode: 'AM-014', deviceName: '高空飞翔', itemId: 'wear', itemName: '结构磨损',
    title: '主支撑连接处磨损超限（6.8 mm）', risk: '高', status: '待处置',
    sourceBatchId: 'B-0928-01', sourceConclusionId: 'CJ-01', createdAt: '2026-09-28T08:26:00', updatedAt: '2026-09-28T08:26:00'
  },
  {
    id: 'DF-02', recordId: 'INS-240821-01', deviceCode: 'AM-014', deviceName: '高空飞翔', itemId: 'lock', itemName: '锁止机构',
    title: '安全压杠锁止存在回弹', risk: '高', status: '处置中',
    sourceBatchId: 'B-0928-01', sourceConclusionId: 'CJ-01', createdAt: '2026-09-28T08:26:00', updatedAt: '2026-09-28T11:02:00'
  },
  {
    id: 'DF-03', recordId: 'INS-240821-02', deviceCode: 'RC-007', deviceName: '家庭过山车', itemId: 'wear', itemName: '结构磨损',
    title: '主支撑连接处磨损超限（6.8 mm）', risk: '中', status: '处置中',
    sourceBatchId: 'B-0928-02', sourceConclusionId: 'CJ-02', createdAt: '2026-09-28T09:13:00', updatedAt: '2026-09-28T14:20:00'
  },
  {
    id: 'DF-04', recordId: 'INS-240821-02', deviceCode: 'RC-007', deviceName: '家庭过山车', itemId: 'lock', itemName: '锁止机构',
    title: '安全压杠锁止存在回弹', risk: '中', status: '待复测',
    sourceBatchId: 'B-0928-02', sourceConclusionId: 'CJ-02', createdAt: '2026-09-28T09:13:00', updatedAt: '2026-09-28T17:40:00'
  },
  {
    id: 'DF-05', recordId: 'INS-240821-03', deviceCode: 'CR-021', deviceName: '旋转木马', itemId: 'wear', itemName: '结构磨损',
    title: '顶棚支撑磨损复测合格', risk: '低', status: '复测通过',
    sourceBatchId: 'B-0928-03', sourceConclusionId: 'CJ-04', createdAt: '2026-09-27T15:52:00', updatedAt: '2026-09-28T10:25:00'
  }
]

export const seedAudit: AuditEntry[] = [
  ...seedRecords.flatMap((record) => [
    { id: `${record.id}-A1`, recordId: record.id, action: '创建检验记录', operator: record.inspector, detail: `${record.deviceName}完成班前检验`, createdAt: record.createdAt, deviceCode: record.deviceCode }
  ]),
  { id: 'AU-B-0928-01', recordId: 'INS-240821-01', deviceCode: 'AM-014', batchId: 'B-0928-01', conclusionId: 'CJ-01', action: '离线包合并', operator: '周宁', detail: '批次 B-0928-01 按字段合并 3 项，出具检验判定：停用整改', createdAt: '2026-09-28T08:26:00' },
  { id: 'AU-DF-01', recordId: 'INS-240821-01', deviceCode: 'AM-014', defectId: 'DF-01', batchId: 'B-0928-01', action: '缺陷登记', operator: '系统', detail: '结构磨损超限，生成缺陷 DF-01 待处置', createdAt: '2026-09-28T08:26:10' },
  { id: 'AU-B-0928-02', recordId: 'INS-240821-02', deviceCode: 'RC-007', batchId: 'B-0928-02', conclusionId: 'CJ-02', action: '离线包合并', operator: '李琪', detail: '批次 B-0928-02 按字段合并 2 项，出具检验判定：限期整改', createdAt: '2026-09-28T09:13:00' },
  { id: 'AU-B-0928-03', recordId: 'INS-240821-03', deviceCode: 'CR-021', batchId: 'B-0928-03', conclusionId: 'CJ-04', action: '复测包合并', operator: '王璟', detail: '批次 B-0928-03 复测合格，结论 CJ-03 作废，CJ-04 生效', createdAt: '2026-09-28T10:25:00' },
  { id: 'AU-CJ-06', recordId: 'INS-240821-04', deviceCode: 'WF-003', conclusionId: 'CJ-06', batchId: 'B-0927-02', action: '签发放行结论', operator: '值班长·陈默', detail: '依据检验判定 CJ-05 准予开放运行', createdAt: '2026-09-28T16:20:00' },
  { id: 'AU-B-0928-05', recordId: 'INS-240821-02', deviceCode: 'RC-007', batchId: 'B-0928-05', action: '合并冲突待裁决', operator: '系统', detail: '批次 B-0928-05 有 2 个字段与值班室版本冲突，两版并存待值班长确认', createdAt: '2026-09-28T20:40:00' }
]
