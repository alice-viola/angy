<template>
  <div class="relative" ref="rowRoot">
    <button
      class="flex items-center gap-2.5 w-full text-left px-3 py-2 rounded-md cursor-pointer transition-colors"
      :class="[
        selected
          ? agent.mode === 'orchestrator'
            ? 'bg-ember-500/[0.06] border-l-2 border-purple-500/40'
            : 'bg-ember-500/[0.06] border-l-2 border-ember-500'
          : 'hover:bg-white/[0.03] border-l-2 border-transparent',
      ]"
      @click="$emit('agent-selected', agent.sessionId)"
      @contextmenu.prevent="openContextMenu($event)"
    >
      <!-- Avatar -->
      <div
        class="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 text-[10px] font-semibold text-white"
        :style="{ background: avatarGradient }"
      >
        {{ initials }}
      </div>

      <!-- Center info -->
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-1.5">
          <span v-if="agent.favorite" class="text-[10px] text-yellow-400 flex-shrink-0">&#9733;</span>
          <span
            class="text-xs font-medium truncate"
            :class="agent.status === 'done' ? 'text-txt-secondary' : 'text-txt-primary'"
          >{{ agent.title || 'Untitled' }}</span>
          <span
            v-if="agent.mode === 'orchestrator'"
            class="text-[9px] px-1 py-0 rounded bg-purple-500/15 text-purple-400 flex-shrink-0"
          >Pipeline</span>
          <span
            v-else-if="agent.mode"
            class="text-[9px] px-1 py-0 rounded bg-cyan-500/15 text-cyan-400 flex-shrink-0"
          >{{ agent.mode }}</span>
        </div>
        <div
          v-if="agent.activity"
          class="text-[10px] text-txt-muted truncate mt-0.5"
        >{{ agent.activity }}</div>
      </div>

      <!-- Right meta -->
      <div class="flex flex-col items-end gap-0.5 flex-shrink-0">
        <span
          class="w-2 h-2 rounded-full"
          :class="statusDotClass"
        />
        <span
          v-if="agent.costUsd > 0"
          class="text-[9px] font-mono text-txt-faint"
        >${{ agent.costUsd.toFixed(2) }}</span>
      </div>
    </button>

    <!-- Inline rename input -->
    <div
      v-if="isRenaming"
      class="absolute inset-0 flex items-center px-3 bg-base z-10"
    >
      <input
        ref="renameInput"
        v-model="renameText"
        @keydown.enter.prevent="confirmRename"
        @keydown.escape.prevent="isRenaming = false"
        @blur="confirmRename"
        class="w-full bg-raised rounded px-2 py-1.5 text-xs text-txt-primary outline-none border border-ember-500/50"
      />
    </div>

    <!-- Context menu -->
    <Teleport to="body">
      <div
        v-if="ctxOpen"
        ref="ctxMenu"
        class="fixed bg-raised border border-border-standard rounded-lg shadow-lg overflow-hidden z-50 min-w-[150px]"
        :style="{ top: ctxY + 'px', left: ctxX + 'px' }"
      >
        <button
          class="w-full text-left px-3 py-2 text-[11px] text-txt-secondary hover:bg-white/[0.05] transition-colors"
          @click="startRename"
        >
          Rename
        </button>
        <button
          class="w-full text-left px-3 py-2 text-[11px] text-txt-secondary hover:bg-white/[0.05] transition-colors"
          @click="toggleFavorite"
        >
          {{ agent.favorite ? 'Unfavorite' : 'Favorite' }}
        </button>
        <button
          class="w-full text-left px-3 py-2 text-[11px] text-txt-secondary hover:bg-white/[0.05] transition-colors"
          @click="copyChatId"
        >
          Copy Chat ID
        </button>
        <button
          class="w-full text-left px-3 py-2 text-[11px] text-txt-secondary hover:bg-white/[0.05] transition-colors"
          @click="exportChat"
        >
          Export chat
        </button>
        <div class="h-px bg-border-subtle my-0.5" />
        <button
          class="w-full text-left px-3 py-2 text-[11px] text-red-400 hover:bg-white/[0.05] transition-colors"
          @click="deleteAgent"
        >
          Delete
        </button>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue';
import type { HierarchicalAgent } from '../../stores/fleet';

const props = defineProps<{
  agent: HierarchicalAgent;
  selected: boolean;
}>();

const emit = defineEmits<{
  'agent-selected': [sessionId: string];
  'delete': [sessionId: string];
  'rename': [sessionId: string, newTitle: string];
  'favorite-toggle': [sessionId: string];
  'export-chat': [sessionId: string];
}>();

// ── Avatar ───────────────────────────────────────────────────────────

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #f59e0b, #ea580c)',
  'linear-gradient(135deg, #10b981, #059669)',
  'linear-gradient(135deg, #22d3ee, #0891b2)',
  'linear-gradient(135deg, #a855f6, #7c3aed)',
];

const avatarGradient = computed(() => {
  const hash = props.agent.sessionId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
});

const initials = computed(() => {
  const name = props.agent.title || 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
});

const statusDotClass = computed(() => {
  switch (props.agent.status) {
    case 'working': return 'bg-teal anim-breathe';
    case 'done': return 'bg-emerald-500/50';
    case 'error': return 'bg-accent-red';
    case 'blocked': return 'bg-yellow-400';
    default: return 'bg-txt-faint';
  }
});

// ── Context menu ─────────────────────────────────────────────────────

const ctxOpen = ref(false);
const ctxX = ref(0);
const ctxY = ref(0);
const ctxMenu = ref<HTMLElement | null>(null);
const rowRoot = ref<HTMLElement | null>(null);

function openContextMenu(e: MouseEvent) {
  ctxX.value = e.clientX;
  ctxY.value = e.clientY;
  ctxOpen.value = true;
}

function closeContextMenu() {
  ctxOpen.value = false;
}

function onDocClick(e: MouseEvent) {
  if (ctxMenu.value && !ctxMenu.value.contains(e.target as Node)) {
    closeContextMenu();
  }
}

onMounted(() => document.addEventListener('click', onDocClick));
onUnmounted(() => document.removeEventListener('click', onDocClick));

// ── Actions ──────────────────────────────────────────────────────────

const isRenaming = ref(false);
const renameText = ref('');
const renameInput = ref<HTMLInputElement | null>(null);

function startRename() {
  closeContextMenu();
  renameText.value = props.agent.title || '';
  isRenaming.value = true;
  nextTick(() => {
    renameInput.value?.focus();
    renameInput.value?.select();
  });
}

function confirmRename() {
  if (!isRenaming.value) return;
  isRenaming.value = false;
  const trimmed = renameText.value.trim();
  if (trimmed && trimmed !== props.agent.title) {
    emit('rename', props.agent.sessionId, trimmed);
  }
}

function toggleFavorite() {
  closeContextMenu();
  emit('favorite-toggle', props.agent.sessionId);
}

function copyChatId() {
  closeContextMenu();
  navigator.clipboard.writeText(props.agent.sessionId);
}

function exportChat() {
  closeContextMenu();
  emit('export-chat', props.agent.sessionId);
}

function deleteAgent() {
  closeContextMenu();
  emit('delete', props.agent.sessionId);
}
</script>
