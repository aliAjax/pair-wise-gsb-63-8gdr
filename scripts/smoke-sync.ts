/* 同步链核心流程冒烟测试（node + localStorage shim） */
import { ensureServerSeed, receiveBatch, fetchServerRecords, applyResolution, resetServer, simulateExternalEdit } from '../src/services/server'
import { seedRecords, seedBatches, seedServerDivergence } from '../src/data/seed'
import { diffRecord, computeConclusionType, getFieldValue } from '../src/services/sync'

let passed = 0
let failed = 0
function check(name: string, cond: boolean) {
  if (cond) { passed += 1; console.log(`  ok  ${name}`) }
  else { failed += 1; console.log(`FAIL  ${name}`) }
}

// 1. 初始化：服务端带值班室分叉
ensureServerSeed(seedRecords, seedServerDivergence)
const serverBefore = fetchServerRecords().find((r) => r.id === 'INS-240821-01')!
check('服务端预置值班室改动 7.2 mm', getFieldValue(serverBefore, 'items.wear.reading') === '7.2 mm')

// 2. 断网包回连：risk 应用，wear.reading/note 冲突
const batch = structuredClone(seedBatches[0])
const result = receiveBatch(batch)
check('批次被接收', result.ack && !result.deduplicated)
check('risk 字段应用', result.applied.includes('risk'))
check('wear.reading 产生冲突', result.conflicts.some((c) => c.field === 'items.wear.reading' && c.localValue === '7.0 mm' && c.serverValue === '7.2 mm'))
check('wear.note 产生冲突', result.conflicts.some((c) => c.field === 'items.wear.note'))
const serverAfter = fetchServerRecords().find((r) => r.id === 'INS-240821-01')!
check('服务端 risk 已更新为紧急', getFieldValue(serverAfter, 'risk') === '紧急')
check('冲突字段未被现场值覆盖', getFieldValue(serverAfter, 'items.wear.reading') === '7.2 mm')

// 3. 幂等：同批次重投不重复落库
const again = receiveBatch(batch)
check('重复投递幂等去重', again.deduplicated && again.conflicts.length === 0)

// 4. 写入失败：抛错且不落库
const failBatch = { ...structuredClone(batch), id: 'BATCH-FAIL-01' }
let threw = false
try { receiveBatch(failBatch, { fail: true }) } catch { threw = true }
check('写入失败抛错', threw)
const recovered = receiveBatch(failBatch)
check('失败批次可重试且被接收', recovered.ack && !recovered.deduplicated)

// 5. 值班长确认写回权威端
applyResolution('INS-240821-01', 'items.wear.reading', '7.0 mm', '值班长')
check('确认值写回服务端', getFieldValue(fetchServerRecords().find((r) => r.id === 'INS-240821-01')!, 'items.wear.reading') === '7.0 mm')

// 6. 对端改动 + 结论推导
simulateExternalEdit('INS-240821-03', '李琪（另一台平板）', [{ field: 'items.lock.result', value: '异常' }])
const flipped = fetchServerRecords().find((r) => r.id === 'INS-240821-03')!
check('对端改动后结论翻转为停用', computeConclusionType(flipped) === '停用')

// 7. diff 生成带基线的字段变更
const before = structuredClone(seedRecords[0])
const after = structuredClone(seedRecords[0])
after.stopped = false
after.items[0].reading = '5.0 mm'
const ops = diffRecord(before, after, '2026-10-02T08:00:00')
check('diff 捕获 stopped 与 wear.reading', ops.length === 2 && ops.every((op) => op.collectedAt === '2026-10-02T08:00:00'))
check('op 保留基线值', ops.find((op) => op.field === 'stopped')?.baseline === true)

resetServer(seedRecords, seedServerDivergence)
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
