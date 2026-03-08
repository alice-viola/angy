<template>
  <div class="relative flex items-center h-10 px-3 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] text-xs select-none">
    <!-- Left: Logo + Breadcrumbs -->
    <div class="flex items-center gap-1.5 min-w-0 z-10">
      <!-- Logo — always visible, clickable when not on home -->
      <component
        :is="ui.viewMode === 'home' ? 'span' : 'button'"
        class="flex items-center gap-1.5 shrink-0"
        :class="ui.viewMode !== 'home' && 'hover:opacity-80 transition-opacity'"
        @click="ui.viewMode !== 'home' && ui.navigateHome()"
      >
        <img src="/angylogo.png" alt="Angy" class="w-4 h-4 object-contain" />
        <span class="font-semibold text-[var(--text-primary)]">Angy</span>
      </component>

      <!-- Breadcrumb: Project -->
      <template v-if="projectName">
        <span class="text-[var(--text-faint)] mx-0.5">›</span>
        <component
          :is="activeEpic ? 'button' : 'span'"
          class="truncate max-w-[140px]"
          :class="activeEpic
            ? 'text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors'
            : 'text-[var(--text-secondary)]'"
          @click="activeEpic && ui.navigateToKanban(ui.activeProjectId!)"
        >{{ projectName }}</component>
      </template>

      <!-- Breadcrumb: Epic -->
      <template v-if="activeEpic">
        <span class="text-[var(--text-faint)] mx-0.5">›</span>
        <span class="text-[var(--text-secondary)] truncate max-w-[160px]">{{ activeEpic.title }}</span>
      </template>
    </div>

    <!-- Center: contextual actions slot (absolute center of the bar) -->
    <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div class="pointer-events-auto">
        <slot name="actions" />
      </div>
    </div>

    <!-- Spacer to push right controls -->
    <div class="flex-1" />

    <!-- Right: persistent controls -->
    <div class="flex items-center gap-2.5 shrink-0">
      <!-- Scheduler status badge -->
      <div class="flex items-center gap-1" title="Scheduler status">
        <span
          class="w-1.5 h-1.5 rounded-full"
          :class="schedulerRunning ? 'bg-emerald-400' : 'bg-gray-500'"
        />
        <span class="text-[10px] text-[var(--text-muted)]">{{ schedulerRunning ? 'On' : 'Off' }}</span>
      </div>

      <!-- Mode toggle (Manager ↔ Editor) — only in manager/editor views -->
      <button
        v-if="ui.viewMode === 'manager' || ui.viewMode === 'editor'"
        @click="ui.toggleViewMode()"
        class="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors"
        :class="ui.viewMode === 'manager'
          ? 'bg-[color-mix(in_srgb,var(--accent-mauve)_15%,transparent)] text-[var(--accent-mauve)] hover:bg-[color-mix(in_srgb,var(--accent-mauve)_25%,transparent)]'
          : 'bg-[color-mix(in_srgb,var(--accent-teal)_15%,transparent)] text-[var(--accent-teal)] hover:bg-[color-mix(in_srgb,var(--accent-teal)_25%,transparent)]'"
        :title="ui.viewMode === 'manager' ? 'Switch to Editor (⌘E)' : 'Switch to Manager (⌘E)'"
      >
        <svg v-if="ui.viewMode === 'manager'" width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3">
          <rect x="1" y="1" width="10" height="10" rx="1.5" />
          <path d="M4 1V11" />
          <path d="M4 4H11" />
        </svg>
        <svg v-else width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3">
          <rect x="1" y="1" width="10" height="10" rx="1.5" />
          <path d="M4 1V11" />
          <path d="M8 1V11" />
        </svg>
        {{ ui.viewMode === 'manager' ? 'Editor' : 'Manager' }}
      </button>

      <!-- Settings -->
      <button
        @click="openSettings"
        class="w-7 h-7 flex items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] transition-colors"
        title="Settings (⌘,)"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useUiStore } from '../../stores/ui';
import { useProjectsStore } from '../../stores/projects';
import { useEpicStore } from '../../stores/epics';
import { Scheduler } from '../../engine/Scheduler';

const ui = useUiStore();
const projectsStore = useProjectsStore();
const epicStore = useEpicStore();

// ── Breadcrumb data ──────────────────────────────────────────────────────

const projectName = computed(() => {
  if (!ui.activeProjectId) return '';
  return projectsStore.projectById(ui.activeProjectId)?.name ?? '';
});

const activeEpic = computed(() => {
  if (!ui.activeEpicId) return null;
  return epicStore.epicById(ui.activeEpicId) ?? null;
});

// ── Scheduler status polling ─────────────────────────────────────────────

const schedulerRunning = ref(false);
let pollTimer: ReturnType<typeof setInterval> | null = null;

function pollSchedulerStatus() {
  try {
    schedulerRunning.value = Scheduler.getInstance().isRunning();
  } catch {
    schedulerRunning.value = false;
  }
}

onMounted(() => {
  pollSchedulerStatus();
  pollTimer = setInterval(pollSchedulerStatus, 5000);
});

onUnmounted(() => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
});

// ── Settings ─────────────────────────────────────────────────────────────

function openSettings() {
  window.dispatchEvent(new CustomEvent('angy:open-settings'));
}
</script>
