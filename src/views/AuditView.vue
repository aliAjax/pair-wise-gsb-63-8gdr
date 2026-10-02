<script setup lang="ts">
import { computed, ref } from 'vue'
import { NInput, NSelect, NTag } from 'naive-ui'
import { useInspectionStore } from '../stores/inspection'

const store = useInspectionStore()
const keyword = ref('')
const traceRecordId = ref(store.records[0]?.id ?? '')

const entries = computed(() => store.audit.filter((item) => !keyword.value
  || `${item.recordId} ${item.deviceCode ?? ''} ${item.batchId ?? ''} ${item.action} ${item.operator} ${item.detail}`.includes(keyword.value)))

const recordOptions = computed(() => store.records.map((item) => ({ label: `${item.deviceName} / ${item.deviceCode}（${item.id}）`, value: item.id })))
const trace = computed(() => traceRecordId.value ? store.lineageOf(traceRecordId.value) : { batches: [], conclusions: [], defects: [], conflicts: [] })

function conclusionsOf(batchId: string) {
  return trace.value.conclusions.filter((item) => item.batchId === batchId)
}

function defectsOf(batchId: string) {
  return trace.value.defects.filter((item) => item.sourceBatchId === batchId)
}

function fmt(value?: string) {
  return value ? value.replace('T', ' ').slice(0, 16) : '—'
}

const conclusionTag = (state: string): 'success' | 'warning' | 'default' => state === '生效' ? 'success' : state === '失效待重核' ? 'warning' : 'default'
</script>

<template>
  <section class="content audit-layout">
    <div class="audit-head">
      <div><h2>操作审计与判定溯源</h2><p>批次、结论、缺陷、放行全链留痕；重开页面后沿设备与批次仍可找到判定来源。</p></div>
      <NInput v-model:value="keyword" clearable placeholder="按编号、设备、批次、操作人搜索" style="max-width: 330px" />
    </div>

    <div class="trace-panel">
      <div class="trace-head">
        <h3>判定来源追溯</h3>
        <NSelect v-model:value="traceRecordId" :options="recordOptions" style="width: 320px" />
      </div>
      <div class="trace-chain">
        <div v-for="batch in trace.batches" :key="batch.id" class="trace-node">
          <div class="trace-batch">
            <NTag size="small" :bordered="false" :type="batch.status === '已合并' ? 'success' : batch.status === '冲突待裁决' ? 'warning' : batch.status === '发送失败' ? 'error' : 'default'">{{ batch.status }}</NTag>
            <strong>{{ batch.id }}</strong>
            <span>{{ batch.kind }}包 · {{ batch.inspector }} · 基线 V{{ batch.baseVersion }} · 打包 {{ fmt(batch.createdAt) }}</span>
          </div>
          <div v-if="conclusionsOf(batch.id).length || defectsOf(batch.id).length" class="trace-children">
            <div v-for="conclusion in conclusionsOf(batch.id)" :key="conclusion.id" class="trace-child">
              <span class="trace-arrow">└</span>
              <NTag size="small" :bordered="false" :type="conclusionTag(conclusion.state)">{{ conclusion.state }}</NTag>
              <div>
                <strong>{{ conclusion.id }} · {{ conclusion.kind }} V{{ conclusion.version }}</strong>
                <small>{{ conclusion.verdict }} · {{ conclusion.decidedBy }} · {{ fmt(conclusion.decidedAt) }}<template v-if="conclusion.supersededBy"> · 由 {{ conclusion.supersededBy }} 替代</template></small>
              </div>
            </div>
            <div v-for="defect in defectsOf(batch.id)" :key="defect.id" class="trace-child">
              <span class="trace-arrow">└</span>
              <NTag size="small" :bordered="false" :type="defect.status === '失效待重核' ? 'warning' : 'default'">{{ defect.status }}</NTag>
              <div>
                <strong>{{ defect.id }} · {{ defect.title }}</strong>
                <small>锚定结论 {{ defect.sourceConclusionId || '—' }}</small>
              </div>
            </div>
          </div>
        </div>
        <div v-for="conclusion in trace.conclusions.filter((item) => item.kind === '放行结论')" :key="conclusion.id" class="trace-node">
          <div class="trace-batch release">
            <NTag size="small" :bordered="false" :type="conclusionTag(conclusion.state)">{{ conclusion.state }}</NTag>
            <strong>{{ conclusion.id }}</strong>
            <span>放行结论 · 依据 {{ conclusion.dependsOn.join('、') || '值班室复核' }} · {{ conclusion.decidedBy }} · {{ fmt(conclusion.decidedAt) }}</span>
          </div>
        </div>
        <p v-if="!trace.batches.length && !trace.conclusions.length" class="lineage-empty">该任务暂无同步批次与判定结论。</p>
      </div>
    </div>

    <div class="timeline">
      <article v-for="entry in entries" :key="entry.id">
        <div class="time">{{ fmt(entry.createdAt) }}</div>
        <i />
        <div class="audit-card">
          <header>
            <strong>{{ entry.action }}</strong>
            <div class="audit-tags">
              <NTag size="small" :bordered="false">{{ entry.recordId }}</NTag>
              <NTag v-if="entry.batchId" size="small" :bordered="false" type="info">{{ entry.batchId }}</NTag>
              <NTag v-if="entry.conclusionId" size="small" :bordered="false" type="success">{{ entry.conclusionId }}</NTag>
              <NTag v-if="entry.defectId" size="small" :bordered="false" type="warning">{{ entry.defectId }}</NTag>
            </div>
          </header>
          <p>{{ entry.detail }}</p>
          <small>操作人：{{ entry.operator }}<template v-if="entry.deviceCode"> · 设备：{{ entry.deviceCode }}</template></small>
        </div>
      </article>
    </div>
  </section>
</template>
