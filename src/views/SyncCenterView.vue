<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NSelect, NSwitch, NTag, useMessage } from 'naive-ui'
import { useInspectionStore } from '../stores/inspection'
import { formatValue } from '../services/sync'
import type { BatchStatus } from '../types'

const store = useInspectionStore()
const router = useRouter()
const message = useMessage()
const simulateTarget = ref('INS-240821-01')

const recordOptions = computed(() => store.records.map((record) => ({
  label: `${record.deviceName} / ${record.id}`,
  value: record.id
})))

const batchStatusType: Record<BatchStatus, 'default' | 'info' | 'success' | 'warning' | 'error'> = {
  待上传: 'info',
  上传中: 'info',
  已接收: 'success',
  部分冲突: 'warning',
  待重试: 'error'
}

const sortedBatches = computed(() => [...store.batches].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
const invalidatedConclusions = computed(() => store.conclusions.filter((item) => !item.effective))

function syncNow() {
  if (!store.online) {
    message.warning('当前处于断网状态，批次将继续保留在出站队列')
    return
  }
  const result = store.syncAll()
  if (result.failed) message.error(`${result.failed} 个批次写入失败，已标记待重试（仅未接收批次会重试）`)
  if (result.conflicted) message.warning(`${result.conflicted} 个批次存在字段冲突，两版已保留待值班长确认`)
  if (result.synced) message.success(`${result.synced} 个批次已按字段合并并被服务端接收`)
  if (!result.failed && !result.conflicted && !result.synced) message.info('出站队列已清空，并完成下行合并')
}

function retry(id: string) {
  store.retryBatch(id)
  const batch = store.batches.find((item) => item.id === id)
  if (!batch) return
  if (batch.status === '待重试') message.error(`批次 ${id} 仍未被接收，保留在重试队列`)
  else if (batch.status === '部分冲突') message.warning(`批次 ${id} 已接收，存在字段冲突待确认`)
  else message.success(`批次 ${id} 已被服务端接收`)
}

function resolve(conflictId: string, adopt: 'local' | 'server') {
  store.resolveConflict(conflictId, adopt)
  message.success(`已采纳${adopt === 'local' ? '现场' : '值班室'}版本，结论链已重核`)
}

function runDutyRoom() {
  const count = store.simulateDutyRoom(simulateTarget.value)
  message[count ? 'warning' : 'info'](count ? `值班室已改动 ${count} 个字段，回连同步后按字段合并` : '该记录未产生改动')
}

function runPeer() {
  const count = store.simulatePeer(simulateTarget.value)
  message[count ? 'warning' : 'info'](count ? `另一台平板已先提交 ${count} 个字段` : '该记录未产生改动')
}
</script>

<template>
  <section class="content">
    <div class="board-intro">
      <div>
        <h2>断网同步中心</h2>
        <p>断网包按字段合并，包内保留采集时刻与基线；同字段两版并存待值班长确认；仅未接收批次参与重试。</p>
      </div>
      <div class="sync-controls">
        <label class="switch-label"><NSwitch v-model:value="store.online" />{{ store.online ? '在线' : '断网' }}</label>
        <label class="switch-label"><NSwitch v-model:value="store.failWrites" />模拟写入失败</label>
        <NButton type="primary" :disabled="!store.online" @click="syncNow">立即同步</NButton>
      </div>
    </div>

    <div class="metric-strip sync-strip">
      <article><span>待上传批次</span><strong>{{ store.pendingBatches.length }}</strong><small>断网期间积累的出站包</small></article>
      <article><span>待重试</span><strong>{{ store.batches.filter((b) => b.status === '待重试').length }}</strong><small>写入失败，仅重试未接收批次</small></article>
      <article><span>待确认冲突</span><strong>{{ store.pendingConflicts.length }}</strong><small>同字段两版等值班长确认</small></article>
      <article><span>失效待重核</span><strong>{{ store.recheckRecords.length }}</strong><small>批次结论变更触发</small></article>
    </div>

    <div class="sync-layout">
      <div class="sync-column">
        <h3>出站断网包</h3>
        <article v-for="batch in sortedBatches" :key="batch.id" class="batch-card">
          <header>
            <div>
              <strong>{{ batch.id }}</strong>
              <small>{{ batch.deviceName }} · {{ batch.inspector }} · 基线 V{{ batch.baseVersion }}</small>
            </div>
            <NTag :type="batchStatusType[batch.status]" size="small" :bordered="false">{{ batch.status }}</NTag>
          </header>
          <p v-if="batch.note" class="batch-note">{{ batch.note }} · 创建于 {{ batch.createdAt.replace('T', ' ').slice(0, 16) }}<template v-if="batch.ackedAt"> · 接收于 {{ batch.ackedAt.replace('T', ' ').slice(0, 16) }}</template> · 尝试 {{ batch.attempts }} 次</p>
          <p v-else class="batch-note">创建于 {{ batch.createdAt.replace('T', ' ').slice(0, 16) }}<template v-if="batch.ackedAt"> · 接收于 {{ batch.ackedAt.replace('T', ' ').slice(0, 16) }}</template> · 尝试 {{ batch.attempts }} 次</p>
          <table v-if="batch.ops.length" class="op-table">
            <thead><tr><th>字段</th><th>基线值</th><th>现场采集值</th><th>采集时刻</th></tr></thead>
            <tbody>
              <tr v-for="op in batch.ops" :key="op.field">
                <td>{{ op.label }}</td>
                <td>{{ formatValue(op.field, op.baseline) }}</td>
                <td class="op-value">{{ formatValue(op.field, op.value) }}</td>
                <td>{{ op.collectedAt.replace('T', ' ').slice(0, 16) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="batch-note">建档批次：整份记录快照随包上传</p>
          <footer>
            <NButton size="small" tertiary @click="router.push(`/records/${batch.recordId}`)">打开记录</NButton>
            <NButton v-if="batch.status === '待重试'" size="small" type="warning" :disabled="!store.online" @click="retry(batch.id)">重试未接收批次</NButton>
          </footer>
        </article>
        <div v-if="!sortedBatches.length" class="kanban-empty">暂无断网包</div>
      </div>

      <div class="sync-column">
        <h3>字段冲突 · 待值班长确认</h3>
        <article v-for="conflict in store.conflicts" :key="conflict.id" class="conflict-card" :class="{ resolved: conflict.status !== '待确认' }">
          <header>
            <div>
              <strong>{{ conflict.label }}</strong>
              <small>{{ conflict.deviceCode }} · {{ conflict.recordId }} · 批次 {{ conflict.batchId }}</small>
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
        <div v-if="!store.conflicts.length" class="kanban-empty">暂无字段冲突</div>

        <h3 class="section-gap">结论失效与重核</h3>
        <article v-for="record in store.recheckRecords" :key="record.id" class="recheck-card">
          <div>
            <strong>{{ record.deviceName }}</strong>
            <small>{{ record.id }} · 来源批次 {{ record.lastBatchId }} · 当前 {{ record.status }}</small>
          </div>
          <div class="recheck-actions">
            <NButton size="small" tertiary @click="router.push(`/records/${record.id}`)">打开记录</NButton>
            <NButton size="small" type="primary" @click="store.confirmRecheck(record.id); message.success('已完成重核确认')">重核确认</NButton>
          </div>
        </article>
        <div v-if="!store.recheckRecords.length" class="kanban-empty">暂无待重核任务</div>

        <template v-if="invalidatedConclusions.length">
          <h3 class="section-gap">旧结论（保留可查）</h3>
          <article v-for="item in invalidatedConclusions" :key="item.id" class="history-card">
            <NTag size="small" type="default" :bordered="false">已失效</NTag>
            <div>
              <strong>{{ item.deviceCode }} · {{ item.type }}</strong>
              <small>来源批次 {{ item.batchId }} · 基线 V{{ item.baseVersion }} · {{ item.createdAt.replace('T', ' ').slice(0, 16) }}</small>
              <small>{{ item.invalidatedReason }}</small>
            </div>
          </article>
        </template>
      </div>
    </div>

    <div class="conflict-table">
      <h3>对端改动模拟</h3>
      <p>模拟值班室或另一台平板在权威端直接改动同一台设备，回连同步后观察字段级合并、冲突两版并存与结论失效重核。</p>
      <div class="simulate-row">
        <NSelect v-model:value="simulateTarget" :options="recordOptions" style="max-width: 320px" />
        <button @click="runDutyRoom">模拟值班室改动</button>
        <button @click="runPeer">模拟另一检验员提交</button>
      </div>
    </div>
  </section>
</template>
