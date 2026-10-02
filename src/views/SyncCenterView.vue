<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NSwitch, NTag, useMessage } from 'naive-ui'
import { useInspectionStore } from '../stores/inspection'
import type { BatchStatus } from '../types'

const store = useInspectionStore()
const router = useRouter()
const message = useMessage()
const expanded = ref<string[]>([])

const statusType: Record<BatchStatus, 'default' | 'error' | 'success' | 'warning'> = {
  待同步: 'default',
  发送失败: 'error',
  已合并: 'success',
  冲突待裁决: 'warning'
}

const orderedBatches = computed(() => [...store.batches].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
const pendingConflicts = computed(() => store.conflicts.filter((item) => item.status === '待确认'))
const resolvedConflicts = computed(() => store.conflicts.filter((item) => item.status === '已确认'))

function flush() {
  const summary = store.flushOutbox()
  if (!summary.total) {
    message.info('没有未接收批次，已接收批次不会重发')
    return
  }
  if (summary.failed) message.error(`${summary.failed} 个批次写入未获接收，已保留在重试队列`)
  if (summary.merged) message.success(`${summary.merged} 个批次已按字段合并`)
  if (summary.conflicted) message.warning(`${summary.conflicted} 个批次存在同字段冲突，待值班长确认`)
}

function toggleExpand(id: string) {
  expanded.value = expanded.value.includes(id) ? expanded.value.filter((item) => item !== id) : [...expanded.value, id]
}

function decide(id: string, keep: 'current' | 'incoming') {
  const result = store.resolveConflict(id, keep)
  result.ok ? message.success(result.message) : message.error(result.message)
}

function fmt(value?: string) {
  return value ? value.replace('T', ' ').slice(0, 16) : '—'
}
</script>

<template>
  <section class="content">
    <div class="sync-head">
      <div>
        <h2>离线同步与冲突裁决</h2>
        <p>断网包按字段合并，包内保留采集时刻与基线；写入失败只重试未接收批次，同字段两版等值班长确认。</p>
      </div>
      <div class="sync-controls">
        <label class="offline-toggle">
          <NSwitch v-model:value="store.offline" />
          <span>{{ store.offline ? '断网演练中（写入必失败）' : '链路正常' }}</span>
        </label>
        <NButton type="primary" @click="flush">重试未接收批次（{{ store.syncStats.pendingBatches }}）</NButton>
      </div>
    </div>

    <div class="sync-metrics">
      <article><span>未接收批次</span><strong>{{ store.syncStats.pendingBatches }}</strong><small>待同步 + 发送失败</small></article>
      <article><span>待裁决冲突</span><strong>{{ store.syncStats.pendingConflicts }}</strong><small>同字段两版并存</small></article>
      <article><span>失效待重核结论</span><strong>{{ store.syncStats.invalidConclusions }}</strong><small>来源批次结论已变更</small></article>
      <article><span>失效待重核缺陷</span><strong>{{ store.syncStats.invalidDefects }}</strong><small>需重新锚定结论</small></article>
    </div>

    <div v-if="pendingConflicts.length" class="conflict-panel">
      <h3>同字段冲突 · 待值班长确认（{{ pendingConflicts.length }}）</h3>
      <article v-for="conflict in pendingConflicts" :key="conflict.id" class="conflict-card">
        <header>
          <strong>{{ conflict.label }}</strong>
          <NTag size="small" :bordered="false" type="warning">{{ conflict.deviceCode }} · {{ conflict.recordId }}</NTag>
        </header>
        <div class="version-compare">
          <div class="version-box">
            <span class="version-source">{{ conflict.currentSource }}</span>
            <b>{{ conflict.currentValue || '（空）' }}</b>
            <small>值班室当前生效值</small>
            <NButton size="small" @click="decide(conflict.id, 'current')">保留值班室版</NButton>
          </div>
          <div class="version-box incoming">
            <span class="version-source">现场包 {{ conflict.batchId }}</span>
            <b>{{ conflict.incomingValue }}</b>
            <small>{{ conflict.incomingInspector }} 采集于 {{ fmt(conflict.collectedAt) }}</small>
            <NButton size="small" type="primary" @click="decide(conflict.id, 'incoming')">采用现场版</NButton>
          </div>
        </div>
        <footer>
          <span>基线值：{{ conflict.baseValue || '（空）' }}</span>
          <a @click="router.push(`/records/${conflict.recordId}`)">打开检验任务 →</a>
        </footer>
      </article>
    </div>

    <div class="batch-list">
      <h3>同步批次链</h3>
      <article v-for="batch in orderedBatches" :key="batch.id" class="batch-card">
        <header @click="toggleExpand(batch.id)">
          <NTag :type="statusType[batch.status]" size="small" :bordered="false">{{ batch.status }}</NTag>
          <strong>{{ batch.id }}</strong>
          <span class="batch-kind">{{ batch.kind }}包</span>
          <span class="batch-meta">{{ batch.deviceName }} / {{ batch.deviceCode }} · {{ batch.inspector }} · {{ batch.shift }}</span>
          <span class="batch-meta">基线 V{{ batch.baseVersion }} · 打包 {{ fmt(batch.createdAt) }} · 重试 {{ batch.attempts }} 次</span>
          <a v-if="batch.recordId" @click.stop="router.push(`/records/${batch.recordId}`)">任务 →</a>
        </header>
        <p v-if="batch.note" class="batch-note">{{ batch.note }}</p>
        <table v-if="expanded.includes(batch.id)" class="op-table">
          <thead><tr><th>字段</th><th>基线值</th><th>包内值</th><th>采集时刻</th></tr></thead>
          <tbody>
            <tr v-for="op in batch.ops" :key="op.field">
              <td>{{ op.label }}</td>
              <td>{{ op.baseValue || '（空）' }}</td>
              <td>{{ op.value }}</td>
              <td>{{ fmt(op.collectedAt) }}</td>
            </tr>
          </tbody>
        </table>
      </article>
    </div>

    <div v-if="resolvedConflicts.length" class="resolved-list">
      <h3>已裁决留痕</h3>
      <p v-for="conflict in resolvedConflicts" :key="conflict.id">
        <NTag size="small" :bordered="false">{{ conflict.batchId }}</NTag>
        {{ conflict.label }}：保留「{{ conflict.keptValue }}」 · {{ conflict.resolvedBy }} · {{ fmt(conflict.resolvedAt) }}
      </p>
    </div>
  </section>
</template>
