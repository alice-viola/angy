<template>
  <div
    v-if="ui.activityLogVisible"
    class="absolute bottom-8 left-0 right-0 z-30 flex flex-col bg-[var(--bg-surface)] border-t border-[var(--border-subtle)]"
    style="height: 180px"
  >
    <!-- Header -->
    <div class="flex items-center justify-between px-3 py-1.5 border-b border-[var(--border-subtle)]">
      <span class="text-[var(--text-xs)] font-semibold text-[var(--text-secondary)]">Activity Log</span>
      <button
        @click="ui.toggleActivityLog()"
        class="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M2 2L8 8M8 2L2 8" />
        </svg>
      </button>
    </div>

    <!-- Log entries -->
    <div ref="scrollContainer" class="flex-1 overflow-y-auto font-mono text-[var(--text-xs)]">
      <div
        v-for="entry in logStore.entries"
        :key="entry.id"
        class="flex items-start gap-2 px-3 py-1 hover:bg-[var(--bg-hover)] transition-colors"
      >
        <!-- Timestamp -->
        <span class="text-[var(--text-faint)] shrink-0 w-[52px]">{{ formatTime(entry.timestamp) }}</span>

        <!-- Level indicator -->
        <span class="shrink-0 w-1.5 h-1.5 rounded-full mt-1" :class="levelClass(entry.level)" />

        <!-- Project dot -->
        <div
          v-if="projectColor(entry.projectId)"
          class="shrink-0 w-1.5 h-1.5 rounded-full mt-1"
          :style="{ background: projectColor(entry.projectId) ?? undefined }"
        />

        <!-- Message -->
        <span class="text-[var(--text-secondary)] min-w-0 break-words">{{ entry.message }}</span>
      </div>

      <div v-if="logStore.entries.length === 0" class="flex items-center justify-center h-full text-[var(--text-faint)]">
        No activity yet
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useUiStore } from '../../stores/ui';
import { useActivityLogStore } from '../../stores/activityLog';
import { useProjectsStore } from '../../stores/projects';
import type { ActivityLogLevel } from '../../engine/KosTypes';

const ui = useUiStore();
const logStore = useActivityLogStore();
const projectsStore = useProjectsStore();

const scrollContainer = ref<HTMLElement | null>(null);

function formatTime(timestamp: string): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function levelClass(level: ActivityLogLevel): string {
  switch (level) {
    case 'success': return 'bg-[var(--accent-green)]';
    case 'warning': return 'bg-[var(--accent-yellow)]';
    case 'error': return 'bg-[var(--accent-red)]';
    default: return 'bg-[var(--text-faint)]';
  }
}

function projectColor(projectId: string): string | null {
  const project = projectsStore.projectById(projectId);
  return project?.color || null;
}
</script>
