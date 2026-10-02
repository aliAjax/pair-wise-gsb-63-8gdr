<script setup lang="ts">
import { computed, h, reactive, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NDataTable, NInput, NSelect, NTag, useDialog, useMessage } from 'naive-ui'
import { useInspectionStore } from '../stores/inspection'
import { formatValue } from '../services/sync'
import type { CheckResult, InspectionRecord, InspectionStatus } from '../types'

const route = useRoute()
const router = useRouter()
const store = useInspectionStore()
const message = useMessage()
const dialog = useDialog()
const record = computed(() => store.records.find((item) => item.id === route.params.id))
const form = reactive<Partial<InspectionRecord>>({})
const stopState = computed({
  get: () => form.stopped ? '停用隔离' : '正常开放',
  set: (value: string) => { form.stopped = value === '停用隔离' }
})

watch(record, (value) => {
  if (value) Object.assign(form, structuredClone(value))
}, { immediate: true })

const items = computed(() => record.value?.items ?? [])
const transitions: InspectionStatus[] = ['待检验', '需整改', '整改中', '待复测', '已关闭', '停用']

const recordConflicts = computed(() => store.conflicts.filter((item) => item.recordId === route.params.id))
const recordConclusions = computed(() => store.conclusions.filter((item) => item.recordId === route.params.id))
const effectiveConclusion = computed(() => recordConclusions.value.find((item) => item.effective))
const sourceBatch = computed(() => store.batches.find((item) => item.id === effectiveConclusion.value?.batchId))

function save() {
  if (!record.value) return
  store.updateRecord(record.value.id, {
    assignedTo: form.assignedTo,
    dueDate: form.dueDate,
    risk: form.risk,
    stopped: form.stopped,
    items: form.items
  })
  if (store.online) {
    const result = store.syncAll()
    if (result.conflicted) message.warning('已保存并回连合并，存在字段冲突待值班长确认')
    else if (result.failed) message.error('已保存到断网包，部分批次写入失败待重试')
    else message.success('检验记录已保存，断网包已回连合并')
  } else {
    message.success('已保存到断网包，回连后按字段合并')
  }
}

function changeStatus(next: InspectionStatus) {
  if (!record.value) return
  dialog.warning({
    title: `确认流转至${next}`,
    content: '系统会校验异常项、停用状态和复测要求，流转写入断网包并记录审计。',
    positiveText: '确认流转',
    negativeText: '取消',
    onPositiveClick: () => {
      const result = store.transition(record.value!.id, next, `由${record.value!.status}流转至${next}`)
      result.ok ? message.success(result.message) : message.error(result.message)
    }
  })
}

function resolve(conflictId: string, adopt: 'local' | 'server') {
  store.resolveConflict(conflictId, adopt)
  message.success(`已采纳${adopt === 'local' ? '现场' : '值班室'}版本，结论链已重核`)
}

const columns = [
  { title: '检验项', key: 'name', width: 130 },
  { title: '结果', key: 'result', width: 120, render: (row: any, index: number) => h(NSelect, { value: row.result, options: ['正常', '异常', '不适用'].map((value) => ({ label: value, value })), onUpdateValue: (value: CheckResult) => { row.result = value } }) },
  { title: '实测值', key: 'reading', width: 160, render: (row: any) => h(NInput, { value: row.reading, onUpdateValue: (value: string) => { row.reading = value } }) },
  { title: '判定标准', key: 'limit', width: 150 },
  { title: '备注', key: 'note', render: (row: any) => h(NInput, { value: row.note, onUpdateValue: (value: string) => { row.note = value } }) }
]

function exportRecord() {
  if (!record.value) return
  const blob = new Blob([JSON.stringify(record.value, null, 2)], { type: 'application/json' })
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
      <div v-if="record.recheckNeeded" class="recheck-banner">
        <strong>结论失效待重核</strong>
        <span>来源批次结论变更，相关缺陷处置与放行结论已失效，请值班长重核。</span>
        <NButton size="small" type="warning" @click="store.confirmRecheck(record.id); message.success('已完成重核确认')">重核确认</NButton>
      </div>

      <div class="section-head">
        <div>
          <p>{{ record.deviceCode }} · {{ record.area }} · {{ record.shift }}</p>
          <h2>{{ record.deviceName }}</h2>
        </div>
        <div class="head-actions">
          <NTag :type="record.stopped ? 'error' : record.status === '已关闭' ? 'success' : 'warning'" :bordered="false">{{ record.stopped ? '设备已停用' : record.status }}</NTag>
          <NButton @click="exportRecord">导出记录</NButton>
          <NButton type="primary" @click="save">保存新版本</NButton>
        </div>
      </div>

      <div class="form-band">
        <label>整改责任人 <NInput v-model:value="form.assignedTo" /></label>
        <label>截止日期 <input v-model="form.dueDate" class="native-date" type="date" /></label>
        <label>风险等级 <NSelect v-model:value="form.risk" :options="['低', '中', '高', '紧急'].map((value) => ({ label: value, value }))" /></label>
        <label>设备状态 <NSelect v-model:value="stopState" :options="['正常开放', '停用隔离'].map((value) => ({ label: value, value }))" /></label>
      </div>

      <h3>逐项检验结果</h3>
      <NDataTable :columns="columns" :data="items" :bordered="false" size="small" />

      <div v-if="recordConflicts.length" class="conflict-panel">
        <h3>字段冲突 · 待值班长确认</h3>
        <article v-for="conflict in recordConflicts" :key="conflict.id" class="conflict-card" :class="{ resolved: conflict.status !== '待确认' }">
          <header>
            <div>
              <strong>{{ conflict.label }}</strong>
              <small>批次 {{ conflict.batchId }}</small>
            </div>
            <NTag :type="conflict.status === '待确认' ? 'warning' : 'success'" size="small" :bordered="false">{{ conflict.status }}</NTag>
          </header>
          <div class="version-compare">
            <div>
              <span>现场版 · {{ conflict.localBy }}</span>
              <strong>{{ formatValue(conflict.field, conflict.localValue) }}</strong>
              <small>采集于 {{ conflict.localCollectedAt.replace('T', ' ').slice(0, 16) }}</small>
            </div>
            <div>
              <span>值班室版 · {{ conflict.serverBy }}</span>
              <strong>{{ formatValue(conflict.field, conflict.serverValue) }}</strong>
              <small>更新于 {{ conflict.serverUpdatedAt.replace('T', ' ').slice(0, 16) }}</small>
            </div>
          </div>
          <footer v-if="conflict.status === '待确认'">
            <NButton size="small" type="primary" @click="resolve(conflict.id, 'local')">采纳现场版</NButton>
            <NButton size="small" @click="resolve(conflict.id, 'server')">采纳值班室版</NButton>
          </footer>
        </article>
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
        <small>版本 V{{ record.version }} · 更新于 {{ record.updatedAt.replace('T', ' ').slice(0, 16) }}</small>
      </div>

      <div v-if="effectiveConclusion" class="source-card">
        <span class="side-label">判定来源</span>
        <div class="source-body">
          <NTag :type="effectiveConclusion.type === '放行' ? 'success' : 'error'" size="small" :bordered="false">{{ effectiveConclusion.type }}</NTag>
          <strong>{{ effectiveConclusion.batchId }}</strong>
          <small>基线 V{{ effectiveConclusion.baseVersion }} · {{ effectiveConclusion.createdAt.replace('T', ' ').slice(0, 16) }}</small>
          <small v-if="sourceBatch">采集人 {{ sourceBatch.inspector }} · {{ sourceBatch.ops.length }} 个字段</small>
          <small v-else>值班室直改合并</small>
        </div>
      </div>

      <div class="flow-list">
        <button v-for="status in transitions" :key="status" :class="{ active: status === record.status }" @click="changeStatus(status)">
          <span>{{ status }}</span><small>{{ status === record.status ? '当前状态' : '执行流转' }}</small>
        </button>
      </div>

      <div v-if="recordConclusions.length" class="history-list">
        <span class="side-label">结论沿革（旧结论可查）</span>
        <article v-for="item in recordConclusions" :key="item.id" :class="{ faded: !item.effective }">
          <div>
            <NTag :type="item.effective ? (item.type === '放行' ? 'success' : 'error') : 'default'" size="small" :bordered="false">{{ item.effective ? item.type : `${item.type}·已失效` }}</NTag>
            <small>{{ item.batchId }}</small>
          </div>
          <small v-if="item.invalidatedReason">{{ item.invalidatedReason }}</small>
        </article>
      </div>

      <div class="rule-note">
        <strong>闭环校验</strong>
        <p>异常项存在时禁止关闭；紧急风险必须先停用设备。断网包回连后按字段合并，结论变更会触发缺陷与放行结论失效重核。</p>
      </div>
      <NButton block @click="router.push('/sync')">前往同步中心</NButton>
      <NButton block @click="router.push('/audit')">查看完整审计</NButton>
    </aside>
  </section>
  <section v-else class="content empty-state">未找到检验记录</section>
</template>
