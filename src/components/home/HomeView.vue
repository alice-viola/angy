<script setup lang="ts">
import { ref, computed } from 'vue';
import type { Project } from '@/engine/KosTypes';
import { useProjectsStore } from '@/stores/projects';
import { useEpicStore } from '@/stores/epics';
import { useFleetStore } from '@/stores/fleet';
import { useUiStore } from '@/stores/ui';
import ProjectCard from './ProjectCard.vue';
import NewProjectCard from './NewProjectCard.vue';
import NewProjectDialog from './NewProjectDialog.vue';
import ProjectSettingsDialog from './ProjectSettingsDialog.vue';

const projectsStore = useProjectsStore();
const epicStore = useEpicStore();
const fleetStore = useFleetStore();
const ui = useUiStore();

const showNewProject = ref(false);
const settingsProject = ref<Project | null>(null);

const greeting = computed(() => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
});

const subtitleStats = computed(() => {
  const pc = projectsStore.projects.length;
  const agentCount = fleetStore.activeCount;
  const epicCount = projectsStore.projects.reduce(
    (sum, p) => sum + epicStore.activeEpicsByProject(p.id),
    0
  );
  const parts = [`${pc} project${pc !== 1 ? 's' : ''}`];
  if (agentCount > 0) parts.push(`${agentCount} active agent${agentCount !== 1 ? 's' : ''}`);
  if (epicCount > 0) parts.push(`${epicCount} epic${epicCount !== 1 ? 's' : ''} in progress`);
  return parts.join(' \u00b7 ');
});
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Header bar -->
    <div class="h-12 border-b border-border-subtle px-5 flex items-center gap-4 shrink-0">
      <span class="text-sm font-semibold text-txt-primary">Projects</span>
      <span class="text-xs text-txt-muted">{{ projectsStore.projects.length }} projects</span>
      <div class="flex-1" />
      <!-- Search trigger -->
      <button
        class="w-64 h-7 bg-white/[0.03] border border-white/[0.06] rounded-lg hover:border-ember/30 flex items-center gap-2 px-2 text-[11px] text-txt-faint cursor-pointer transition-colors"
        @click="ui.openCommandPalette()"
      >
        <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <span class="flex-1 text-left">Search epics, agents, files...</span>
        <span class="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/[0.08] text-txt-faint font-mono">⌘K</span>
      </button>
    </div>

    <!-- Scrollable content -->
    <div class="flex-1 overflow-y-auto p-8">
      <!-- Greeting -->
      <div class="mb-8 anim-fade-in">
        <h1 class="text-2xl font-bold text-txt-primary mb-1">{{ greeting }}</h1>
        <p class="text-sm text-txt-secondary">{{ subtitleStats }}</p>
      </div>

      <!-- Loading skeletons -->
      <template v-if="projectsStore.loading">
        <div class="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 max-w-6xl">
          <div v-for="i in 4" :key="i" class="flex items-center gap-2.5 px-3 py-2 rounded-md border-l-2 border-l-txt-faint/20 animate-pulse">
            <div class="w-7 h-7 rounded-md bg-raised" />
            <div class="flex-1">
              <div class="h-3 bg-raised rounded w-3/4 mb-1.5" />
              <div class="h-2 bg-raised rounded w-1/2" />
            </div>
          </div>
        </div>
      </template>

      <!-- Empty state -->
      <template v-else-if="projectsStore.projects.length === 0">
        <div class="flex flex-col items-center justify-center py-20 text-center">
          <svg class="w-12 h-12 text-txt-faint mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          <p class="text-sm text-txt-muted mb-4">Create a project to get started</p>
          <button
            class="px-4 py-2 text-xs rounded-lg bg-ember text-white hover:brightness-110 transition-all"
            @click="showNewProject = true"
          >New Project</button>
        </div>
      </template>

      <!-- Card grid -->
      <template v-else>
        <div class="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 max-w-6xl">
          <ProjectCard
            v-for="(project, idx) in projectsStore.projects"
            :key="project.id"
            :project="project"
            :agents="fleetStore.agentsByProject(project.id)"
            :active-epic-count="epicStore.activeEpicsByProject(project.id)"
            :repo-count="projectsStore.reposByProjectId(project.id).length"
            :index="idx"
            @open-settings="settingsProject = project"
          />
          <NewProjectCard @click="showNewProject = true" />
        </div>
      </template>
    </div>

    <!-- Dialogs -->
    <NewProjectDialog v-if="showNewProject" @close="showNewProject = false" />
    <ProjectSettingsDialog v-if="settingsProject" :project="settingsProject" @close="settingsProject = null" />
  </div>
</template>
