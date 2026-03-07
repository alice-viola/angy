<template>
  <div
    class="group relative bg-[var(--bg-surface)] border rounded-xl overflow-hidden transition-all duration-200 hover:shadow-lg hover:shadow-black/20"
    :class="isAssigned
      ? 'border-[var(--accent-teal)] shadow-[0_0_0_1px_var(--accent-teal)]'
      : 'border-[var(--border-subtle)] hover:border-[var(--border-standard)]'"
  >
    <!-- Main card body -->
    <div class="p-4 cursor-pointer" @click="ui.navigateToKanban(project.id)">
      <!-- Header -->
      <div class="flex items-start justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">
          <!-- Active instance indicator -->
          <div
            v-if="isAssigned"
            class="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-[var(--accent-teal)]"
          />
          <h3 class="text-sm font-semibold text-[var(--text-primary)] truncate leading-tight">{{ project.name }}</h3>
        </div>
        <!-- Settings -->
        <button
          class="flex-shrink-0 p-1 -mr-1 -mt-1 text-[var(--text-faint)] hover:text-[var(--text-secondary)] rounded hover:bg-[var(--bg-hover)] opacity-0 group-hover:opacity-100 transition-all"
          title="Project settings"
          @click.stop="$emit('open-settings')"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>

      <!-- Description -->
      <p v-if="project.description" class="text-[11px] text-[var(--text-muted)] mt-2 line-clamp-2 leading-relaxed">
        {{ project.description }}
      </p>

      <!-- Stats -->
      <div class="flex items-center gap-3 mt-3 text-[10px] text-[var(--text-faint)]">
        <span class="flex items-center gap-1">
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          {{ repoCount }} {{ repoCount === 1 ? 'repo' : 'repos' }}
        </span>
        <span v-if="epicTotal > 0" class="flex items-center gap-1">
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <span v-if="epicActive > 0" class="text-[var(--accent-teal)]">{{ epicActive }} active</span>
          <span v-if="epicActive > 0"> / </span>
          {{ epicTotal }} epics
        </span>
      </div>
    </div>

    <!-- Bottom action bar -->
    <div class="border-t border-[var(--border-subtle)] flex items-stretch divide-x divide-[var(--border-subtle)]">
      <!-- Kanban -->
      <button
        class="flex-1 flex flex-col items-center gap-1 py-2.5 text-[var(--text-faint)] hover:text-[var(--accent-mauve)] hover:bg-[color-mix(in_srgb,var(--accent-mauve)_8%,transparent)] transition-colors"
        title="Go to Kanban"
        @click="ui.navigateToKanban(project.id)"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
        </svg>
        <span class="text-[9px] font-medium tracking-wide uppercase">Kanban</span>
      </button>

      <!-- Code -->
      <button
        class="flex-1 flex flex-col items-center gap-1 py-2.5 text-[var(--text-faint)] hover:text-[var(--accent-blue)] hover:bg-[color-mix(in_srgb,var(--accent-blue)_8%,transparent)] transition-colors"
        title="Go to Code"
        @click="goToCode"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
        <span class="text-[9px] font-medium tracking-wide uppercase">Code</span>
      </button>

      <!-- Agent Fleet -->
      <button
        class="flex-1 flex flex-col items-center gap-1 py-2.5 text-[var(--text-faint)] hover:text-[var(--accent-peach)] hover:bg-[color-mix(in_srgb,var(--accent-peach)_8%,transparent)] transition-colors"
        title="Go to Agent Fleet"
        @click="goToFleet"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <rect x="3" y="11" width="18" height="10" rx="2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 11V8a3 3 0 016 0v3"/>
          <circle cx="9" cy="16" r="1" fill="currentColor"/>
          <circle cx="15" cy="16" r="1" fill="currentColor"/>
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19h6"/>
        </svg>
        <span class="text-[9px] font-medium tracking-wide uppercase">Fleet</span>
      </button>

      <!-- Instance toggle -->
      <button
        class="flex-1 flex flex-col items-center gap-1 py-2.5 transition-colors"
        :class="isAssigned
          ? 'text-[var(--accent-teal)] bg-[color-mix(in_srgb,var(--accent-teal)_8%,transparent)]'
          : 'text-[var(--text-faint)] hover:text-[var(--accent-teal)] hover:bg-[color-mix(in_srgb,var(--accent-teal)_8%,transparent)]'"
        :title="isAssigned ? 'Active instance' : 'Set as active instance'"
        @click="assignToInstance"
      >
        <svg v-if="isAssigned" class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
        </svg>
        <svg v-else class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" stroke-width="2"/>
          <circle cx="12" cy="12" r="3" stroke-width="2"/>
        </svg>
        <span class="text-[9px] font-medium tracking-wide uppercase">Instance</span>
      </button>
    </div>
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

const projectEpics = computed(() => epicStore.epicsByProject(props.project.id));
const epicTotal = computed(() => projectEpics.value.length);
const epicActive = computed(() => projectEpics.value.filter(e => e.column === 'in-progress').length);

function assignToInstance() {
  ui.activeProjectId = props.project.id;
  const repos = projectsStore.reposByProjectId(props.project.id);
  if (repos.length > 0) {
    ui.workspacePath = repos[0].path;
  }
}

function goToCode() {
  ui.activeProjectId = props.project.id;
  const repos = projectsStore.reposByProjectId(props.project.id);
  if (repos.length > 0) {
    ui.workspacePath = repos[0].path;
  }
  ui.switchToMode('editor');
}

function goToFleet() {
  ui.activeProjectId = props.project.id;
  const repos = projectsStore.reposByProjectId(props.project.id);
  if (repos.length > 0) {
    ui.workspacePath = repos[0].path;
  }
  ui.switchToMode('manager');
}
</script>
