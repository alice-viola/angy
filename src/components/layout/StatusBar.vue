<template>
  <div class="flex items-center justify-between h-8 px-4 bg-[var(--bg-surface)] border-t border-[var(--border-subtle)] text-[var(--text-xs)]">
    <!-- Left side -->
    <div class="flex items-center gap-3">
      <!-- Navigation buttons -->
      <div class="flex items-center gap-4">
        <button
          @click="ui.navigateHome()"
          class="px-2.5 py-1 rounded text-[var(--text-xs)] font-medium transition-colors"
          :class="ui.viewMode === 'home'
            ? 'text-[var(--accent-mauve)] bg-[color-mix(in_srgb,var(--accent-mauve)_15%,transparent)]'
            : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'"
        >Projects</button>

        <button
          @click="goToKanban"
          :disabled="!hasProjects"
          class="px-2.5 py-1 rounded text-[var(--text-xs)] font-medium transition-colors"
          :class="!hasProjects
            ? 'text-[var(--text-faint)] opacity-40 cursor-not-allowed'
            : ui.viewMode === 'kanban'
              ? 'text-[var(--accent-mauve)] bg-[color-mix(in_srgb,var(--accent-mauve)_15%,transparent)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'"
        >Kanban</button>

        <button
          @click="goToAgents"
          :disabled="!hasProjects"
          class="px-2.5 py-1 rounded text-[var(--text-xs)] font-medium transition-colors"
          :class="!hasProjects
            ? 'text-[var(--text-faint)] opacity-40 cursor-not-allowed'
            : (ui.viewMode === 'manager' || ui.viewMode === 'mission-control')
              ? 'text-[var(--accent-mauve)] bg-[color-mix(in_srgb,var(--accent-mauve)_15%,transparent)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'"
        >Agents</button>

        <button
          @click="goToCode"
          :disabled="!hasProjects"
          class="px-2.5 py-1 rounded text-[var(--text-xs)] font-medium transition-colors"
          :class="!hasProjects
            ? 'text-[var(--text-faint)] opacity-40 cursor-not-allowed'
            : ui.viewMode === 'editor'
              ? 'text-[var(--accent-mauve)] bg-[color-mix(in_srgb,var(--accent-mauve)_15%,transparent)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'"
        >Code</button>
      </div>

      <!-- Contextual info -->
      <template v-if="ui.viewMode === 'home'">
        <span class="text-[var(--text-muted)]">{{ projectsStore.projects.length }} project{{ projectsStore.projects.length !== 1 ? 's' : '' }}</span>
      </template>

      <template v-else-if="ui.viewMode === 'kanban'">
        <span class="text-[var(--text-muted)]">{{ kanbanLabel }}</span>
      </template>

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

    <!-- Center: multi-epic activity ticker -->
    <div v-if="activeActivities.length > 0" class="flex items-center gap-3 overflow-hidden max-w-[50%]">
      <div
        v-for="act in activeActivities.slice(0, 3)"
        :key="act.epicId"
        class="flex items-center gap-1.5 shrink-0"
      >
        <div
          class="w-1.5 h-1.5 rounded-full animate-pulse shrink-0"
          :style="{ background: act.color }"
        ></div>
        <span class="text-[var(--text-muted)] truncate max-w-[160px]">{{ act.projectName }} {{ act.label }}</span>
        <span v-if="act.progress" class="text-[var(--text-faint)] font-mono">{{ act.progress.current }}/{{ act.progress.total }}</span>
      </div>
      <span v-if="activeActivities.length > 3" class="text-[var(--text-faint)]">+{{ activeActivities.length - 3 }}</span>
    </div>
    <div v-else-if="ui.pipelineActivity" class="flex items-center gap-1.5">
      <div class="w-1.5 h-1.5 rounded-full bg-[var(--accent-green)] animate-pulse"></div>
      <span class="text-[var(--text-muted)] truncate max-w-[260px]">{{ ui.pipelineActivity }}</span>
      <span v-if="ui.pipelineTodoProgress" class="text-[var(--text-faint)] font-mono ml-1">{{ ui.pipelineTodoProgress.current }}/{{ ui.pipelineTodoProgress.total }}</span>
    </div>
    <div v-else-if="ui.isProcessing" class="flex items-center gap-1">
      <div class="w-1.5 h-1.5 rounded-full bg-[var(--accent-green)] animate-pulse"></div>
      <span class="text-[var(--text-muted)]">Processing</span>
    </div>

    <!-- Right side -->
    <div class="flex items-center gap-3">
      <!-- Activity log toggle -->
      <button
        @click="ui.toggleActivityLog()"
        class="flex items-center gap-1 px-2 py-0.5 rounded-md text-[var(--text-xs)] font-medium transition-colors"
        :class="ui.activityLogVisible
          ? 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          : 'text-[var(--text-faint)] hover:text-[var(--text-secondary)]'"
        title="Activity Log"
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3">
          <path d="M2 3h8M2 6h6M2 9h4" stroke-linecap="round" />
        </svg>
        Log
      </button>

      <!-- Model: only in manager/editor where agents run -->
      <span v-if="ui.viewMode === 'manager' || ui.viewMode === 'editor'" class="text-[var(--text-xs)] text-[var(--text-faint)]">{{ ui.currentModel }}</span>

      <!-- Panel toggles: only in manager/editor -->
      <button
        v-if="ui.viewMode === 'manager'"
        @click="ui.toggleEffectsPanel()"
        class="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[var(--text-xs)] font-medium transition-colors"
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
        class="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[var(--text-xs)] font-medium transition-colors"
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
import { useEpicStore } from '../../stores/epics';

const ui = useUiStore();
const projectsStore = useProjectsStore();
const epicStore = useEpicStore();

const hasProjects = computed(() => projectsStore.projects.length > 0);

const workspaceLabel = computed(() => {
  if (!ui.workspacePath) return 'Open folder\u2026';
  if (ui.activeProjectId) {
    const project = projectsStore.projectById(ui.activeProjectId);
    if (project) return project.name;
  }
  const parts = ui.workspacePath.replace(/\/$/, '').split('/');
  return parts[parts.length - 1] || ui.workspacePath;
});

const kanbanLabel = computed(() => {
  const ids = ui.kanbanProjectIds;
  if (ids.length === 0) return 'All Projects';
  if (ids.length === 1) {
    const project = projectsStore.projectById(ids[0]);
    return project?.name ?? '';
  }
  return `${ids.length} projects`;
});

const currentFileName = computed(() => {
  if (!ui.currentFile) return '';
  return ui.currentFile.split('/').pop() || ui.currentFile;
});

// Build activity ticker from epicActivities map
const activeActivities = computed(() => {
  const result: Array<{ epicId: string; projectName: string; color: string; label: string; progress?: { current: number; total: number } }> = [];
  for (const [epicId, act] of ui.epicActivities) {
    const epic = epicStore.epicById(epicId);
    const project = epic ? projectsStore.projectById(epic.projectId) : null;
    result.push({
      epicId,
      projectName: project?.name ?? '?',
      color: project?.color ?? '#cba6f7',
      label: act.label,
      progress: act.progress,
    });
  }
  return result;
});

function ensureWorkspace() {
  if (ui.activeProjectId) {
    const repos = projectsStore.reposByProjectId(ui.activeProjectId);
    if (repos.length > 0 && !ui.workspacePath) {
      ui.workspacePath = repos[0].path;
    }
  }
}

function goToKanban() {
  if (ui.kanbanProjectIds.length > 0) {
    ui.navigateToKanban();
  } else {
    // Show all projects
    ui.showAllProjectsOnKanban(projectsStore.projects.map(p => p.id));
  }
}

function goToAgents() {
  ensureWorkspace();
  ui.switchToMode('manager');
}

function goToCode() {
  if (!ui.activeProjectId) {
    // Multiple projects or none — need to pick one for code editor
    if (projectsStore.projects.length === 1) {
      ui.activeProjectId = projectsStore.projects[0].id;
      const repos = projectsStore.reposByProjectId(projectsStore.projects[0].id);
      if (repos.length > 0) ui.workspacePath = repos[0].path;
    } else {
      // Let kanban handle project picking — emit event to show picker
      ui.addNotification('info', 'Select a project', 'Choose a project from the Kanban board first to open its code editor.');
      return;
    }
  }
  ensureWorkspace();
  ui.switchToMode('editor');
}

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
