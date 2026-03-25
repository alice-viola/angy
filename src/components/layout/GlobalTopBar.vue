<template>
  <div class="relative flex items-center h-10 px-3 bg-window/50 border-b border-[var(--border-subtle)] text-xs select-none">
    <!-- Left: Logo + Breadcrumbs -->
    <div class="flex items-center gap-1.5 min-w-0 z-10">
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

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { getModKey } from '@/engine/platform';
import { useUiStore } from '../../stores/ui';
import { useProjectsStore } from '../../stores/projects';
import { useEpicStore } from '../../stores/epics';
import { Scheduler } from '../../engine/Scheduler';
import { engineBus } from '@/engine/EventBus';

const ui = useUiStore();

const modKey = ref('⌘');
getModKey().then(k => { modKey.value = k; });
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

const onConfigChanged = () => { pollSchedulerStatus(); };
engineBus.on('scheduler:configChanged', onConfigChanged);

onMounted(() => {
  pollSchedulerStatus();
  pollTimer = setInterval(pollSchedulerStatus, 5000);
});

onUnmounted(() => {
  engineBus.off('scheduler:configChanged', onConfigChanged);
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
});

</script>
