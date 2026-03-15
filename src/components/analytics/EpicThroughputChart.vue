<template>
  <div class="bg-window rounded-lg border border-border-subtle p-3.5">
    <div class="text-xs font-semibold text-txt-primary mb-2.5">Epic Throughput</div>
    <div class="relative h-40">
      <Bar v-if="hasData" :data="chartData" :options="chartOptions" />
      <div v-else class="flex flex-col items-center justify-center h-full">
        <svg class="w-8 h-8 text-txt-faint mb-2" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
        </svg>
        <p class="text-xs text-txt-muted">No throughput data</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement,
  Title, Tooltip, Legend
} from 'chart.js'
import { Bar } from 'vue-chartjs'
import { useAnalyticsStore } from '@/stores/analytics'
import { gridColor, tickColor, legendDefaults, tooltipDefaults } from './chartTheme'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

const analytics = useAnalyticsStore()

const hasData = computed(() => analytics.epicThroughput.length > 0)

const chartData = computed(() => ({
  labels: analytics.epicThroughput.map(e => e.week),
  datasets: [
    {
      label: 'Started',
      data: analytics.epicThroughput.map(e => e.started),
      backgroundColor: 'rgba(245,158,11,0.6)',
      hoverBackgroundColor: 'rgba(245,158,11,0.8)',
      borderRadius: 4,
      barPercentage: 0.7,
      categoryPercentage: 0.8,
    },
    {
      label: 'Completed',
      data: analytics.epicThroughput.map(e => e.completed),
      backgroundColor: '#10b981',
      hoverBackgroundColor: '#0d9668',
      borderRadius: 4,
      barPercentage: 0.7,
      categoryPercentage: 0.8,
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
      grid: { color: gridColor },
      ticks: {
        color: tickColor,
        font: { family: 'Inter', size: 10 },
        stepSize: 1,
      },
    },
  },
}))
</script>
