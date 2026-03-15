<template>
  <div class="bg-window rounded-lg border border-border-subtle p-3.5">
    <div class="text-xs font-semibold text-txt-primary mb-2.5">Model Usage</div>
    <div class="relative h-40">
      <template v-if="hasData">
        <Doughnut :data="chartData" :options="chartOptions" />
        <div class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div class="text-sm font-bold font-mono text-txt-primary">${{ totalCost }}</div>
          <div class="text-[9px] text-txt-muted">total</div>
        </div>
      </template>
      <div v-else class="flex flex-col items-center justify-center h-full">
        <svg class="w-8 h-8 text-txt-faint mb-2" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 6a7.5 7.5 0 1 0 7.5 7.5h-7.5V6Z" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 10.5H21A7.5 7.5 0 0 0 13.5 3v7.5Z" />
        </svg>
        <p class="text-xs text-txt-muted">No model data</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js'
import { Doughnut } from 'vue-chartjs'
import { useAnalyticsStore } from '@/stores/analytics'
import { accentColors, legendDefaults, tooltipDefaults } from './chartTheme'

ChartJS.register(ArcElement, Tooltip, Legend)

const analytics = useAnalyticsStore()

const hasData = computed(() => analytics.modelUsage.length > 0)

const totalCost = computed(() => {
  const sum = analytics.modelUsage.reduce((acc, m) => acc + m.cost_usd, 0)
  return sum >= 1000 ? `${(sum / 1000).toFixed(1)}k` : sum.toFixed(2)
})

const chartData = computed(() => ({
  labels: analytics.modelUsage.map(m => m.model),
  datasets: [{
    data: analytics.modelUsage.map(m => m.cost_usd),
    backgroundColor: analytics.modelUsage.map((_, i) => accentColors[i % accentColors.length]),
    borderWidth: 0,
    hoverOffset: 4,
  }],
}))

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  cutout: '70%',
  plugins: {
    legend: { ...legendDefaults, position: 'right' as const },
    tooltip: {
      ...tooltipDefaults,
      callbacks: {
        label: (ctx: any) => ` $${ctx.parsed.toFixed(2)}`,
      },
    },
  },
}))
</script>
