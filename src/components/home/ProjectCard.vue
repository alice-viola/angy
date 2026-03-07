<template>
  <div
    class="group relative bg-[var(--bg-surface)] border rounded-lg p-4 cursor-pointer transition-all hover:shadow-lg hover:shadow-black/20"
    :class="isAssigned
      ? 'border-[var(--accent-teal)] shadow-[0_0_0_1px_var(--accent-teal)] shadow-[var(--accent-teal)]/10'
      : 'border-[var(--border-subtle)] hover:border-[var(--accent-mauve)]'"
    @click="ui.navigateToProject(project.id)"
  >
    <!-- Settings gear -->
    <button
      class="absolute top-3 right-3 text-[var(--text-faint)] hover:text-[var(--text-secondary)] opacity-0 group-hover:opacity-100 transition-opacity"
      @click.stop="$emit('open-settings')"
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    </button>

    <!-- Project name -->
    <h3 class="text-sm font-medium text-[var(--text-primary)] pr-6">{{ project.name }}</h3>

    <!-- Description -->
    <p v-if="project.description" class="text-[11px] text-[var(--text-muted)] mt-1 line-clamp-2">
      {{ project.description }}
    </p>

    <!-- Stats -->
    <div class="flex items-center gap-3 mt-3 text-[10px] text-[var(--text-faint)]">
      <span>{{ repoCount }} {{ repoCount === 1 ? 'repo' : 'repos' }}</span>
      <span v-if="epicTotal > 0">{{ epicActive }} active / {{ epicTotal }} epics</span>
    </div>

    <!-- Assign to instance button -->
    <button
      class="absolute bottom-3 right-3 transition-all"
      :class="isAssigned
        ? 'text-[var(--accent-teal)] opacity-100'
        : 'text-[var(--text-faint)] hover:text-[var(--accent-teal)] opacity-0 group-hover:opacity-100'"
      :title="isAssigned ? 'Assigned to this instance' : 'Assign to this instance'"
      @click.stop="assignToInstance"
    >
      <!-- Filled check when assigned, outline target when not -->
      <svg v-if="isAssigned" class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
      </svg>
      <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" stroke-width="2"/>
        <circle cx="12" cy="12" r="3" stroke-width="2"/>
      </svg>
    </button>

    <!-- Quick Chat button -->
    <button
      v-if="repoCount > 0"
      class="absolute bottom-3 left-3 text-[var(--text-faint)] hover:text-[var(--accent-teal)] opacity-0 group-hover:opacity-100 transition-all"
      title="Quick Chat in this project's workspace"
      @click.stop="onProjectQuickChat"
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Project } from '@/engine/KosTypes';
import { useUiStore } from '@/stores/ui';
import { useProjectsStore } from '@/stores/projects';
import { useEpicStore } from '@/stores/epics';

const props = defineProps<{
  project: Project;
}>();

defineEmits<{
  'open-settings': [];
}>();

const ui = useUiStore();
const projectsStore = useProjectsStore();
const epicStore = useEpicStore();

const repoCount = computed(() => projectsStore.reposByProjectId(props.project.id).length);
const isAssigned = computed(() => ui.activeProjectId === props.project.id);

function assignToInstance() {
  ui.activeProjectId = props.project.id;
  const repos = projectsStore.reposByProjectId(props.project.id);
  if (repos.length > 0) {
    ui.workspacePath = repos[0].path;
  }
}

function onProjectQuickChat() {
  const repos = projectsStore.reposByProjectId(props.project.id);
  if (repos.length > 0) {
    ui.workspacePath = repos[0].path;
  }
  ui.switchToMode('manager');
}
const projectEpics = computed(() => epicStore.epicsByProject(props.project.id));
const epicTotal = computed(() => projectEpics.value.length);
const epicActive = computed(() => projectEpics.value.filter(e => e.column === 'in-progress').length);
</script>
