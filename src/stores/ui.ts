import { defineStore } from 'pinia';
import { ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useFilterStore } from '@/stores/filter';
import { useProjectsStore } from '@/stores/projects';
import { DEFAULT_MODEL_ID } from '@/constants/models';

export type ViewMode = 'home' | 'kanban' | 'agents' | 'code' | 'mission-control' | 'analytics' | 'git-graph';

export interface AppNotification {
  id: string
  type: 'error' | 'warning' | 'info' | 'success'
  title: string
  message: string
  timestamp: number
  epicId?: string
  autoDismiss?: boolean
}

export const useUiStore = defineStore('ui', () => {
  const viewMode = ref<ViewMode>('home');
  const activeProjectId = ref<string | null>(null);
  const activeEpicId = ref<string | null>(null);
  const terminalVisible = ref(false);
  const activeLeftTab = ref<'files' | 'git' | 'search'>('files');
  const workspacePath = ref('');
  const currentFile = ref('');
  const currentBranch = ref('');
  const currentModel = ref(DEFAULT_MODEL_ID);
  const isProcessing = ref(false);
  const inlinePreviewFile = ref<string | null>(null);
  const effectsPanelVisible = ref(true);
  const editorChatVisible = ref(true);
  const rightPanelMode = ref<'effects' | 'graph'>('effects');
  const missionControlFilter = ref<string | null>(null);
  const autoCommitEnabled = ref(false);
  const geminiApiKey = ref('');
  const anthropicApiKey = ref('');
  const ollamaBaseUrl = ref('http://localhost:11434');

  const openProjectIds = ref<string[]>([]);
  const notifications = ref<AppNotification[]>([]);
  const repoSwitchOnly = ref(false);
  const epicActivities = ref<Map<string, { label: string; progress?: { current: number; total: number } }>>(new Map());
  const activityLogVisible = ref(false);
  const kanbanFilterText = ref('');
  const pipelineActivity = ref<string | null>(null);
  const pipelineTodoProgress = ref<{ current: number; total: number } | null>(null);
  const navRailExpanded = ref(true);

  // Diff view state (git diff shown in Monaco DiffSplitView)
  const diffView = ref<{
    filePath: string;
    oldContent: string;
    newContent: string;
    leftLabel: string;
    rightLabel: string;
  } | null>(null);

  // Splitter sizes for each mode (pixel hints, splitpanes uses percentages)
  const managerSizes = ref([220, 0, 0, -1, 300]);
  const editorSizes = ref([40, 210, -1, 320, 0]);

  function switchToMode(mode: ViewMode) {
    window.dispatchEvent(new CustomEvent('angy:close-popovers'));
    viewMode.value = mode;
  }

  function toggleViewMode() {
    switchToMode(viewMode.value === 'agents' ? 'code' : 'agents');
  }

  function toggleTerminal() {
    terminalVisible.value = !terminalVisible.value;
  }

  function dismissInlinePreview() {
    inlinePreviewFile.value = null;
  }

  function toggleEffectsPanel() {
    effectsPanelVisible.value = !effectsPanelVisible.value;
  }

  function toggleEditorChat() {
    editorChatVisible.value = !editorChatVisible.value;
  }

  function toggleRightPanelMode() {
    rightPanelMode.value = rightPanelMode.value === 'effects' ? 'graph' : 'effects';
  }

  function setRightPanelMode(mode: 'effects' | 'graph') {
    rightPanelMode.value = mode;
  }

  function enterMissionControl() {
    viewMode.value = 'mission-control';
  }

  function exitMissionControl() {
    viewMode.value = 'agents';
    missionControlFilter.value = null;
  }

  function setMissionControlFilter(sessionId: string | null) {
    missionControlFilter.value = sessionId;
  }

  function toggleAutoCommit() {
    autoCommitEnabled.value = !autoCommitEnabled.value;
  }

  function showDiffView(filePath: string, oldContent: string, newContent: string, leftLabel: string, rightLabel: string) {
    diffView.value = { filePath, oldContent, newContent, leftLabel, rightLabel };
  }

  function closeDiffView() {
    diffView.value = null;
  }

  function addNotification(type: AppNotification['type'], title: string, message: string, epicId?: string, autoDismissOverride?: boolean) {
    const notification: AppNotification = {
      id: crypto.randomUUID(),
      type,
      title,
      message,
      timestamp: Date.now(),
      epicId,
      autoDismiss: autoDismissOverride ?? (type !== 'error'),
    }
    notifications.value.push(notification)
    if (notification.autoDismiss) {
      setTimeout(() => dismissNotification(notification.id), 8000)
    }
    if (notifications.value.length > 20) {
      notifications.value = notifications.value.slice(-20)
    }
  }

  function dismissNotification(id: string) {
    notifications.value = notifications.value.filter(n => n.id !== id)
  }

  function clearNotifications() {
    notifications.value = []
  }

  function openCommandPalette() {
    window.dispatchEvent(new CustomEvent('angy:command-palette'));
  }

  function navigateHome() {
    window.dispatchEvent(new CustomEvent('angy:close-popovers'));
    viewMode.value = 'home';
    activeProjectId.value = null;
    activeEpicId.value = null;
  }

  function selectFirstRepo(projectId: string) {
    const projectsStore = useProjectsStore();
    const projectRepos = projectsStore.reposByProjectId(projectId);
    if (projectRepos.length === 0) {
      return;
    }
    if (projectRepos.length === 1) {
      workspacePath.value = projectRepos[0].path;
      return;
    }
    // Multi-repo: compute common ancestor path
    const paths = projectRepos.map(r => r.path).filter(Boolean);
    const segments = paths.map(p => p.split('/'));
    const commonParts: string[] = [];
    for (let i = 0; i < segments[0].length; i++) {
      const seg = segments[0][i];
      if (segments.every(s => s[i] === seg)) commonParts.push(seg);
      else break;
    }
    workspacePath.value = commonParts.join('/') || '/';
  }

  function navigateToProject(projectId: string) {
    window.dispatchEvent(new CustomEvent('angy:close-popovers'));
    openProjectTab(projectId);
    viewMode.value = 'agents';
  }

  function navigateToEpic(epicId: string | null, projectId: string) {
    window.dispatchEvent(new CustomEvent('angy:close-popovers'));
    openProjectTab(projectId);
    activeEpicId.value = epicId;
    viewMode.value = 'agents';
  }

  function openProjectTab(projectId: string) {
    if (!openProjectIds.value.includes(projectId)) {
      openProjectIds.value = [...openProjectIds.value, projectId];
    }
    activeProjectId.value = projectId;
    selectFirstRepo(projectId);
    useFilterStore().applySelection([projectId]);
  }

  function switchProjectTab(projectId: string) {
    if (openProjectIds.value.includes(projectId)) {
      activeProjectId.value = projectId;
      selectFirstRepo(projectId);
      useFilterStore().applySelection([projectId]);
    }
  }

  function closeProjectTab(projectId: string) {
    openProjectIds.value = openProjectIds.value.filter(id => id !== projectId);
    if (activeProjectId.value === projectId) {
      if (openProjectIds.value.length > 0) {
        // Fall back to the last opened tab
        switchProjectTab(openProjectIds.value[openProjectIds.value.length - 1]);
      } else {
        navigateHome();
      }
    }
  }

  function toggleActivityLog() {
    activityLogVisible.value = !activityLogVisible.value;
  }

  function setEpicActivity(epicId: string, label: string | null, progress?: { current: number; total: number }) {
    if (!label) {
      epicActivities.value.delete(epicId);
      epicActivities.value = new Map(epicActivities.value);
    } else {
      const updated = new Map(epicActivities.value);
      updated.set(epicId, { label, progress });
      epicActivities.value = updated;
    }
  }

  function navigateToKanban(projectId: string) {
    window.dispatchEvent(new CustomEvent('angy:close-popovers'));
    openProjectTab(projectId);
    activeEpicId.value = null;
    viewMode.value = 'kanban';
  }

  function toggleNavRail() {
    navRailExpanded.value = !navRailExpanded.value;
  }

  async function openNewWindow(projectId?: string | null) {
    try {
      const windowId = await invoke<string>('new_window', {
        projectId: projectId ?? undefined,
      });
      console.log(`[UI] Opened new window: ${windowId}`);
      return windowId;
    } catch (err) {
      console.error('[UI] Failed to open new window:', err);
      throw err;
    }
  }

  return {
    viewMode, activeProjectId, activeEpicId, terminalVisible, activeLeftTab,
    workspacePath, currentFile, currentBranch, currentModel, isProcessing,
    inlinePreviewFile, effectsPanelVisible, editorChatVisible, rightPanelMode, diffView,
    missionControlFilter, autoCommitEnabled, openProjectIds, notifications, repoSwitchOnly,
    managerSizes, editorSizes, kanbanFilterText, pipelineActivity, pipelineTodoProgress,
    epicActivities, activityLogVisible, geminiApiKey, anthropicApiKey, ollamaBaseUrl, navRailExpanded,
    switchToMode, toggleViewMode, toggleTerminal, dismissInlinePreview,
    toggleEffectsPanel, toggleEditorChat, toggleRightPanelMode, setRightPanelMode,
    showDiffView, closeDiffView,
    enterMissionControl, exitMissionControl, setMissionControlFilter, toggleAutoCommit,
    addNotification, dismissNotification, clearNotifications,
    navigateHome, navigateToProject, navigateToEpic, navigateToKanban,
    openProjectTab, switchProjectTab, closeProjectTab, selectFirstRepo,
    openCommandPalette, toggleActivityLog, setEpicActivity, toggleNavRail,
    openNewWindow,
  };
});
