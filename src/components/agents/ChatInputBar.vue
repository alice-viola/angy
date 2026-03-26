<template>
  <div class="bg-base border-t border-border-subtle">
    <!-- Image thumbnails -->
    <div v-if="images.length > 0" class="flex gap-2 px-4 pt-3">
      <div
        v-for="(img, i) in images"
        :key="i"
        class="relative w-14 h-14 rounded-lg overflow-hidden border border-border-subtle group"
      >
        <img
          :src="'data:image/' + img.format + ';base64,' + img.data"
          class="w-full h-full object-cover"
        />
        <button
          @click="removeImage(i)"
          class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
        >
          <svg class="w-3.5 h-3.5 text-white" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Textarea -->
    <div
      class="px-4 pt-3"
      @dragenter.prevent="isDragging = true"
      @dragover.prevent
      @dragleave.self="isDragging = false"
      @drop.prevent="onDrop($event)"
    >
      <textarea
        ref="inputEl"
        v-model="draft"
        @keydown="onKeydown"
        @paste="onPaste"
        @dragover.prevent
        :placeholder="'Send a message...'"
        rows="1"
        autocapitalize="none"
        autocomplete="off"
        autocorrect="off"
        spellcheck="false"
        class="w-full bg-transparent text-[13px] text-txt-primary placeholder:text-txt-faint resize-none outline-none ring-0 border-0"
        :style="{ maxHeight: MAX_HEIGHT + 'px' }"
        :class="isDragging ? 'opacity-50' : ''"
        :disabled="processing"
      />
    </div>

    <!-- Footer controls -->
    <div class="flex items-center justify-between px-3 pb-3 pt-1">
      <div class="flex items-center gap-1">
        <!-- Mode dropdown -->
        <div class="relative" ref="modeRoot">
          <button
            @click="modeOpen = !modeOpen"
            class="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md text-txt-muted hover:text-txt-secondary hover:bg-raised transition-colors"
          >
            <svg class="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
              <template v-if="selectedMode === 'agent'">
                <circle cx="8" cy="5" r="3" /><path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" />
              </template>
              <template v-else-if="selectedMode === 'plan'">
                <path d="M4 3h8M4 6.5h8M4 10h5" /><circle cx="12" cy="12" r="2.5" />
              </template>
              <template v-else>
                <circle cx="8" cy="8" r="6" /><path d="M6.5 6.5a1.8 1.8 0 013 1.3c0 1.2-1.5 1.2-1.5 2.2M8 12.5v.01" />
              </template>
            </svg>
            <span class="capitalize">{{ selectedMode }}</span>
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
              :class="mode.id === selectedMode ? 'text-ember' : ''"
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
                  :title="isDisabled(model) ? disabledReason(model) : undefined"
                  @click="!isDisabled(model) && selectModel(model.id)"
                  class="flex items-center gap-2 px-3 py-1.5 whitespace-nowrap"
                  :class="[
                    isDisabled(model) ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-white/[0.05] transition-colors',
                    model.id === selectedModel ? 'text-ember' : ''
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
          :disabled="processing"
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
        <span v-if="draft.length > 0" class="text-[9px] text-txt-faint tabular-nums">
          {{ draft.length }}
        </span>
        <button
          v-if="processing"
          @click="$emit('stop')"
          class="w-8 h-8 flex items-center justify-center rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--accent-red)] hover:text-[var(--accent-red)] text-txt-faint cursor-pointer transition-all flex-shrink-0"
          title="Stop"
        >
          <svg class="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
            <rect x="2" y="2" width="8" height="8" rx="1.5" />
          </svg>
        </button>
        <button
          v-else
          @click="sendMessage"
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
</template>

<script lang="ts">
// Module-level: shared across all instances, survives component re-creation from :key
const draftsBySession = new Map<string, string>();
</script>

<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { ProfileManager, type PersonalityProfile } from '../../engine/ProfileManager';
import type { AttachedImage } from '../../engine/types';
import { useUiStore } from '@/stores/ui';
import { MODEL_GROUPS, ALL_MODELS, DEFAULT_MODEL_ID, type ModelEntry } from '@/constants/models';

const props = defineProps<{
  processing: boolean;
  sessionId?: string;
}>();

const emit = defineEmits<{
  send: [message: string, images: AttachedImage[], model: string];
  stop: [];
}>();

// ── State ─────────────────────────────────────────────────────────────
const ui = useUiStore();

const draft = ref(props.sessionId ? (draftsBySession.get(props.sessionId) ?? '') : '');
const inputEl = ref<HTMLTextAreaElement | null>(null);
const isDragging = ref(false);
const images = ref<AttachedImage[]>([]);

// Mode
const selectedMode = ref('agent');
const modeOpen = ref(false);
const modeRoot = ref<HTMLElement | null>(null);
const modes = [
  { id: 'agent', label: 'Agent', desc: 'Full capabilities' },
  { id: 'plan', label: 'Plan', desc: 'Plan before acting' },
  { id: 'ask', label: 'Ask', desc: 'Read-only questions' },
];

// Model — per-session, with global fallback for new chats
const MODEL_DEFAULT_KEY = 'angy:selectedModel';
function loadModel(sessionId?: string): string {
  if (sessionId) {
    const perChat = localStorage.getItem(`angy:model:${sessionId}`);
    if (perChat) return perChat;
  }
  return localStorage.getItem(MODEL_DEFAULT_KEY) ?? DEFAULT_MODEL_ID;
}
const selectedModel = ref(loadModel(props.sessionId));
const modelOpen = ref(false);
const modelRoot = ref<HTMLElement | null>(null);
const modelDropdownStyle = ref<Record<string, string>>({});
const modelGroups = MODEL_GROUPS;

const models = computed(() => ALL_MODELS);

function isDisabled(model: ModelEntry): boolean {
  if (model.provider === 'gemini') return !ui.geminiApiKey;
  if (model.provider === 'claude') return !ui.anthropicApiKey;
  return false;
}

function disabledReason(model: ModelEntry): string | undefined {
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

// Profiles
const selectedProfiles = ref<string[]>([]);
const profileOpen = ref(false);
const profileRoot = ref<HTMLElement | null>(null);
const profiles = ref<PersonalityProfile[]>([]);
const profileManager = new ProfileManager();

const MIN_HEIGHT = 28;
const MAX_HEIGHT = 300; // ~15 lines at 13px / 1.5 line-height

// ── Computed ──────────────────────────────────────────────────────────

const canSend = computed(() => draft.value.trim().length > 0 || images.value.length > 0);

const modelShortName = computed(() =>
  models.value.find((m) => m.id === selectedModel.value)?.name || selectedModel.value,
);

// ── Auto-height textarea ─────────────────────────────────────────────

function autoGrow() {
  const el = inputEl.value;
  if (!el) return;
  el.style.height = 'auto';
  const h = Math.min(Math.max(el.scrollHeight, MIN_HEIGHT), MAX_HEIGHT);
  el.style.height = h + 'px';
  el.style.overflowY = h >= MAX_HEIGHT ? 'auto' : 'hidden';
}

watch(draft, (val) => {
  autoGrow();
  if (props.sessionId) draftsBySession.set(props.sessionId, val);
});

// ── Send ──────────────────────────────────────────────────────────────

function sendMessage() {
  const text = draft.value.trim();
  if (!text && images.value.length === 0) return;
  emit('send', text, [...images.value], selectedModel.value);
  draft.value = '';
  if (props.sessionId) draftsBySession.delete(props.sessionId);
  images.value = [];
  nextTick(() => {
    const el = inputEl.value;
    if (el) { el.style.height = MIN_HEIGHT + 'px'; el.style.overflowY = 'hidden'; }
  });
}

// ── Keydown ───────────────────────────────────────────────────────────

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

// ── Dropdown selection ────────────────────────────────────────────────

function selectMode(id: string) {
  selectedMode.value = id;
  modeOpen.value = false;
}

function selectModel(id: string) {
  selectedModel.value = id;
  ui.currentModel = id;
  if (props.sessionId) localStorage.setItem(`angy:model:${props.sessionId}`, id);
  localStorage.setItem(MODEL_DEFAULT_KEY, id); // also update global default for new chats
  modelOpen.value = false;
}

// ── Click outside to close dropdowns ─────────────────────────────────

function onClickOutside(e: MouseEvent) {
  const target = e.target as Node;
  if (modeRoot.value && !modeRoot.value.contains(target)) modeOpen.value = false;
  if (modelRoot.value && !modelRoot.value.contains(target)) modelOpen.value = false;
  if (profileRoot.value && !profileRoot.value.contains(target)) profileOpen.value = false;
}

// ── Image handling ────────────────────────────────────────────────────

function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) readImageFromFile(file);
      return;
    }
  }
}

function onDrop(e: DragEvent) {
  e.preventDefault();
  isDragging.value = false;
  const files = e.dataTransfer?.files;
  if (!files) return;
  for (const file of files) {
    if (file.type.startsWith('image/')) readImageFromFile(file);
  }
}

function readImageFromFile(file: File) {
  const reader = new FileReader();
  reader.onload = () => {
    const result = reader.result as string;
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
    } catch (err) {
      console.error('Failed to read image:', filePath, err);
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

// ── Tauri OS file drop (Finder → window) ─────────────────────────────

let unlistenDrop: (() => void) | null = null;

onMounted(async () => {
  inputEl.value?.focus();
  autoGrow();
  document.addEventListener('click', onClickOutside);

  await profileManager.init();
  profiles.value = profileManager.userProfiles();

  try {
    unlistenDrop = await getCurrentWebview().onDragDropEvent(async (event) => {
      if (event.payload.type === 'enter' || event.payload.type === 'over') {
        isDragging.value = true;
      } else if (event.payload.type === 'leave') {
        isDragging.value = false;
      } else if (event.payload.type === 'drop') {
        isDragging.value = false;
        for (const filePath of event.payload.paths) {
          const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
          if (IMAGE_EXTENSIONS.includes(ext)) {
            const format = ext === 'jpg' ? 'jpeg' : ext;
            try {
              const bytes = await readFile(filePath);
              const base64 = uint8ArrayToBase64(bytes);
              const fileName = filePath.split('/').pop() || 'image';
              images.value.push({ data: base64, format, displayName: fileName });
            } catch (err) {
              console.error('Failed to read dropped image:', filePath, err);
            }
          }
        }
      }
    });
  } catch {
    // Tauri drag-drop not available (e.g. in browser dev mode)
  }
});

onUnmounted(() => {
  document.removeEventListener('click', onClickOutside);
  unlistenDrop?.();
});

defineExpose({ selectedMode, selectedModel, selectedProfiles });
</script>

<style scoped>
textarea {
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.5;
}
textarea::placeholder {
  color: var(--text-faint);
}
</style>
