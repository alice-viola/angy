<template>
  <div class="flex items-center gap-4 px-4 py-2 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] text-[11px]">
    <!-- Status indicator -->
    <div class="flex items-center gap-1.5">
      <span class="w-2 h-2 rounded-full" :class="schedulerRunning ? 'bg-emerald-400' : 'bg-gray-500'" />
      <span class="text-[var(--text-muted)]">{{ schedulerRunning ? 'Running' : 'Stopped' }}</span>
    </div>

    <span class="text-[var(--border-subtle)]">|</span>

    <!-- Projects -->
    <span class="text-[var(--text-secondary)]">{{ projectCount }} {{ projectCount === 1 ? 'project' : 'projects' }}</span>

    <span class="text-[var(--border-subtle)]">|</span>

    <!-- Active epics -->
    <span class="text-[var(--text-secondary)]">{{ activeEpicCount }} active {{ activeEpicCount === 1 ? 'epic' : 'epics' }}</span>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useProjectsStore } from '@/stores/projects';
import { useEpicStore } from '@/stores/epics';
import { Scheduler } from '@/engine/Scheduler';

const projectsStore = useProjectsStore();
const epicStore = useEpicStore();

const projectCount = computed(() => projectsStore.projectCount);
const activeEpicCount = computed(() => epicStore.activeEpics.length);

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
</script>
