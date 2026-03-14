<template>
  <div class="bg-surface rounded-lg border border-border-subtle overflow-hidden">
    <div class="px-3 py-2 border-b border-border-subtle flex items-center justify-between">
      <span class="text-xs font-semibold text-txt-primary">Epics Detail</span>
      <span class="text-[11px] text-txt-muted">{{ sortedEpics.length }} epics</span>
    </div>

    <table v-if="analytics.epicsDetail.length > 0" class="w-full">
      <thead>
        <tr class="text-[9px] font-semibold text-txt-muted uppercase tracking-wider border-b border-border-standard">
          <th
            v-for="col in columns"
            :key="col.key"
            class="px-3 py-2 cursor-pointer select-none transition-colors hover:text-txt-secondary"
            :class="col.align === 'right' ? 'text-right' : 'text-left'"
            @click="toggleSort(col.key)"
          >
            <span class="inline-flex items-center gap-1">
              {{ col.label }}
              <svg v-if="sortCol === col.key" class="w-2.5 h-2.5 text-txt-primary" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" :d="sortDir === 'asc' ? 'M4.5 15.75l7.5-7.5 7.5 7.5' : 'M19.5 8.25l-7.5 7.5-7.5-7.5'" />
              </svg>
            </span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="epic in pagedEpics"
          :key="epic.id"
          class="border-b border-border-subtle last:border-0 hover:bg-white/[0.015] cursor-pointer transition-colors"
          @click="ui.navigateToEpic(epic.id, epic.project_id)"
        >
          <td class="px-3 py-1.5 text-[11px] text-txt-primary max-w-[180px] truncate">{{ epic.title }}</td>
          <td class="px-3 py-1.5 text-[11px] text-txt-secondary truncate">{{ epic.project_name }}</td>
          <td class="px-3 py-1.5">
            <span
              class="text-[9px] font-semibold px-1.5 py-0.5 rounded-full capitalize"
              :class="statusClass(epic.status)"
            >{{ epic.status }}</span>
          </td>
          <td class="px-3 py-1.5">
            <span
              v-if="epic.complexity"
              class="text-[9px] font-semibold px-1.5 py-0.5 rounded-full capitalize"
              :class="complexityClass(epic.complexity)"
            >{{ epic.complexity }}</span>
          </td>
          <td class="px-3 py-1.5 text-[11px] text-txt-primary text-right font-mono">${{ epic.total_cost_usd.toFixed(2) }}</td>
          <td class="px-3 py-1.5 text-[11px] text-txt-primary text-right font-mono">{{ formatTokens(epic.input_tokens + epic.output_tokens) }}</td>
          <td class="px-3 py-1.5 text-[11px] text-txt-primary text-right font-mono">{{ epic.duration_hours != null ? epic.duration_hours.toFixed(1) + 'h' : '--' }}</td>
          <td class="px-3 py-1.5 text-[11px] text-txt-muted text-right">{{ epic.created_at.slice(0, 10) }}</td>
        </tr>
      </tbody>
    </table>

    <div v-else class="flex flex-col items-center justify-center py-8">
      <svg class="w-8 h-8 text-txt-faint mb-2" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" />
      </svg>
      <p class="text-xs text-txt-muted">No epics to display</p>
    </div>

    <!-- Pagination -->
    <div v-if="analytics.epicsDetail.length > 0" class="px-3 py-2 border-t border-border-subtle flex items-center justify-between">
      <span class="text-[11px] text-txt-muted">Page {{ page + 1 }} of {{ totalPages }}</span>
      <div class="flex items-center gap-1.5">
        <button
          :disabled="page === 0"
          @click="page--"
          class="px-2 py-0.5 rounded text-[11px] transition-colors"
          :class="page === 0 ? 'text-txt-faint cursor-not-allowed' : 'bg-raised hover:bg-raised-hover text-txt-secondary'"
        >Prev</button>
        <button
          :disabled="page >= totalPages - 1"
          @click="page++"
          class="px-2 py-0.5 rounded text-[11px] transition-colors"
          :class="page >= totalPages - 1 ? 'text-txt-faint cursor-not-allowed' : 'bg-raised hover:bg-raised-hover text-txt-secondary'"
        >Next</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAnalyticsStore } from '@/stores/analytics'
import { useUiStore } from '@/stores/ui'

const analytics = useAnalyticsStore()
const ui = useUiStore()

const sortCol = ref<string>('created_at')
const sortDir = ref<'asc' | 'desc'>('desc')
const page = ref(0)
const pageSize = 50

const columns = [
  { key: 'title', label: 'Title', align: 'left' },
  { key: 'project_name', label: 'Project', align: 'left' },
  { key: 'status', label: 'Status', align: 'left' },
  { key: 'complexity', label: 'Complexity', align: 'left' },
  { key: 'total_cost_usd', label: 'Cost', align: 'right' },
  { key: 'tokens', label: 'Tokens', align: 'right' },
  { key: 'duration_hours', label: 'Duration', align: 'right' },
  { key: 'created_at', label: 'Created', align: 'right' },
]

function toggleSort(col: string) {
  if (sortCol.value === col) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortCol.value = col
    sortDir.value = 'desc'
  }
  page.value = 0
}

const sortedEpics = computed(() => {
  const data = [...analytics.epicsDetail]
  const col = sortCol.value
  const dir = sortDir.value === 'asc' ? 1 : -1

  return data.sort((a, b) => {
    let av: any, bv: any
    if (col === 'tokens') {
      av = a.input_tokens + a.output_tokens
      bv = b.input_tokens + b.output_tokens
    } else {
      av = (a as any)[col]
      bv = (b as any)[col]
    }
    if (av == null) return 1
    if (bv == null) return -1
    if (typeof av === 'string') return av.localeCompare(bv) * dir
    return (av - bv) * dir
  })
})

const totalPages = computed(() => Math.max(1, Math.ceil(sortedEpics.value.length / pageSize)))

const pagedEpics = computed(() => {
  const start = page.value * pageSize
  return sortedEpics.value.slice(start, start + pageSize)
})

function formatTokens(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`
  return String(v)
}

function statusClass(s: string): string {
  switch (s) {
    case 'done': return 'bg-teal/10 text-teal'
    case 'in-progress': return 'bg-blue/10 text-blue'
    case 'review': return 'bg-orange-500/20 text-orange-400'
    case 'discarded': return 'bg-red-500/20 text-red-400'
    case 'todo': case 'idea': case 'backlog': return 'bg-raised text-txt-muted'
    default: return 'bg-raised text-txt-muted'
  }
}

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
