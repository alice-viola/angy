import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useFilterStore } from '@/stores/filter';

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
  const currentModel = ref('claude-sonnet-4-6');
  const isProcessing = ref(false);
  const inlinePreviewFile = ref<string | null>(null);
  const effectsPanelVisible = ref(true);
  const editorChatVisible = ref(true);
  const rightPanelMode = ref<'effects' | 'graph'>('effects');
  const missionControlFilter = ref<string | null>(null);
  const autoCommitEnabled = ref(false);

  const fleetProjectIds = ref<string[]>([]);
  const notifications = ref<AppNotification[]>([]);
  const repoSwitchOnly = ref(false);
  const epicActivities = ref<Map<string, { label: string; progress?: { current: number; total: number } }>>(new Map());
  const activityLogVisible = ref(false);
  const kanbanFilterText = ref('');
  const pipelineActivity = ref<string | null>(null);
  const pipelineTodoProgress = ref<{ current: number; total: number } | null>(null);

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

  function openCommandPalette() {
    window.dispatchEvent(new CustomEvent('angy:command-palette'));
  }

  function navigateHome() {
    window.dispatchEvent(new CustomEvent('angy:close-popovers'));
    viewMode.value = 'home';
    activeProjectId.value = null;
    activeEpicId.value = null;
  }

  function navigateToProject(projectId: string) {
    window.dispatchEvent(new CustomEvent('angy:close-popovers'));
    activeProjectId.value = projectId;
    useFilterStore().applySelection([projectId]);
    viewMode.value = 'kanban';
  }

  function navigateToEpic(epicId: string, projectId: string) {
    window.dispatchEvent(new CustomEvent('angy:close-popovers'));
    activeProjectId.value = projectId;
    activeEpicId.value = epicId;
    viewMode.value = 'agents';
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

  function navigateToKanban(projectId: string) {
    window.dispatchEvent(new CustomEvent('angy:close-popovers'));
    activeProjectId.value = projectId;
    const filterStore = useFilterStore();
    if (!filterStore.selectedProjectIds.includes(projectId)) {
      filterStore.applySelection([projectId]);
    }
    activeEpicId.value = null;
    viewMode.value = 'kanban';
  }

  return {
    viewMode, activeProjectId, activeEpicId, terminalVisible, activeLeftTab,
    workspacePath, currentFile, currentBranch, currentModel, isProcessing,
    inlinePreviewFile, effectsPanelVisible, editorChatVisible, rightPanelMode, diffView,
    missionControlFilter, autoCommitEnabled, fleetProjectIds, notifications, repoSwitchOnly,
    managerSizes, editorSizes, kanbanFilterText, pipelineActivity, pipelineTodoProgress,
    epicActivities, activityLogVisible,
    switchToMode, toggleViewMode, toggleTerminal, dismissInlinePreview,
    toggleEffectsPanel, toggleEditorChat, toggleRightPanelMode, setRightPanelMode,
    showDiffView, closeDiffView,
    enterMissionControl, exitMissionControl, setMissionControlFilter, toggleAutoCommit,
    addNotification, dismissNotification, clearNotifications,
    navigateHome, navigateToProject, navigateToEpic, navigateToKanban,
    openCommandPalette, toggleFleetProject, toggleActivityLog, setEpicActivity,
  };
});
