<template>
  <div class="grid grid-cols-4 gap-3">
    <div
      v-for="(card, i) in cards"
      :key="card.label"
      class="bg-surface rounded-lg border border-border-subtle px-3.5 py-3 card-lift anim-fade-in"
      :style="{ animationDelay: `${i * 50}ms` }"
    >
      <div class="flex items-center gap-2 mb-1.5">
        <div
          class="w-6 h-6 rounded flex items-center justify-center shrink-0"
          :style="{ background: `color-mix(in srgb, ${card.color} 10%, transparent)` }"
        >
          <svg class="w-3.5 h-3.5" :style="{ color: card.color }" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" :d="card.icon" />
          </svg>
        </div>
        <div class="text-[11px] text-txt-muted">{{ card.label }}</div>
      </div>
      <div class="text-xl font-bold text-txt-primary font-mono">{{ card.value }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAnalyticsStore } from '@/stores/analytics'

const analytics = useAnalyticsStore()

function formatCost(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}m`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}k`
  return `$${v.toFixed(2)}`
}

function formatTokens(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`
  return String(v)
}

const cards = computed(() => {
  const s = analytics.globalSummary
  return [
    {
      label: 'Total Cost',
      value: s ? formatCost(s.total_cost_usd) : '--',
      color: '#f59e0b',
      icon: 'M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    },
    {
      label: 'Total Sessions',
      value: s ? formatTokens(s.total_sessions) : '--',
      color: '#22d3ee',
      icon: 'M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155',
    },
    {
      label: 'Total Epics',
      value: s ? String(s.total_epics) : '--',
      color: '#89b4fa',
      icon: 'M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z',
    },
    {
      label: 'Completed Epics',
      value: s ? String(s.completed_epics) : '--',
      color: '#10b981',
      icon: 'M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    },
  ]
})
</script>
