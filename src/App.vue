<template>
  <AppShell>
    <template #actions>
      <HomeActions v-if="ui.viewMode === 'home'" />
      <KanbanActions v-else-if="ui.viewMode === 'kanban'"
        @add-epic="kanbanViewRef?.addEpic()"
        @schedule-now="kanbanViewRef?.scheduleNow()"
        @open-git-tree="kanbanViewRef?.openGitTree()"
        @open-scheduler-config="kanbanViewRef?.openSchedulerConfig()" />
      <ManagerActions v-else-if="ui.viewMode === 'manager'"
        @new-agent="onNewChat()"
        @orchestrate="onOrchestrate()"
        @enter-mission-control="onEnterMissionControl()" />
      <MissionControlActions v-else-if="ui.viewMode === 'mission-control'"
        @exit-mission-control="onExitMissionControl()" />
    </template>

    <!-- Top-level view routing based on viewMode -->
    <HomeView v-if="ui.viewMode === 'home'" />
    <KanbanView v-else-if="ui.viewMode === 'kanban'" ref="kanbanViewRef" />

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
            @orchestrate-requested="onOrchestratorStart"
            @orchestrate-started="(sid: string, fix: boolean) => onOrchestrateStarted(sid, fix)"
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

      <OrchestratorDialog :visible="showOrchestratorDialog" @close="showOrchestratorDialog = false" @start="onOrchestratorStart" />
    </template>
  </AppShell>

  <!-- Global dialogs (available on all views) -->
  <SettingsDialog :visible="showSettings" @close="showSettings = false" @saved="onSettingsSaved" />
  <NotificationToast />
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue';
import AppShell from './components/layout/AppShell.vue';
import HomeActions from './components/layout/actions/HomeActions.vue';
import KanbanActions from './components/layout/actions/KanbanActions.vue';
import ManagerActions from './components/layout/actions/ManagerActions.vue';
import MissionControlActions from './components/layout/actions/MissionControlActions.vue';
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
import OrchestratorDialog from './components/settings/OrchestratorDialog.vue';
import NotificationToast from './components/home/NotificationToast.vue';
import { useUiStore } from './stores/ui';
import { useThemeStore } from './stores/theme';
import { useSessionsStore, getDatabase, getSessionManager, initSessionEngines } from './stores/sessions';
import { useFleetStore } from './stores/fleet';
import { useProjectsStore } from './stores/projects';
import { useEpicStore } from './stores/epics';
import { useGraphStore } from './stores/graph';
import { useGitStore } from './stores/git';
import { useKeyboard } from './composables/useKeyboard';
import { useOrchestrator } from './composables/useOrchestrator';
import { useGraphBuilder } from './composables/useGraphBuilder';
import { useMissionControl } from './composables/useMissionControl';
import { sendMessageToEngine, cancelProcess, setOrchestratorLookup, setProcessManager } from './composables/useEngine';
import { ORCHESTRATOR_SYSTEM_PROMPT, SPECIALIST_PROMPTS, SPECIALIST_TOOLS } from './engine/Orchestrator';
import { detectTechnologies, buildTechPromptPrefix } from './engine/TechDetector';
import { DelegationStatus } from './engine/types';
import type { EpicColumn } from './engine/KosTypes';
import { DiffEngine } from './engine/DiffEngine';
import { engineBus } from './engine/EventBus';
import { AngyEngine } from './engine/AngyEngine';
import { getCurrentWindow } from '@tauri-apps/api/window';

// ── Stores ──────────────────────────────────────────────────────────────

const ui = useUiStore();
const sessionsStore = useSessionsStore();
const fleetStore = useFleetStore();
const gitStore = useGitStore();
const themeStore = useThemeStore();
const projectStore = useProjectsStore();
const epicStore = useEpicStore();

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
const showOrchestratorDialog = ref(false);

// ── Orchestrator ──────────────────────────────────────────────────────
const { startOrchestration, orchestrator, getOrchestratorForSession, initPool, setEngine } = useOrchestrator();

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

  // Resolve workspace path from the epic's target repos (use first repo)
  const projectRepos = projectStore.reposByProjectId(ui.activeProjectId);
  let repoPath = '';
  if (epic.targetRepoIds.length > 0) {
    const targetRepo = projectRepos.find((r) => r.id === epic.targetRepoIds[0]);
    if (targetRepo) repoPath = targetRepo.path;
  }
  // Fallback: use first project repo
  if (!repoPath && projectRepos.length > 0) {
    repoPath = projectRepos[0].path;
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
    await sessionsStore.loadFromDatabase(repoPath);
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

    // Clear current sessions and reload for new workspace
    sessionsStore.sessions.clear();
    sessionsStore.messages.clear();
    await sessionsStore.loadFromDatabase(newPath);
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

// ── Orchestrator ─────────────────────────────────────────────────────────

function onOrchestrate() {
  showOrchestratorDialog.value = true;
}

/**
 * Build a shared OrchestratorChatPanelAPI backed by ChatPanel + Pinia stores.
 * Used by both dialog-initiated and input-bar-initiated orchestration.
 */
function buildChatPanelAPI(opts: {
  newChatHook?: (sid: string) => void;
  sendSystemPrompt?: () => string;
  sendAutoCommit?: boolean;
  injectUserMessage?: boolean;
}) {
  return {
    newChat: async (workspace: string) => {
      const sid = await chatPanelRef.value?.newChat(workspace) ?? '';
      opts.newChatHook?.(sid);
      return sid;
    },

    configureSession: (sid: string, mode: string, _profileIds: string[]) => {
      const session = sessionsStore.sessions.get(sid);
      if (session) {
        session.title = session.title || `${mode} session`;
      }
    },

    sendMessageToSession: (sid: string, msg: string) => {
      const panel = chatPanelRef.value;
      if (!panel) return;

      if (opts.injectUserMessage) {
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
      const state = panel.sessionStates?.get(sid);
      sendMessageToEngine(sid, msg, handle, {
        workingDir: ui.workspacePath || '.',
        mode: 'orchestrator',
        systemPrompt: opts.sendSystemPrompt?.() ?? ORCHESTRATOR_SYSTEM_PROMPT,
        autoCommit: opts.sendAutoCommit,
        resumeSessionId: state?.realClaudeSessionId || undefined,
      });
    },

    delegateToChild: async (
      parentSessionId: string,
      task: string,
      context: string,
      specialistProfileId: string,
      _contextProfileIds: string[],
      agentName?: string,
      teamId?: string,
      teammates?: string[],
      workingDir?: string,
    ) => {
      const panel = chatPanelRef.value;
      if (!panel) return '';
      const resolvedDir = workingDir || ui.workspacePath || '.';
      const childSid = await sessionsStore.createChildSession(parentSessionId, resolvedDir, 'agent', task);

      if (agentName) {
        const childSession = sessionsStore.sessions.get(childSid);
        if (childSession) {
          childSession.title = agentName.charAt(0).toUpperCase() + agentName.slice(1);
        }
      }
      fleetStore.rebuildFromSessions();

      // Build system prompt: specialist identity + orchestrator context + team coordination
      const promptParts: string[] = [];

      const role = specialistProfileId.replace('specialist-', '');
      const specialistPrompt = SPECIALIST_PROMPTS[role];
      if (specialistPrompt) {
        promptParts.push(specialistPrompt);
      }

      if (context) {
        const truncated = context.length > 4000
          ? context.substring(0, 4000) + '\n...(truncated)'
          : context;
        promptParts.push(`## Context from orchestrator\n${truncated}`);
      }

      if (teammates && teammates.length > 0 && agentName) {
        promptParts.push(
          `Your agent name is "${agentName}". ` +
          `You are on a team with: ${teammates.join(', ')}. ` +
          `Use send_message(to, content) and check_inbox() to coordinate.`,
        );
      }

      const toolList = SPECIALIST_TOOLS[role];
      if (toolList) {
        promptParts.push(`\nYou have access to these tools: ${toolList}. Use only these tools.`);
      }

      // Prepend technology profile guidelines for implementer/tester roles
      const autoProfiles = orchestrator.getAutoProfiles();
      if (autoProfiles.length > 0) {
        promptParts.unshift(buildTechPromptPrefix(autoProfiles));
      }

      const systemPrompt = promptParts.join('\n\n');

      const handle = {
        appendTextDelta: panel.appendTextDelta,
        appendThinkingDelta: (_s: string, _t: string) => { /* no-op */ },
        addToolUse: panel.addToolUse,
        markDone: (s: string) => {
          // Set delegation status BEFORE panel.markDone so the first persist
          // already writes Completed (not Pending) to the DB.
          const mgr = getSessionManager();
          mgr.setDelegationStatus(s, DelegationStatus.Completed);
          const childState = panel.sessionStates?.get(s);
          const lastMsg = childState?.messages
            ? [...childState.messages].reverse().find((m: { role: string }) => m.role === 'assistant')
            : null;
          const result = lastMsg?.content ?? '';
          mgr.setDelegationResult(s, result);
          panel.markDone(s);
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
        workingDir: resolvedDir,
        mode: 'agent',
        systemPrompt,
        agentName,
        teamId,
        specialistRole: role,
      });

      return childSid;
    },

    cancelChild: (sessionId: string) => {
      cancelProcess(sessionId);
    },

    sessionFinalOutput: (sid: string) => {
      const state = chatPanelRef.value?.sessionStates?.get(sid);
      if (!state) return '';
      const lastAssistant = [...state.messages].reverse().find((m: { role: string }) => m.role === 'assistant');
      return lastAssistant?.content ?? '';
    },
  };
}

async function onOrchestratorStart(goal: string) {
  showOrchestratorDialog.value = false;
  ui.setRightPanelMode('graph');
  orchestrator.setChatPanel(buildChatPanelAPI({
    newChatHook: (sid) => {
      if (sid) {
        if (graphCleanup) graphCleanup();
        graphCleanup = startLiveGraph(sid);
      }
    },
  }));
  orchestrator.setWorkspace(ui.workspacePath || '.');

  // Detect technology profiles from workspace
  const workspace = ui.workspacePath || '.';
  const detectedProfiles = await detectTechnologies(workspace);
  orchestrator.setAutoProfiles(detectedProfiles);

  startOrchestration(goal);
}

async function onOrchestrateStarted(sessionId: string, fixMode = false) {
  ui.setRightPanelMode('graph');
  if (graphCleanup) graphCleanup();
  graphCleanup = startLiveGraph(sessionId);
  orchestrator.setPipelineType(fixMode ? 'fix' : 'create');
  orchestrator.setChatPanel(buildChatPanelAPI({
    sendSystemPrompt: () => orchestrator.getSystemPrompt(),
    sendAutoCommit: ui.autoCommitEnabled,
    injectUserMessage: true,
  }));
  orchestrator.setWorkspace(ui.workspacePath || '.');

  // Detect technology profiles from workspace
  const workspace = ui.workspacePath || '.';
  const detectedProfiles = await detectTechnologies(workspace);
  orchestrator.setAutoProfiles(detectedProfiles);

  await orchestrator.attachToSession(sessionId, ui.autoCommitEnabled);
}

// Clean up graph subscriptions when orchestration ends
orchestrator.on('completed', () => {
  if (graphCleanup) {
    graphCleanup();
    graphCleanup = null;
  }
});
orchestrator.on('failed', () => {
  if (graphCleanup) {
    graphCleanup();
    graphCleanup = null;
  }
});

// ── engineBus listener references (hoisted for cleanup in onUnmounted) ──

let onSchedulerError: (e: { epicId?: string; title: string; message: string }) => void;
let onSchedulerInfo: (e: { epicId?: string; title: string; message: string }) => void;
let onSessionCreatedBus: (e: { sessionId: string }) => void;
let onAgentStatusBus: (e: { agentId: string; status: string; activity: string }) => void;
let onEpicRequestStart: (e: { epicId: string }) => void;
let onEpicRequestStop: (e: { epicId: string; targetColumn?: EpicColumn }) => void;
let onEpicStoreSync: () => Promise<void>;
let onAgentFileEdited: (e: { sessionId: string; filePath: string; toolName: string; toolInput?: Record<string, any> }) => void;

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
  gitStore.manager.on('fileDiffReady', onGitFileDiffReady);
  themeStore.loadSavedTheme();

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
  const engine = AngyEngine.getInstance();
  await engine.initialize();

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
      const currentWs = ui.workspacePath;
      if (currentWs && (!info.workspace || info.workspace !== currentWs)) {
        return;
      }
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

  // Share the engine's ProcessManager with the useEngine composable
  setProcessManager(engine.processes);

  // Wire engine into the useOrchestrator composable for session → orchestrator routing
  setEngine(engine);

  // Pool-aware MCP routing: standalone orchestrator + engine epic orchestrators
  setOrchestratorLookup((sessionId: string) => {
    return getOrchestratorForSession(sessionId);
  });
  console.log('[App] Engine initialized, orchestrator lookup registered');

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

  // Initialize Pinia stores from engine's database (DB is already open via engine)
  const db = getDatabase();
  if (db) {
    await projectStore.initialize();
    await epicStore.initialize();

    // Initialize the composable-level pool (for standalone orchestrator)
    const branchManager = engine.branchManager;
    initPool(branchManager);

    const scheduler = engine.scheduler;
    await scheduler.initialize();

    await sessionsStore.loadFromDatabase(ui.workspacePath || undefined);
    fleetStore.rebuildFromSessions();
    console.log(`[App] Loaded ${sessionsStore.sessions.size} sessions from database`);

    // Periodically sync sessions from DB so other instances' chats appear
    sessionSyncInterval = window.setInterval(async () => {
      const added = await sessionsStore.syncNewSessions(ui.workspacePath || undefined);
      if (added) {
        fleetStore.rebuildFromSessions();
      }
    }, 5000);

    // Periodically sync epics from DB so scheduler-driven changes appear
    epicSyncInterval = window.setInterval(() => epicStore.loadAll(), 3000);

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
  gitStore.manager.off('fileDiffReady', onGitFileDiffReady);

  // Clean up engineBus listeners to prevent leaks
  engineBus.off('scheduler:error', onSchedulerError);
  engineBus.off('scheduler:info', onSchedulerInfo);
  engineBus.off('session:created', onSessionCreatedBus);
  engineBus.off('agent:statusChanged', onAgentStatusBus);
  engineBus.off('epic:requestStart', onEpicRequestStart);
  engineBus.off('epic:requestStop', onEpicRequestStop);
  engineBus.off('epic:storeSyncNeeded', onEpicStoreSync);
  engineBus.off('agent:fileEdited', onAgentFileEdited);

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
  missionControl.dispose();
});
</script>
