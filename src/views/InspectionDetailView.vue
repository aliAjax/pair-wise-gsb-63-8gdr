<script setup lang="ts">
import { computed, h, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NDataTable, NInput, NSelect, NTag, useDialog, useMessage } from 'naive-ui'
import { useInspectionStore } from '../stores/inspection'
import { fieldLabel, getFieldValue } from '../services/sync'
import type { CheckResult, InspectionRecord, InspectionStatus, PendingChange } from '../types'

const route = useRoute()
const router = useRouter()
const store = useInspectionStore()
const message = useMessage()
const dialog = useDialog()
const record = computed(() => store.records.find((item) => item.id === route.params.id))
const form = reactive<Partial<InspectionRecord>>({})
const editTimes = reactive<Record<string, string>>({})
const packKind = ref<'检验' | '复测'>('检验')

const stopState = computed({
  get: () => form.stopped ? '停用隔离' : '正常开放',
  set: (value: string) => { form.stopped = value === '停用隔离'; mark('stopped') }
})

watch(record, (value) => {
  if (value) {
    Object.assign(form, structuredClone(value))
    packKind.value = value.status === '待复测' ? '复测' : '检验'
  }
}, { immediate: true })

const items = computed(() => record.value?.items ?? [])
const transitions: InspectionStatus[] = ['待检验', '需整改', '整改中', '待复测', '已关闭', '停用']
const lineage = computed(() => record.value ? store.lineageOf(record.value.id) : { batches: [], conclusions: [], defects: [], conflicts: [] })
const queuedBatches = computed(() => lineage.value.batches.filter((item) => item.status === '待同步' || item.status === '发送失败'))
const pendingConflicts = computed(() => lineage.value.conflicts.filter((item) => item.status === '待确认'))
const release = computed(() => lineage.value.conclusions.find((item) => item.kind === '放行结论' && item.state === '生效'))
const staleRelease = computed(() => lineage.value.conclusions.find((item) => item.kind === '放行结论' && item.state === '失效待重核'))
const hasAbnormal = computed(() => (record.value?.items ?? []).some((item) => item.result === '异常'))

function mark(field: string) {
  editTimes[field] = new Date().toISOString()
}

function fmt(value?: string) {
  return value ? value.replace('T', ' ').slice(0, 16) : '—'
}

/** 值班室直改：立即落库并触发结论重算 */
function save() {
  if (!record.value) return
  store.updateRecord(record.value.id, {
    assignedTo: form.assignedTo,
    dueDate: form.dueDate,
    risk: form.risk,
    stopped: form.stopped,
    items: form.items
  })
  message.success('值班室改动已生效，相关结论已重算')
}

/** 离线打包：只装发生变化的字段，保留采集时刻与基线 */
function collectChanges(): PendingChange[] {
  if (!record.value) return []
  const current = record.value
  const changes: PendingChange[] = []
  const push = (field: string, value: unknown) => {
    const next = String(value)
    if (getFieldValue(current, field) !== next) {
      changes.push({ field, label: fieldLabel(current, field), value: next, collectedAt: editTimes[field] ?? new Date().toISOString() })
    }
  }
  push('risk', form.risk)
  push('stopped', String(Boolean(form.stopped)))
  push('assignedTo', form.assignedTo ?? '')
  push('dueDate', form.dueDate ?? '')
  for (const item of form.items ?? []) {
    push(`items.${item.id}.result`, item.result)
    push(`items.${item.id}.reading`, item.reading)
    push(`items.${item.id}.note`, item.note)
  }
  return changes
}

function packBatch() {
  if (!record.value) return
  const changes = collectChanges()
  if (!changes.length) {
    message.info('没有字段变化，无需打包')
    return
  }
  const batch = store.packOfflineBatch(record.value.id, changes, packKind.value, record.value.inspector)
  if (batch) message.success(`已装入离线包 ${batch.id}（${changes.length} 项字段），回连后到同步中心重试`)
}

function changeStatus(next: InspectionStatus) {
  if (!record.value) return
  dialog.warning({
    title: `确认流转至${next}`,
    content: '系统会校验异常项、停用状态和复测要求，并写入操作审计。',
    positiveText: '确认流转',
    negativeText: '取消',
    onPositiveClick: () => {
      const result = store.transition(record.value!.id, next, `由${record.value!.status}流转至${next}`)
      result.ok ? message.success(result.message) : message.error(result.message)
    }
  })
}

function releaseNow() {
  if (!record.value) return
  const result = store.issueRelease(record.value.id)
  result.ok ? message.success(result.message) : message.error(result.message)
}

function revalidateRelease() {
  if (!record.value) return
  const result = store.revalidateRelease(record.value.id)
  result.ok ? message.success(result.message) : message.error(result.message)
}

function revalidateDefect(defectId: string) {
  const result = store.revalidateDefect(defectId)
  result.ok ? message.success(result.message) : message.error(result.message)
}

const columns = [
  { title: '检验项', key: 'name', width: 130 },
  { title: '结果', key: 'result', width: 120, render: (row: any) => h(NSelect, { value: row.result, options: ['正常', '异常', '不适用'].map((value) => ({ label: value, value })), onUpdateValue: (value: CheckResult) => { row.result = value; mark(`items.${row.id}.result`) } }) },
  { title: '实测值', key: 'reading', width: 160, render: (row: any) => h(NInput, { value: row.reading, onUpdateValue: (value: string) => { row.reading = value; mark(`items.${row.id}.reading`) } }) },
  { title: '判定标准', key: 'limit', width: 150 },
  { title: '备注', key: 'note', render: (row: any) => h(NInput, { value: row.note, onUpdateValue: (value: string) => { row.note = value; mark(`items.${row.id}.note`) } }) }
]

const conclusionTag = (state: string): 'success' | 'warning' | 'default' => state === '生效' ? 'success' : state === '失效待重核' ? 'warning' : 'default'
const batchLabel = (id: string) => id === 'DIRECT' ? '值班室直改' : id

function exportRecord() {
  if (!record.value) return
  const blob = new Blob([JSON.stringify({ record: record.value, lineage: lineage.value }, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${record.value.id}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <section v-if="record" class="content detail-layout">
    <div class="detail-main">
      <div class="section-head">
        <div>
          <p>{{ record.deviceCode }} · {{ record.area }} · {{ record.shift }}</p>
          <h2>{{ record.deviceName }}</h2>
        </div>
        <div class="head-actions">
          <NTag :type="record.stopped ? 'error' : record.status === '已关闭' ? 'success' : 'warning'" :bordered="false">{{ record.stopped ? '设备已停用' : record.status }}</NTag>
          <NButton @click="exportRecord">导出记录</NButton>
          <NButton @click="save">值班室直改</NButton>
          <NSelect v-model:value="packKind" :options="['检验', '复测'].map((value) => ({ label: `${value}包`, value }))" style="width: 96px" />
          <NButton type="primary" @click="packBatch">离线打包</NButton>
        </div>
      </div>

      <div v-if="queuedBatches.length" class="sync-banner">
        <span>有 {{ queuedBatches.length }} 个离线包待回连同步（{{ queuedBatches.map((item) => item.id).join('、') }}），后到包不会覆盖已合并结果。</span>
        <a @click="router.push('/sync')">去同步中心 →</a>
      </div>
      <div v-if="pendingConflicts.length" class="sync-banner warning">
        <span>{{ pendingConflicts.length }} 个字段与值班室版本冲突，两版并存待值班长确认。</span>
        <a @click="router.push('/sync')">去裁决 →</a>
      </div>

      <div class="form-band">
        <label>整改责任人 <NInput v-model:value="form.assignedTo" @update:value="mark('assignedTo')" /></label>
        <label>截止日期 <input v-model="form.dueDate" class="native-date" type="date" @input="mark('dueDate')" /></label>
        <label>风险等级 <NSelect v-model:value="form.risk" :options="['低', '中', '高', '紧急'].map((value) => ({ label: value, value }))" @update:value="mark('risk')" /></label>
        <label>设备状态 <NSelect v-model:value="stopState" :options="['正常开放', '停用隔离'].map((value) => ({ label: value, value }))" /></label>
      </div>

      <h3>逐项检验结果</h3>
      <NDataTable :columns="columns" :data="items" :bordered="false" size="small" />

      <div class="release-panel">
        <div>
          <strong>放行结论</strong>
          <p v-if="release">
            <NTag type="success" size="small" :bordered="false">生效</NTag>
            {{ release.id }} · {{ release.verdict }} · {{ release.decidedBy }} · {{ fmt(release.decidedAt) }}
          </p>
          <p v-else-if="staleRelease" class="stale">
            <NTag type="warning" size="small" :bordered="false">失效待重核</NTag>
            {{ staleRelease.id }} 因{{ staleRelease.invalidatedReason }}失效，需值班长重核
          </p>
          <p v-else>尚未签发放行结论</p>
        </div>
        <NButton v-if="staleRelease" type="warning" @click="revalidateRelease">重核放行</NButton>
        <NButton v-else-if="!release" type="primary" :disabled="hasAbnormal" @click="releaseNow">签发放行</NButton>
      </div>

      <div class="lineage-panel">
        <h3>判定来源链</h3>
        <div v-for="conclusion in lineage.conclusions" :key="conclusion.id" class="lineage-row">
          <NTag :type="conclusionTag(conclusion.state)" size="small" :bordered="false">{{ conclusion.state }}</NTag>
          <div>
            <strong>{{ conclusion.id }} · {{ conclusion.kind }} V{{ conclusion.version }}</strong>
            <p>{{ conclusion.verdict }}</p>
            <small>来源批次 {{ batchLabel(conclusion.batchId) }} · {{ conclusion.decidedBy }} · {{ fmt(conclusion.decidedAt) }}<template v-if="conclusion.invalidatedReason"> · {{ conclusion.invalidatedReason }}</template></small>
          </div>
        </div>
        <div v-for="defect in lineage.defects" :key="defect.id" class="lineage-row">
          <NTag :type="defect.status === '失效待重核' ? 'warning' : defect.status === '已闭环' ? 'success' : 'default'" size="small" :bordered="false">{{ defect.status }}</NTag>
          <div>
            <strong>{{ defect.id }} · {{ defect.title }}</strong>
            <small>来源批次 {{ batchLabel(defect.sourceBatchId) }} · 锚定结论 {{ defect.sourceConclusionId || '—' }}</small>
          </div>
          <NButton v-if="defect.status === '失效待重核'" size="tiny" type="warning" @click="revalidateDefect(defect.id)">重核</NButton>
        </div>
        <p v-if="!lineage.conclusions.length && !lineage.defects.length" class="lineage-empty">尚无判定结论，离线包合并后自动生成。</p>
      </div>

      <div class="evidence-panel">
        <div><strong>现场证据</strong><span>{{ record.evidenceCount }} 张照片 · 最近上传 09:31</span></div>
        <div class="evidence-list"><span>锁止间隙近景</span><span>设备铭牌</span><span>制动测试仪表</span><button @click="record.evidenceCount += 1; message.success('已模拟上传现场照片')">上传照片</button></div>
      </div>
    </div>

    <aside class="detail-side">
      <div>
        <span class="side-label">当前流程</span>
        <strong>{{ record.status }}</strong>
        <small>版本 V{{ record.version }} · 更新于 {{ fmt(record.updatedAt) }}</small>
      </div>
      <div class="flow-list">
        <button v-for="status in transitions" :key="status" :class="{ active: status === record.status }" @click="changeStatus(status)">
          <span>{{ status }}</span><small>{{ status === record.status ? '当前状态' : '执行流转' }}</small>
        </button>
      </div>
      <div class="rule-note">
        <strong>闭环校验</strong>
        <p>异常项存在时禁止关闭；紧急风险必须先停用设备。离线包按字段合并，结论变更会使缺陷与放行失效待重核，旧结论保留可查。</p>
      </div>
      <NButton block @click="router.push('/audit')">查看完整审计</NButton>
    </aside>
  </section>
  <section v-else class="content empty-state">未找到检验记录</section>
</template>
