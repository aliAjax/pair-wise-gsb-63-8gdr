<script setup lang="ts">
import { computed, ref } from 'vue'
import { NInput, NSelect, NTag } from 'naive-ui'
import { useInspectionStore } from '../stores/inspection'

const store = useInspectionStore()
const keyword = ref('')
const device = ref('全部')
const batchId = ref('')

const deviceOptions = computed(() => ['全部', ...new Set(store.records.map((item) => item.deviceCode))].map((value) => ({ label: value === '全部' ? '全部设备' : value, value })))

const entries = computed(() => store.audit.filter((item) => {
  const hitKeyword = !keyword.value || `${item.recordId} ${item.action} ${item.operator} ${item.detail}`.includes(keyword.value)
  const hitDevice = device.value === '全部' || item.deviceCode === device.value
  const hitBatch = !batchId.value || (item.batchId ?? '').includes(batchId.value)
  return hitKeyword && hitDevice && hitBatch
}))
</script>

<template>
  <section class="content audit-layout">
    <div class="audit-head">
      <div><h2>操作审计与版本追溯</h2><p>记录创建、检验修改、状态流转、批次合并、冲突确认与结论失效的完整时间线，可沿设备与批次追溯判定来源。</p></div>
      <div class="audit-filters">
        <NSelect v-model:value="device" :options="deviceOptions" style="width: 150px" />
        <NInput v-model:value="batchId" clearable placeholder="批次号，如 BATCH-0928-01" style="width: 200px" />
        <NInput v-model:value="keyword" clearable placeholder="按编号、操作人、动作搜索" style="width: 240px" />
      </div>
    </div>
    <div class="timeline">
      <article v-for="entry in entries" :key="entry.id">
        <div class="time">{{ entry.createdAt.replace('T', ' ').slice(0, 16) }}</div>
        <i />
        <div class="audit-card">
          <header>
            <strong>{{ entry.action }}</strong>
            <div class="audit-tags">
              <NTag v-if="entry.batchId" size="small" type="info" :bordered="false">{{ entry.batchId }}</NTag>
              <NTag size="small" :bordered="false">{{ entry.recordId }}</NTag>
              <NTag v-if="entry.deviceCode" size="small" type="default" :bordered="false">{{ entry.deviceCode }}</NTag>
            </div>
          </header>
          <p>{{ entry.detail }}</p>
          <small>操作人：{{ entry.operator }}</small>
        </div>
      </article>
      <div v-if="!entries.length" class="kanban-empty">没有匹配的审计记录</div>
    </div>
  </section>
</template>
