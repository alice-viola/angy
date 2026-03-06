<template>
  <!-- Workspace gate: show selector until a workspace is chosen -->
  <WorkspaceSelector v-if="!ui.workspacePath" />

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
      @turn-clicked="onTurnClicked"
      @toggle-view="ui.toggleViewMode()"
      @orchestrate="onOrchestrate"
      @exit-mission-control="onExitMissionControl"
      @mission-control-filter="onMissionControlFilter"
      @enter-mission-control="onEnterMissionControl"
    >
      <template #code-viewer>
        <CodeViewer ref="codeViewerRef" />
      </template>

      <template #chat>
        <ChatPanel
          ref="chatPanelRef"
          class="h-full"
          @file-edited="onFileEdited"
          @orchestrate-requested="onOrchestratorStart"
          @orchestrate-started="onOrchestrateStarted"
        />
      </template>

      <template #effects>
        <EffectsPanel
          ref="effectsPanelRef"
          @file-clicked="onFileClicked"
          @turn-clicked="onTurnClicked"
        />
      </template>

      <template #terminal>
        <TerminalPanel
          v-if="ui.terminalVisible"
          :workingDirectory="ui.workspacePath || '.'"
        />
      </template>
    </MainSplitter>

    <!-- Dialogs -->
    <SettingsDialog :visible="showSettings" @close="showSettings = false" @saved="onSettingsSaved" />
    <ProfileEditor :visible="showProfileEditor" @close="showProfileEditor = false" />
    <OrchestratorDialog :visible="showOrchestratorDialog" @close="showOrchestratorDialog = false" @start="onOrchestratorStart" />
  </template>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue';
import WorkspaceSelector from './components/WorkspaceSelector.vue';
import MainSplitter from './components/layout/MainSplitter.vue';
import ChatPanel from './components/chat/ChatPanel.vue';
import EffectsPanel from './components/effects/EffectsPanel.vue';
import CodeViewer from './components/editor/CodeViewer.vue';
import type { GitUnifiedDiff } from './engine/GitManager';
import TerminalPanel from './components/terminal/TerminalPanel.vue';
import SettingsDialog from './components/settings/SettingsDialog.vue';
import ProfileEditor from './components/settings/ProfileEditor.vue';
import OrchestratorDialog from './components/settings/OrchestratorDialog.vue';
import { useUiStore } from './stores/ui';
import { useThemeStore } from './stores/theme';
import { useSessionsStore, getDatabase, getSessionManager } from './stores/sessions';
import { useFleetStore } from './stores/fleet';
import { useGraphStore } from './stores/graph';
import { useGitStore } from './stores/git';
import { useKeyboard } from './composables/useKeyboard';
import { useOrchestrator } from './composables/useOrchestrator';
import { useGraphBuilder } from './composables/useGraphBuilder';
import { useMissionControl } from './composables/useMissionControl';
import { sendMessageToEngine, setMcpToolInterceptor, setSessionFinishedInterceptor } from './composables/useEngine';
import { ORCHESTRATOR_SYSTEM_PROMPT } from './engine/Orchestrator';
import { DelegationStatus } from './engine/types';
import { DiffEngine } from './engine/DiffEngine';
import { engineBus } from './engine/EventBus';
import { getCurrentWindow } from '@tauri-apps/api/window';

// ── Stores ──────────────────────────────────────────────────────────────

const ui = useUiStore();
const sessionsStore = useSessionsStore();
const fleetStore = useFleetStore();
const gitStore = useGitStore();
const themeStore = useThemeStore();

// ── Graph ────────────────────────────────────────────────────────────────
const { buildFromHistory, startLiveGraph } = useGraphBuilder();
const graphStore = useGraphStore();
let graphCleanup: (() => void) | null = null;

// ── Mission Control ──────────────────────────────────────────────────────
const missionControl = useMissionControl();

function ensureLiveGraph(sessionId: string) {
  // Start a live graph for the given session if one isn't already running
  if (graphCleanup) graphCleanup();
  graphStore.clear();
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
const showProfileEditor = ref(false);
const showOrchestratorDialog = ref(false);

// ── Orchestrator ──────────────────────────────────────────────────────
const { startOrchestration, orchestrator } = useOrchestrator();

// ── Keyboard shortcuts ──────────────────────────────────────────────────

useKeyboard();

// ── Refs ────────────────────────────────────────────────────────────────

const chatPanelRef = ref<InstanceType<typeof ChatPanel> | null>(null);
const codeViewerRef = ref<InstanceType<typeof CodeViewer> | null>(null);
const effectsPanelRef = ref<InstanceType<typeof EffectsPanel> | null>(null);

// ── Event handlers ──────────────────────────────────────────────────────

const EDIT_TOOLS = new Set(['Edit', 'Write', 'StrReplace', 'MultiEdit', 'NotebookEdit']);
const diffEngine = new DiffEngine();

async function onAgentSelected(sessionId: string) {
  ui.inlinePreviewFile = null; // dismiss any inline preview
  chatPanelRef.value?.selectSession(sessionId);
  fleetStore.selectAgent(sessionId);
  effectsPanelRef.value?.setCurrentSession(sessionId);
  diffEngine.setCurrentSessionId(sessionId);

  // Show graph replay for completed orchestrator sessions, or live graph for active sessions
  const sessionInfo = sessionsStore.sessions.get(sessionId);
  if (sessionInfo?.mode === 'orchestrator' && sessionInfo.delegationStatus === DelegationStatus.Completed) {
    showGraphForSession(sessionId);
  } else if (ui.rightPanelMode === 'graph') {
    ensureLiveGraph(sessionId);
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

function onNewChat() {
  const sessionId = chatPanelRef.value?.newChat() ?? '';
  if (sessionId) {
    fleetStore.selectAgent(sessionId);
    effectsPanelRef.value?.setCurrentSession(sessionId);
    diffEngine.setCurrentSessionId(sessionId);
    // Restart live graph for the new session if graph is active
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
  // In manager mode, show inline preview instead of switching to editor
  if (ui.viewMode === 'manager') {
    ui.inlinePreviewFile = filePath;
    ui.currentFile = filePath;
    await nextTick();
    codeViewerRef.value?.loadFile(filePath);
  } else {
    ui.currentFile = filePath;
    codeViewerRef.value?.loadFile(filePath);
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

watch(() => ui.rightPanelMode, (mode) => {
  if (mode === 'graph' && !graphCleanup) {
    // Find the current session and start a live graph
    const currentSessionId = fleetStore.selectedAgentId
      || (sessionsStore.sessionList[0]?.sessionId);
    if (currentSessionId) {
      ensureLiveGraph(currentSessionId);
    }
  }
});

// ── Workspace path changes: reload sessions + git ───────────────────────

watch(() => ui.workspacePath, async (newPath, oldPath) => {
  if (newPath && newPath !== oldPath) {
    // Ensure database is open before querying
    const db = getDatabase();
    await db.open();

    // Clear current sessions and reload for new workspace
    sessionsStore.sessions.clear();
    sessionsStore.messages.clear();
    await sessionsStore.loadFromDatabase(newPath);
    fleetStore.rebuildFromSessions();

    // Wait for DOM update so ChatPanel is mounted before loading messages
    await nextTick();

    // Auto-select most recent session
    if (sessionsStore.sessions.size > 0) {
      const mostRecent = sessionsStore.sessionList[0];
      if (mostRecent) await onAgentSelected(mostRecent.sessionId);
    }
  }
  if (newPath) {
    gitStore.init(newPath);
    const name = newPath.replace(/\/$/, '').split('/').pop() || newPath;
    getCurrentWindow().setTitle(name);
  }
}, { immediate: true });

// ── Orchestrator ─────────────────────────────────────────────────────────

function onOrchestrate() {
  showOrchestratorDialog.value = true;
}

function onOrchestratorStart(goal: string) {
  showOrchestratorDialog.value = false;
  ui.setRightPanelMode('graph');
  orchestrator.setChatPanel({
    newChat: (workspace: string) => {
      const sid = chatPanelRef.value?.newChat(workspace) ?? '';
      if (sid) {
        if (graphCleanup) graphCleanup();
        graphCleanup = startLiveGraph(sid);
      }
      return sid;
    },
    configureSession: (sid: string, mode: string, _profileIds: string[]) => {
      // Update the session's mode in the store
      const session = sessionsStore.sessions.get(sid);
      if (session) {
        session.title = session.title || `${mode} session`;
      }
    },
    sendMessageToSession: (sid: string, msg: string) => {
      const panel = chatPanelRef.value;
      if (!panel) return;
      // Build a ChatPanelHandle that routes events to the panel's methods
      const handle = {
        appendTextDelta: panel.appendTextDelta,
        appendThinkingDelta: (_s: string, _t: string) => { /* thinking delta for orchestrator sessions */ },
        addToolUse: panel.addToolUse,
        markDone: panel.markDone,
        showError: panel.showError,
        setThinking: panel.setThinking,
        setRealSessionId: panel.setRealSessionId!,
      };
      const state = panel.sessionStates?.get(sid);
      sendMessageToEngine(sid, msg, handle, {
        workingDir: ui.workspacePath || '.',
        mode: 'orchestrator',
        systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
        resumeSessionId: state?.realClaudeSessionId || undefined,
      });
    },
    delegateToChild: (
      parentSessionId: string,
      task: string,
      _context: string,
      _specialistProfileId: string,
      _contextProfileIds: string[],
      agentName?: string,
      _teamId?: string,
      teammates?: string[],
    ) => {
      const panel = chatPanelRef.value;
      if (!panel) return '';
      const childSid = sessionsStore.createChildSession(parentSessionId, ui.workspacePath || '.', 'agent', task);
      fleetStore.rebuildFromSessions();

      // Build system prompt with peer messaging instructions
      let systemPrompt = '';
      if (teammates && teammates.length > 0 && agentName) {
        systemPrompt = `Your agent name is "${agentName}". ` +
          `You are on a team with: ${teammates.join(', ')}. ` +
          `Use send_message(to, content) and check_inbox() to coordinate.`;
      }

      // Build handle that routes events to the panel and notifies orchestrator on done
      const handle = {
        appendTextDelta: panel.appendTextDelta,
        appendThinkingDelta: (_s: string, _t: string) => { /* no-op */ },
        addToolUse: panel.addToolUse,
        markDone: (s: string) => {
          panel.markDone(s);
          // Update child session delegation status
          const mgr = getSessionManager();
          mgr.setDelegationStatus(s, DelegationStatus.Completed);
          const childState = panel.sessionStates?.get(s);
          const lastMsg = childState?.messages
            ? [...childState.messages].reverse().find((m: { role: string }) => m.role === 'assistant')
            : null;
          const result = lastMsg?.content ?? '';
          mgr.setDelegationResult(s, result);
          sessionsStore.syncFromEngine(s);
          sessionsStore.persistSession(s);
          // Notify orchestrator that this child finished
          orchestrator.onDelegateFinished(s, result);
        },
        showError: panel.showError,
        setThinking: panel.setThinking,
        setRealSessionId: panel.setRealSessionId!,
        onFileEdited,
      };

      sendMessageToEngine(childSid, task, handle, {
        workingDir: ui.workspacePath || '.',
        mode: 'agent',
        systemPrompt,
      });

      return childSid;
    },
    sessionFinalOutput: (sid: string) => {
      const state = chatPanelRef.value?.sessionStates?.get(sid);
      if (!state) return '';
      const lastAssistant = [...state.messages].reverse().find((m: { role: string }) => m.role === 'assistant');
      return lastAssistant?.content ?? '';
    },
  });
  orchestrator.setWorkspace(ui.workspacePath || '.');
  startOrchestration(goal);
}

/**
 * Orchestrate from input bar: attach orchestrator to existing session.
 * The message is already sent by ChatPanel.onSend with mode 'orchestrator'.
 * We just need to wire up the orchestrator to intercept MCP tool calls
 * and manage child sessions.
 */
async function onOrchestrateStarted(sessionId: string) {
  ui.setRightPanelMode('graph');
  if (graphCleanup) graphCleanup();
  graphCleanup = startLiveGraph(sessionId);
  orchestrator.setChatPanel({
    newChat: (workspace: string) => chatPanelRef.value?.newChat(workspace) ?? '',
    configureSession: (sid: string, mode: string, _profileIds: string[]) => {
      const session = sessionsStore.sessions.get(sid);
      if (session) {
        session.title = session.title || `${mode} session`;
      }
    },
    sendMessageToSession: (sid: string, msg: string) => {
      const panel = chatPanelRef.value;
      if (!panel) return;

      // Add feedback as visible user message so the user sees orchestrator progress
      const state = panel.sessionStates?.get(sid);
      if (state) {
        state.turnCounter++;
        state.isProcessing = true;
        state.isThinking = true;
        state.currentAssistantMsgId = null;
        state.messages.push({
          id: `msg-${Date.now()}-feed`,
          role: 'user',
          content: msg,
          turnId: state.turnCounter,
          timestamp: Date.now(),
        });
      }

      const handle = {
        appendTextDelta: panel.appendTextDelta,
        appendThinkingDelta: (_s: string, _t: string) => { /* no-op */ },
        addToolUse: panel.addToolUse,
        markDone: panel.markDone,
        showError: panel.showError,
        setThinking: panel.setThinking,
        setRealSessionId: panel.setRealSessionId!,
      };
      sendMessageToEngine(sid, msg, handle, {
        workingDir: ui.workspacePath || '.',
        mode: 'orchestrator',
        systemPrompt: orchestrator.getSystemPrompt(),
        autoCommit: ui.autoCommitEnabled,
        resumeSessionId: state?.realClaudeSessionId || undefined,
      });
    },
    delegateToChild: (
      parentSessionId: string,
      task: string,
      _context: string,
      _specialistProfileId: string,
      _contextProfileIds: string[],
      agentName?: string,
      teamId?: string,
      teammates?: string[],
    ) => {
      const panel = chatPanelRef.value;
      if (!panel) return '';
      const childSid = sessionsStore.createChildSession(parentSessionId, ui.workspacePath || '.', 'agent', task);

      // Update child session title to show role if agent name is provided
      if (agentName) {
        const childSession = sessionsStore.sessions.get(childSid);
        if (childSession) {
          childSession.title = agentName.charAt(0).toUpperCase() + agentName.slice(1);
        }
      }
      fleetStore.rebuildFromSessions();

      let systemPrompt = '';
      if (teammates && teammates.length > 0 && agentName) {
        systemPrompt = `Your agent name is "${agentName}". ` +
          `You are on a team with: ${teammates.join(', ')}. ` +
          `Use send_message(to, content) and check_inbox() to coordinate.`;
      }

      const handle = {
        appendTextDelta: panel.appendTextDelta,
        appendThinkingDelta: (_s: string, _t: string) => { /* no-op */ },
        addToolUse: panel.addToolUse,
        markDone: (s: string) => {
          panel.markDone(s);
          // Update child session delegation status
          const mgr = getSessionManager();
          mgr.setDelegationStatus(s, DelegationStatus.Completed);
          const childState = panel.sessionStates?.get(s);
          const lastMsg = childState?.messages
            ? [...childState.messages].reverse().find((m: { role: string }) => m.role === 'assistant')
            : null;
          const result = lastMsg?.content ?? '';
          mgr.setDelegationResult(s, result);
          sessionsStore.syncFromEngine(s);
          sessionsStore.persistSession(s);
          orchestrator.onDelegateFinished(s, result);
        },
        showError: panel.showError,
        setThinking: panel.setThinking,
        setRealSessionId: panel.setRealSessionId!,
        onFileEdited,
      };

      sendMessageToEngine(childSid, task, handle, {
        workingDir: ui.workspacePath || '.',
        mode: 'agent',
        systemPrompt,
        agentName,
        teamId,
      });

      return childSid;
    },
    sessionFinalOutput: (sid: string) => {
      const state = chatPanelRef.value?.sessionStates?.get(sid);
      if (!state) return '';
      const lastAssistant = [...state.messages].reverse().find((m: { role: string }) => m.role === 'assistant');
      return lastAssistant?.content ?? '';
    },
  });
  orchestrator.setWorkspace(ui.workspacePath || '.');
  await orchestrator.attachToSession(sessionId, ui.autoCommitEnabled);

  // Register interceptors so MCP tool calls are routed to the orchestrator
  setMcpToolInterceptor((sid, toolName, args) => {
    orchestrator.onMcpToolCalled(sid, toolName, args);
  });
  setSessionFinishedInterceptor((sid) => {
    orchestrator.onSessionFinishedProcessing(sid);
  });
}

// Clean up interceptors and graph subscriptions when orchestration ends
orchestrator.on('completed', () => {
  setMcpToolInterceptor(null);
  setSessionFinishedInterceptor(null);
  if (graphCleanup) {
    graphCleanup();
    graphCleanup = null;
  }
});
orchestrator.on('failed', () => {
  setMcpToolInterceptor(null);
  setSessionFinishedInterceptor(null);
  if (graphCleanup) {
    graphCleanup();
    graphCleanup = null;
  }
});

// ── Global keyboard event: Cmd+N new chat ───────────────────────────────

function onGlobalNewChat() {
  onNewChat();
}

function onSettingsSaved(_settings: Record<string, string>) {
  // Apply saved settings as needed
}

function onGlobalOpenSettings() {
  showSettings.value = true;
}

function onGlobalOpenProfileEditor() {
  showProfileEditor.value = true;
}

function onGitFileDiffReady({ filePath, staged, diff }: { filePath: string; staged: boolean; diff: GitUnifiedDiff }) {
  if (diff.isBinary) return;
  const rightLabel = staged ? 'Staged' : 'Working Tree';
  ui.showDiffView(filePath, diff.oldContent, diff.newContent, 'HEAD', rightLabel);
  // Ensure code pane is visible in editor mode
  if (ui.viewMode === 'editor') {
    // diff will show in Panel 2 via MainSplitter
  } else {
    // In manager mode, show as inline preview
    ui.inlinePreviewFile = filePath;
  }
}

onMounted(async () => {
  window.addEventListener('angy:new-chat', onGlobalNewChat);
  window.addEventListener('angy:open-settings', onGlobalOpenSettings);
  window.addEventListener('angy:open-profile-editor', onGlobalOpenProfileEditor);
  gitStore.manager.on('fileDiffReady', onGitFileDiffReady);
  themeStore.loadSavedTheme();

  // Initialize database and load saved sessions
  const db = getDatabase();
  const ok = await db.open();
  if (ok) {
    await sessionsStore.loadFromDatabase(ui.workspacePath || undefined);
    fleetStore.rebuildFromSessions();
    console.log(`[App] Loaded ${sessionsStore.sessions.size} sessions from database`);

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
  window.removeEventListener('angy:new-chat', onGlobalNewChat);
  window.removeEventListener('angy:open-settings', onGlobalOpenSettings);
  window.removeEventListener('angy:open-profile-editor', onGlobalOpenProfileEditor);
  gitStore.manager.off('fileDiffReady', onGitFileDiffReady);
  if (graphCleanup) {
    graphCleanup();
    graphCleanup = null;
  }
  missionControl.dispose();
});
</script>
