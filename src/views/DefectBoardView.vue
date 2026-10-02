<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NTag, useMessage } from 'naive-ui'
import { useInspectionStore } from '../stores/inspection'
import type { DefectStatus } from '../types'

const store = useInspectionStore()
const router = useRouter()
const message = useMessage()
const columns = ['需整改', '整改中', '待复测', '已关闭'] as const
const riskOrder = { 紧急: 0, 高: 1, 中: 2, 低: 3 }
const grouped = computed(() => Object.fromEntries(columns.map((status) => [status, store.records.filter((item) => item.status === status).sort((a, b) => riskOrder[a.risk] - riskOrder[b.risk])])))

const defectStatusType: Record<DefectStatus, 'default' | 'info' | 'warning' | 'success' | 'error'> = {
  待处置: 'error',
  处置中: 'info',
  待复测: 'warning',
  复测通过: 'success',
  已闭环: 'default',
  失效待重核: 'warning'
}

const orderedDefects = computed(() => [...store.defects].sort((a, b) => {
  if (a.status === '失效待重核' && b.status !== '失效待重核') return -1
  if (b.status === '失效待重核' && a.status !== '失效待重核') return 1
  return riskOrder[a.risk] - riskOrder[b.risk]
}))

const nextAction: Partial<Record<DefectStatus, string>> = { 待处置: '开始处置', 处置中: '提交整改', 复测通过: '闭环确认' }

function advance(defectId: string) {
  const result = store.advanceDefect(defectId, '当前用户')
  result.ok ? message.success(result.message) : message.error(result.message)
}

function revalidate(defectId: string) {
  const result = store.revalidateDefect(defectId)
  result.ok ? message.success(result.message) : message.error(result.message)
}

function fmt(value?: string) {
  return value ? value.replace('T', ' ').slice(0, 16) : '—'
}

const batchLabel = (id: string) => id === 'DIRECT' ? '值班室直改' : id
</script>

<template>
  <section class="content">
    <div class="board-intro">
      <div><h2>缺陷处置泳道</h2><p>按风险等级排列未闭环任务，点击卡片进入现场处置记录。</p></div>
      <NButton @click="store.resetDemo(); message.success('已恢复演示数据')">恢复演示数据</NButton>
    </div>
    <div class="kanban">
      <div v-for="column in columns" :key="column" class="kanban-column">
        <header><span>{{ column }}</span><b>{{ grouped[column].length }}</b></header>
        <article v-for="record in grouped[column]" :key="record.id" @click="router.push(`/records/${record.id}`)">
          <div><NTag :type="record.risk === '紧急' ? 'error' : record.risk === '高' ? 'warning' : 'default'" size="small" :bordered="false">{{ record.risk }}风险</NTag><small>V{{ record.version }}</small></div>
          <h3>{{ record.deviceName }}</h3>
          <p>{{ record.deviceCode }} · {{ record.area }}</p>
          <footer><span>{{ record.assignedTo }}</span><span :class="{ overdue: record.dueDate <= '2026-09-29' }">{{ record.dueDate }} 截止</span></footer>
        </article>
        <div v-if="!grouped[column].length" class="kanban-empty">暂无任务</div>
      </div>
    </div>

    <div class="defect-chain">
      <h3>缺陷闭环链</h3>
      <p class="chain-note">来源批次结论一变，缺陷随即失效待重核；重核后锚定当前生效结论，旧结论仍可在审计中追溯。</p>
      <table class="defect-table">
        <thead>
          <tr><th>缺陷</th><th>设备</th><th>风险</th><th>状态</th><th>来源批次</th><th>锚定结论</th><th>更新</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="defect in orderedDefects" :key="defect.id" :class="{ stale: defect.status === '失效待重核' }">
            <td><strong>{{ defect.id }}</strong> {{ defect.title }}</td>
            <td><a @click="router.push(`/records/${defect.recordId}`)">{{ defect.deviceName }} / {{ defect.deviceCode }}</a></td>
            <td>{{ defect.risk }}</td>
            <td><NTag :type="defectStatusType[defect.status]" size="small" :bordered="false">{{ defect.status }}</NTag></td>
            <td>{{ batchLabel(defect.sourceBatchId) }}</td>
            <td>{{ defect.sourceConclusionId || '—' }}</td>
            <td>{{ fmt(defect.updatedAt) }}</td>
            <td>
              <NButton v-if="defect.status === '失效待重核'" size="tiny" type="warning" @click="revalidate(defect.id)">重核</NButton>
              <NButton v-else-if="nextAction[defect.status]" size="tiny" @click="advance(defect.id)">{{ nextAction[defect.status] }}</NButton>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
