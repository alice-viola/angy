<template>
  <div class="flex flex-col h-full bg-[var(--bg-base)]">
    <!-- Messages area -->
    <div ref="scrollEl" class="flex-1 overflow-y-auto px-3 py-3 space-y-2 min-h-0">
      <div v-if="messages.length === 0 && !isProcessing" class="flex flex-col items-center justify-center h-full text-center px-4">
        <span class="text-[11px] text-txt-muted">Send a message to start coding</span>
      </div>
      <template v-for="item in groupedItems" :key="item.id">
        <ToolCallGroup
          v-if="item.type === 'tool-group'"
          :calls="item.calls"
          :expanded-by-default="item.expandedByDefault"
          @file-clicked="(fp: string) => $emit('file-clicked', fp)"
        />
        <div v-else-if="item.msg.role === 'user'" class="bg-[var(--bg-raised)] rounded-lg px-3 py-2">
          <div class="text-[11px] text-txt-primary whitespace-pre-wrap break-words leading-relaxed">{{ item.msg.content }}</div>
        </div>
        <div v-else-if="item.msg.role === 'assistant'" class="py-1">
          <div class="compact-markdown text-[11px] text-txt-secondary leading-relaxed" v-html="renderMd(item.msg.content)" />
        </div>
      </template>
      <div v-if="isProcessing && !currentText" class="flex items-center gap-2 py-2">
        <div class="w-4 h-4 border-2 border-[var(--accent-mauve)] border-t-transparent rounded-full animate-spin" />
        <span class="text-[10px] text-txt-muted">Thinking...</span>
      </div>
    </div>

    <!-- Input area -->
    <div class="border-t border-[var(--border-subtle)]">
      <!-- Image thumbnails -->
      <div v-if="images.length > 0" class="flex gap-1.5 px-3 pt-2">
        <div v-for="(img, i) in images" :key="i" class="relative w-10 h-10 rounded overflow-hidden border border-[var(--border-subtle)]">
          <img :src="'data:image/' + img.format + ';base64,' + img.data" class="w-full h-full object-cover" />
          <button @click="images.splice(i, 1)" class="absolute top-0 right-0 bg-black/50 text-white text-[8px] px-0.5 hover:bg-black/70">×</button>
        </div>
      </div>

      <!-- Textarea -->
      <div class="px-3 pt-2 pb-1">
        <div class="relative bg-[var(--bg-raised)] rounded-md border border-[var(--border-subtle)]">
          <textarea
            ref="inputEl"
            v-model="inputText"
            @keydown="onKeydown"
            @paste="onPaste"
            placeholder="Send a message..."
            rows="1"
            autocapitalize="none"
            autocomplete="off"
            autocorrect="off"
            spellcheck="false"
            :disabled="isProcessing"
            class="w-full bg-transparent text-[11px] text-txt-primary px-2.5 py-1.5 resize-none outline-none ring-0 min-h-[28px] max-h-[100px]"
            :style="{ height: textareaHeight + 'px' }"
          />
        </div>
      </div>

      <!-- Footer: selectors + actions -->
      <div class="flex items-center justify-between px-3 pb-2 pt-1">
        <div class="flex items-center gap-1">
          <!-- Mode dropdown -->
          <div class="relative" ref="modeRoot">
            <button
              @click="modeOpen = !modeOpen"
              class="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md text-txt-muted hover:text-txt-secondary hover:bg-raised transition-colors"
            >
              <svg class="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
                <template v-if="currentMode === 'agent'">
                  <circle cx="8" cy="5" r="3" /><path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" />
                </template>
                <template v-else-if="currentMode === 'plan'">
                  <path d="M4 3h8M4 6.5h8M4 10h5" /><circle cx="12" cy="12" r="2.5" />
                </template>
                <template v-else>
                  <circle cx="8" cy="8" r="6" /><path d="M6.5 6.5a1.8 1.8 0 013 1.3c0 1.2-1.5 1.2-1.5 2.2M8 12.5v.01" />
                </template>
              </svg>
              <span class="capitalize">{{ currentMode }}</span>
              <svg class="w-2 h-2 opacity-50" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2.5 4L5 6.5L7.5 4"/></svg>
            </button>
            <div
              v-if="modeOpen"
              class="absolute bottom-full left-0 mb-1 bg-raised border border-border-standard rounded-lg shadow-lg overflow-hidden z-20 min-w-[140px]"
            >
              <div
                v-for="mode in modes"
                :key="mode.id"
                @click="selectMode(mode.id)"
                class="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-white/[0.05] transition-colors"
                :class="mode.id === currentMode ? 'text-ember' : ''"
              >
                <div>
                  <div class="text-[11px] text-txt-primary">{{ mode.label }}</div>
                  <div class="text-[9px] text-txt-faint">{{ mode.desc }}</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Model dropdown -->
          <div class="relative" ref="modelRoot">
            <button
              @click="toggleModelOpen"
              class="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md text-txt-muted hover:text-txt-secondary hover:bg-raised transition-colors"
            >
              <svg class="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
                <rect x="2" y="3" width="12" height="10" rx="2" /><path d="M5 7h6M5 9.5h4" />
              </svg>
              <span>{{ modelShortName }}</span>
              <svg class="w-2 h-2 opacity-50" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2.5 4L5 6.5L7.5 4"/></svg>
            </button>
            <Teleport to="body">
              <div
                v-if="modelOpen"
                :style="modelDropdownStyle"
                class="fixed bg-raised border border-border-standard rounded-lg shadow-lg overflow-hidden z-[200] min-w-[160px] max-h-96 overflow-y-auto"
              >
                <template v-for="(group, gIdx) in modelGroups" :key="gIdx">
                  <div class="px-3 pt-2 pb-1 text-[10px] font-bold text-txt-muted uppercase tracking-wider bg-raised sticky top-0 z-10 border-b border-border-subtle shadow-sm">
                    {{ group.category }}
                  </div>
                  <div
                    v-for="model in group.items"
                    :key="model.id"
                    :title="isModelDisabled(model) ? modelDisabledReason(model) : undefined"
                    @click="!isModelDisabled(model) && selectModel(model.id)"
                    class="flex items-center gap-2 px-3 py-1.5 whitespace-nowrap"
                    :class="[
                      isModelDisabled(model) ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-white/[0.05] transition-colors',
                      model.id === ui.currentModel ? 'text-ember' : ''
                    ]"
                  >
                    <div>
                      <div class="text-[11px] text-txt-primary">{{ model.name }}</div>
                      <div class="text-[9px] text-txt-faint">{{ model.desc }}</div>
                    </div>
                  </div>
                </template>
              </div>
            </Teleport>
          </div>

          <!-- Profile multi-select -->
          <div class="relative" ref="profileRoot">
            <button
              @click="profileOpen = !profileOpen"
              class="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md text-txt-muted hover:text-txt-secondary hover:bg-raised transition-colors"
            >
              <svg class="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
                <path d="M2 3h12M2 8h12M2 13h12" />
              </svg>
              <span>{{ selectedProfiles.length > 0 ? `${selectedProfiles.length} profile${selectedProfiles.length > 1 ? 's' : ''}` : 'Profiles' }}</span>
              <svg class="w-2 h-2 opacity-50" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2.5 4L5 6.5L7.5 4"/></svg>
            </button>
            <div
              v-if="profileOpen"
              class="absolute bottom-full left-0 mb-1 w-52 bg-raised border border-border-standard rounded-lg shadow-lg overflow-hidden z-20 max-h-48 overflow-y-auto"
            >
              <div v-if="profiles.length === 0" class="px-3 py-2 text-[10px] text-txt-faint">
                No profiles available
              </div>
              <label
                v-for="profile in profiles"
                :key="profile.id"
                class="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-white/[0.05] transition-colors"
              >
                <input
                  type="checkbox"
                  :value="profile.id"
                  v-model="selectedProfiles"
                  class="w-3 h-3 rounded border-border-standard accent-ember"
                />
                <span class="text-[11px] text-txt-primary truncate">{{ profile.name }}</span>
              </label>
            </div>
          </div>

          <!-- Image upload button -->
          <button
            @click="openImagePicker"
            :disabled="isProcessing"
            class="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md text-txt-muted hover:text-txt-secondary hover:bg-raised transition-colors"
            title="Attach images"
          >
            <svg class="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="2" width="12" height="12" rx="2" />
              <circle cx="5.5" cy="5.5" r="1" />
              <path d="M14 10l-3-3-5 5" />
            </svg>
          </button>
        </div>

        <div class="flex items-center gap-2">
          <button
            v-if="isProcessing"
            @click="onStop"
            class="flex-shrink-0 px-2 py-0.5 rounded text-[9px] bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
          >Stop</button>
          <button
            v-else
            @click="onSendClick"
            :disabled="!canSend"
            class="flex-shrink-0 px-2 py-0.5 rounded text-[9px] font-medium transition-colors"
            :class="canSend ? 'bg-[var(--accent-mauve)] text-white hover:brightness-110' : 'bg-[var(--bg-raised)] text-txt-faint'"
          >Send</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import MarkdownIt from 'markdown-it';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import ToolCallGroup from '@/components/chat/ToolCallGroup.vue';
import type { ToolCallInfo } from '@/components/chat/ToolCallGroup.vue';
import { useUiStore } from '@/stores/ui';
import { useSessionsStore, getDatabase } from '@/stores/sessions';
import { useFleetStore } from '@/stores/fleet';
import { sendMessageToEngine, cancelProcess, isAngyCodeModel, sendAngyCodeMessage, cancelAngyCodeProcess, isAngyCodeRunning } from '@/composables/useEngine';
import type { AgentHandle, MessageRecord, AttachedImage } from '@/engine/types';
import { MODEL_GROUPS, ALL_MODELS, type ModelEntry } from '@/constants/models';
import { ProfileManager, type PersonalityProfile } from '@/engine/ProfileManager';

const emit = defineEmits<{
  'file-clicked': [filePath: string];
}>();

const ui = useUiStore();
const sessionsStore = useSessionsStore();
const fleetStore = useFleetStore();

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

const EDIT_TOOLS = new Set(['Edit', 'Write', 'StrReplace', 'MultiEdit', 'NotebookEdit']);

// ── Local session state ──────────────────────────────────────────────────

const sessionId = ref<string | null>(null);
const messages = ref<ChatMsg[]>([]);
const isProcessing = ref(false);
const currentText = ref('');
const currentThinking = ref('');
const currentMsgId = ref<string | null>(null);
const turnCounter = ref(0);

const inputText = ref('');
const inputEl = ref<HTMLTextAreaElement | null>(null);
const scrollEl = ref<HTMLElement | null>(null);
const textareaHeight = ref(28);
const images = ref<AttachedImage[]>([]);

// Mode
const currentMode = ref('agent');
const modeOpen = ref(false);
const modeRoot = ref<HTMLElement | null>(null);
const modes = [
  { id: 'agent', label: 'Agent', desc: 'Full capabilities' },
  { id: 'plan', label: 'Plan', desc: 'Plan before acting' },
  { id: 'ask', label: 'Ask', desc: 'Read-only questions' },
];

// Model
const modelOpen = ref(false);
const modelRoot = ref<HTMLElement | null>(null);
const modelDropdownStyle = ref<Record<string, string>>({});
const modelGroups = MODEL_GROUPS;

const modelShortName = computed(() =>
  ALL_MODELS.find((m) => m.id === ui.currentModel)?.name || ui.currentModel,
);

function isModelDisabled(model: ModelEntry): boolean {
  if (model.provider === 'gemini') return !ui.geminiApiKey;
  if (model.provider === 'claude') return !ui.anthropicApiKey;
  return false;
}

function modelDisabledReason(model: ModelEntry): string | undefined {
  if (model.provider === 'gemini') return 'Add your Gemini API key in Settings to enable';
  if (model.provider === 'claude') return 'Add your Anthropic API key in Settings to enable';
  return undefined;
}

function toggleModelOpen() {
  if (!modelOpen.value && modelRoot.value) {
    const rect = modelRoot.value.getBoundingClientRect();
    modelDropdownStyle.value = {
      left: rect.left + 'px',
      bottom: (window.innerHeight - rect.top + 4) + 'px',
    };
  }
  modelOpen.value = !modelOpen.value;
}

function selectModel(id: string) {
  ui.currentModel = id;
  modelOpen.value = false;
}

function selectMode(id: string) {
  currentMode.value = id;
  modeOpen.value = false;
}

// Profiles
const selectedProfiles = ref<string[]>([]);
const profileOpen = ref(false);
const profileRoot = ref<HTMLElement | null>(null);
const profiles = ref<PersonalityProfile[]>([]);
const profileManager = new ProfileManager();

const canSend = computed(() => inputText.value.trim().length > 0 || images.value.length > 0);

interface ChatMsg {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  turnId: number;
  toolName?: string;
  toolInput?: Record<string, any>;
  timestamp: number;
}

// ── Grouped items for rendering ──────────────────────────────────────────

type GroupedItem =
  | { type: 'message'; msg: ChatMsg; id: string }
  | { type: 'tool-group'; calls: ToolCallInfo[]; expandedByDefault: boolean; id: string };

const groupedItems = computed((): GroupedItem[] => {
  const result: GroupedItem[] = [];
  let pendingGroup: ToolCallInfo[] = [];
  let pendingGroupId = '';
  let pendingHasEdit = false;
  let pendingAssistantMsg: ChatMsg | null = null;

  const flushGroup = () => {
    if (pendingGroup.length > 0) {
      result.push({
        type: 'tool-group',
        calls: [...pendingGroup],
        expandedByDefault: pendingHasEdit,
        id: `tg-${pendingGroupId}`,
      });
      pendingGroup = [];
      pendingGroupId = '';
      pendingHasEdit = false;
    }
    // Output any pending assistant message after the tool group
    if (pendingAssistantMsg) {
      result.push({ type: 'message', msg: pendingAssistantMsg, id: pendingAssistantMsg.id });
      pendingAssistantMsg = null;
    }
  };

  const msgs = messages.value;
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i];
    if (msg.role === 'tool' || (msg.toolName && msg.role !== 'user')) {
      const isEdit = EDIT_TOOLS.has(msg.toolName ?? '');
      const input = msg.toolInput ?? {};
      const filePath = String(input.file_path ?? input.path ?? '') || undefined;
      let newString: string | undefined;
      if (isEdit) {
        newString = String(input.new_string ?? input.content ?? input.contents ?? '') || undefined;
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

      // Group all consecutive tool calls together (regardless of turn)
      if (pendingGroup.length === 0) pendingGroupId = msg.id;
      if (isEdit) pendingHasEdit = true;
      pendingGroup.push(call);
    } else if (msg.role === 'user') {
      // User message: flush tools and any pending assistant, then add user msg
      flushGroup();
      result.push({ type: 'message', msg, id: msg.id });
    } else if (msg.role === 'assistant') {
      const stripped = (msg.content || '').replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
      if (stripped.length === 0) {
        // Skip empty assistant messages
        continue;
      }
      if (pendingGroup.length > 0) {
        // Store assistant message to show after tools are flushed
        pendingAssistantMsg = msg;
      } else {
        // No pending tools, show assistant message immediately
        result.push({ type: 'message', msg, id: msg.id });
      }
    }
  }
  flushGroup();
  return result;
});

// ── Markdown rendering ───────────────────────────────────────────────────

function renderMd(content: string): string {
  if (!content) return '';
  const cleaned = content.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
  return md.render(cleaned);
}

// ── Auto-scroll ──────────────────────────────────────────────────────────

watch(
  () => messages.value.length,
  async () => {
    await nextTick();
    if (scrollEl.value) {
      scrollEl.value.scrollTop = scrollEl.value.scrollHeight;
    }
  },
);

// ── Textarea auto-resize ─────────────────────────────────────────────────

watch(inputText, () => {
  nextTick(() => {
    if (inputEl.value) {
      inputEl.value.style.height = '0px';
      textareaHeight.value = Math.min(100, Math.max(28, inputEl.value.scrollHeight));
    }
  });
});

// ── Public API ───────────────────────────────────────────────────────────

async function createNewChat(): Promise<string> {
  const workspace = ui.workspacePath || '.';
  const sid = await sessionsStore.createSession(workspace);
  fleetStore.rebuildFromSessions();
  sessionId.value = sid;
  messages.value = [];
  turnCounter.value = 0;
  isProcessing.value = false;
  currentText.value = '';
  currentThinking.value = '';
  currentMsgId.value = null;
  return sid;
}

defineExpose({ createNewChat, sessionId });

// ── AgentHandle for streaming ────────────────────────────────────────────

function genId(): string {
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const handle: AgentHandle = {
  appendTextDelta(_sid: string, text: string) {
    currentText.value += text;
    const content = currentThinking.value
      ? `<thinking>${currentThinking.value}</thinking>\n${currentText.value}`
      : currentText.value;
    const last = messages.value[messages.value.length - 1];
    if (last && last.id === currentMsgId.value) {
      last.content = content;
    } else {
      const id = genId();
      currentMsgId.value = id;
      const msg: ChatMsg = { id, role: 'assistant', content, turnId: turnCounter.value, timestamp: Math.floor(Date.now() / 1000) };
      messages.value.push(msg);
      const record: MessageRecord = { sessionId: _sid, role: 'assistant', content, turnId: turnCounter.value, timestamp: msg.timestamp };
      sessionsStore.addMessage(_sid, record);
    }
  },
  appendThinkingDelta(_sid: string, text: string) {
    currentThinking.value += text;
  },
  addToolUse(_sid: string, toolName: string, summary: string, toolInput?: Record<string, any>) {
    currentText.value = '';
    currentThinking.value = '';
    currentMsgId.value = null;
    const id = genId();
    let parsedInput: Record<string, any> | undefined;
    if (toolInput) parsedInput = toolInput;
    const msg: ChatMsg = { id, role: 'tool', content: summary, toolName, toolInput: parsedInput, turnId: turnCounter.value, timestamp: Math.floor(Date.now() / 1000) };
    messages.value.push(msg);
    const record: MessageRecord = {
      sessionId: _sid, role: 'tool', content: summary, toolName,
      toolInput: toolInput ? JSON.stringify(toolInput) : undefined,
      turnId: turnCounter.value, timestamp: msg.timestamp,
    };
    sessionsStore.addMessage(_sid, record);
  },
  markDone(_sid: string) {
    isProcessing.value = false;
    currentText.value = '';
    currentThinking.value = '';
    currentMsgId.value = null;
    fleetStore.updateAgent({ sessionId: _sid, status: 'idle', activity: '' });
    sessionsStore.persistSession(_sid);
  },
  showError(_sid: string, error: string) {
    const id = genId();
    const content = `**Error:** ${error.replace(/<[^>]*>/g, '')}`;
    // Push for in-memory UI display only — DB persistence handled by the buffer.
    // Do NOT call markDone — the finished handler is the sole caller.
    messages.value.push({ id, role: 'assistant', content, turnId: turnCounter.value, timestamp: Math.floor(Date.now() / 1000) });
  },
  setThinking() {},
  setRealSessionId(_sid: string, realId: string) {
    const info = sessionsStore.sessions.get(_sid);
    if (info) info.claudeSessionId = realId;
  },
  onFileEdited(_sid: string, filePath: string) {
    emit('file-clicked', filePath);
  },
};

// ── Image handling ────────────────────────────────────────────────────────

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];

async function openImagePicker() {
  const selected = await open({
    multiple: true,
    filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS }],
  });
  if (!selected) return;
  const paths = Array.isArray(selected) ? selected : [selected];
  for (const filePath of paths) {
    const ext = filePath.split('.').pop()?.toLowerCase() || 'png';
    const format = ext === 'jpg' ? 'jpeg' : ext;
    try {
      const bytes = await readFile(filePath);
      const base64 = uint8ArrayToBase64(bytes);
      const fileName = filePath.split('/').pop() || 'image';
      images.value.push({ data: base64, format, displayName: fileName });
    } catch (e) {
      console.error('Failed to read image:', filePath, e);
    }
  }
}

function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (!item.type.startsWith('image/')) continue;
    const blob = item.getAsFile();
    if (!blob) continue;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const match = result.match(/^data:image\/(\w+);base64,(.+)$/);
      if (match) {
        images.value.push({ data: match[2], format: match[1], displayName: 'pasted-image' });
      }
    };
    reader.readAsDataURL(blob);
  }
}

// ── Send / Stop ──────────────────────────────────────────────────────────

async function doSend(text: string) {
  let sid = sessionId.value;
  if (!sid) sid = await createNewChat();

  turnCounter.value++;
  currentText.value = '';
  currentThinking.value = '';
  currentMsgId.value = null;

  const id = genId();
  const userMsg: ChatMsg = { id, role: 'user', content: text, turnId: turnCounter.value, timestamp: Math.floor(Date.now() / 1000) };
  messages.value.push(userMsg);

  const record: MessageRecord = { sessionId: sid, role: 'user', content: text, turnId: turnCounter.value, timestamp: userMsg.timestamp };
  sessionsStore.addMessage(sid, record);
  const db = getDatabase();
  await db.saveMessage(record);

  isProcessing.value = true;
  fleetStore.updateAgent({ sessionId: sid, status: 'working', activity: 'Sending message...' });

  const info = sessionsStore.sessions.get(sid);
  const engineImages = images.value.length > 0
    ? images.value.map(img => ({ data: img.data, mediaType: `image/${img.format}` }))
    : undefined;

  if (isAngyCodeModel(ui.currentModel)) {
    // Convert images to the format expected by AngyCode server
    const angyImages = engineImages
      ? engineImages.map(img => ({ data: img.data, mimeType: img.mediaType }))
      : undefined;
      
    const provider = ui.currentModel.includes('gemini') ? 'gemini' : 'anthropic';
    const apiKey = provider === 'gemini' ? ui.geminiApiKey : ui.anthropicApiKey;
    
    try {
      await sendAngyCodeMessage({
        sessionId: sid,
        workingDir: info?.workspace || ui.workspacePath || '.',
        goal: text,
        provider,
        apiKey,
        model: ui.currentModel.replace(/^angy-/, ''),
        images: angyImages,
      }, handle);
    } catch (err) {
      handle.showError(sid, err instanceof Error ? err.message : String(err));
      handle.markDone(sid);
    }
  } else {
    sendMessageToEngine(sid, text, handle, {
      workingDir: info?.workspace || ui.workspacePath || '.',
      mode: currentMode.value,
      model: ui.currentModel,
      resumeSessionId: info?.claudeSessionId,
      images: engineImages,
    });
  }
}

function onSendClick() {
  const text = inputText.value.trim();
  if (!text && images.value.length === 0) return;
  inputText.value = '';
  images.value = [];
  textareaHeight.value = 28;
  doSend(text);
}

function onStop() {
  const sid = sessionId.value;
  if (sid) {
    if (isAngyCodeRunning(sid)) {
      cancelAngyCodeProcess(sid);
    } else {
      cancelProcess(sid);
    }
    isProcessing.value = false;
    fleetStore.updateAgent({ sessionId: sid, status: 'idle', activity: '' });
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    onSendClick();
  }
}

// ── Click outside to close dropdowns ─────────────────────────────────────

function onClickOutside(e: MouseEvent) {
  const target = e.target as Node;
  if (modeRoot.value && !modeRoot.value.contains(target)) modeOpen.value = false;
  if (modelRoot.value && !modelRoot.value.contains(target)) modelOpen.value = false;
  if (profileRoot.value && !profileRoot.value.contains(target)) profileOpen.value = false;
}

onMounted(async () => {
  document.addEventListener('click', onClickOutside);
  await profileManager.init();
  profiles.value = profileManager.userProfiles();
});

onUnmounted(() => {
  document.removeEventListener('click', onClickOutside);
  if (sessionId.value && isProcessing.value) {
    cancelProcess(sessionId.value);
  }
});
</script>

<style scoped>
.compact-markdown :deep(p) {
  margin: 0.25em 0;
}
.compact-markdown :deep(pre) {
  background: var(--bg-raised);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 10px;
  overflow-x: auto;
  margin: 4px 0;
}
.compact-markdown :deep(code) {
  font-size: 10px;
  background: var(--bg-raised);
  padding: 1px 3px;
  border-radius: 3px;
}
.compact-markdown :deep(pre code) {
  background: none;
  padding: 0;
}
.compact-markdown :deep(ul),
.compact-markdown :deep(ol) {
  padding-left: 1.2em;
  margin: 0.25em 0;
}
.compact-markdown :deep(h1),
.compact-markdown :deep(h2),
.compact-markdown :deep(h3) {
  font-size: 12px;
  font-weight: 600;
  margin: 0.5em 0 0.25em;
}
.compact-markdown :deep(a) {
  color: var(--accent-teal);
}
</style>
