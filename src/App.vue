<template>
  <AppShell>
    <!-- Top-level view routing based on viewMode -->
    <HomeView v-if="ui.viewMode === 'home'" />
    <AnalyticsView v-else-if="ui.viewMode === 'analytics'" />
    <KanbanView v-else-if="ui.viewMode === 'kanban'" ref="kanbanViewRef" />

    <!-- Agents view: new 3-panel layout -->
    <AgentsView
      v-else-if="ui.viewMode === 'agents'"
      @file-clicked="onFileClicked"
      @enter-mission-control="onEnterMissionControl"
    />

    <!-- Code view: standalone 3-panel layout -->
    <CodeView
      v-else-if="ui.viewMode === 'code' && ui.workspacePath"
    />

    <GitGraphView v-else-if="ui.viewMode === 'git-graph'" />

    <!-- Workspace-dependent views: show selector until a workspace is chosen -->
    <WorkspaceSelector v-else-if="!ui.workspacePath" />

    <template v-else>
      <MainSplitter
        @agent-selected="onAgentSelected"
        @new-chat="onNewChat"
        @delete-agent="onDeleteAgent"
        @rename-agent="onRenameAgent"
        @favorite-toggled="onFavoriteToggled"
        @delete-all="onDeleteAll"
        @delete-older="onDeleteOlder"
        @keep-today="onKeepToday"
        @file-clicked="onFileClicked"
        @file-deleted="onFileDeleted"
        @turn-clicked="onTurnClicked"
        @toggle-view="ui.toggleViewMode()"
        @exit-mission-control="onExitMissionControl"
        @mission-control-filter="onMissionControlFilter"
      >
        <template #code-viewer>
          <CodeViewer ref="codeViewerRef" />
        </template>

        <template #chat>
          <ChatPanel
            ref="chatPanelRef"
            class="h-full"
            @file-edited="onFileEdited"
            @file-clicked="onFileClicked"
          />
        </template>

        <template #effects>
          <EffectsPanel
            ref="effectsPanelRef"
            @file-clicked="onFileClicked"
            @diff-requested="onEffectsDiffRequested"
            @turn-clicked="onTurnClicked"
          />
        </template>

        <template #terminal>
          <TerminalPanel
            v-if="ui.terminalVisible"
            :workingDirectory="ui.workspacePath || '.'"
            @close="ui.toggleTerminal()"
          />
        </template>
      </MainSplitter>

    </template>
  </AppShell>

  <!-- Global dialogs (available on all views) -->
  <SettingsDialog :visible="showSettings" @close="showSettings = false" @saved="onSettingsSaved" />
  <NotificationToast />
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue';
import AppShell from './components/layout/AppShell.vue';
import WorkspaceSelector from './components/WorkspaceSelector.vue';
import HomeView from './components/home/HomeView.vue';
import KanbanView from './components/kanban/KanbanView.vue';
import MainSplitter from './components/layout/MainSplitter.vue';
import ChatPanel from './components/chat/ChatPanel.vue';
import EffectsPanel from './components/effects/EffectsPanel.vue';
import CodeViewer from './components/editor/CodeViewer.vue';
import type { GitUnifiedDiff } from './engine/GitManager';
import TerminalPanel from './components/terminal/TerminalPanel.vue';
import SettingsDialog from './components/settings/SettingsDialog.vue';
import NotificationToast from './components/home/NotificationToast.vue';
import AgentsView from './components/agents/AgentsView.vue';
import CodeView from './components/code/CodeView.vue';
import AnalyticsView from './components/analytics/AnalyticsView.vue';
import GitGraphView from './components/gitgraph/GitGraphView.vue';
import { useUiStore } from './stores/ui';
import { useThemeStore } from './stores/theme';
import { useSessionsStore, getDatabase, initSessionEngines } from './stores/sessions';
import { useFleetStore } from './stores/fleet';
import { useProjectsStore } from './stores/projects';
import { useEpicStore } from './stores/epics';
import { useGraphStore } from './stores/graph';
import { useGitStore } from './stores/git';
import { useKeyboard } from './composables/useKeyboard';
import { useOrchestrator } from './composables/useOrchestrator';
import { useGraphBuilder } from './composables/useGraphBuilder';
import { useMissionControl } from './composables/useMissionControl';
import { setProcessManager } from './composables/useEngine';
import { DelegationStatus } from './engine/types';
import type { EpicColumn } from './engine/KosTypes';
import { useActivityLogStore } from './stores/activityLog';
import { DiffEngine } from './engine/DiffEngine';
import { engineBus } from './engine/EventBus';
import { AngyEngine } from './engine/AngyEngine';
import { startSyncListener, stopSyncListener, onSync } from './engine/WindowSync';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useVersionCheck } from './composables/useVersionCheck';

// ── Stores ──────────────────────────────────────────────────────────────

const ui = useUiStore();
const sessionsStore = useSessionsStore();
const fleetStore = useFleetStore();
const gitStore = useGitStore();
const themeStore = useThemeStore();
const projectStore = useProjectsStore();
const epicStore = useEpicStore();
const activityLogStore = useActivityLogStore();

// ── Graph ────────────────────────────────────────────────────────────────
const { buildFromHistory, startLiveGraph } = useGraphBuilder();
const graphStore = useGraphStore();
let graphCleanup: (() => void) | null = null;
let sessionSyncInterval: number | null = null;
let epicSyncInterval: number | null = null;

// ── Mission Control ──────────────────────────────────────────────────────
const missionControl = useMissionControl();

async function ensureLiveGraph(sessionId: string) {
  if (graphCleanup) graphCleanup();
  graphStore.clear();
  // Load existing history FIRST, then subscribe to live events
  await buildFromHistory(sessionId);
  graphStore.isLive = true;  // Override replay mode → live
  graphCleanup = startLiveGraph(sessionId);
}

async function showGraphForSession(sessionId: string) {
  if (graphCleanup) {
    graphCleanup();
    graphCleanup = null;
  }
  graphStore.clear();
  graphStore.isLive = false;
  await buildFromHistory(sessionId);
  ui.setRightPanelMode('graph');
}

// ── Dialog visibility ──────────────────────────────────────────────────
const showSettings = ref(false);
// ── Orchestrator (used by epic pipelines) ────────────────────────────
const { initPool, setEngine } = useOrchestrator();

// ── Version check ────────────────────────────────────────────────────
const { start: startVersionCheck, stop: stopVersionCheck } = useVersionCheck();

// ── Keyboard shortcuts ──────────────────────────────────────────────────

useKeyboard();

// ── Refs ────────────────────────────────────────────────────────────────

const chatPanelRef = ref<InstanceType<typeof ChatPanel> | null>(null);
const codeViewerRef = ref<InstanceType<typeof CodeViewer> | null>(null);
const effectsPanelRef = ref<InstanceType<typeof EffectsPanel> | null>(null);
const kanbanViewRef = ref<InstanceType<typeof KanbanView> | null>(null);

// ── Event handlers ──────────────────────────────────────────────────────

const EDIT_TOOLS = new Set(['Edit', 'Write', 'StrReplace', 'MultiEdit', 'NotebookEdit']);
const diffEngine = new DiffEngine();

async function onAgentSelected(sessionId: string) {
  ui.inlinePreviewFile = null; // dismiss any inline preview
  chatPanelRef.value?.selectSession(sessionId);
  fleetStore.selectAgent(sessionId);
  effectsPanelRef.value?.setCurrentSession(sessionId);
  diffEngine.setCurrentSessionId(sessionId);

  // Do NOT rebuild the graph when in Mission Control mode
  if (ui.viewMode !== 'mission-control') {
    const sessionInfo = sessionsStore.sessions.get(sessionId);
    if (sessionInfo?.mode === 'orchestrator' && sessionInfo.delegationStatus === DelegationStatus.Completed) {
      showGraphForSession(sessionId);
    } else if (ui.rightPanelMode === 'graph') {
      await ensureLiveGraph(sessionId);
    }
  }

  const db = getDatabase();

  // Load messages from DB if this session has no in-memory messages yet
  const panel = chatPanelRef.value;
  let dbMessages: Awaited<ReturnType<typeof db.loadMessages>> = [];
  if (panel) {
    const state = panel.sessionStates.get(sessionId);
    if (!state || state.messages.length === 0) {
      // Set loading flag BEFORE async load
      panel.setLoadingHistory(sessionId, true);
      try {
        dbMessages = await db.loadMessages(sessionId);
        if (dbMessages.length > 0) {
          for (const msg of dbMessages) {
            panel.appendDbMessage(sessionId, msg);
          }
          // Force Vue reactivity — Map mutations aren't tracked by ref()
          panel.sessionStates = new Map(panel.sessionStates);
        }
      } finally {
        // Clear loading flag AFTER load complete
        panel.setLoadingHistory(sessionId, false);
        // Scroll to bottom after loading history
        nextTick(() => panel.scrollToBottom());
      }
    }

    // Restore Claude session ID from persisted SessionInfo so --resume works
    // after ChatPanel was unmounted/remounted by v-if navigation
    const sessionInfo = sessionsStore.sessions.get(sessionId);
    if (sessionInfo?.claudeSessionId) {
      const state = panel.sessionStates.get(sessionId);
      if (state && !state.realClaudeSessionId) {
        state.realClaudeSessionId = sessionInfo.claudeSessionId;
      }
    }
  }

  // Reconstruct EffectsPanel from tool_input in the messages table
  if (effectsPanelRef.value && !effectsPanelRef.value.hasChangesForSession(sessionId)) {
    if (dbMessages.length === 0) {
      dbMessages = await db.loadMessages(sessionId);
    }
    const changes = [];
    for (const msg of dbMessages) {
      if (msg.role === 'tool' && msg.toolName && EDIT_TOOLS.has(msg.toolName)) {
        let input: Record<string, any> = {};
        try { input = JSON.parse(msg.toolInput || '{}'); } catch { /* skip */ }
        const filePath = input.file_path || input.path || '';
        if (filePath) {
          changes.push({
            filePath,
            changeType: (msg.toolName === 'Write' ? 'created' : 'modified') as 'modified' | 'created',
            linesAdded: 0,
            linesRemoved: 0,
            sessionId,
            turnId: msg.turnId,
          });
        }
      }
    }
    if (changes.length > 0) {
      effectsPanelRef.value.populateFromHistory(sessionId, changes);
    }
  }
}

async function onNewChat() {
  const sessionId = await chatPanelRef.value?.newChat() ?? '';
  if (sessionId) {
    fleetStore.selectAgent(sessionId);
    effectsPanelRef.value?.setCurrentSession(sessionId);
    diffEngine.setCurrentSessionId(sessionId);
    if (ui.rightPanelMode === 'graph') {
      ensureLiveGraph(sessionId);
    }
  }
}

function onDeleteAgent(sessionId: string) {
  sessionsStore.removeSession(sessionId);
  fleetStore.rebuildFromSessions();
}

function onRenameAgent(sessionId: string, newTitle: string) {
  sessionsStore.updateSessionTitle(sessionId, newTitle);
  fleetStore.rebuildFromSessions();
}

function onFavoriteToggled(sessionId: string) {
  sessionsStore.toggleFavorite(sessionId);
  fleetStore.rebuildFromSessions();
}

function onDeleteAll() {
  const all = Array.from(sessionsStore.sessions.keys());
  for (const sid of all) {
    sessionsStore.removeSession(sid);
  }
  fleetStore.rebuildFromSessions();
}

function onDeleteOlder() {
  const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
  const toDelete = Array.from(sessionsStore.sessions.entries())
    .filter(([, info]) => info.updatedAt < oneDayAgo)
    .map(([sid]) => sid);
  for (const sid of toDelete) {
    sessionsStore.removeSession(sid);
  }
  fleetStore.rebuildFromSessions();
}

function onKeepToday() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todaySecs = Math.floor(startOfToday.getTime() / 1000);
  const toDelete = Array.from(sessionsStore.sessions.entries())
    .filter(([, info]) => info.updatedAt < todaySecs)
    .map(([sid]) => sid);
  for (const sid of toDelete) {
    sessionsStore.removeSession(sid);
  }
  fleetStore.rebuildFromSessions();
}

async function onFileClicked(filePath: string) {
  // AgentsView handles file clicks internally with its own CodeViewer;
  // this handler is only reached from MainSplitter (mission-control).
  ui.currentFile = filePath;
  if (ui.viewMode === 'agents') {
    ui.inlinePreviewFile = filePath;
  }
  await nextTick();
  codeViewerRef.value?.loadFile(filePath);
}

function onFileDeleted(filePath: string) {
  // Close exact match
  codeViewerRef.value?.closeFile(filePath);
  // Close all open files under a deleted directory
  const openFiles = codeViewerRef.value?.openFiles() ?? [];
  for (const f of openFiles) {
    if (f.startsWith(filePath + '/')) {
      codeViewerRef.value?.closeFile(f);
    }
  }
}

function onFileEdited(sessionId: string, filePath: string, toolName: string, toolInput?: Record<string, any>) {
  // Compute turnId from the session's current state
  const state = chatPanelRef.value?.sessionStates?.get(sessionId);
  const turnId = state?.turnCounter ?? 0;

  // Determine change type
  let changeType: 'modified' | 'created' | 'deleted';
  if (toolName === 'Delete') {
    changeType = 'deleted';
  } else if (toolName === 'Write') {
    changeType = diffEngine.hasFile(filePath) ? 'modified' : 'created';
  } else {
    changeType = 'modified';
  }

  // Compute real line counts using DiffEngine
  let linesAdded = 0;
  let linesRemoved = 0;

  if (toolInput) {
    if (toolName === 'Edit' || toolName === 'StrReplace') {
      const oldString = toolInput.old_string ?? '';
      const newString = toolInput.new_string ?? '';
      if (oldString || newString) {
        diffEngine.recordEditToolChange(filePath, oldString, newString, sessionId);
        linesAdded = diffEngine.linesAddedForFile(filePath);
        linesRemoved = diffEngine.linesRemovedForFile(filePath);
      }
    } else if (toolName === 'MultiEdit') {
      // MultiEdit has an array of edits
      const edits = toolInput.edits ?? [];
      for (const edit of edits) {
        diffEngine.recordEditToolChange(filePath, edit.old_string ?? '', edit.new_string ?? '', sessionId);
      }
      linesAdded = diffEngine.linesAddedForFile(filePath);
      linesRemoved = diffEngine.linesRemovedForFile(filePath);
    } else if (toolName === 'Write') {
      const content = toolInput.content ?? toolInput.contents ?? '';
      if (content) {
        diffEngine.recordWriteToolChange(filePath, content, sessionId);
        linesAdded = diffEngine.linesAddedForFile(filePath);
        linesRemoved = diffEngine.linesRemovedForFile(filePath);
      }
    }
  }

  effectsPanelRef.value?.onFileChanged(filePath, {
    filePath,
    changeType,
    linesAdded,
    linesRemoved,
    sessionId,
    turnId,
  });

  // Emit to engineBus so graph builder picks up file changes
  engineBus.emit('diff:fileChanged', {
    sessionId,
    filePath,
    diff: { linesAdded, linesRemoved, hunks: [] },
  });
}

function onTurnClicked(turnId: number) {
  console.log('Turn clicked:', turnId);
}

// ── Mission Control handlers ─────────────────────────────────────────────

async function onEnterMissionControl() {
  await missionControl.enter();
}

function onExitMissionControl() {
  missionControl.exit();
}

async function onMissionControlFilter(sessionId: string | null) {
  await missionControl.filterBySession(sessionId);
}

// ── Graph auto-start: start live graph when switching to Graph tab ────────

watch(() => ui.rightPanelMode, async (mode) => {
  if (mode === 'graph' && !graphCleanup) {
    const currentSessionId = fleetStore.selectedAgentId
      || (sessionsStore.sessionList[0]?.sessionId);
    if (currentSessionId) {
      await ensureLiveGraph(currentSessionId);
    }
  }
});

// ── Epic navigation: set workspace when navigating to an epic ────────────

watch(() => ui.activeEpicId, async (epicId) => {
  if (!epicId || !ui.activeProjectId) return;
  const epic = epicStore.epicById(epicId);
  if (!epic) return;

  // Resolve workspace path from the epic's target repos
  const projectRepos = projectStore.reposByProjectId(ui.activeProjectId);
  let repoPath = '';
  const targetPaths: string[] = [];
  if (epic.targetRepoIds.length > 0) {
    for (const repoId of epic.targetRepoIds) {
      const repo = projectRepos.find((r) => r.id === repoId);
      if (repo) targetPaths.push(repo.path);
    }
  }
  // Fallback: use all project repos
  if (targetPaths.length === 0) {
    for (const repo of projectRepos) {
      targetPaths.push(repo.path);
    }
  }
  // Compute common ancestor for multi-repo
  if (targetPaths.length === 1) {
    repoPath = targetPaths[0];
  } else if (targetPaths.length > 1) {
    const segments = targetPaths.map(p => p.split('/'));
    const commonParts: string[] = [];
    for (let i = 0; i < segments[0].length; i++) {
      const seg = segments[0][i];
      if (segments.every(s => s[i] === seg)) commonParts.push(seg);
      else break;
    }
    repoPath = commonParts.join('/') || '/';
  }

  if (repoPath && repoPath !== ui.workspacePath) {
    // Different workspace — the workspacePath watch will handle reload
    ui.workspacePath = repoPath;
  } else if (repoPath) {
    // Same workspace — force reload sessions from DB so headless epic sessions appear
    const db = getDatabase();
    await db.open();
    sessionsStore.sessions.clear();
    sessionsStore.messages.clear();
    await sessionsStore.loadFromDatabase(undefined);
    fleetStore.rebuildFromSessions();

    await nextTick();
    // Auto-select the epic's root session if available
    if (epic.rootSessionId && sessionsStore.sessions.has(epic.rootSessionId)) {
      await onAgentSelected(epic.rootSessionId);
    } else if (sessionsStore.sessions.size > 0) {
      const mostRecent = sessionsStore.sessionList[0];
      if (mostRecent) await onAgentSelected(mostRecent.sessionId);
    }
  }
});

// ── Workspace path changes: reload sessions + git ───────────────────────

watch(() => ui.workspacePath, async (newPath, oldPath) => {
  if (newPath && newPath !== oldPath) {
    // Repo-only switch (multi-repo tab): skip heavy session reload,
    // just update git status and window title.
    if (ui.repoSwitchOnly) {
      ui.repoSwitchOnly = false;
      gitStore.init(newPath);
      const projectName = ui.activeProjectId
        ? projectStore.projectById(ui.activeProjectId)?.name
        : null;
      const folderName = newPath.replace(/\/$/, '').split('/').pop() || newPath;
      getCurrentWindow().setTitle(projectName || folderName);
      return;
    }

    // Ensure database is open before querying
    const db = getDatabase();
    await db.open();

    // Load all sessions globally so the fleet shows agents from all projects
    sessionsStore.sessions.clear();
    sessionsStore.messages.clear();
    await sessionsStore.loadFromDatabase(undefined);
    fleetStore.rebuildFromSessions();

    // Wait for DOM update so ChatPanel is mounted before loading messages
    await nextTick();

    // Auto-select the epic's root session if navigating to an epic, else most recent
    const activeEpic = ui.activeEpicId ? epicStore.epicById(ui.activeEpicId) : null;
    if (activeEpic?.rootSessionId && sessionsStore.sessions.has(activeEpic.rootSessionId)) {
      await onAgentSelected(activeEpic.rootSessionId);
    } else if (sessionsStore.sessions.size > 0) {
      const mostRecent = sessionsStore.sessionList[0];
      if (mostRecent) await onAgentSelected(mostRecent.sessionId);
    }

    gitStore.init(newPath);
    const projectName = ui.activeProjectId
      ? projectStore.projectById(ui.activeProjectId)?.name
      : null;
    const folderName = newPath.replace(/\/$/, '').split('/').pop() || newPath;
    getCurrentWindow().setTitle(projectName || folderName);
  }
}, { immediate: true });

// ── engineBus listener references (hoisted for cleanup in onUnmounted) ──

let onSchedulerError: (e: { epicId?: string; title: string; message: string }) => void;
let onSchedulerInfo: (e: { epicId?: string; title: string; message: string }) => void;
let onSessionCreatedBus: (e: { sessionId: string }) => void;
let onAgentStatusBus: (e: { agentId: string; status: string; activity: string }) => void;
let onEpicRequestStart: (e: { epicId: string }) => void;
let onEpicRequestStop: (e: { epicId: string; targetColumn?: EpicColumn }) => void;
let onEpicRequestSuspend: (e: { epicId: string }) => void;
let onEpicStoreSync: () => Promise<void>;
let onAgentFileEdited: (e: { sessionId: string; filePath: string; toolName: string; toolInput?: Record<string, any> }) => void;
let onEpicPhaseChanged: (e: { epicId: string; phase: string }) => void;
let onPipelineInternalCall: (e: { epicId: string; callType: string; status: string }) => void;
let onPipelineTodoProgress: (e: { epicId: string; current: number; total: number; scope: string; title: string }) => void;
let onSessionFinishedBell: (e: { sessionId: string; exitCode: number }) => void;

// ── Bell notification ─────────────────────────────────────────────────────
const bellOnTaskDone = ref(false);
let bellAudioCtx: AudioContext | null = null;

function playBell() {
  try {
    if (!bellAudioCtx || bellAudioCtx.state === 'closed') {
      bellAudioCtx = new AudioContext();
    }
    const ctx = bellAudioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.4);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.6);
  } catch { /* AudioContext unavailable */ }
}

// ── Global keyboard event: Cmd+N new chat ───────────────────────────────

function onGlobalNewChat() {
  onNewChat();
}

function onSettingsSaved(settings: Record<string, unknown>) {
  bellOnTaskDone.value = !!settings.bellOnTaskDone;
}

function onGlobalOpenSettings() {
  showSettings.value = true;
}

function onGitFileDiffReady({ filePath, staged, diff }: { filePath: string; staged: boolean; diff: GitUnifiedDiff }) {
  if (diff.isBinary) return;
  const rightLabel = staged ? 'Staged' : 'Working Tree';
  ui.showDiffView(filePath, diff.oldContent, diff.newContent, 'HEAD', rightLabel);
}

function onEffectsDiffRequested(filePath: string) {
  // Convert absolute path to relative for git
  const workspace = ui.workspacePath;
  const relativePath = workspace && filePath.startsWith(workspace + '/')
    ? filePath.slice(workspace.length + 1)
    : filePath;
  gitStore.manager.requestFileDiff(relativePath, false);
}

// ── Global safety net: prevent webview navigation on link clicks & file drops ──

/** Prevent the browser from navigating when a file is dropped anywhere on the page. */
function preventDragNavigation(e: DragEvent) {
  e.preventDefault();
}

/**
 * Safety-net click handler that catches <a> clicks not already handled by a
 * component (e.g. links rendered via v-html in CodeViewer, OrchestratorChat,
 * TreeBranch, CodeChatPanel, etc.).  Components that call e.preventDefault()
 * themselves (like ChatMessage.handleContentClick) are left alone.
 */
function interceptGlobalClicks(e: MouseEvent) {
  if (e.defaultPrevented) return;

  const anchor = (e.target as HTMLElement)?.closest?.('a');
  if (!anchor) return;

  const href = anchor.getAttribute('href');
  if (!href) return;

  // Block the navigation *before* doing anything else
  e.preventDefault();

  try {
    const url = new URL(href, window.location.href);

    if (url.protocol === 'angy:' && url.hostname === 'open') {
      const filePath = url.searchParams.get('file');
      if (filePath) onFileClicked(filePath);
    } else if (url.protocol === 'http:' || url.protocol === 'https:') {
      window.open(href, '_blank');
    }
    // Everything else (file:, data:, blob:, …) is silently swallowed.
  } catch {
    // Malformed URL – nothing to do.
  }
}

onMounted(async () => {
  // Global webview-navigation guards
  document.addEventListener('dragover', preventDragNavigation);
  document.addEventListener('drop', preventDragNavigation);
  document.addEventListener('click', interceptGlobalClicks);

  window.addEventListener('angy:new-chat', onGlobalNewChat);
  window.addEventListener('angy:open-settings', onGlobalOpenSettings);
  gitStore.manager.on('fileDiffReady', onGitFileDiffReady);
  themeStore.loadSavedTheme();
  startVersionCheck();

  // Handle URL params for multi-window support (e.g., ?project=xyz)
  const urlParams = new URLSearchParams(window.location.search);
  const projectIdFromUrl = urlParams.get('project');
  if (projectIdFromUrl) {
    // Will be applied after stores initialize below
    ui.activeProjectId = projectIdFromUrl;
  }

  // Wire scheduler events to UI notifications
  onSchedulerError = ({ epicId, title, message }) => {
    ui.addNotification('error', title, message, epicId);
  };
  onSchedulerInfo = ({ epicId, title, message }) => {
    ui.addNotification('info', title, message, epicId);
  };
  engineBus.on('scheduler:error', onSchedulerError);
  engineBus.on('scheduler:info', onSchedulerInfo);

  // ── Initialize AngyEngine (headless core) ────────────────────────────
  const isMainWindow = getCurrentWindow().label === 'main';
  const engine = AngyEngine.getInstance();
  console.log(`[App] Initializing engine (${isMainWindow ? 'primary' : 'secondary'} window)...`);
  try {
    await engine.initialize(undefined, { primaryWindow: isMainWindow });
    console.log('[App] Engine initialized, DB open:', !!engine.db);
  } catch (err) {
    console.error('[App] Engine initialization failed:', err);
    throw err;
  }

  try {
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const { join } = await import('@tauri-apps/api/path');
    const { getAngyConfigDir } = await import('@/engine/platform');
    const content = await readTextFile(await join(await getAngyConfigDir(), 'settings.json'));
    const parsed = JSON.parse(content);
    bellOnTaskDone.value = !!parsed.bellOnTaskDone;
  } catch { /* file may not exist yet */ }

  // Load API keys from DB into UI store
  const savedGeminiKey = await engine.db.getAppSetting('gemini_api_key');
  if (savedGeminiKey) ui.geminiApiKey = savedGeminiKey;
  
  const savedAnthropicKey = await engine.db.getAppSetting('anthropic_api_key');
  if (savedAnthropicKey) ui.anthropicApiKey = savedAnthropicKey;

  // Unify the Database and SessionManager singletons: the engine owns the
  // canonical instances; Pinia stores must share them to avoid split-brain.
  initSessionEngines(engine.sessions.manager, engine.db);

  // Bridge engine-created sessions into the Pinia store so the UI can track them.
  // When the headless orchestrator creates child sessions (architect, implementer, etc.),
  // the SessionService emits 'session:created' on the engine bus. We listen here and
  // sync those sessions into the reactive Pinia store that drives the sidebar/fleet.
  onSessionCreatedBus = ({ sessionId }) => {
    if (sessionsStore.sessions.has(sessionId)) return;
    const info = engine.sessions.getSession(sessionId);
    if (info) {
      sessionsStore.sessions.set(sessionId, info);
      if (!sessionsStore.messages.has(sessionId)) {
        sessionsStore.messages.set(sessionId, []);
      }
      fleetStore.rebuildFromSessions();
    }
  };
  engineBus.on('session:created', onSessionCreatedBus);

  // Bridge agent status changes into the fleet store.
  // ProcessManager emits this for every tool use and session finish, so the fleet
  // cards show real-time activity for ALL agents (including headless epic agents).
  onAgentStatusBus = ({ agentId, status, activity }) => {
    fleetStore.updateAgent({ sessionId: agentId, status: status as any, activity });
  };
  engineBus.on('agent:statusChanged', onAgentStatusBus);

  onSessionFinishedBell = ({ exitCode }) => {
    if (bellOnTaskDone.value && exitCode === 0) playBell();
  };
  engineBus.on('session:finished', onSessionFinishedBell);

  // Primary window: wire orchestration control, process management, and lifecycle events.
  // Secondary windows are view-only — they read from the DB via sync intervals.
  if (isMainWindow) {
    // Share the engine's ProcessManager with the useEngine composable
    setProcessManager(engine.processes);

    // Wire engine into the useOrchestrator composable for session → orchestrator routing
    setEngine(engine);

    // Handle manual epic start requests (from EpicCard/EpicDetailPanel arrow buttons)
    onEpicRequestStart = async ({ epicId }) => {
      console.log(`[App] epic:requestStart received for: ${epicId}`);
      const epic = epicStore.epicById(epicId);
      if (!epic) {
        console.error(`[App] Epic not found: ${epicId}`);
        return;
      }
      if (epic.column === 'in-progress') {
        console.warn(`[App] Epic already in-progress: ${epicId}`);
        return;
      }
      try {
        await engine.scheduler.executeStart(epic);
        await epicStore.loadAll();
      } catch (err) {
        console.error(`[App] Failed to start epic ${epicId}:`, err);
        ui.addNotification('error', 'Failed to start epic', err instanceof Error ? err.message : String(err), epicId);
      }
    };
    engineBus.on('epic:requestStart', onEpicRequestStart);

    onEpicRequestStop = async ({ epicId, targetColumn }) => {
      console.log(`[App] epic:requestStop received for: ${epicId}`);
      try {
        await engine.cancelEpicOrchestration(epicId);
        await epicStore.moveEpic(epicId, targetColumn || 'backlog');
        console.log(`[App] Epic stopped and moved to ${targetColumn || 'backlog'}: ${epicId}`);
      } catch (err) {
        console.error(`[App] Failed to stop epic ${epicId}:`, err);
      }
    };
    engineBus.on('epic:requestStop', onEpicRequestStop);

    onEpicRequestSuspend = async ({ epicId }) => {
      console.log(`[App] epic:requestSuspend received for: ${epicId}`);
      try {
        await engine.suspendEpicOrchestration(epicId);
        await epicStore.loadAll();
        ui.addNotification('info', 'Epic suspended', 'The epic has been suspended and can be resumed later.', epicId);
      } catch (err) {
        console.error(`[App] Failed to suspend epic ${epicId}:`, err);
        ui.addNotification('error', 'Failed to suspend epic', err instanceof Error ? err.message : String(err), epicId);
      }
    };
    engineBus.on('epic:requestSuspend', onEpicRequestSuspend);

    // Sync Pinia store when the engine finishes writing epic lifecycle changes.
    // The engine emits epic:storeSyncNeeded AFTER its DB writes complete —
    // no timing hacks needed.
    onEpicStoreSync = async () => {
      await epicStore.loadAll();
    };
    engineBus.on('epic:storeSyncNeeded', onEpicStoreSync);

    // Wire headless file-edit events into the effects/diff chain
    onAgentFileEdited = ({ sessionId, filePath, toolName, toolInput }) => {
      onFileEdited(sessionId, filePath, toolName, toolInput);
    };
    engineBus.on('agent:fileEdited', onAgentFileEdited);

    // Pipeline phase and internal call visibility
    const CALL_LABELS: Record<string, string> = {
      extractVerdict: 'Extracting verdict',
      extractTodos: 'Extracting todos from plan',
      extractTestResult: 'Extracting test results',
      verifyTodo: 'Verifying todo',
      generateFixTodos: 'Generating fix-todos',
    };
    onEpicPhaseChanged = ({ epicId, phase }) => {
      const isTerminal = phase === 'completed' || phase === 'failed' || phase === 'cancelled';
      // Legacy single-activity (backward compat)
      ui.pipelineActivity = isTerminal ? null : phase;
      if (isTerminal) ui.pipelineTodoProgress = null;
      // Multi-epic activity tracking
      ui.setEpicActivity(epicId, isTerminal ? null : phase);
      // Activity log
      const epic = epicStore.epicById(epicId);
      if (epic) {
        const level = phase === 'completed' ? 'success' : phase === 'failed' ? 'error' : 'info';
        activityLogStore.append(epic.projectId, level, `Epic "${epic.title}" ${phase}`, epicId);
      }
    };
    onPipelineInternalCall = ({ epicId, callType, status }) => {
      ui.pipelineActivity = status === 'started'
        ? (CALL_LABELS[callType] || callType)
        : null;
      const label = status === 'started' ? (CALL_LABELS[callType] || callType) : null;
      ui.setEpicActivity(epicId, label);
    };
    onPipelineTodoProgress = ({ epicId, current, total, scope, title }) => {
      ui.pipelineTodoProgress = { current, total };
      ui.setEpicActivity(epicId, `${scope}: ${title}`, { current, total });
      // Log agent completion milestones
      const epic = epicStore.epicById(epicId);
      if (epic) {
        activityLogStore.append(epic.projectId, 'info', `${scope}-${current} of epic "${epic.title}" completed (${current}/${total})`, epicId);
      }
    };
    engineBus.on('epic:phaseChanged', onEpicPhaseChanged);
    engineBus.on('pipeline:internalCall', onPipelineInternalCall);
    engineBus.on('pipeline:todoProgress', onPipelineTodoProgress);
  }

  console.log('[App] Engine initialized');

  // Initialize Pinia stores from engine's database (DB is already open via engine)
  const db = getDatabase();
  console.log('[App] Got database instance, initializing stores...');
  if (db) {
    await projectStore.initialize();
    console.log('[App] Projects loaded:', projectStore.projects.length);
    await epicStore.initialize();
    console.log('[App] Epics loaded:', epicStore.epics.length);
    await activityLogStore.load();

    // If this window was opened with a project param, navigate to it now
    if (projectIdFromUrl) {
      console.log('[App] URL project param:', projectIdFromUrl);
      const project = projectStore.projectById(projectIdFromUrl);
      if (project) {
        console.log('[App] Navigating to project:', project.name);
        ui.navigateToProject(projectIdFromUrl);
      } else {
        console.warn('[App] Project not found:', projectIdFromUrl);
      }
    }

    // Primary window: start scheduler and orchestrator pool
    if (isMainWindow) {
      const branchManager = engine.branchManager;
      initPool(branchManager);

      const scheduler = engine.scheduler;
      await scheduler.initialize();
    }

    // Load ALL sessions globally (no workspace filter) so the fleet shows agents from all projects
    await sessionsStore.loadFromDatabase(undefined);
    fleetStore.rebuildFromSessions();
    console.log(`[App] Loaded ${sessionsStore.sessions.size} sessions from database`);

    // Periodically sync sessions from DB (fallback; cross-window events handle instant sync)
    sessionSyncInterval = window.setInterval(async () => {
      const added = await sessionsStore.syncNewSessions(undefined);
      if (added) {
        fleetStore.rebuildFromSessions();
      }
    }, 5000);

    // Periodically sync epics from DB (fallback; cross-window events handle instant sync)
    epicSyncInterval = window.setInterval(() => epicStore.loadAll(), 3000);

    // ── Cross-window sync: instant propagation of shared state ──────────
    await startSyncListener();

    onSync('projects', async () => {
      await projectStore.loadAll();
    });
    onSync('epics', async () => {
      await epicStore.loadAll();
    });
    onSync('sessions', async () => {
      const added = await sessionsStore.syncNewSessions(undefined);
      if (added) fleetStore.rebuildFromSessions();
    });
    onSync('scheduler-config', async () => {
      // Main window: reload & apply (start/stop scheduler).
      // Secondary windows: reload for UI display.
      await engine.scheduler.reloadConfig();
    });

    // Auto-select the most recent session
    if (sessionsStore.sessions.size > 0) {
      const mostRecent = sessionsStore.sessionList[0];
      if (mostRecent) {
        await onAgentSelected(mostRecent.sessionId);
      }
    }
  } else {
    console.warn('[App] Failed to open database');
  }
});

onUnmounted(() => {
  document.removeEventListener('dragover', preventDragNavigation);
  document.removeEventListener('drop', preventDragNavigation);
  document.removeEventListener('click', interceptGlobalClicks);

  window.removeEventListener('angy:new-chat', onGlobalNewChat);
  window.removeEventListener('angy:open-settings', onGlobalOpenSettings);
  gitStore.manager.off('fileDiffReady', onGitFileDiffReady);
  stopVersionCheck();

  // Clean up engineBus listeners to prevent leaks
  engineBus.off('scheduler:error', onSchedulerError);
  engineBus.off('scheduler:info', onSchedulerInfo);
  engineBus.off('session:created', onSessionCreatedBus);
  engineBus.off('agent:statusChanged', onAgentStatusBus);
  engineBus.off('session:finished', onSessionFinishedBell);
  engineBus.off('epic:requestStart', onEpicRequestStart);
  engineBus.off('epic:requestStop', onEpicRequestStop);
  engineBus.off('epic:requestSuspend', onEpicRequestSuspend);
  engineBus.off('epic:storeSyncNeeded', onEpicStoreSync);
  engineBus.off('agent:fileEdited', onAgentFileEdited);
  engineBus.off('epic:phaseChanged', onEpicPhaseChanged);
  engineBus.off('pipeline:internalCall', onPipelineInternalCall);
  engineBus.off('pipeline:todoProgress', onPipelineTodoProgress);

  if (graphCleanup) {
    graphCleanup();
    graphCleanup = null;
  }
  if (sessionSyncInterval !== null) {
    clearInterval(sessionSyncInterval);
    sessionSyncInterval = null;
  }
  if (epicSyncInterval !== null) {
    clearInterval(epicSyncInterval);
    epicSyncInterval = null;
  }
  stopSyncListener();
  missionControl.dispose();
});
</script>
