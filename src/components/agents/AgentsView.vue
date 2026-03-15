<template>
  <div class="flex flex-col h-full">
    <AgentsHeader
      @new-agent="onNewAgent"
      @enter-mission-control="emit('enter-mission-control')"
    />
    <div class="flex flex-1 min-h-0">
      <FleetSidebar @agent-selected="onAgentSelected" />

      <!-- Center: inline file preview OR chat -->
      <div v-if="ui.inlinePreviewFile" class="flex flex-col flex-1 min-w-0">
        <div
          class="flex items-center h-8 px-3 border-b border-border-subtle bg-window cursor-pointer"
          @click="dismissPreview"
        >
          <span class="text-[11px] text-teal">← Back to Chat</span>
          <span class="text-[11px] text-txt-faint mx-2">·</span>
          <span class="text-[11px] text-txt-primary font-medium">{{ previewFileName }}</span>
        </div>
        <CodeViewer ref="inlineViewerRef" class="flex-1 min-h-0" />
      </div>

      <OrchestratorChat
        v-else-if="selectedAgentId"
        :sessionId="selectedAgentId"
        @file-clicked="onLocalFileClicked"
        @send="onSend"
        @stop="onStop"
        @question-answered="onQuestionAnswered"
      />
      <div
        v-else
        class="flex-1 flex flex-col items-center justify-center text-center px-6"
      >
        <svg class="w-6 h-6 mb-2 opacity-30 text-txt-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
        </svg>
        <span class="text-[11px] text-txt-muted">Select an agent to view conversation</span>
        <span class="text-[10px] text-txt-faint mt-1">Or press +New Agent to get started</span>
      </div>
      <AgentsEffectsPanel
        v-if="selectedAgentId && fleetStore.effectsExpanded"
        :sessionId="selectedAgentId"
        @file-clicked="onLocalFileClicked"
        @approve="onApprove"
        @reject="onReject"
      />
      <AgentsEffectsCollapsed v-else-if="selectedAgentId" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';
import { useFleetStore } from '../../stores/fleet';
import { useSessionsStore, getDatabase, getSessionManager } from '../../stores/sessions';
import { useUiStore } from '../../stores/ui';
import { sendMessageToEngine, cancelProcess } from '../../composables/useEngine';
import { engineBus } from '../../engine/EventBus';
import type { AgentHandle, MessageRecord, AttachedImage } from '../../engine/types';
import AgentsHeader from './AgentsHeader.vue';
import FleetSidebar from './FleetSidebar.vue';
import OrchestratorChat from './OrchestratorChat.vue';
import AgentsEffectsPanel from './AgentsEffectsPanel.vue';
import AgentsEffectsCollapsed from './AgentsEffectsCollapsed.vue';
import CodeViewer from '../editor/CodeViewer.vue';

const fleetStore = useFleetStore();
const sessionsStore = useSessionsStore();
const ui = useUiStore();

const emit = defineEmits<{
  'file-clicked': [filePath: string];
  'enter-mission-control': [];
}>();

const selectedAgentId = computed(() => fleetStore.selectedAgentId);

const inlineViewerRef = ref<InstanceType<typeof CodeViewer> | null>(null);

const previewFileName = computed(() => {
  const full = ui.inlinePreviewFile;
  if (!full) return '';
  return full.split('/').pop() ?? full;
});

async function onLocalFileClicked(filePath: string) {
  ui.inlinePreviewFile = filePath;
  ui.currentFile = filePath;
  await nextTick();
  inlineViewerRef.value?.loadFile(filePath);
}

function dismissPreview() {
  ui.dismissInlinePreview();
}

function onAgentSelected(sessionId: string) {
  ui.dismissInlinePreview();
  fleetStore.selectAgent(sessionId);
}

async function onNewAgent() {
  const workspace = ui.workspacePath;
  if (!workspace) return;
  const sessionId = await sessionsStore.createSession(workspace);
  fleetStore.rebuildFromSessions();
  fleetStore.selectAgent(sessionId);
}

// ── Per-session streaming state ──────────────────────────────────────

interface StreamState {
  turnCounter: number;
  currentText: string;
  thinkingText: string;
}

const streamStates = new Map<string, StreamState>();

function getStreamState(sessionId: string): StreamState {
  let s = streamStates.get(sessionId);
  if (!s) {
    const existing = sessionsStore.getMessages(sessionId);
    const maxTurn = existing.reduce((max, m) => Math.max(max, m.turnId), 0);
    s = { turnCounter: maxTurn, currentText: '', thinkingText: '' };
    streamStates.set(sessionId, s);
  }
  return s;
}

// ── AgentHandle adapter: routes engine events → sessionsStore ────────

const storeHandle: AgentHandle = {
  appendTextDelta(sessionId: string, text: string) {
    const state = getStreamState(sessionId);
    state.currentText += text;

    const content = state.thinkingText
      ? `<thinking>${state.thinkingText}</thinking>\n${state.currentText}`
      : state.currentText;

    const msgs = sessionsStore.getMessages(sessionId);
    const last = msgs[msgs.length - 1];
    if (last?.role === 'assistant' && !last.toolName && last.turnId === state.turnCounter) {
      last.content = content;
    } else {
      const msg: MessageRecord = {
        sessionId,
        role: 'assistant',
        content,
        turnId: state.turnCounter,
        timestamp: Math.floor(Date.now() / 1000),
      };
      sessionsStore.addMessage(sessionId, msg);
    }
  },

  appendThinkingDelta(sessionId: string, text: string) {
    const state = getStreamState(sessionId);
    state.thinkingText += text;

    const content = `<thinking>${state.thinkingText}</thinking>`;
    const msgs = sessionsStore.getMessages(sessionId);
    const last = msgs[msgs.length - 1];
    if (last?.role === 'assistant' && !last.toolName && last.turnId === state.turnCounter) {
      last.content = content;
    } else {
      const msg: MessageRecord = {
        sessionId,
        role: 'assistant',
        content,
        turnId: state.turnCounter,
        timestamp: Math.floor(Date.now() / 1000),
      };
      sessionsStore.addMessage(sessionId, msg);
    }
  },

  addToolUse(sessionId: string, toolName: string, summary: string, toolInput?: Record<string, any>, toolId?: string) {
    const state = getStreamState(sessionId);
    state.currentText = '';
    state.thinkingText = '';

    const msg: MessageRecord = {
      sessionId,
      role: 'tool',
      content: summary,
      toolName,
      toolInput: toolInput ? JSON.stringify(toolInput) : undefined,
      toolId,
      turnId: state.turnCounter,
      timestamp: Math.floor(Date.now() / 1000),
    };
    sessionsStore.addMessage(sessionId, msg);
  },

  markDone(sessionId: string) {
    const state = streamStates.get(sessionId);
    if (!state) return;

    state.currentText = '';
    state.thinkingText = '';

    fleetStore.updateAgent({ sessionId, status: 'idle', activity: '' });
    sessionsStore.persistSession(sessionId);
  },

  showError(sessionId: string, error: string) {
    const state = getStreamState(sessionId);
    const msg: MessageRecord = {
      sessionId,
      role: 'assistant',
      content: `**Error:** ${error.replace(/<[^>]*>/g, '')}`,
      turnId: state.turnCounter,
      timestamp: Math.floor(Date.now() / 1000),
    };
    // Push for in-memory UI display only — DB persistence handled by the buffer.
    // Do NOT call markDone — the finished handler is the sole caller.
    sessionsStore.addMessage(sessionId, msg);
  },

  setThinking(sessionId: string, thinking: boolean) {
    if (!thinking) {
      // Thinking ended; thinkingText remains for embedding in the next text message
    }
    void sessionId;
    void thinking;
  },

  setRealSessionId(sessionId: string, realId: string) {
    const info = sessionsStore.sessions.get(sessionId);
    if (info) info.claudeSessionId = realId;
    const mgrInfo = getSessionManager().sessionInfo(sessionId);
    if (mgrInfo) mgrInfo.claudeSessionId = realId;
  },

  onFileEdited(sessionId: string, filePath: string, toolName: string, toolInput?: Record<string, any>) {
    engineBus.emit('agent:fileEdited', { sessionId, filePath, toolName, toolInput });
  },
};

// ── Send / Stop handlers ─────────────────────────────────────────────

async function onSend(message: string, images: AttachedImage[] = []) {
  const sid = selectedAgentId.value;
  if (!sid) return;

  const state = getStreamState(sid);
  state.turnCounter++;
  state.currentText = '';
  state.thinkingText = '';

  const userMsg: MessageRecord = {
    sessionId: sid,
    role: 'user',
    content: message,
    turnId: state.turnCounter,
    timestamp: Math.floor(Date.now() / 1000),
  };
  sessionsStore.addMessage(sid, userMsg);

  const db = getDatabase();
  await db.saveMessage(userMsg);

  fleetStore.updateAgent({ sessionId: sid, status: 'working', activity: 'Sending message...' });

  const info = sessionsStore.sessions.get(sid);
  const workingDir = info?.workspace || ui.workspacePath || '.';

  const engineImages = images.length > 0
    ? images.map(img => ({ data: img.data, mediaType: `image/${img.format}` }))
    : undefined;

  sendMessageToEngine(sid, message, storeHandle, {
    workingDir,
    mode: info?.mode || 'agent',
    model: ui.currentModel,
    resumeSessionId: info?.claudeSessionId,
    images: engineImages,
  });
}

function onStop() {
  const sid = selectedAgentId.value;
  if (sid) {
    cancelProcess(sid);
    fleetStore.updateAgent({ sessionId: sid, status: 'idle', activity: '' });
  }
}

async function onQuestionAnswered(_toolUseId: string, answer: string) {
  const sid = selectedAgentId.value;
  if (!sid) return;

  fleetStore.updateAgent({ sessionId: sid, status: 'working', activity: 'Answering question...' });

  // The claude process is still running, blocked in the MCP server waiting for the answer file.
  // Write the answer file so the MCP handler can return it to Claude and resume the session.
  try {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile('/tmp/angy_answer.json', JSON.stringify({ answer }));
  } catch (e) {
    console.error('[AgentsView] Failed to write answer file:', e);
  }
}

function onApprove() {
  // TODO: wire to engine — approve pending tool use for the selected agent
}

function onReject() {
  // TODO: wire to engine — reject pending tool use for the selected agent
}
</script>
