import { defineStore } from 'pinia';
import { ref } from 'vue';

export type ViewMode = 'manager' | 'editor' | 'mission-control';

export const useUiStore = defineStore('ui', () => {
  const viewMode = ref<ViewMode>('manager');
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

  return {
    viewMode, terminalVisible, activeLeftTab,
    workspacePath, currentFile, currentBranch, currentModel, isProcessing,
    inlinePreviewFile, effectsPanelVisible, editorChatVisible, rightPanelMode, diffView,
    missionControlFilter, autoCommitEnabled,
    managerSizes, editorSizes,
    switchToMode, toggleViewMode, toggleTerminal, dismissInlinePreview,
    toggleEffectsPanel, toggleEditorChat, toggleRightPanelMode, setRightPanelMode,
    showDiffView, closeDiffView,
    enterMissionControl, exitMissionControl, setMissionControlFilter, toggleAutoCommit,
  };
});
