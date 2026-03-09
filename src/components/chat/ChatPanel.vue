<template>
  <div class="flex flex-col h-full bg-[var(--bg-base)]">
    <!-- Loading spinner (shown while loading history from DB) -->
    <div
      v-if="isLoadingHistory"
      class="flex-1 flex items-center justify-center"
    >
      <div class="flex flex-col items-center gap-3">
        <div class="w-6 h-6 border-2 border-[var(--accent-teal)] border-t-transparent rounded-full animate-spin" />
        <span class="text-[11px] text-[var(--text-muted)]">Loading conversation...</span>
      </div>
    </div>

    <!-- Welcome screen (shown when no messages for active session) -->
    <WelcomeScreen v-if="!isLoadingHistory && activeMessages.length === 0 && !isProcessing" />

    <!-- Messages area -->
    <div
      ref="messagesContainer"
      class="flex-1 overflow-y-auto"
      v-show="activeMessages.length > 0 || isProcessing"
    >
      <div class="max-w-[860px] mx-auto py-8 px-6 space-y-5">
        <template v-for="item in groupedMessages" :key="item.id">
          <!-- AskUserQuestion → QuestionWidget -->
          <QuestionWidget
            v-if="item.type === 'question'"
            :question="extractQuestion(item.msg.toolInput!)"
            :options="extractOptions(item.msg.toolInput!)"
            :session-id="activeSessionId || ''"
            :answered="item.msg.questionAnswered ?? false"
            @answer="(opt: string) => onQuestionAnswer(item.msg, opt)"
          />
          <!-- Tool call group → ToolCallGroup card -->
          <ToolCallGroup
            v-else-if="item.type === 'tool-group'"
            :calls="item.calls"
            :expanded-by-default="item.expandedByDefault"
            @file-clicked="(fp: string) => emit('file-clicked', fp)"
          />
          <!-- User / assistant message -->
          <ChatMessage
            v-else
            :role="item.msg.role"
            :content="item.msg.content"
            :turn-id="item.msg.turnId"
            :tool-name="item.msg.toolName"
            :timestamp="item.msg.timestamp"
            :images="item.msg.images"
            :thinking-content="item.msg.thinkingContent"
            :thinking-elapsed-ms="item.msg.thinkingElapsedMs"
            :thinking-streaming="item.msg.thinkingStreaming"
            @navigate="onNavigate"
            @revert="onRevert"
            @apply-code="onApplyCode"
          />
        </template>
        <ThinkingIndicator v-if="isThinking" />
      </div>
    </div>

    <!-- Input bar -->
    <InputBar
      v-if="!isAutoSpawned"
      ref="inputBar"
      :processing="isProcessing"
      :workspacePath="ui.workspacePath"
      @send="onSend"
      @stop="onStop"
      @slash-command="onSlashCommand"
    >
      <template #footer-left>
        <ModeSelector v-model="currentMode" />
        <ModelSelector v-model="ui.currentModel" />
        <ProfileSelector v-model="selectedProfiles" />
        <div class="flex items-center rounded border border-[var(--border-subtle)] overflow-hidden">
          <button
            v-for="pm in pipelineModes"
            :key="pm.value"
            class="text-[10px] px-2 py-0.5 transition-colors cursor-pointer border-r border-[var(--border-subtle)] last:border-r-0"
            :class="pipelineMode === pm.value
              ? pm.activeClass
              : 'text-[var(--text-muted)] bg-[var(--bg-surface)] hover:text-[var(--text-secondary)]'"
            :title="pm.title"
            @click="pipelineMode = pipelineMode === pm.value ? 'normal' : pm.value"
          >
            {{ pm.label }}
          </button>
        </div>
      </template>
    </InputBar>
    <div v-else class="py-3 text-center text-[11px] text-[var(--text-muted)] border-t border-[var(--border-subtle)]">
      This agent is managed by the scheduler
      <div v-if="autoProfiles.length" class="flex items-center justify-center gap-1.5 mt-1 flex-wrap">
        <span v-for="p in autoProfiles" :key="p.id"
              class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px]"
              style="background: color-mix(in srgb, var(--accent-teal) 15%, transparent); color: var(--accent-teal)">
          {{ p.icon }} {{ p.name }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue';
import ChatMessage from './ChatMessage.vue';
import ThinkingIndicator from './ThinkingIndicator.vue';
import QuestionWidget from './QuestionWidget.vue';
import ToolCallGroup from './ToolCallGroup.vue';
import type { ToolCallInfo } from './ToolCallGroup.vue';
import WelcomeScreen from './WelcomeScreen.vue';
import InputBar from '../input/InputBar.vue';
import ModeSelector from '../input/ModeSelector.vue';
import ModelSelector from '../input/ModelSelector.vue';
import ProfileSelector from '../input/ProfileSelector.vue';
import { useSessionsStore, getDatabase } from '../../stores/sessions';
import { useFleetStore } from '../../stores/fleet';
import { useUiStore } from '../../stores/ui';
import { useProjectsStore } from '../../stores/projects';
import { ClaudeProcess } from '../../engine/ClaudeProcess';
import { sendMessageToEngine, sendToolResultToEngine, cancelProcess, type ChatPanelHandle } from '../../composables/useEngine';
import { Orchestrator, ORCHESTRATOR_SYSTEM_PROMPT, ORCHESTRATOR_FIX_PROMPT } from '../../engine/Orchestrator';
import type { AgentStatus, AttachedContext, AttachedImage, MessageRecord } from '../../engine/types';
import { engineBus } from '../../engine/EventBus';
import { useOrchestrator } from '../../composables/useOrchestrator';

// ── Message type ──────────────────────────────────────────────────────────

interface ChatMsg {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  turnId: number;
  toolName?: string;
  toolId?: string;
  toolInput?: Record<string, any>;
  timestamp: number;
  images?: string[];
  thinkingContent?: string;
  thinkingElapsedMs?: number;
  thinkingStreaming?: boolean;
  questionAnswered?: boolean;
}

// ── Per-session state ────────────────────────────────────────────────────

interface SessionState {
  messages: ChatMsg[];
  turnCounter: number;
  lastPersistedTurnId: number;
  currentAssistantMsgId: string | null;
  isProcessing: boolean;
  isThinking: boolean;
  isLoadingHistory: boolean;
  editCount: number;
  lastActivity: string;
  costUsd: number;
  realClaudeSessionId: string | null;
  // Thinking accumulation
  pendingThinkingContent: string;
  thinkingStartTime: number;
}

// ── Emits ────────────────────────────────────────────────────────────────

const emit = defineEmits<{
  'active-session-changed': [sessionId: string];
  'session-list-changed': [];
  'agent-activity-changed': [sessionId: string, activity: string];
  'file-edited': [sessionId: string, filePath: string, toolName: string, toolInput?: Record<string, any>];
  'file-clicked': [filePath: string];
  'orchestrate-requested': [goal: string];
  'orchestrate-started': [sessionId: string, fixMode: boolean];
}>();

// ── Stores ───────────────────────────────────────────────────────────────

const sessionsStore = useSessionsStore();
const fleetStore = useFleetStore();
const ui = useUiStore();
const projectsStore = useProjectsStore();
const { autoProfiles } = useOrchestrator();

// ── Selector state ──────────────────────────────────────────────────────
const currentMode = ref('agent');
const selectedProfiles = ref<string[]>([]);
type PipelineMode = 'normal' | 'orchestrate' | 'fixer';
const pipelineMode = ref<PipelineMode>('normal');
const pipelineModes = [
  {
    value: 'normal' as PipelineMode,
    label: 'Normal',
    title: 'Single agent mode',
    activeClass: 'text-[var(--text-primary)] bg-[var(--bg-raised)]',
  },
  {
    value: 'orchestrate' as PipelineMode,
    label: 'Orchestrate',
    title: 'Creation pipeline: architect → implement → test → review',
    activeClass: 'text-[var(--accent-mauve)] bg-[color-mix(in_srgb,var(--accent-mauve)_15%,transparent)]',
  },
  {
    value: 'fixer' as PipelineMode,
    label: 'Fixer',
    title: 'Fix pipeline: diagnose → debug → fix → test → review',
    activeClass: 'text-[var(--accent-peach)] bg-[color-mix(in_srgb,var(--accent-peach)_15%,transparent)]',
  },
];

// ── State ────────────────────────────────────────────────────────────────

const sessionStates = ref<Map<string, SessionState>>(new Map());
const messagesContainer = ref<HTMLElement | null>(null);
const inputBar = ref<InstanceType<typeof InputBar> | null>(null);

// ── Computed: active session's messages ──────────────────────────────────

const activeSessionId = computed(() => sessionsStore.activeSessionId);

const activeState = computed((): SessionState | null => {
  if (!activeSessionId.value) return null;
  return sessionStates.value.get(activeSessionId.value) ?? null;
});

const activeMessages = computed((): ChatMsg[] => {
  return activeState.value?.messages ?? [];
});

const isProcessing = computed((): boolean => {
  return activeState.value?.isProcessing ?? false;
});

const isThinking = computed((): boolean => {
  return activeState.value?.isThinking ?? false;
});

const isLoadingHistory = computed((): boolean => {
  return activeState.value?.isLoadingHistory ?? false;
});

const isAutoSpawned = computed((): boolean => {
  if (!activeSessionId.value) return false;
  const session = sessionsStore.sessions.get(activeSessionId.value);
  return !!session?.epicId && !!session?.parentSessionId;
});

function setLoadingHistory(sessionId: string, loading: boolean) {
  const state = getOrCreateState(sessionId);
  state.isLoadingHistory = loading;
}

// ── Grouped messages (groups consecutive non-edit tool calls) ─────────────

const EDIT_TOOLS = new Set(['Edit', 'Write', 'StrReplace', 'MultiEdit', 'NotebookEdit']);

type GroupedItem =
  | { type: 'message'; msg: ChatMsg; id: string }
  | { type: 'question'; msg: ChatMsg; id: string }
  | { type: 'tool-group'; calls: ToolCallInfo[]; expandedByDefault: boolean; id: string };

const groupedMessages = computed((): GroupedItem[] => {
  const result: GroupedItem[] = [];
  let pendingGroup: ToolCallInfo[] = [];
  let pendingGroupId = '';

  const flushGroup = () => {
    if (pendingGroup.length > 0) {
      result.push({
        type: 'tool-group',
        calls: [...pendingGroup],
        expandedByDefault: false,
        id: `tg-${pendingGroupId}`,
      });
      pendingGroup = [];
      pendingGroupId = '';
    }
  };

  for (const msg of activeMessages.value) {
    if (msg.role === 'tool') {
      if (msg.toolName === 'AskUserQuestion') {
        flushGroup();
        result.push({ type: 'question', msg, id: msg.id });
        continue;
      }

      const isEdit = EDIT_TOOLS.has(msg.toolName ?? '');
      const input = msg.toolInput ?? {};
      const filePath = String(input.file_path ?? input.path ?? '') || undefined;
      let newString: string | undefined;
      if (isEdit) {
        newString = String(input.new_string ?? input.content ?? input.contents ?? '') || undefined;
        // Truncate large Write tool content to first 20 lines
        if (newString && msg.toolName === 'Write' && newString.split('\n').length > 30) {
          const lines = newString.split('\n');
          newString = lines.slice(0, 20).join('\n') + `\n... (${lines.length - 20} more lines)`;
        }
      }

      const call: ToolCallInfo = {
        toolName: msg.toolName ?? 'Tool',
        filePath,
        summary: msg.content,
        isEdit,
        oldString: isEdit ? String(input.old_string ?? '') || undefined : undefined,
        newString,
      };

      if (isEdit) {
        flushGroup();
        result.push({
          type: 'tool-group',
          calls: [call],
          expandedByDefault: true,
          id: `tg-${msg.id}`,
        });
      } else {
        if (pendingGroup.length === 0) pendingGroupId = msg.id;
        pendingGroup.push(call);
      }
    } else {
      flushGroup();
      result.push({ type: 'message', msg, id: msg.id });
    }
  }

  flushGroup();
  return result;
});

// ── Auto-scroll ──────────────────────────────────────────────────────────

function scrollToBottom() {
  nextTick(() => {
    const el = messagesContainer.value;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  });
}

watch(
  () => activeMessages.value.length,
  () => scrollToBottom(),
);

// ── Session management ───────────────────────────────────────────────────

function getOrCreateState(sessionId: string): SessionState {
  let state = sessionStates.value.get(sessionId);
  if (!state) {
    const raw: SessionState = {
      messages: [],
      turnCounter: 0,
      lastPersistedTurnId: 0,
      currentAssistantMsgId: null,
      isProcessing: false,
      isThinking: false,
      isLoadingHistory: false,
      editCount: 0,
      lastActivity: '',
      costUsd: 0,
      realClaudeSessionId: null,
      pendingThinkingContent: '',
      thinkingStartTime: 0,
    };
    sessionStates.value.set(sessionId, raw);
    // Return the reactive proxy from .get(), not the raw object.
    // Vue's reactive Map wraps values on .get() but .set() stores the raw value.
    // Returning the raw object causes mutations to bypass Vue's reactivity tracking.
    state = sessionStates.value.get(sessionId)!;
  }
  return state;
}

function selectSession(sessionId: string) {
  sessionsStore.selectSession(sessionId);
  getOrCreateState(sessionId);
  fleetStore.markViewed(sessionId);
  emit('active-session-changed', sessionId);
  scrollToBottom();
  nextTick(() => inputBar.value?.focus());
}

async function newChat(workspace = ''): Promise<string> {
  const sessionId = await sessionsStore.createSession(workspace || ui.workspacePath || '.');
  getOrCreateState(sessionId);
  sessionsStore.selectSession(sessionId);
  fleetStore.rebuildFromSessions();
  emit('session-list-changed');
  emit('active-session-changed', sessionId);
  nextTick(() => inputBar.value?.focus());
  return sessionId;
}

// ── Actions ──────────────────────────────────────────────────────────────

// ── ChatPanel handle for engine bridge ──────────────────────────────────
const chatPanelHandle: ChatPanelHandle = {
  appendTextDelta,
  appendThinkingDelta,
  addToolUse,
  markDone,
  showError,
  setThinking,
  setRealSessionId,
  onFileEdited,
  onCheckpointReceived,
};

function onFileEdited(sessionId: string, filePath: string, toolName: string, toolInput?: Record<string, any>) {
  emit('file-edited', sessionId, filePath, toolName, toolInput);
}

function onCheckpointReceived(sessionId: string, uuid: string, replayIndex: number) {
  const state = sessionStates.value.get(sessionId);
  if (!state) return;

  const userMessages = state.messages
    .filter(m => m.role === 'user')
    .sort((a, b) => a.turnId - b.turnId);

  if (replayIndex < userMessages.length) {
    getDatabase().saveCheckpoint({
      sessionId,
      turnId: userMessages[replayIndex].turnId,
      uuid,
      timestamp: Math.floor(Date.now() / 1000),
    });
  }
}

function setRealSessionId(sessionId: string, realId: string) {
  const state = getOrCreateState(sessionId);
  if (state) {
    state.realClaudeSessionId = realId;
  }
  const info = sessionsStore.sessions.get(sessionId);
  if (info) {
    info.claudeSessionId = realId;
    sessionsStore.persistSession(sessionId);
  }
}

async function onSend(text: string, _contexts?: AttachedContext[], _images?: AttachedImage[]) {
  const currentPipeline = pipelineMode.value;
  const isOrchestrate = currentPipeline === 'orchestrate' || currentPipeline === 'fixer';
  const effectiveMode = isOrchestrate ? 'orchestrator' : currentMode.value;
  if (isOrchestrate) {
    pipelineMode.value = 'normal';
  }

  let sid = activeSessionId.value;
  if (!sid) {
    sid = await newChat();
  }

  if (isOrchestrate) {
    emit('orchestrate-started', sid, currentPipeline === 'fixer');
  }

  const state = getOrCreateState(sid);
  state.turnCounter++;
  state.isProcessing = true;
  state.isThinking = true;
  state.currentAssistantMsgId = null;

  // Build image payload for engine
  const imagePayload = _images && _images.length > 0
    ? _images.map(img => ({
        data: img.data,
        mediaType: `image/${img.format.toLowerCase() === 'jpg' ? 'jpeg' : img.format.toLowerCase()}`,
      }))
    : undefined;

  const now = Date.now();
  state.messages.push({
    id: `msg-${now}-user`,
    role: 'user',
    content: text,
    turnId: state.turnCounter,
    timestamp: now,
    images: _images?.length
      ? _images.map(img => `data:image/${img.format};base64,${img.data}`)
      : undefined,
  });

  // Auto-title: use first words of the first user message
  const session = sessionsStore.sessions.get(sid);
  if (session && (!session.title || session.title.startsWith('Chat '))) {
    const words = text.trim().split(/\s+/).slice(0, 6).join(' ');
    const title = words.length > 40 ? words.substring(0, 40) + '\u2026' : words;
    sessionsStore.updateSessionTitle(sid, title);
    fleetStore.rebuildFromSessions();
  }

  // Persist user message to DB
  const db = getDatabase();
  db.saveMessage({
    sessionId: sid,
    role: 'user',
    content: text,
    turnId: state.turnCounter,
    timestamp: Math.floor(now / 1000),
  });
  // Persist session
  sessionsStore.persistSession(sid);

  scrollToBottom();

  // Update fleet status
  updateFleetStatus(sid, 'working', isOrchestrate ? 'Orchestrating...' : 'Sending message...');

  let engineMessage = text;
  let systemPrompt: string | undefined;

  if (isOrchestrate) {
    const isFixer = currentPipeline === 'fixer';
    const pipelineType = isFixer ? 'fix' : 'create';
    engineMessage = Orchestrator.buildInitialMessage(text, { pipelineType });
    systemPrompt = isFixer ? ORCHESTRATOR_FIX_PROMPT : ORCHESTRATOR_SYSTEM_PROMPT;
  }

  // When a project is active, inject repo context so the agent only checks configured repos
  if (!systemPrompt && ui.activeProjectId) {
    const repos = projectsStore.reposByProjectId(ui.activeProjectId);
    if (repos.length > 0) {
      const project = projectsStore.projectById(ui.activeProjectId);
      const repoLines = repos.map(r => `- ${r.name}: ${r.path}`).join('\n');
      systemPrompt =
        `You are working on the "${project?.name || 'project'}" project.\n` +
        `This project contains ONLY the following repositories:\n${repoLines}\n\n` +
        `Only inspect and work within these repositories. Do not explore or reference other folders outside these repos.`;
    }
  }

  sendMessageToEngine(sid, engineMessage, chatPanelHandle, {
    workingDir: ui.workspacePath || '.',
    mode: effectiveMode,
    model: ui.currentModel,
    systemPrompt,
    resumeSessionId: state.realClaudeSessionId || undefined,
    images: imagePayload,
  });
}

async function onSlashCommand(command: string) {
  const sid = activeSessionId.value;
  if (!sid) return;

  if (command === 'export') {
    await exportChat(sid);
  } else if (command === 'clear') {
    clearChat(sid);
  }
}

async function exportChat(sessionId: string) {
  const state = sessionStates.value.get(sessionId);
  const sessionInfo = sessionsStore.sessions.get(sessionId);
  if (!state || !sessionInfo) return;

  const exportData = {
    session: {
      sessionId: sessionInfo.sessionId,
      title: sessionInfo.title,
      workspace: sessionInfo.workspace,
      mode: sessionInfo.mode,
      createdAt: sessionInfo.createdAt,
      updatedAt: sessionInfo.updatedAt,
    },
    messages: state.messages.map(msg => ({
      role: msg.role,
      content: msg.content,
      turnId: msg.turnId,
      toolName: msg.toolName ?? undefined,
      timestamp: msg.timestamp,
    })),
  };

  const { save } = await import('@tauri-apps/plugin-dialog');
  const { writeTextFile } = await import('@tauri-apps/plugin-fs');

  const safeName = (sessionInfo.title || 'chat').replace(/[^a-z0-9_-]/gi, '_').substring(0, 40);
  const path = await save({
    defaultPath: `${safeName}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });

  if (path) {
    await writeTextFile(path, JSON.stringify(exportData, null, 2));
  }
}

function clearChat(sessionId: string) {
  const state = sessionStates.value.get(sessionId);
  if (!state) return;
  state.messages = [];
  state.turnCounter = 0;
  state.lastPersistedTurnId = 0;
  state.currentAssistantMsgId = null;
  state.isProcessing = false;
  state.isThinking = false;
  state.realClaudeSessionId = null;
  state.pendingThinkingContent = '';
  state.thinkingStartTime = 0;
}

function onStop() {
  const sid = activeSessionId.value;
  if (!sid) return;

  cancelProcess(sid);

  const state = sessionStates.value.get(sid);
  if (state) {
    state.isProcessing = false;
    state.isThinking = false;
  }

  updateFleetStatus(sid, 'idle', '');
}

function onNavigate(payload: { filePath: string; line?: number }) {
  emit('file-clicked', payload.filePath);
}

async function onRevert(turnId: number) {
  const sid = activeSessionId.value;
  if (!sid) return;

  cancelProcess(sid);

  const state = sessionStates.value.get(sid);
  if (!state) return;

  // Rewind files to the checkpoint at this turn (= file state when user sent this message)
  const realSessionId = state.realClaudeSessionId;
  const db = getDatabase();
  let rewound = false;

  if (realSessionId) {
    const uuid = await db.checkpointUuid(sid, turnId);
    if (uuid) {
      const proc = new ClaudeProcess();
      proc.setSessionId(realSessionId);
      proc.setWorkingDirectory(ui.workspacePath || '.');
      await proc.rewindFiles(uuid);
      rewound = true;
    }
  }

  // Fallback: if no checkpoint (e.g. most recent message), reverse edits using toolInput
  if (!rewound) {
    const EDIT_TOOLS = new Set(['Edit', 'StrReplace', 'MultiEdit']);
    const editMsgs = state.messages
      .filter(m => m.turnId >= turnId && m.role === 'tool' && m.toolName && EDIT_TOOLS.has(m.toolName) && m.toolInput)
      .reverse();

    if (editMsgs.length > 0) {
      const { readTextFile, writeTextFile } = await import('@tauri-apps/plugin-fs');
      for (const msg of editMsgs) {
        const filePath = msg.toolInput!.file_path || msg.toolInput!.path;
        if (!filePath) continue;

        try {
          let content = await readTextFile(filePath);

          if (msg.toolName === 'MultiEdit') {
            const edits = (msg.toolInput!.edits ?? []).slice().reverse();
            for (const edit of edits) {
              if (edit.new_string && content.includes(edit.new_string)) {
                content = content.replace(edit.new_string, edit.old_string ?? '');
              }
            }
          } else {
            const newStr = msg.toolInput!.new_string ?? '';
            const oldStr = msg.toolInput!.old_string ?? '';
            if (newStr && content.includes(newStr)) {
              content = content.replace(newStr, oldStr);
            }
          }

          await writeTextFile(filePath, content);
        } catch (err) {
          console.warn(`[Revert] Failed to reverse edit for ${filePath}:`, err);
        }
      }
    }
  }

  // Drop all messages at or after the reverted turn
  state.messages = state.messages.filter(m => m.turnId < turnId);

  const newTurnCounter = turnId - 1;
  state.turnCounter = newTurnCounter;
  state.lastPersistedTurnId = newTurnCounter;
  state.isProcessing = false;
  state.isThinking = false;
  state.currentAssistantMsgId = null;
  // Cannot resume the old Claude session after truncating history
  state.realClaudeSessionId = null;
  state.pendingThinkingContent = '';
  state.thinkingStartTime = 0;

  db.deleteMessagesFromTurn(sid, turnId);
  updateFleetStatus(sid, 'idle', '');
  nextTick(() => inputBar.value?.focus());
}

function onApplyCode(payload: { code: string; language: string }) {
  console.log('Apply code:', payload.language);
}

// ── Engine event handlers (called by parent/engine) ──────────────────────

function appendThinkingDelta(sessionId: string, text: string) {
  const state = getOrCreateState(sessionId);
  state.pendingThinkingContent += text;
}

function appendTextDelta(sessionId: string, text: string) {
  const state = getOrCreateState(sessionId);
  state.isThinking = false;

  if (!state.currentAssistantMsgId) {
    state.turnCounter++;
    state.currentAssistantMsgId = `msg-${Date.now()}-assistant`;

    // Attach accumulated thinking content to this assistant message
    const thinkingContent = state.pendingThinkingContent || undefined;
    const thinkingElapsedMs = state.thinkingStartTime > 0
      ? Date.now() - state.thinkingStartTime
      : undefined;

    state.messages.push({
      id: state.currentAssistantMsgId,
      role: 'assistant',
      content: text,
      turnId: state.turnCounter,
      timestamp: Date.now(),
      thinkingContent,
      thinkingElapsedMs,
    });

    // Reset thinking accumulation
    state.pendingThinkingContent = '';
    state.thinkingStartTime = 0;
  } else {
    const msg = state.messages.find((m) => m.id === state.currentAssistantMsgId);
    if (msg) {
      msg.content += text;
    }
  }

  if (sessionId === activeSessionId.value) scrollToBottom();
}

function addToolUse(sessionId: string, toolName: string, summary: string, toolInput?: Record<string, any>, toolId?: string) {
  const state = getOrCreateState(sessionId);
  state.isThinking = false;
  state.currentAssistantMsgId = null;

  state.turnCounter++;
  state.messages.push({
    id: `msg-${Date.now()}-tool-${toolName}`,
    role: 'tool',
    content: summary,
    turnId: state.turnCounter,
    toolName,
    toolId,
    toolInput,
    timestamp: Date.now(),
  });

  // Track edit count
  if (toolName === 'Edit' || toolName === 'Write' || toolName === 'StrReplace' || toolName === 'MultiEdit') {
    state.editCount++;
  }
  state.lastActivity = `${toolName}: ${summary.substring(0, 50)}`;

  // Update fleet
  updateFleetStatus(sessionId, 'working', state.lastActivity);

  if (sessionId === activeSessionId.value) scrollToBottom();
}

function markDone(sessionId: string) {
  const state = sessionStates.value.get(sessionId);
  if (state) {
    // Ensure the session row exists in the DB before saving messages
    // (prevents FOREIGN KEY constraint failures for newly-created sessions).
    sessionsStore.persistSession(sessionId);

    // Persist any unsaved assistant/tool messages from this turn batch.
    // Also persist orchestrator feed-result user messages (id contains '-feed')
    // so orchestrator sessions are fully debuggable from the DB.
    const db = getDatabase();
    for (const msg of state.messages) {
      if (msg.id.startsWith('db-')) continue;
      const isFeedMessage = msg.role === 'user' && msg.id.includes('-feed');
      if ((msg.role !== 'user' || isFeedMessage) && msg.turnId > state.lastPersistedTurnId) {
        db.saveMessage({
          sessionId,
          role: msg.role,
          content: msg.content,
          toolName: msg.toolName,
          toolInput: msg.toolInput ? JSON.stringify(msg.toolInput) : undefined,
          turnId: msg.turnId,
          timestamp: Math.floor(msg.timestamp / 1000),
        });
      }
    }
    state.lastPersistedTurnId = state.turnCounter;

    state.isProcessing = false;
    state.isThinking = false;
    state.currentAssistantMsgId = null;
  }

  updateFleetStatus(sessionId, 'idle', '');

  if (sessionId === activeSessionId.value) {
    inputBar.value?.focus();
  } else {
    fleetStore.markUnviewed(sessionId);
  }
}

function showError(sessionId: string, errorText: string) {
  const state = getOrCreateState(sessionId);
  // Strip any HTML tags from error text to avoid rendering issues
  const cleanError = errorText.replace(/<[^>]*>/g, '');
  state.messages.push({
    id: `msg-${Date.now()}-error`,
    role: 'assistant',
    content: `**Error:** ${cleanError}`,
    turnId: state.turnCounter,
    timestamp: Date.now(),
  });
  markDone(sessionId);
}

function setThinking(sessionId: string, thinking: boolean) {
  const state = getOrCreateState(sessionId);
  state.isThinking = thinking;
  if (thinking) {
    // Start tracking thinking time
    if (state.thinkingStartTime === 0) {
      state.thinkingStartTime = Date.now();
      state.pendingThinkingContent = '';
    }
  }
  if (thinking && sessionId === activeSessionId.value) scrollToBottom();
}

function updateCost(sessionId: string, costUsd: number) {
  const state = getOrCreateState(sessionId);
  state.costUsd = costUsd;
  fleetStore.updateAgent({ sessionId, costUsd });
}

// ── Fleet status helper ──────────────────────────────────────────────────

function updateFleetStatus(sessionId: string, status: AgentStatus, activity: string) {
  fleetStore.updateAgent({ sessionId, status, activity });
  emit('agent-activity-changed', sessionId, activity);
}

// ── QuestionWidget helpers ───────────────────────────────────────────────

function extractQuestion(toolInput: Record<string, any>): string {
  // AskUserQuestion input has a `questions` array with `question` fields
  if (toolInput.questions && Array.isArray(toolInput.questions) && toolInput.questions.length > 0) {
    return toolInput.questions[0].question || '';
  }
  // Fallback: direct question field
  return toolInput.question || '';
}

function extractOptions(toolInput: Record<string, any>): string[] {
  if (toolInput.questions && Array.isArray(toolInput.questions) && toolInput.questions.length > 0) {
    const q = toolInput.questions[0];
    if (q.options && Array.isArray(q.options)) {
      return q.options.map((o: any) => o.label || o.value || String(o));
    }
  }
  // Fallback: direct options
  if (toolInput.options && Array.isArray(toolInput.options)) {
    return toolInput.options.map((o: any) => o.label || o.value || String(o));
  }
  return [];
}

function onQuestionAnswer(msg: ChatMsg, answer: string) {
  msg.questionAnswered = true;
  const sid = activeSessionId.value;
  if (!sid) return;

  const state = sessionStates.value.get(sid);
  if (!state) return;

  updateFleetStatus(sid, 'working', `Answered: ${answer.substring(0, 40)}`);
  state.isProcessing = true;
  state.isThinking = true;

  // Send the answer as a tool result back to the Claude process
  const toolUseId = msg.toolId;
  const resumeId = state.realClaudeSessionId;
  if (!toolUseId || !resumeId) {
    console.warn('Cannot send tool result: missing toolUseId or resumeSessionId');
    return;
  }

  sendToolResultToEngine(sid, toolUseId, answer, chatPanelHandle, {
    workingDir: ui.workspacePath || '.',
    mode: currentMode.value,
    model: ui.currentModel,
    resumeSessionId: resumeId,
  });
}

// Load a message from the database into a session's state
function appendDbMessage(sessionId: string, msg: MessageRecord) {
  const state = getOrCreateState(sessionId);
  const role = (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'tool')
    ? msg.role : 'assistant';
  // Parse toolInput from JSON string stored in DB
  let toolInput: Record<string, any> | undefined;
  if (msg.toolInput) {
    try {
      toolInput = JSON.parse(msg.toolInput);
    } catch {
      toolInput = undefined;
    }
  }

  state.messages.push({
    id: `db-${msg.id ?? Date.now()}-${state.messages.length}`,
    role,
    content: msg.content,
    turnId: msg.turnId,
    toolName: msg.toolName || undefined,
    toolInput,
    timestamp: msg.timestamp * 1000, // DB stores seconds, UI uses milliseconds
  });
  if (msg.turnId > state.turnCounter) {
    state.turnCounter = msg.turnId;
  }
}

// ── Headless agent live streaming ────────────────────────────────────────
//
// Epic/orchestrated agents use HeadlessHandle instead of ChatPanel's handle,
// so their streaming events are broadcast on engineBus. We subscribe here so
// ChatPanel shows real-time updates when viewing a headless session.

function onHeadlessTextDelta({ sessionId, text }: { sessionId: string; text: string }) {
  getOrCreateState(sessionId).isProcessing = true;
  appendTextDelta(sessionId, text);
}

function onHeadlessToolUse({ sessionId, toolName, summary, toolInput }: { sessionId: string; toolName: string; summary: string; toolInput?: Record<string, any> }) {
  getOrCreateState(sessionId).isProcessing = true;
  addToolUse(sessionId, toolName, summary, toolInput);
}

function onHeadlessThinkingDelta({ sessionId, text }: { sessionId: string; text: string }) {
  getOrCreateState(sessionId).isProcessing = true;
  appendThinkingDelta(sessionId, text);
}

function onHeadlessThinking({ sessionId, thinking }: { sessionId: string; thinking: boolean }) {
  getOrCreateState(sessionId).isProcessing = true;
  setThinking(sessionId, thinking);
}

function onHeadlessTurnDone({ sessionId }: { sessionId: string }) {
  // HeadlessHandle already persisted messages to DB — skip ChatPanel's DB writes
  // by marking everything as already persisted before calling markDone.
  const state = sessionStates.value.get(sessionId);
  if (state) {
    state.lastPersistedTurnId = state.turnCounter;
  }
  markDone(sessionId);
}

onMounted(() => {
  engineBus.on('agent:textDelta', onHeadlessTextDelta);
  engineBus.on('agent:toolUse', onHeadlessToolUse);
  engineBus.on('agent:thinkingDelta', onHeadlessThinkingDelta);
  engineBus.on('agent:thinking', onHeadlessThinking);
  engineBus.on('agent:turnDone', onHeadlessTurnDone);
});

onUnmounted(() => {
  engineBus.off('agent:textDelta', onHeadlessTextDelta);
  engineBus.off('agent:toolUse', onHeadlessToolUse);
  engineBus.off('agent:thinkingDelta', onHeadlessThinkingDelta);
  engineBus.off('agent:thinking', onHeadlessThinking);
  engineBus.off('agent:turnDone', onHeadlessTurnDone);
});

// Expose methods for parent / engine integration
defineExpose({
  // Multi-session API
  selectSession,
  newChat,
  // Per-session event handlers (sessionId-aware)
  appendTextDelta,
  addToolUse,
  markDone,
  showError,
  setThinking,
  updateCost,
  // Database message loading
  appendDbMessage,
  setLoadingHistory,
  // State access
  activeMessages,
  activeSessionId,
  sessionStates,
  setRealSessionId,
});
</script>
