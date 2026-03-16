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
            :disabled="isProcessing"
            class="w-full bg-transparent text-[11px] text-txt-primary px-2.5 py-1.5 resize-none outline-none ring-0 min-h-[28px] max-h-[100px]"
            :style="{ height: textareaHeight + 'px' }"
          />
        </div>
      </div>

      <!-- Footer: selectors + actions -->
      <div class="compact-selectors flex items-center gap-1 px-3 pb-2 pt-1 flex-wrap">
        <ModeSelector v-model="currentMode" />
        <ModelSelector v-model="ui.currentModel" />
        <ProfileSelector v-model="selectedProfiles" />
        <button
          @click="openImagePicker"
          :disabled="isProcessing"
          class="p-0.5 rounded text-txt-faint hover:text-txt-secondary hover:bg-[var(--bg-surface)] transition-colors"
          title="Attach images"
        >
          <svg class="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="2" width="12" height="12" rx="2" />
            <circle cx="5.5" cy="5.5" r="1" />
            <path d="M14 10l-3.5-3.5L4 13" />
          </svg>
        </button>
        <span class="flex-1" />
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
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted } from 'vue';
import MarkdownIt from 'markdown-it';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import ToolCallGroup from '@/components/chat/ToolCallGroup.vue';
import type { ToolCallInfo } from '@/components/chat/ToolCallGroup.vue';
import ModeSelector from '@/components/input/ModeSelector.vue';
import ModelSelector from '@/components/input/ModelSelector.vue';
import ProfileSelector from '@/components/input/ProfileSelector.vue';
import { useUiStore } from '@/stores/ui';
import { useSessionsStore, getDatabase } from '@/stores/sessions';
import { useFleetStore } from '@/stores/fleet';
import { sendMessageToEngine, cancelProcess, isAngyCodeModel, sendAngyCodeMessage, cancelAngyCodeProcess, isAngyCodeRunning } from '@/composables/useEngine';
import type { AgentHandle, MessageRecord, AttachedImage } from '@/engine/types';

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
const currentMode = ref('agent');
const selectedProfiles = ref<string[]>([]);

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
      if (isEdit) {
        flushGroup();
        result.push({ type: 'tool-group', calls: [call], expandedByDefault: true, id: `tg-${msg.id}` });
      } else {
        if (pendingGroup.length === 0) pendingGroupId = msg.id;
        pendingGroup.push(call);
      }
    } else {
      if (msg.role === 'assistant' && pendingGroup.length > 0) {
        const stripped = (msg.content || '').replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
        if (stripped.length < 200) {
          continue;
        }
      }
      flushGroup();
      result.push({ type: 'message', msg, id: msg.id });
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
    try {
      await sendAngyCodeMessage({
        sessionId: sid,
        workingDir: info?.workspace || ui.workspacePath || '.',
        goal: text,
        provider: 'gemini',
        apiKey: ui.geminiApiKey,
        model: ui.currentModel,
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

onUnmounted(() => {
  if (sessionId.value && isProcessing.value) {
    cancelProcess(sessionId.value);
  }
});
</script>

<style scoped>
.compact-selectors :deep(button) {
  font-size: 9px !important;
  padding: 2px 6px !important;
  gap: 2px !important;
  line-height: 1.2 !important;
}
.compact-selectors :deep(svg) {
  width: 8px !important;
  height: 8px !important;
}
.compact-selectors :deep(.absolute) {
  font-size: 10px !important;
}
.compact-selectors :deep(.absolute div),
.compact-selectors :deep(.absolute label) {
  padding: 3px 8px !important;
  font-size: 10px !important;
}
.compact-selectors :deep(.absolute .text-xs),
.compact-selectors :deep(.absolute .text-\[var\(--text-xs\)\]) {
  font-size: 10px !important;
}

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
