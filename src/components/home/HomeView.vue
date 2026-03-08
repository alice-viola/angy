<template>
  <div class="flex flex-col h-full bg-[var(--bg-base)]">
    <!-- Main content -->
    <div class="flex-1 overflow-y-auto">
      <div class="max-w-[900px] mx-auto px-8 py-12">
        <!-- Header with Open Workspace CTA -->
        <div class="flex items-center justify-between mb-8">
          <div />
          <button
            @click="onOpenWorkspace"
            class="flex items-center gap-3 px-4 py-2.5 text-xs text-[var(--text-secondary)] bg-[var(--bg-surface)] border border-[var(--border-standard)] rounded-lg hover:border-[var(--accent-teal)] hover:brightness-110 transition-all"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <div class="text-left">
              <div class="font-medium">Open Workspace</div>
              <div class="text-[10px] text-[var(--text-muted)]">Agent fleet without a project</div>
            </div>
          </button>
        </div>

        <!-- Empty state -->
        <div
          v-if="projectsStore.projects.length === 0 && !projectsStore.loading"
          class="flex flex-col items-center justify-center py-20 text-center"
        >
          <div class="text-[var(--text-faint)] mb-4">
            <svg class="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <p class="text-sm text-[var(--text-muted)] mb-4">No projects yet. Create your first project to get started.</p>
          <button
            @click="showNewProject = true"
            class="px-4 py-2 text-xs bg-[var(--accent-mauve)] text-white rounded-lg hover:brightness-110 transition-all"
          >
            Create Project
          </button>
        </div>

        <!-- Project grid -->
        <template v-else>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <ProjectCard
              v-for="project in projectsStore.projects"
              :key="project.id"
              :project="project"
              @open-settings="settingsProject = project"
            />

            <!-- New project card -->
            <button
              @click="showNewProject = true"
              class="flex flex-col items-center justify-center gap-2 min-h-[120px] border border-dashed border-[var(--border-subtle)] rounded-lg text-[var(--text-faint)] hover:text-[var(--accent-teal)] hover:border-[var(--accent-teal)] transition-colors cursor-pointer"
            >
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
              <span class="text-xs">New Project</span>
            </button>
          </div>

        </template>
      </div>
    </div>

    <!-- Dialogs -->
    <NewProjectDialog v-if="showNewProject" @close="showNewProject = false" />
    <ProjectSettingsDialog v-if="settingsProject" :project="settingsProject" @close="settingsProject = null" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { Project } from '@/engine/KosTypes';
import { useProjectsStore } from '@/stores/projects';
import { useUiStore } from '@/stores/ui';
import ProjectCard from './ProjectCard.vue';
import NewProjectDialog from './NewProjectDialog.vue';
import ProjectSettingsDialog from './ProjectSettingsDialog.vue';

const projectsStore = useProjectsStore();
const ui = useUiStore();

function onOpenWorkspace() {
  ui.activeProjectId = null;
  ui.workspacePath = '';
  ui.switchToMode('manager');
}

const showNewProject = ref(false);
const settingsProject = ref<Project | null>(null);
</script>
