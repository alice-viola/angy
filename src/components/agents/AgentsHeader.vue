<template>
  <div class="flex flex-col bg-window/50 border-b border-border-subtle">
    <!-- Row 1: Title + Actions -->
    <div class="h-12 flex items-center gap-3 px-5">
      <span class="text-sm font-semibold text-txt-primary">Agents</span>
      <span class="text-xs text-txt-muted">{{ subtitle }}</span>

      <span class="flex-1" />

      <!-- Stop All -->
      <button
        v-if="runningCount > 0"
        class="flex items-center gap-1 text-xs text-txt-faint hover:text-red-400 px-2 py-1 rounded hover:bg-red-500/10 transition-colors"
        title="Stop all agents"
      >
        <svg class="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
          <rect x="3" y="3" width="10" height="10" rx="1" />
        </svg>
        Stop All
      </button>

      <!-- Mission Control -->
      <button
        class="flex items-center gap-1 text-xs text-txt-muted hover:text-txt-primary px-2 py-1 rounded-md hover:bg-raised transition-colors"
        @click="$emit('enter-mission-control')"
        title="Mission Control"
      >
        <svg class="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
          <rect x="1" y="1" width="6" height="6" rx="1" />
          <rect x="9" y="1" width="6" height="6" rx="1" />
          <rect x="1" y="9" width="6" height="6" rx="1" />
          <rect x="9" y="9" width="6" height="6" rx="1" />
        </svg>
      </button>

      <!-- +New Agent -->
      <button
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-base bg-gradient-to-r from-ember-500 to-ember-600 hover:brightness-110 transition"
        @click="$emit('new-agent')"
        title="New agent"
      >
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        New Agent
      </button>
    </div>

    <!-- Row 2: Project filter chips -->
    <div class="px-4 py-2 border-t border-border-subtle">
      <ProjectFilterChips
        :selectedIds="filterStore.selectedProjectIds"
        :projects="chipProjects"
        :showAgentCounts="true"
        popoverId="agents-project-filter"
        @toggle="filterStore.toggleProject"
        @remove="filterStore.toggleProject"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useFleetStore } from '../../stores/fleet';
import { useFilterStore } from '../../stores/filter';
import { useProjectsStore } from '../../stores/projects';
import ProjectFilterChips from '../common/ProjectFilterChips.vue';

defineEmits<{
  'new-agent': [];
  'enter-mission-control': [];
}>();

const fleetStore = useFleetStore();
const filterStore = useFilterStore();
const projectsStore = useProjectsStore();

const runningCount = computed(() =>
  fleetStore.agents.filter((a) => a.status === 'working').length,
);

const projectCount = computed(() => {
  const grouped = fleetStore.agentsGroupedByProject;
  return grouped.filter((g) => g.projectId !== '__unattached__').length;
});

const subtitle = computed(() => {
  const r = runningCount.value;
  const p = projectCount.value;
  if (r === 0) return `${fleetStore.agents.length} agents`;
  return `${r} running across ${p} project${p !== 1 ? 's' : ''}`;
});

const chipProjects = computed(() =>
  projectsStore.projects.map((p) => ({ id: p.id, name: p.name })),
);
</script>
