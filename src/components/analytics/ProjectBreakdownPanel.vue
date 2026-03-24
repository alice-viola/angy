<template>
  <div class="border border-border-subtle rounded-md p-3">
    <div class="text-[11px] font-semibold uppercase tracking-wider text-txt-muted mb-3">Project Breakdown</div>

    <template v-if="analytics.projectSummaries.length > 0">
      <div
        v-for="project in analytics.projectSummaries"
        :key="project.project_id"
        class="flex items-center gap-2.5 py-1.5"
      >
        <div class="w-28 text-[11px] text-txt-secondary truncate shrink-0">{{ project.project_name }}</div>
        <div class="flex-1 bg-raised rounded-full h-1.5 overflow-hidden">
          <div
            class="h-full rounded-full transition-all duration-500"
            :style="{
              width: barWidth(project.total_cost_usd) + '%',
              background: project.project_color || '#f59e0b'
            }"
          />
        </div>
        <div class="text-[11px] font-mono text-txt-muted w-14 text-right shrink-0">${{ project.total_cost_usd.toFixed(2) }}</div>
        <div class="text-[11px] text-txt-faint w-14 text-right shrink-0">{{ project.epic_count }} epics</div>
      </div>
    </template>

    <div v-else class="flex flex-col items-center justify-center py-8">
      <svg class="w-8 h-8 text-txt-faint mb-2" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
      </svg>
      <p class="text-xs text-txt-muted">No project data</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAnalyticsStore } from '@/stores/analytics'

const analytics = useAnalyticsStore()

const maxCost = computed(() =>
  Math.max(...analytics.projectSummaries.map(p => p.total_cost_usd), 0.0001)
)

function barWidth(cost: number): number {
  return (cost / maxCost.value) * 100
}
</script>
