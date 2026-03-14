<template>
  <div class="h-full flex flex-col bg-base">
    <AnalyticsHeader />

    <!-- Initial loading skeleton (first load only) -->
    <div v-if="analytics.loading && !analytics.initialLoaded" class="flex-1 min-h-0 overflow-y-auto px-5 py-4">
      <div class="grid grid-cols-4 gap-3 mb-4">
        <div v-for="i in 4" :key="i" class="bg-surface rounded-lg border border-border-subtle p-3.5 animate-pulse">
          <div class="w-6 h-6 rounded bg-raised mb-2" />
          <div class="h-5 bg-raised rounded w-2/3 mb-1.5" />
          <div class="h-3 bg-raised rounded w-1/2" />
        </div>
      </div>
      <div class="grid grid-cols-[2fr_1fr] gap-3 mb-3">
        <div class="bg-raised rounded-lg h-44 animate-pulse" />
        <div class="bg-raised rounded-lg h-44 animate-pulse" />
      </div>
      <div class="grid grid-cols-[2fr_1fr] gap-3 mb-3">
        <div class="bg-raised rounded-lg h-44 animate-pulse" />
        <div class="bg-raised rounded-lg h-44 animate-pulse" />
      </div>
      <div class="bg-raised rounded-lg h-36 animate-pulse mb-3" />
      <div class="bg-raised rounded-lg h-64 animate-pulse" />
    </div>

    <!-- Content (stays mounted during refreshes) -->
    <div v-else class="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3" :class="{ 'opacity-60 pointer-events-none': analytics.loading }">
      <GlobalSummaryCards />

      <div class="grid grid-cols-[2fr_1fr] gap-3">
        <CostOverTimeChart />
        <ModelUsageChart />
      </div>

      <div class="grid grid-cols-[2fr_1fr] gap-3">
        <EpicThroughputChart />
        <ComplexityStatsTable />
      </div>

      <ProjectBreakdownPanel />
      <EpicsDetailTable />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useAnalyticsStore } from '@/stores/analytics'
import AnalyticsHeader from './AnalyticsHeader.vue'
import GlobalSummaryCards from './GlobalSummaryCards.vue'
import CostOverTimeChart from './CostOverTimeChart.vue'
import ModelUsageChart from './ModelUsageChart.vue'
import EpicThroughputChart from './EpicThroughputChart.vue'
import ComplexityStatsTable from './ComplexityStatsTable.vue'
import ProjectBreakdownPanel from './ProjectBreakdownPanel.vue'
import EpicsDetailTable from './EpicsDetailTable.vue'

const analytics = useAnalyticsStore()
onMounted(() => analytics.loadAll())
</script>
