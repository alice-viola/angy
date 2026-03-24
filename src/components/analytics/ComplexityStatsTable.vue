<template>
  <div class="border border-border-subtle rounded-md overflow-hidden">
    <div class="px-3 py-2 border-b border-border-subtle">
      <span class="text-[11px] font-semibold uppercase tracking-wider text-txt-muted">By Complexity</span>
    </div>
    <table class="w-full">
      <thead>
        <tr class="text-[9px] font-semibold text-txt-muted uppercase tracking-wider border-b border-border-standard">
          <th class="px-3 py-2 text-left">Complexity</th>
          <th class="px-3 py-2 text-right">Epics</th>
          <th class="px-3 py-2 text-right">Avg Cost</th>
          <th class="px-3 py-2 text-right">Avg Dur.</th>
          <th class="px-3 py-2 text-right">Done</th>
        </tr>
      </thead>
      <tbody v-if="analytics.complexityStats.length > 0">
        <tr
          v-for="row in analytics.complexityStats"
          :key="row.complexity"
          class="border-b border-border-subtle last:border-0 hover:bg-white/[0.015]"
        >
          <td class="px-3 py-1.5">
            <span
              class="text-[9px] font-semibold px-1.5 py-0.5 rounded-full capitalize"
              :class="complexityClass(row.complexity)"
            >{{ row.complexity }}</span>
          </td>
          <td class="px-3 py-1.5 text-[11px] text-txt-primary text-right font-mono">{{ row.epic_count }}</td>
          <td class="px-3 py-1.5 text-[11px] text-txt-primary text-right font-mono">${{ row.avg_cost_usd.toFixed(2) }}</td>
          <td class="px-3 py-1.5 text-[11px] text-txt-primary text-right font-mono">{{ row.avg_duration_hours != null ? row.avg_duration_hours.toFixed(1) + 'h' : '--' }}</td>
          <td class="px-3 py-1.5 text-[11px] text-txt-primary text-right font-mono">{{ Math.round(row.completion_rate * 100) }}%</td>
        </tr>
      </tbody>
      <tbody v-else>
        <tr>
          <td colspan="5" class="px-3 py-6 text-center text-xs text-txt-muted">No complexity data</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { useAnalyticsStore } from '@/stores/analytics'

const analytics = useAnalyticsStore()

function complexityClass(c: string): string {
  switch (c.toLowerCase()) {
    case 'trivial': return 'bg-[var(--text-faint)]/10 text-txt-faint'
    case 'small': return 'bg-cyan/10 text-cyan'
    case 'medium': return 'bg-ember/10 text-ember'
    case 'large': return 'bg-orange-500/20 text-orange-400'
    case 'epic': return 'bg-rose/10 text-rose'
    default: return 'bg-raised text-txt-muted'
  }
}
</script>
