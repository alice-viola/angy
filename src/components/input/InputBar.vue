<template>
  <div class="input-bar relative bg-[var(--bg-base)]">
    <!-- Context pills (@ mentions) -->
    <div v-if="contexts.length > 0" class="flex flex-wrap gap-1 px-4 pt-2">
      <div
        v-for="(ctx, i) in contexts"
        :key="i"
        class="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--bg-raised)] text-xs text-[var(--text-secondary)]"
      >
        <span class="truncate max-w-[200px]">{{ ctx.displayName }}</span>
        <button
          @click="removeContext(i)"
          class="text-[var(--text-faint)] hover:text-[var(--accent-red)] transition-colors"
        >
          ×
        </button>
      </div>
    </div>

    <!-- Image thumbnails -->
    <div v-if="images.length > 0" class="flex gap-2 px-4 pt-2">
      <div
        v-for="(img, i) in images"
        :key="i"
        class="relative w-16 h-16 rounded overflow-hidden border border-[var(--border-standard)]"
      >
        <img
          :src="'data:image/' + img.format + ';base64,' + img.data"
          class="w-full h-full object-cover"
        />
        <button
          @click="removeImage(i)"
          class="absolute top-0 right-0 bg-black/50 text-white text-xs px-1 hover:bg-black/70"
        >
          ×
        </button>
      </div>
    </div>

    <!-- Queued messages list -->
    <div v-if="messageQueue.length > 0" class="px-4 pt-2 flex flex-col gap-1">
      <div class="text-[9px] text-txt-faint uppercase tracking-wider mb-0.5">Queued</div>
      <div
        v-for="(msg, i) in messageQueue"
        :key="i"
        class="flex items-center gap-2 px-2 py-1 rounded-md bg-raised border border-border-subtle group"
      >
        <span class="flex-1 text-[11px] text-txt-secondary truncate">{{ msg.text || '(image)' }}</span>
        <button
          @click="editQueued(i)"
          class="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity text-txt-faint hover:text-ember-400 flex-shrink-0"
          title="Edit"
        >
          <svg class="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 2l3 3-8 8H3v-3l8-8z"/>
          </svg>
        </button>
        <button
          @click="removeQueued(i)"
          class="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity text-txt-faint hover:text-red-400 flex-shrink-0"
          title="Remove"
        >
          <svg class="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <path d="M2 2l8 8M10 2l-8 8"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- Input container -->
    <div
      class="px-4 py-4"
      @dragenter.prevent="isDraggingOver = true"
      @dragover.prevent
      @dragleave.self="isDraggingOver = false"
      @drop.prevent="onDrop($event)"
    >
      <div
        class="relative bg-[var(--bg-raised)] rounded-xl border ring-0 outline-none transition-border-color"
        :class="{
          'border-[var(--border-standard)]': focused,
          'border-[var(--border-subtle)]': !focused && !isDraggingOver,
          'border-[var(--accent-ember)]': isDraggingOver,
        }"
      >
        <textarea
          ref="inputEl"
          v-model="text"
          @keydown="onKeydown"
          @input="onInput"
          @paste="onPaste"
          @focus="focused = true"
          @blur="focused = false"
          @dragover.prevent
          @drop="onDrop"
          :placeholder="processing ? 'Type to queue next message…' : (placeholder || 'Message Claude...')"
          rows="1"
          autocapitalize="none"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
          class="textarea-field w-full bg-transparent text-[var(--text-primary)] px-4 py-3 resize-none outline-none ring-0"
          :style="{ height: textareaHeight + 'px', maxHeight: '300px' }"
        />

        <!-- Footer with controls -->
        <div class="flex items-center justify-between px-3 pb-3">
          <div class="flex items-center gap-1">
            <slot name="footer-left" />
            <button
              @click="openImagePicker"
              class="p-1.5 rounded-md text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] transition-colors cursor-pointer"
              title="Attach images"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="2" width="12" height="12" rx="2" />
                <circle cx="5.5" cy="5.5" r="1" />
                <path d="M14 10l-3-3-5 5" />
                <path d="M14 14H4l6-6 4 4" />
              </svg>
            </button>
          </div>
          <div class="flex items-center gap-2">
            <span v-if="messageQueue.length > 0" class="text-[9px] text-ember-400 tabular-nums" title="Messages queued">
              +{{ messageQueue.length }}
            </span>
            <span v-else-if="text.length > 0" class="text-[var(--text-xs)] text-[var(--text-faint)]">
              {{ text.length }}
            </span>
            <slot name="footer-right" />
            <button
              v-if="processing"
              @click="$emit('stop')"
              class="w-8 h-8 flex items-center justify-center rounded-lg bg-[var(--bg-surface)] border border-ember-500 text-ember-500 hover:border-ember-400 hover:text-ember-400 cursor-pointer transition-all flex-shrink-0"
              title="Stop"
            >
              <svg class="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
                <rect x="2" y="2" width="8" height="8" rx="1.5" />
              </svg>
            </button>
            <button
              v-if="processing && canSend"
              @click="send"
              class="w-8 h-8 flex items-center justify-center rounded-lg transition-all flex-shrink-0 bg-gradient-to-br from-ember-500 to-ember-600 hover:brightness-110 cursor-pointer"
              title="Queue message"
            >
              <svg class="w-3.5 h-3.5 text-white" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 8h10M9 4l4 4-4 4" />
              </svg>
            </button>
            <button
              v-if="!processing"
              @click="send"
              :disabled="!canSend"
              class="w-8 h-8 flex items-center justify-center rounded-lg transition-all flex-shrink-0"
              :class="canSend
                ? 'bg-gradient-to-br from-ember-500 to-ember-600 hover:brightness-110 cursor-pointer'
                : 'bg-[var(--bg-surface)] cursor-not-allowed border border-[var(--border-subtle)]'"
              title="Send"
            >
              <svg class="w-3.5 h-3.5" :class="canSend ? 'text-white' : 'text-txt-faint'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 8h10M9 4l4 4-4 4" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Context popup (@) -->
    <ContextPopup
      v-if="showContextPopup"
      ref="contextPopupRef"
      :query="contextQuery"
      :workspacePath="workspacePath || ''"
      @select="onContextSelect"
      @close="showContextPopup = false"
    />

    <!-- Slash command popup -->
    <SlashCommandPopup
      v-if="showSlashPopup"
      ref="slashPopupRef"
      :query="slashQuery"
      :workspacePath="props.workspacePath"
      @select="onSlashSelect"
      @close="showSlashPopup = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import ContextPopup from './ContextPopup.vue';
import SlashCommandPopup from './SlashCommandPopup.vue';
import type { AttachedContext, AttachedImage } from '../../engine/types';

const props = defineProps<{
  processing: boolean;
  placeholder?: string;
  workspacePath?: string;
  claudeCode?: boolean;
}>();

const emit = defineEmits<{
  send: [text: string, contexts: AttachedContext[], images: AttachedImage[]];
  stop: [];
  'slash-command': [command: string];
}>();

// ── State ─────────────────────────────────────────────────────────────────

const text = ref('');
const focused = ref(false);
const isDraggingOver = ref(false);
const inputEl = ref<HTMLTextAreaElement | null>(null);
const textareaHeight = ref(40);
const contexts = ref<AttachedContext[]>([]);
const images = ref<AttachedImage[]>([]);

// Popup state
const showContextPopup = ref(false);
const contextQuery = ref('');
const showSlashPopup = ref(false);
const slashQuery = ref('');
const contextPopupRef = ref<InstanceType<typeof ContextPopup> | null>(null);
const slashPopupRef = ref<InstanceType<typeof SlashCommandPopup> | null>(null);

// Track @ position for replacement
const atStartPos = ref(-1);

// Message queue
interface QueuedMessage { text: string; contexts: AttachedContext[]; images: AttachedImage[] }
const messageQueue = ref<QueuedMessage[]>([]);

watch(() => props.processing, (isProcessing) => {
  if (!isProcessing && messageQueue.value.length > 0) {
    const next = messageQueue.value.shift()!;
    emit('send', next.text, next.contexts, next.images);
  }
});

const MIN_HEIGHT = 40;
const MAX_HEIGHT = 300;

// ── Computed ──────────────────────────────────────────────────────────────

const canSend = computed(() => {
  return text.value.trim().length > 0 || contexts.value.length > 0 || images.value.length > 0;
});

// ── Auto-height ──────────────────────────────────────────────────────────

function autoGrow() {
  nextTick(() => {
    const el = inputEl.value;
    if (!el) return;
    el.style.height = 'auto';
    const newHeight = Math.min(Math.max(el.scrollHeight, MIN_HEIGHT), MAX_HEIGHT);
    textareaHeight.value = newHeight;
  });
}

watch(text, () => autoGrow());

// ── Send ──────────────────────────────────────────────────────────────────

function send() {
  const trimmed = text.value.trim();
  if (!trimmed && contexts.value.length === 0 && images.value.length === 0) return;
  if (props.processing) {
    messageQueue.value.push({ text: trimmed, contexts: [...contexts.value], images: [...images.value] });
  } else {
    emit('send', trimmed, [...contexts.value], [...images.value]);
  }
  text.value = '';
  contexts.value = [];
  images.value = [];
  textareaHeight.value = MIN_HEIGHT;
  nextTick(() => autoGrow());
}

function removeQueued(index: number) {
  messageQueue.value.splice(index, 1);
}

function editQueued(index: number) {
  const msg = messageQueue.value.splice(index, 1)[0];
  text.value = msg.text;
  if (msg.contexts.length > 0) contexts.value.push(...msg.contexts);
  if (msg.images.length > 0) images.value.push(...msg.images);
  nextTick(() => { inputEl.value?.focus(); autoGrow(); });
}

// ── Keydown ───────────────────────────────────────────────────────────────

function onKeydown(e: KeyboardEvent) {
  // Forward to popup if open
  if (showContextPopup.value) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
      e.preventDefault();
      contextPopupRef.value?.onKeydown(e);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      showContextPopup.value = false;
      return;
    }
  }

  if (showSlashPopup.value) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
      e.preventDefault();
      slashPopupRef.value?.onKeydown(e);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      showSlashPopup.value = false;
      return;
    }
  }

  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
}

// ── Input (detect @ and /) ─────────────────────────────────────────────

function onInput() {
  const el = inputEl.value;
  if (!el) return;

  const val = text.value;
  const cursorPos = el.selectionStart;

  // Detect @ context trigger
  detectAtSymbol(val, cursorPos);

  // Detect / slash command trigger
  detectSlashCommand(val);
}

function detectAtSymbol(val: string, cursorPos: number) {
  // Search backwards from cursor for @
  const beforeCursor = val.substring(0, cursorPos);
  const lastAt = beforeCursor.lastIndexOf('@');

  if (lastAt >= 0) {
    // Check no space between @ and cursor (allow dots, slashes for paths)
    const afterAt = beforeCursor.substring(lastAt + 1);
    if (!/\s/.test(afterAt) || afterAt.length === 0) {
      showContextPopup.value = true;
      contextQuery.value = afterAt;
      atStartPos.value = lastAt;
      return;
    }
  }

  showContextPopup.value = false;
  atStartPos.value = -1;
}

function detectSlashCommand(val: string) {
  if (props.claudeCode && val.startsWith('/')) {
    showSlashPopup.value = true;
    slashQuery.value = val.substring(1).split(/\s/)[0];
  } else {
    showSlashPopup.value = false;
  }
}

// ── Context selection ──────────────────────────────────────────────────

function onContextSelect(filePath: string) {
  showContextPopup.value = false;

  // Remove the @query from text
  if (atStartPos.value >= 0) {
    const el = inputEl.value;
    if (el) {
      const cursorPos = el.selectionStart;
      text.value = text.value.substring(0, atStartPos.value) + text.value.substring(cursorPos);
    }
  }
  atStartPos.value = -1;

  // Add context pill
  const displayName = filePath.split('/').pop() || filePath;
  contexts.value.push({
    displayName,
    fullPath: filePath,
  });

  nextTick(() => inputEl.value?.focus());
}

function removeContext(index: number) {
  contexts.value.splice(index, 1);
}

// ── Slash command selection ────────────────────────────────────────────

function onSlashSelect(commandName: string) {
  showSlashPopup.value = false;
  text.value = '';
  emit('slash-command', commandName);
  nextTick(() => inputEl.value?.focus());
}

// ── Image handling ────────────────────────────────────────────────────

function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items;
  if (!items) return;

  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) {
        readImageFile(file);
      }
      return;
    }
  }
}

function onDrop(e: DragEvent) {
  // Only handles in-browser drags (e.g. dragging an <img> element).
  // OS file drops from Finder are handled via Tauri's onDragDropEvent below.
  e.preventDefault();
  isDraggingOver.value = false;
  const files = e.dataTransfer?.files;
  if (!files) return;
  for (const file of files) {
    if (file.type.startsWith('image/')) readImageFile(file);
  }
}

async function loadImageFromPath(filePath: string, fileName?: string) {
  const ext = filePath.split('.').pop()?.toLowerCase() || 'png';
  const format = ext === 'jpg' ? 'jpeg' : ext;
  const name = fileName || filePath.split('/').pop() || filePath.split('\\').pop() || 'image';
  try {
    const bytes = await readFile(filePath);
    const base64 = uint8ArrayToBase64(bytes);
    images.value.push({ data: base64, format, displayName: name });
  } catch (err) {
    console.error('Failed to read dropped image:', filePath, err);
  }
}

function readImageFile(file: File) {
  const reader = new FileReader();
  reader.onload = () => {
    const result = reader.result as string;
    // data:image/png;base64,xxxx
    const match = result.match(/^data:image\/(\w+);base64,(.+)$/);
    if (match) {
      images.value.push({
        data: match[2],
        format: match[1],
        displayName: file.name || 'pasted-image',
      });
    }
  };
  reader.readAsDataURL(file);
}

function removeImage(index: number) {
  images.value.splice(index, 1);
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];

async function openImagePicker() {
  const selected = await open({
    multiple: true,
    title: 'Select Images',
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
      const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || 'image';
      images.value.push({ data: base64, format, displayName: fileName });
    } catch (e) {
      console.error('Failed to read image:', filePath, e);
    }
  }
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ── Focus ─────────────────────────────────────────────────────────────

function focus() {
  inputEl.value?.focus();
}

function prefill(t: string) {
  text.value = t;
  nextTick(() => {
    autoGrow();
    inputEl.value?.focus();
  });
}

// ── Tauri OS file drop (Finder → window) ─────────────────────────────

let unlistenDrop: (() => void) | null = null;

onMounted(async () => {
  focus();

  unlistenDrop = await getCurrentWebview().onDragDropEvent(async (event) => {
    if (event.payload.type === 'enter' || event.payload.type === 'over') {
      isDraggingOver.value = true;
    } else if (event.payload.type === 'leave') {
      isDraggingOver.value = false;
    } else if (event.payload.type === 'drop') {
      isDraggingOver.value = false;
      for (const filePath of event.payload.paths) {
        const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
        if (IMAGE_EXTENSIONS.includes(ext)) {
          await loadImageFromPath(filePath);
        }
      }
    }
  });
});

onUnmounted(() => {
  unlistenDrop?.();
});

defineExpose({ focus, prefill });
</script>

<style scoped>
.textarea-field {
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.6;
}
.textarea-field::placeholder {
  color: var(--text-faint);
}
.textarea-field:focus::placeholder {
  color: transparent;
}
.transition-border-color {
  transition: border-color var(--transition-fast);
}
</style>
