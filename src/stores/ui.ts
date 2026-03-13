import { defineStore } from 'pinia';
import { ref } from 'vue';

export type ViewMode = 'home' | 'kanban' | 'manager' | 'editor' | 'mission-control';

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
  const currentModel = ref('claude-sonnet-4-6');
  const isProcessing = ref(false);
  const inlinePreviewFile = ref<string | null>(null);
  const effectsPanelVisible = ref(true);
  const editorChatVisible = ref(true);
  const rightPanelMode = ref<'effects' | 'graph'>('effects');
  const missionControlFilter = ref<string | null>(null);
  const autoCommitEnabled = ref(false);
  const kanbanProjectIds = ref<string[]>([]);
  const fleetProjectIds = ref<string[]>([]); // empty = show all
  const notifications = ref<AppNotification[]>([]);
  const repoSwitchOnly = ref(false);
  const kanbanFilterText = ref('');
  const pipelineActivity = ref<string | null>(null);
  const pipelineTodoProgress = ref<{ current: number; total: number } | null>(null);

  // Multi-epic activity tracking: epicId -> { label, progress }
  const epicActivities = ref<Map<string, { label: string; progress?: { current: number; total: number } }>>(new Map());
  const activityLogVisible = ref(false);

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
    viewMode.value = mode;
  }

  function toggleViewMode() {
    switchToMode(viewMode.value === 'manager' ? 'editor' : 'manager');
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
    viewMode.value = 'manager';
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

  function addNotification(type: AppNotification['type'], title: string, message: string, epicId?: string) {
    const notification: AppNotification = {
      id: crypto.randomUUID(),
      type,
      title,
      message,
      timestamp: Date.now(),
      epicId,
      autoDismiss: type !== 'error',
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

  function navigateHome() {
    viewMode.value = 'home';
    activeProjectId.value = null;
    activeEpicId.value = null;
  }

  function navigateToProject(projectId: string) {
    activeProjectId.value = projectId;
    if (!kanbanProjectIds.value.includes(projectId)) {
      kanbanProjectIds.value = [...kanbanProjectIds.value, projectId];
    }
    viewMode.value = 'kanban';
  }

  function navigateToEpic(epicId: string, projectId: string) {
    activeProjectId.value = projectId;
    activeEpicId.value = epicId;
    viewMode.value = 'manager';
  }

  function navigateToKanban(projectId?: string) {
    if (projectId) {
      activeProjectId.value = projectId;
      if (!kanbanProjectIds.value.includes(projectId)) {
        kanbanProjectIds.value = [...kanbanProjectIds.value, projectId];
      }
    }
    activeEpicId.value = null;
    viewMode.value = 'kanban';
  }

  /** Show all projects on the kanban board */
  function showAllProjectsOnKanban(allProjectIds: string[]) {
    kanbanProjectIds.value = [...allProjectIds];
    activeProjectId.value = allProjectIds[0] ?? null;
    viewMode.value = 'kanban';
  }

  function toggleKanbanProject(projectId: string) {
    const idx = kanbanProjectIds.value.indexOf(projectId);
    if (idx >= 0) {
      // Don't allow removing the last project
      if (kanbanProjectIds.value.length > 1) {
        kanbanProjectIds.value = kanbanProjectIds.value.filter(id => id !== projectId);
        // If we removed the active project, switch to another
        if (activeProjectId.value === projectId) {
          activeProjectId.value = kanbanProjectIds.value[0] ?? null;
        }
      }
    } else {
      kanbanProjectIds.value = [...kanbanProjectIds.value, projectId];
    }
  }

  function toggleFleetProject(projectId: string) {
    const idx = fleetProjectIds.value.indexOf(projectId);
    if (idx >= 0) {
      fleetProjectIds.value = fleetProjectIds.value.filter(id => id !== projectId);
    } else {
      fleetProjectIds.value = [...fleetProjectIds.value, projectId];
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

  return {
    viewMode, activeProjectId, activeEpicId, terminalVisible, activeLeftTab,
    workspacePath, currentFile, currentBranch, currentModel, isProcessing,
    inlinePreviewFile, effectsPanelVisible, editorChatVisible, rightPanelMode, diffView,
    missionControlFilter, autoCommitEnabled, kanbanProjectIds, fleetProjectIds, notifications, repoSwitchOnly,
    managerSizes, editorSizes, kanbanFilterText, pipelineActivity, pipelineTodoProgress,
    epicActivities, activityLogVisible,
    switchToMode, toggleViewMode, toggleTerminal, dismissInlinePreview,
    toggleEffectsPanel, toggleEditorChat, toggleRightPanelMode, setRightPanelMode,
    showDiffView, closeDiffView,
    enterMissionControl, exitMissionControl, setMissionControlFilter, toggleAutoCommit,
    addNotification, dismissNotification, clearNotifications,
    navigateHome, navigateToProject, navigateToEpic, navigateToKanban,
    showAllProjectsOnKanban, toggleKanbanProject, toggleFleetProject, toggleActivityLog, setEpicActivity,
  };
});
