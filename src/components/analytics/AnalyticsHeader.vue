<template>
  <div class="h-12 border-b border-border-subtle px-5 flex items-center gap-4 shrink-0">
    <svg class="w-5 h-5 text-ember-500" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
    </svg>
    <span class="text-sm font-semibold text-txt-primary">Analytics</span>

    <div class="flex-1" />

    <!-- Time range pills -->
    <div class="flex items-center gap-1 bg-base rounded-lg p-0.5 border border-border-subtle">
      <button
        v-for="range in ranges"
        :key="range"
        @click="setRange(range)"
        class="px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors"
        :class="analytics.timeRange === range
          ? 'bg-raised text-txt-primary'
          : 'text-txt-muted hover:text-txt-secondary'"
      >{{ range }}</button>
    </div>

    <!-- Project filter -->
    <select
      v-model="analytics.selectedProjectId"
      class="text-xs bg-raised border border-border-subtle rounded-md px-2.5 py-1 text-txt-secondary outline-none"
    >
      <option :value="null">All projects</option>
      <option v-for="p in analytics.projectSummaries" :key="p.project_id" :value="p.project_id">
        {{ p.project_name }}
      </option>
    </select>

    <!-- Refresh -->
    <button
      @click="analytics.loadAll()"
      class="w-[26px] h-[26px] flex items-center justify-center rounded-full text-txt-muted hover:bg-raised hover:text-txt-primary transition-colors"
      :class="{ 'pointer-events-none': analytics.loading }"
      title="Refresh"
    >
      <svg class="w-4 h-4 transition-transform" :class="{ 'animate-spin': analytics.loading }" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { useAnalyticsStore } from '@/stores/analytics'

const analytics = useAnalyticsStore()
const ranges = ['7d', '30d', '90d', 'all'] as const

function setRange(range: '7d' | '30d' | '90d' | 'all') {
  analytics.timeRange = range
}
</script>
