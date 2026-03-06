<template>
  <div class="h-full w-full flex flex-col bg-[var(--bg-primary)]">
    <!-- Toolbar -->
    <div class="flex items-center gap-3 px-4 py-2 border-b border-[var(--border-primary)]">
      <span class="text-sm font-medium text-[var(--text-primary)]">Mission Control</span>
      <select
        class="text-xs bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-primary)] rounded px-2 py-1"
        :value="currentFilter"
        @change="onFilterChange"
      >
        <option :value="null">All Sessions</option>
        <option v-for="s in rootSessions" :key="s.sessionId" :value="s.sessionId">
          {{ s.title || s.sessionId.slice(0, 8) }}
        </option>
      </select>
      <div class="flex-1" />
      <button
        class="text-xs px-3 py-1 rounded border border-[var(--border-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
        @click="$emit('exit-mission-control')"
      >
        Exit
      </button>
    </div>

    <!-- Graph fills remaining space -->
    <div class="flex-1 min-h-0">
      <AgentGraph
        :nodes="graphStore.visibleNodes"
        :edges="graphStore.visibleEdges"
        :is-live="graphStore.isLive"
        :min-turn="graphStore.minTurn"
        :max-turn="graphStore.maxTurn"
        @agent-selected="$emit('agent-selected', $event)"
        @file-clicked="$emit('file-clicked', $event)"
        @turn-clicked="$emit('turn-clicked', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import AgentGraph from './AgentGraph.vue';
import { useGraphStore } from '../../stores/graph';
import { useSessionsStore } from '../../stores/sessions';

// ── Emits ─────────────────────────────────────────────────────────────────

const emit = defineEmits<{
  'exit-mission-control': [];
  'filter-changed': [sessionId: string | null];
  'agent-selected': [nodeId: string];
  'file-clicked': [filePath: string];
  'turn-clicked': [turnId: number];
}>();

// ── Stores ────────────────────────────────────────────────────────────────

const graphStore = useGraphStore();
const sessionsStore = useSessionsStore();

// ── Filter state ──────────────────────────────────────────────────────────

const currentFilter = ref<string | null>(null);

const rootSessions = computed(() =>
  sessionsStore.sessionList.filter(s => !s.parentSessionId),
);

function onFilterChange(e: Event) {
  const value = (e.target as HTMLSelectElement).value;
  currentFilter.value = value === 'null' ? null : value;
  emit('filter-changed', currentFilter.value);
}
</script>
