<template>
  <div class="flex flex-col h-full bg-base">
    <AgentsHeader
      @new-agent="onNewAgent"
      @enter-mission-control="emit('enter-mission-control')"
    />
    <Splitpanes class="flex-1 min-h-0">
      <Pane :size="paneSizes.fleet" :min-size="15" :max-size="20">
        <FleetSidebar @agent-selected="onAgentSelected" />
      </Pane>

      <Pane :size="paneSizes.center" :min-size="30">
        <div class="flex flex-col h-full bg-window">
          <!-- Top: diff / preview / chat / intro -->
          <div class="flex-1 min-h-0 min-w-0 flex flex-col">
            <div v-if="ui.diffView" class="flex flex-col h-full">
              <div
                class="flex items-center h-8 px-3 border-b border-border-subtle bg-window cursor-pointer flex-shrink-0"
                @click="ui.closeDiffView()"
              >
                <span class="text-[11px] text-teal">← Back to Chat</span>
                <span class="text-[11px] text-txt-faint mx-2">·</span>
                <span class="text-[11px] text-txt-primary font-medium">{{ diffFileName }}</span>
              </div>
              <DiffSplitView
                :filePath="ui.diffView.filePath"
                :oldContent="ui.diffView.oldContent"
                :newContent="ui.diffView.newContent"
                :leftLabel="ui.diffView.leftLabel"
                :rightLabel="ui.diffView.rightLabel"
                @close="ui.closeDiffView()"
                class="flex-1 min-h-0"
              />
            </div>
            <div v-else-if="ui.inlinePreviewFile" class="flex flex-col h-full">
              <div
                class="flex items-center h-8 px-3 border-b border-border-subtle bg-window cursor-pointer flex-shrink-0"
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
              :key="selectedAgentId"
              :sessionId="selectedAgentId"
              @file-clicked="onLocalFileClicked"
              @send="onSend"
              @stop="onStop"
              @question-answered="onQuestionAnswered"
            />
            <!-- Introduction panel (no agent selected) -->
            <div v-else class="flex-1 flex flex-col items-center justify-center h-full overflow-y-auto">
              <div class="w-full max-w-md px-8 py-10">

              <!-- Header -->
              <div class="mb-8 text-center">
                <div class="flex items-center justify-center gap-2.5 mb-2">
                  <img src="/angy-new-logo.png" class="w-8 h-8 rounded-lg flex-shrink-0" alt="Angy" />
                  <span class="text-lg font-semibold text-txt-primary">Angy</span>
                </div>
                <p class="text-[12px] text-txt-secondary">AI-powered IDE — Claude as your coding partner</p>
              </div>

              <!-- Steps -->
              <div class="mb-7">
                <p class="text-[10px] font-semibold text-txt-faint uppercase tracking-widest mb-3">How it works</p>
                <div class="flex flex-col gap-2">
                  <div class="flex items-start gap-3 px-3 py-2.5 rounded-lg border border-border-subtle bg-raised/30">
                    <span class="w-5 h-5 rounded-full bg-ember/15 text-ember text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-px">1</span>
                    <div>
                      <p class="text-[12px] font-medium text-txt-primary">Create a Project</p>
                      <p class="text-[11px] text-txt-muted mt-0.5">Go to <span class="text-txt-secondary font-medium">Projects</span> and link a local git repo</p>
                    </div>
                  </div>
                  <div class="flex items-start gap-3 px-3 py-2.5 rounded-lg border border-border-subtle bg-raised/30">
                    <span class="w-5 h-5 rounded-full bg-ember/15 text-ember text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-px">2</span>
                    <div>
                      <p class="text-[12px] font-medium text-txt-primary">Plan work on the Board</p>
                      <p class="text-[11px] text-txt-muted mt-0.5">Add <span class="text-txt-secondary font-medium">Epics</span> — each one is a task or feature for Claude</p>
                    </div>
                  </div>
                  <div class="flex items-start gap-3 px-3 py-2.5 rounded-lg border border-border-subtle bg-raised/30">
                    <span class="w-5 h-5 rounded-full bg-ember/15 text-ember text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-px">3</span>
                    <div>
                      <p class="text-[12px] font-medium text-txt-primary">Chat with an Agent</p>
                      <p class="text-[11px] text-txt-muted mt-0.5">Claude reads code, edits files, and runs commands autonomously</p>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Nav guide -->
              <div class="mb-8">
                <p class="text-[10px] font-semibold text-txt-faint uppercase tracking-widest mb-3">Navigation</p>
                <div class="grid grid-cols-2 gap-1.5">
                  <div class="flex items-start gap-2 px-2.5 py-2 rounded-md bg-raised/20 border border-border-subtle/50">
                    <svg class="w-3.5 h-3.5 text-txt-muted mt-px flex-shrink-0" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zm0 9.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zm9.75-9.75A2.25 2.25 0 0115.75 3.75H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zm0 9.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25a2.25 2.25 0 01-2.25-2.25v-2.25z" /></svg>
                    <div>
                      <p class="text-[11px] font-medium text-txt-secondary">Projects</p>
                      <p class="text-[10px] text-txt-faint leading-snug">Manage repos &amp; workspace</p>
                    </div>
                  </div>
                  <div class="flex items-start gap-2 px-2.5 py-2 rounded-md bg-raised/20 border border-border-subtle/50">
                    <svg class="w-3.5 h-3.5 text-txt-muted mt-px flex-shrink-0" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125z" /></svg>
                    <div>
                      <p class="text-[11px] font-medium text-txt-secondary">Board</p>
                      <p class="text-[10px] text-txt-faint leading-snug">Kanban view for epics</p>
                    </div>
                  </div>
                  <div class="flex items-start gap-2 px-2.5 py-2 rounded-md bg-raised/20 border border-border-subtle/50">
                    <svg class="w-3.5 h-3.5 text-txt-muted mt-px flex-shrink-0" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
                    <div>
                      <p class="text-[11px] font-medium text-txt-secondary">Agents</p>
                      <p class="text-[10px] text-txt-faint leading-snug">Chat with Claude agents</p>
                    </div>
                  </div>
                  <div class="flex items-start gap-2 px-2.5 py-2 rounded-md bg-raised/20 border border-border-subtle/50">
                    <svg class="w-3.5 h-3.5 text-txt-muted mt-px flex-shrink-0" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" /></svg>
                    <div>
                      <p class="text-[11px] font-medium text-txt-secondary">Code</p>
                      <p class="text-[10px] text-txt-faint leading-snug">Browse &amp; edit the codebase</p>
                    </div>
                  </div>
                  <div class="flex items-start gap-2 px-2.5 py-2 rounded-md bg-raised/20 border border-border-subtle/50 col-span-2">
                    <svg class="w-3.5 h-3.5 text-txt-muted mt-px flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>
                    <div>
                      <p class="text-[11px] font-medium text-txt-secondary">Git</p>
                      <p class="text-[10px] text-txt-faint leading-snug">Visual diff viewer &amp; branch switcher</p>
                    </div>
                  </div>
                </div>
              </div>

              <!-- CTA -->
              <div class="flex justify-center">
                <button
                  class="px-5 py-2 text-[12px] font-medium rounded-lg bg-ember text-white hover:brightness-110 transition-all"
                  @click="onNewAgent"
                >
                  + New Agent
                </button>
              </div>

              </div>
            </div>
          </div>

          <!-- Bottom: terminal panel (shown when terminalVisible) -->
          <div
            v-show="ui.terminalVisible"
            class="flex-shrink-0 border-t border-border-subtle h-[35%]"
          >
            <TerminalPanel :workingDirectory="ui.workspacePath || '.'" @close="ui.toggleTerminal()" />
          </div>
        </div>
      </Pane>

      <Pane :size="paneSizes.effects" :min-size="effectsPaneMin" :max-size="effectsPaneMax">
        <AgentsEffectsPanel
          v-if="selectedAgentId && fleetStore.effectsExpanded"
          :sessionId="selectedAgentId"
          @file-clicked="onLocalFileClicked"
          @diff-requested="onDiffRequested"
          @approve="onApprove"
          @reject="onReject"
        />
        <AgentsEffectsCollapsed v-else-if="selectedAgentId" />
      </Pane>
    </Splitpanes>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useFleetStore } from '../../stores/fleet';
import { useSessionsStore, getDatabase, getSessionManager } from '../../stores/sessions';
import { useUiStore } from '../../stores/ui';
import { useEpicStore } from '../../stores/epics';
import { useProjectsStore } from '../../stores/projects';
import { useFilterStore } from '../../stores/filter';
import { sendMessageToEngine, cancelProcess, isAngyCodeModel, sendAngyCodeMessage, cancelAngyCodeProcess } from '../../composables/useEngine';
import { engineBus } from '../../engine/EventBus';
import type { AgentHandle, MessageRecord, AttachedImage } from '../../engine/types';
import AgentsHeader from './AgentsHeader.vue';
import FleetSidebar from './FleetSidebar.vue';
import OrchestratorChat from './OrchestratorChat.vue';
import AgentsEffectsPanel from './AgentsEffectsPanel.vue';
import AgentsEffectsCollapsed from './AgentsEffectsCollapsed.vue';
import TerminalPanel from '../terminal/TerminalPanel.vue';
import CodeViewer from '../editor/CodeViewer.vue';
import DiffSplitView from '../editor/DiffSplitView.vue';
import { Splitpanes, Pane } from 'splitpanes';
import { useGitStore } from '../../stores/git';

const fleetStore = useFleetStore();
const sessionsStore = useSessionsStore();
const ui = useUiStore();
const epicStore = useEpicStore();
const projectsStore = useProjectsStore();
const filterStore = useFilterStore();

const emit = defineEmits<{
  'file-clicked': [filePath: string];
  'enter-mission-control': [];
}>();

const selectedAgentId = computed(() => fleetStore.selectedAgentId);

// ── Stable pane sizes (always 3 panes to avoid Splitpanes redistribution) ──

const effectsPaneMin = computed(() => {
  if (!selectedAgentId.value) return 0;
  return fleetStore.effectsExpanded ? 15 : 3;
});
const effectsPaneMax = computed(() => {
  if (!selectedAgentId.value) return 0;
  return fleetStore.effectsExpanded ? 30 : 3;
});
const paneSizes = computed(() => {
  if (!selectedAgentId.value) {
    // No agent selected: effects pane collapses to 0, fleet + center fill space
    return { fleet: 20, center: 80, effects: 0 };
  }
  if (fleetStore.effectsExpanded) {
    return { fleet: 20, center: 60, effects: 20 };
  }
  // Effects collapsed to thin strip
  return { fleet: 20, center: 77, effects: 3 };
});

// Force Splitpanes to re-read size props when the layout changes.
// Without this, the library can drift from intended sizes after
// the effects pane toggles between 0 and 20%.
watch(
  [() => paneSizes.value, () => effectsPaneMin.value, () => effectsPaneMax.value],
  async () => {
    await nextTick();
    window.dispatchEvent(new Event('resize'));
  },
);

const inlineViewerRef = ref<InstanceType<typeof CodeViewer> | null>(null);
const gitStore = useGitStore();

const diffFileName = computed(() => {
  const full = ui.diffView?.filePath;
  if (!full) return '';
  return full.split('/').pop() ?? full;
});

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

function onDiffRequested(filePath: string) {
  // Convert absolute path to relative for git
  const workspace = ui.workspacePath;
  const relativePath = workspace && filePath.startsWith(workspace + '/')
    ? filePath.slice(workspace.length + 1)
    : filePath;
  gitStore.manager.requestFileDiff(relativePath, false);
}

function onAgentSelected(sessionId: string) {
  ui.dismissInlinePreview();
  fleetStore.selectAgent(sessionId);
}

async function onNewAgent() {
  // Prefer the first repo of the active project so the session resolves to the
  // correct project group in the fleet sidebar. Fall back to the global workspace.
  const activeProjectId = filterStore.selectedProjectIds[0];
  const projectRepo = activeProjectId
    ? projectsStore.reposByProjectId(activeProjectId)[0]?.path
    : null;
  const workspace = projectRepo || ui.workspacePath || '.';
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

async function onSend(message: string, images: AttachedImage[] = [], model?: string) {
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

  // For orchestrator sessions (hybrid/fix/plan), the root session never runs Claude
  // directly so claudeSessionId is never set. Try to restore the last child's
  // Claude session so the follow-up has full context. Fall back to context injection
  // if no child session is available.
  let effectiveMessage = message;
  let resumeSessionId = info?.claudeSessionId;

  if (!resumeSessionId) {
    const children = fleetStore.hierarchicalAgents.filter(a => a.parentSessionId === sid);
    for (let i = children.length - 1; i >= 0; i--) {
      const childInfo = sessionsStore.sessions.get(children[i].sessionId);
      if (childInfo?.claudeSessionId) {
        resumeSessionId = childInfo.claudeSessionId;
        break;
      }
    }
  }

  if (!resumeSessionId && info?.epicId) {
    const epic = epicStore.epicById(info.epicId);
    if (epic) {
      const parts: string[] = [];
      parts.push(`# Epic: ${epic.title}`);
      if (epic.description) parts.push(`## Description\n${epic.description}`);
      if (epic.lastArchitectPlan) parts.push(`## Architect Plan\n${epic.lastArchitectPlan}`);
      const priorMessages = sessionsStore.getMessages(sid).filter(
        m => (m.role === 'user' || m.role === 'assistant') && !m.toolName,
      );
      if (priorMessages.length > 0) {
        const history = priorMessages
          .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
          .join('\n\n');
        parts.push(`## Prior Conversation\n${history}`);
      }
      parts.push(`## User Follow-up\n${message}`);
      effectiveMessage = parts.join('\n\n');
    }
  }

  const effectiveModel = model ?? ui.currentModel;
  if (isAngyCodeModel(effectiveModel)) {
    // Convert images to the format expected by AngyCode server
    const angyImages = engineImages
      ? engineImages.map(img => ({ data: img.data, mimeType: img.mediaType }))
      : undefined;
    
    // Determine provider and api key
    const provider = effectiveModel.includes('gemini') ? 'gemini' : 'anthropic';
    const apiKey = provider === 'gemini' ? ui.geminiApiKey : ui.anthropicApiKey;
    
    try {
      await sendAngyCodeMessage({
        sessionId: sid,
        workingDir,
        goal: effectiveMessage,
        provider,
        apiKey,
        model: effectiveModel.replace(/^angy-/, ''),
        images: angyImages,
      }, storeHandle);
    } catch (err) {
      storeHandle.showError(sid, err instanceof Error ? err.message : String(err));
      storeHandle.markDone(sid);
    }
  } else {
    sendMessageToEngine(sid, effectiveMessage, storeHandle, {
      workingDir,
      mode: info?.mode || 'agent',
      model: effectiveModel,
      resumeSessionId,
      images: engineImages,
    });
  }
}

function onStop() {
  const sid = selectedAgentId.value;
  if (sid) {
    if (isAngyCodeModel(ui.currentModel)) {
      cancelAngyCodeProcess(sid);
    } else {
      cancelProcess(sid);
    }
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
