<template>
  <div class="flex flex-col h-full bg-base flex-1 min-w-0">
    <!-- Agent header bar -->
    <div class="px-5 py-3 border-b border-border-subtle flex items-center gap-3">
      <div
        class="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
        :class="isOrchestrator ? 'bg-gradient-to-br from-purple-500/30 to-purple-600/30' : 'bg-gradient-to-br from-teal/30 to-emerald-500/30'"
      >
        <svg v-if="isOrchestrator" class="w-3.5 h-3.5 text-purple-400" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
        </svg>
        <svg v-else class="w-3.5 h-3.5 text-teal" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
        </svg>
      </div>
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-sm font-semibold text-txt-primary truncate">
            {{ selectedAgent?.title || 'Select an agent' }}
          </span>
          <span v-if="isOrchestrator" class="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 flex-shrink-0">orchestrator</span>
          <span v-else class="text-[10px] px-1.5 py-0.5 rounded bg-teal/10 text-teal flex-shrink-0">agent</span>
          <span v-if="selectedAgent?.status === 'working'" class="text-[10px] px-1.5 py-0.5 rounded bg-teal/10 text-teal flex-shrink-0">running</span>
          <span v-else-if="selectedAgent?.status === 'done'" class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 flex-shrink-0">done</span>
          <span v-else-if="selectedAgent?.status === 'error'" class="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 flex-shrink-0">failed</span>
        </div>
        <div v-if="epicInfo" class="flex items-center gap-2 mt-0.5">
          <span class="text-[10px] text-txt-muted">{{ epicInfo.projectName }}</span>
          <span class="text-txt-faint text-[10px]">›</span>
          <span class="text-[10px] text-txt-muted">{{ epicInfo.epicTitle }}</span>
          <span class="text-txt-faint text-[10px]">·</span>
          <span class="text-[10px] text-txt-faint">{{ childAgents.length }} sub-agents</span>
        </div>
      </div>
      <span class="flex-1" />
      <span v-if="selectedAgent?.costUsd" class="text-[10px] text-txt-faint">${{ selectedAgent.costUsd.toFixed(2) }} total</span>
      <span v-if="selectedAgent?.costUsd" class="text-[10px] text-txt-faint">·</span>
      <span class="text-[10px] text-txt-faint">{{ elapsedTime }}</span>
      <button
        v-if="isProcessing"
        class="text-[10px] text-txt-faint hover:text-red-400 transition-colors px-2 py-1 rounded hover:bg-red-500/10"
        @click="$emit('stop')"
      >Stop All</button>
    </div>

    <!-- Scrollable hierarchical conversation -->
    <div
      ref="scrollEl"
      class="flex-1 overflow-y-auto px-5 py-4 space-y-5"
    >
      <!-- No session selected -->
      <div v-if="!sessionId" class="flex flex-col items-center justify-center h-full text-center px-6">
        <svg class="w-6 h-6 mb-2 opacity-30 text-txt-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
        <span class="text-[11px] text-txt-muted">Select an agent to view conversation</span>
      </div>

      <!-- Loading -->
      <div v-else-if="loading" class="flex flex-col items-center justify-center h-full">
        <div class="w-6 h-6 border-2 border-teal border-t-transparent rounded-full animate-spin" />
        <span class="text-[11px] text-txt-muted mt-2">Loading messages...</span>
      </div>

      <!-- Interleaved timeline -->
      <template v-else-if="timeline.length > 0">
        <template v-for="(item, idx) in timeline" :key="idx">

          <!-- ── Text message (user or assistant) ── -->
          <div v-if="item.type === 'orchestrator-message'" class="tree-node anim-fade-in">
            <div class="flex items-center gap-2 mb-1.5">
              <!-- User message -->
              <template v-if="item.message!.role === 'user'">
                <div class="w-5 h-5 rounded-lg bg-ember-500/20 flex items-center justify-center flex-shrink-0">
                  <svg class="w-2.5 h-2.5 text-ember-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" />
                  </svg>
                </div>
                <span class="text-xs font-medium text-ember-400">You</span>
              </template>
              <!-- Assistant message -->
              <template v-else>
                <div class="w-5 h-5 rounded-lg bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                  <svg class="w-2.5 h-2.5 text-purple-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                  </svg>
                </div>
                <span class="text-xs font-medium text-purple-400">Claude</span>
              </template>
              <span v-if="item.message!.timestamp" class="text-[10px] text-txt-faint">{{ relativeTime(item.message!.timestamp) }}</span>
            </div>
            <div class="ml-7 space-y-2">
              <!-- Thinking blocks (extracted, collapsible) -->
              <details
                v-for="(think, ti) in getThinkingBlocks(item.message!.content)"
                :key="'think-' + ti"
                class="group"
              >
                <summary class="flex items-center gap-2 cursor-pointer text-[11px] text-txt-faint hover:text-txt-secondary transition-colors">
                  <svg class="w-2.5 h-2.5 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
                  Thinking
                </summary>
                <div class="mt-1.5 p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[11px] text-txt-secondary font-mono whitespace-pre-wrap max-h-64 overflow-y-auto leading-relaxed">{{ think }}</div>
              </details>
              <!-- Text content (markdown rendered) -->
              <div
                v-if="getTextContent(item.message!.content)"
                class="md-content text-[13px] text-txt-primary leading-relaxed"
                v-html="renderMd(item.message!.content)"
              />
            </div>
          </div>

          <!-- ── Orchestrator tool calls (grouped summary with diffs) ── -->
          <ToolCallGroup
            v-else-if="item.type === 'orchestrator-tools'"
            class="tree-node anim-fade-in"
            :calls="item.toolCalls ?? []"
            :expanded-by-default="item.hasEdits"
            @file-clicked="(path: string) => $emit('file-clicked', path)"
          />

          <!-- ── Sub-agent branch ── -->
          <TreeBranch
            v-else-if="item.type === 'sub-agent'"
            :agent="item.agent!"
            :messages="getAgentMessages(item.agent!.sessionId)"
            :depth="0"
            @file-clicked="(path: string) => $emit('file-clicked', path)"
          />
        </template>
      </template>

      <!-- Empty conversation -->
      <div v-else class="flex flex-col items-center justify-center h-full text-center px-6">
        <template v-if="isProcessing">
          <div class="w-6 h-6 border-2 border-teal border-t-transparent rounded-full animate-spin mb-2" />
          <span class="text-[11px] text-txt-muted">Starting agents...</span>
        </template>
        <template v-else>
          <svg class="w-6 h-6 mb-2 opacity-30 text-txt-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
          <span class="text-[11px] text-txt-muted">No messages yet</span>
          <span class="text-[10px] text-txt-faint mt-1">Send a message to get started</span>
        </template>
      </div>
    </div>

    <!-- Input bar -->
    <ChatInputBar
      v-if="!isAutoSpawned"
      :processing="isProcessing"
      @send="(msg: string, imgs: any[]) => $emit('send', msg, imgs)"
      @stop="$emit('stop')"
    />
    <div v-else class="py-3 text-center text-[11px] text-txt-muted border-t border-border-subtle">
      This agent is managed by the Scheduler
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { useFleetStore, type HierarchicalAgent } from '../../stores/fleet';
import { useSessionsStore, getDatabase } from '../../stores/sessions';
import { useProjectsStore } from '../../stores/projects';
import { useEpicStore } from '../../stores/epics';
import { engineBus } from '../../engine/EventBus';
import type { MessageRecord } from '../../engine/types';
import { renderMarkdown } from '../../utils/renderMarkdown';
import TreeBranch from './TreeBranch.vue';
import ChatInputBar from './ChatInputBar.vue';
import ToolCallGroup from '../chat/ToolCallGroup.vue';
import type { ToolCallInfo } from '../chat/ToolCallGroup.vue';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'StrReplace', 'MultiEdit', 'NotebookEdit']);

interface TimelineItem {
  type: 'orchestrator-message' | 'orchestrator-tools' | 'sub-agent';
  message?: MessageRecord;
  agent?: HierarchicalAgent;
  timestamp: number;
  toolCalls?: ToolCallInfo[];
  toolCount?: number;
  toolSummary?: string;
  hasEdits?: boolean;
}

const props = defineProps<{
  sessionId: string;
}>();

defineEmits<{
  'file-clicked': [filePath: string];
  send: [message: string, images: { data: string; format: string; displayName: string }[]];
  stop: [];
}>();

const fleetStore = useFleetStore();
const sessionsStore = useSessionsStore();
const projectsStore = useProjectsStore();
const epicStore = useEpicStore();
const scrollEl = ref<HTMLElement | null>(null);
const loading = ref(false);

// ── Per-child streaming state ────────────────────────────────────────────
// Tracks in-progress text/thinking for each child session so we can
// update the sessionsStore reactively as HeadlessHandle streams output.

interface ChildStreamState {
  turnCounter: number;
  currentText: string;
  thinkingText: string;
}

const childStreamStates = new Map<string, ChildStreamState>();

function getChildStreamState(sessionId: string): ChildStreamState {
  let s = childStreamStates.get(sessionId);
  if (!s) {
    const existing = sessionsStore.getMessages(sessionId);
    const maxTurn = existing.reduce((max, m) => Math.max(max, m.turnId ?? 0), 0);
    s = { turnCounter: maxTurn, currentText: '', thinkingText: '' };
    childStreamStates.set(sessionId, s);
  }
  return s;
}

async function loadChildMessagesFromDb(sessionIds: string[]) {
  if (sessionIds.length === 0) return;
  const db = getDatabase();
  await Promise.all(
    sessionIds.map(async (sid) => {
      const msgs = await db.loadMessages(sid);
      if (msgs.length > 0) {
        sessionsStore.setMessages(sid, msgs);
      }
    }),
  );
}

// Load orchestrator + child messages when the selected session changes
watch(() => props.sessionId, async (sessionId) => {
  if (!sessionId) return;
  childStreamStates.clear();

  loading.value = true;
  try {
    const db = getDatabase();

    const msgs = await db.loadMessages(sessionId);
    if (msgs.length > 0) {
      sessionsStore.setMessages(sessionId, msgs);
    }

    const children = fleetStore.hierarchicalAgents.filter(
      (a) => a.parentSessionId === sessionId,
    );
    await loadChildMessagesFromDb(children.map(c => c.sessionId));
  } finally {
    loading.value = false;
  }
}, { immediate: true });

const selectedAgent = computed(() =>
  fleetStore.agents.find((a) => a.sessionId === props.sessionId),
);

const isOrchestrator = computed(() =>
  selectedAgent.value?.mode === 'orchestrator',
);

const isProcessing = computed(() =>
  selectedAgent.value?.status === 'working',
);

const isAutoSpawned = computed(() => {
  const session = sessionsStore.sessions.get(props.sessionId);
  return !!session?.epicId;
});

const messages = computed((): MessageRecord[] =>
  sessionsStore.getMessages(props.sessionId),
);

const childAgents = computed(() =>
  fleetStore.hierarchicalAgents.filter(
    (a) => a.parentSessionId === props.sessionId,
  ),
);

const childSessionIdSet = computed(() =>
  new Set(childAgents.value.map(a => a.sessionId)),
);

// ── Watch for late-arriving children ──────────────────────────────────────
// Children are created AFTER the orchestrator, so the initial load may
// miss them. Whenever a new child appears, load its messages from DB.

const knownChildIds = ref<Set<string>>(new Set());

watch(
  () => childAgents.value.map(a => a.sessionId),
  async (ids) => {
    const newIds = ids.filter(id => !knownChildIds.value.has(id));
    knownChildIds.value = new Set(ids);
    if (newIds.length > 0) {
      await loadChildMessagesFromDb(newIds);
    }
  },
);

// ── Headless streaming bridge ────────────────────────────────────────────
// HeadlessHandle emits events on engineBus. We listen and route them
// into the sessionsStore so TreeBranch can render live output.

function isRelevantChild(sessionId: string): boolean {
  return childSessionIdSet.value.has(sessionId);
}

function onTextDelta({ sessionId, text }: { sessionId: string; text: string }) {
  if (!isRelevantChild(sessionId)) return;

  const state = getChildStreamState(sessionId);
  state.currentText += text;

  const content = state.thinkingText
    ? `<thinking>${state.thinkingText}</thinking>\n${state.currentText}`
    : state.currentText;

  const msgs = sessionsStore.getMessages(sessionId);
  const last = msgs[msgs.length - 1];
  if (last?.role === 'assistant' && !last.toolName && last.turnId === state.turnCounter) {
    last.content = content;
  } else {
    sessionsStore.addMessage(sessionId, {
      sessionId,
      role: 'assistant',
      content,
      turnId: state.turnCounter,
      timestamp: Math.floor(Date.now() / 1000),
    });
  }
}

function onToolUse({ sessionId, toolName, summary, toolInput }: {
  sessionId: string; toolName: string; summary: string; toolInput?: Record<string, any>;
}) {
  if (!isRelevantChild(sessionId)) return;

  const state = getChildStreamState(sessionId);
  state.currentText = '';
  state.thinkingText = '';

  sessionsStore.addMessage(sessionId, {
    sessionId,
    role: 'tool',
    content: summary,
    toolName,
    toolInput: toolInput ? JSON.stringify(toolInput) : undefined,
    turnId: state.turnCounter,
    timestamp: Math.floor(Date.now() / 1000),
  });
}

function onThinkingDelta({ sessionId, text }: { sessionId: string; text: string }) {
  if (!isRelevantChild(sessionId)) return;
  getChildStreamState(sessionId).thinkingText += text;
}

async function onTurnDone({ sessionId }: { sessionId: string }) {
  if (!isRelevantChild(sessionId) && sessionId !== props.sessionId) return;

  // Reset streaming state and reload canonical data from DB
  childStreamStates.delete(sessionId);

  const db = getDatabase();
  const msgs = await db.loadMessages(sessionId);
  sessionsStore.setMessages(sessionId, msgs);
}

onMounted(() => {
  engineBus.on('agent:textDelta', onTextDelta);
  engineBus.on('agent:toolUse', onToolUse);
  engineBus.on('agent:thinkingDelta', onThinkingDelta);
  engineBus.on('agent:turnDone', onTurnDone);
});

onUnmounted(() => {
  engineBus.off('agent:textDelta', onTextDelta);
  engineBus.off('agent:toolUse', onToolUse);
  engineBus.off('agent:thinkingDelta', onThinkingDelta);
  engineBus.off('agent:turnDone', onTurnDone);
  childStreamStates.clear();
});

const epicInfo = computed(() => {
  const agent = selectedAgent.value;
  if (!agent) return null;
  const epic = epicStore.epics.find(e => e.rootSessionId === props.sessionId);
  if (!epic) return null;
  const project = projectsStore.projects.find(p => p.id === epic.projectId);
  return {
    projectName: project?.name ?? 'Unknown',
    epicTitle: epic.title,
  };
});

const elapsedTime = computed(() => {
  const agent = selectedAgent.value;
  if (!agent?.updatedAt) return '';
  const tsMs = agent.updatedAt < 1e12 ? agent.updatedAt * 1000 : agent.updatedAt;
  const ms = Date.now() - tsMs;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
});

function getAgentMessages(agentSessionId: string): MessageRecord[] {
  return sessionsStore.getMessages(agentSessionId);
}

// ── Thinking block extraction ─────────────────────────────────────────────

const THINKING_RE = /<thinking>([\s\S]*?)<\/thinking>/g;

function getThinkingBlocks(content: string): string[] {
  if (!content) return [];
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(THINKING_RE.source, 'g');
  while ((match = re.exec(content)) !== null) {
    const trimmed = match[1].trim();
    if (trimmed) blocks.push(trimmed);
  }
  return blocks;
}

function getTextContent(content: string): string {
  if (!content) return '';
  return content.replace(THINKING_RE, '').trim();
}

function renderMd(text: string): string {
  const cleaned = getTextContent(text);
  if (!cleaned) return '';
  return renderMarkdown(cleaned);
}

function relativeTime(ts: number): string {
  const tsMs = ts < 1e12 ? ts * 1000 : ts;
  const diff = Math.floor((Date.now() - tsMs) / 1000);
  if (diff < 60) return 'just now';
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}

// ── Timeline: groups messages into orchestrator text, decisions, tool
//    summaries, and sub-agent branches, sorted chronologically ─────────────

function parseToolEntry(msg: MessageRecord): ToolCallInfo {
  let filePath: string | undefined;
  let summary: string | undefined;
  let isEdit = false;
  let oldString: string | undefined;
  let newString: string | undefined;
  try {
    const input = msg.toolInput ? JSON.parse(msg.toolInput) : {};
    filePath = input.file_path || input.filePath || input.path;
    summary = input.command || input.query || input.task;
    if (msg.toolName && EDIT_TOOLS.has(msg.toolName)) {
      isEdit = true;
      oldString = input.old_string;
      newString = input.new_string ?? input.content ?? input.contents;
    }
  } catch { /* ignore */ }
  return { toolName: msg.toolName!, filePath, summary, isEdit, oldString, newString };
}

const timeline = computed((): TimelineItem[] => {
  const items: TimelineItem[] = [];
  let pendingTools: { msg: MessageRecord; entry: ToolCallInfo }[] = [];

  function flushTools() {
    if (pendingTools.length === 0) return;
    const entries = pendingTools.map(t => t.entry);
    const counts: Record<string, number> = {};
    for (const e of entries) counts[e.toolName] = (counts[e.toolName] ?? 0) + 1;
    const summaryParts = Object.entries(counts).map(([name, n]) =>
      n > 1 ? `${name} ×${n}` : name,
    );
    const hasEdits = entries.some(e => e.isEdit);

    items.push({
      type: 'orchestrator-tools',
      timestamp: pendingTools[0].msg.timestamp ?? Date.now(),
      toolCalls: entries,
      toolCount: entries.length,
      toolSummary: summaryParts.join(', '),
      hasEdits,
    });
    pendingTools = [];
  }

  const msgs = messages.value;
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i];
    const isToolCall = !!msg.toolName && (msg.role === 'assistant' || msg.role === 'tool');

    if (isToolCall) {
      pendingTools.push({ msg, entry: parseToolEntry(msg) });
      continue;
    }

    // Skip bare tool-result messages (role='tool' without toolName)
    if (msg.role === 'tool') continue;

    // Skip short assistant narration between tool calls (mid-sequence only)
    if (msg.role === 'assistant' && pendingTools.length > 0) {
      const text = getTextContent(msg.content);
      if (text.length < 200) {
        continue;
      }
    }

    flushTools();

    if (msg.role === 'assistant' || msg.role === 'user') {
      items.push({
        type: 'orchestrator-message',
        message: msg,
        timestamp: msg.timestamp ?? Date.now(),
      });
    }
  }

  flushTools();

  for (const agent of childAgents.value) {
    items.push({
      type: 'sub-agent',
      agent,
      timestamp: agent.updatedAt ? (agent.updatedAt < 1e12 ? agent.updatedAt * 1000 : agent.updatedAt) : Date.now(),
    });
  }

  items.sort((a, b) => a.timestamp - b.timestamp);
  return items;
});

const totalMessageCount = computed(() => {
  let count = messages.value.length;
  for (const agent of childAgents.value) {
    count += sessionsStore.getMessages(agent.sessionId).length;
  }
  return count;
});

watch(totalMessageCount, () => {
  nextTick(() => {
    scrollEl.value?.scrollTo({
      top: scrollEl.value.scrollHeight,
      behavior: 'smooth',
    });
  });
});
</script>

<style scoped>
.orch-decision :deep(.agent-code) {
  font-size: 10px;
  font-family: var(--font-mono);
  background: rgba(139, 92, 246, 0.1);
  padding: 1px 4px;
  border-radius: 3px;
  color: #c4b5fd;
}
.orch-decision :deep(strong) {
  font-weight: 600;
  color: #e9d5ff;
}
</style>
