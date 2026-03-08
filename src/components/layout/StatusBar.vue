<template>
  <div class="flex items-center justify-between h-7 px-4 bg-[var(--bg-surface)] border-t border-[var(--border-subtle)] text-[10px]">
    <!-- Left side -->
    <div class="flex items-center gap-3">
      <!-- Home: project count -->
      <template v-if="ui.viewMode === 'home'">
        <span class="text-[var(--text-muted)]">{{ projectsStore.projects.length }} project{{ projectsStore.projects.length !== 1 ? 's' : '' }}</span>
      </template>

      <!-- Kanban: project name -->
      <template v-else-if="ui.viewMode === 'kanban'">
        <span class="text-[var(--text-muted)]">{{ projectLabel }}</span>
      </template>

      <!-- Manager / Editor / Mission Control: workspace + file + branch -->
      <template v-else>
        <button
          @click="openFolder"
          class="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors truncate max-w-[200px]"
          :title="ui.workspacePath || 'Open workspace'"
        >
          {{ workspaceLabel }}
        </button>
        <span v-if="ui.currentFile" class="text-[var(--text-muted)] truncate max-w-[200px]">{{ currentFileName }}</span>
        <span v-if="ui.currentBranch" class="text-[var(--text-muted)]">
          <span class="text-[var(--accent-green)]">&#x2387;</span> {{ ui.currentBranch }}
        </span>
      </template>
    </div>

    <!-- Center: processing indicator -->
    <div v-if="ui.isProcessing" class="flex items-center gap-1">
      <div class="w-1.5 h-1.5 rounded-full bg-[var(--accent-green)] animate-pulse"></div>
      <span class="text-[var(--text-muted)]">Processing</span>
    </div>

    <!-- Right side -->
    <div class="flex items-center gap-3">
      <!-- Model: only in manager/editor where agents run -->
      <span v-if="ui.viewMode === 'manager' || ui.viewMode === 'editor'" class="text-[var(--text-faint)]">{{ ui.currentModel }}</span>

      <!-- Panel toggles: only in manager/editor -->
      <button
        v-if="ui.viewMode === 'manager'"
        @click="ui.toggleEffectsPanel()"
        class="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors"
        :class="ui.effectsPanelVisible
          ? 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          : 'text-[var(--text-faint)] hover:text-[var(--text-secondary)]'"
        :title="ui.effectsPanelVisible ? 'Hide Effects' : 'Show Effects'"
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3">
          <rect x="1" y="1" width="10" height="10" rx="1.5" />
          <path d="M8 1V11" />
        </svg>
        Effects
      </button>
      <button
        v-else-if="ui.viewMode === 'editor'"
        @click="ui.toggleEditorChat()"
        class="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors"
        :class="ui.editorChatVisible
          ? 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          : 'text-[var(--text-faint)] hover:text-[var(--text-secondary)]'"
        :title="ui.editorChatVisible ? 'Hide Chat' : 'Show Chat'"
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3">
          <rect x="1" y="2" width="10" height="8" rx="1.5" />
          <path d="M3 5H9M3 7.5H6.5" />
        </svg>
        Chat
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import { useUiStore } from '../../stores/ui';
import { useProjectsStore } from '../../stores/projects';

const ui = useUiStore();
const projectsStore = useProjectsStore();

const workspaceLabel = computed(() => {
  if (!ui.workspacePath) return 'Open folder\u2026';
  if (ui.activeProjectId) {
    const project = projectsStore.projectById(ui.activeProjectId);
    if (project) return project.name;
  }
  const parts = ui.workspacePath.replace(/\/$/, '').split('/');
  return parts[parts.length - 1] || ui.workspacePath;
});

const projectLabel = computed(() => {
  if (ui.activeProjectId) {
    const project = projectsStore.projectById(ui.activeProjectId);
    if (project) return project.name;
  }
  return '';
});

const currentFileName = computed(() => {
  if (!ui.currentFile) return '';
  return ui.currentFile.split('/').pop() || ui.currentFile;
});

async function openFolder() {
  const selected = await open({
    directory: true,
    multiple: false,
    title: 'Select Workspace Folder',
  });
  if (selected && typeof selected === 'string') {
    ui.workspacePath = selected;
  }
}
</script>
