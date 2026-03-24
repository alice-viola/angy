<template>
  <div class="border border-border-subtle rounded-md p-3">
    <div class="text-[11px] font-semibold uppercase tracking-wider text-txt-muted mb-3">Cost Over Time</div>
    <div class="relative h-40">
      <Line v-if="hasData" :data="chartData" :options="chartOptions" />
      <div v-else class="flex flex-col items-center justify-center h-full">
        <svg class="w-8 h-8 text-txt-faint mb-2" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
        </svg>
        <p class="text-xs text-txt-muted">No data for this period</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement, LineElement,
  Title, Tooltip, Legend, Filler
} from 'chart.js'
import { Line } from 'vue-chartjs'
import { useAnalyticsStore } from '@/stores/analytics'
import { gridColor, tickColor, legendDefaults, tooltipDefaults } from './chartTheme'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler)

const analytics = useAnalyticsStore()

const hasData = computed(() => analytics.costByDay.length > 0)

const chartData = computed(() => ({
  labels: analytics.costByDay.map(d => d.day),
  datasets: [
    {
      label: 'Cost (USD)',
      data: analytics.costByDay.map(d => d.cost_usd),
      borderColor: '#f59e0b',
      backgroundColor: 'rgba(245,158,11,0.1)',
      fill: true,
      yAxisID: 'y',
    },
    {
      label: 'Tokens',
      data: analytics.costByDay.map(d => d.input_tokens + d.output_tokens),
      borderColor: '#22d3ee',
      backgroundColor: 'transparent',
      borderDash: [4, 4],
      fill: false,
      yAxisID: 'y1',
    },
  ],
}))

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: legendDefaults,
    tooltip: tooltipDefaults,
  },
  scales: {
    x: {
      grid: { color: gridColor },
      ticks: { color: tickColor, font: { family: 'Inter', size: 10 } },
    },
    y: {
      type: 'linear' as const,
      position: 'left' as const,
      grid: { color: gridColor },
      ticks: {
        color: tickColor,
        font: { family: 'Inter', size: 10 },
        callback: (v: string | number) => `$${Number(v).toFixed(2)}`,
      },
    },
    y1: {
      type: 'linear' as const,
      position: 'right' as const,
      grid: { drawOnChartArea: false },
      ticks: {
        color: tickColor,
        font: { family: 'Inter', size: 10 },
        callback: (v: string | number) => {
          const n = Number(v)
          return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n)
        },
      },
    },
  },
  elements: {
    line: { tension: 0.3, borderWidth: 2 },
    point: { radius: 0, hoverRadius: 5 },
  },
}))
</script>
