<template>
  <div
    class="agent-card relative cursor-pointer rounded-md transition-colors group"
    :class="[
      selected ? 'bg-[var(--bg-raised)]' : 'hover:bg-white/[0.03]',
      collapsed ? 'flex items-center justify-center h-9' : 'py-2',
    ]"
    :style="{
      paddingLeft: collapsed ? undefined : `${14 + depth * 16}px`,
      paddingRight: collapsed ? undefined : '10px',
    }"
    @click="$emit('select', agent.sessionId)"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
    @dblclick="startRename()"
    @contextmenu.prevent="showContextMenu"
  >
    <!-- Collapsed mode: centered status dot only -->
    <template v-if="collapsed">
      <div
        class="rounded-full"
        :class="statusDotClass"
        :style="collapsedDotStyle"
      />
    </template>

    <!-- Expanded mode -->
    <template v-else>
      <!-- Intensity wash background -->
      <div
        v-if="intensity > 0.01 && !selected"
        class="absolute inset-x-[2px] inset-y-[1px] rounded-md pointer-events-none"
        :style="{ background: intensityWashColor }"
      />

      <!-- Selection teal border -->
      <div
        v-if="selected"
        class="absolute inset-x-[2px] inset-y-[1px] rounded-md border pointer-events-none"
        style="border-color: var(--accent-teal); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-teal) 40%, transparent)"
      />

      <!-- Orchestrator root: mauve accent bar -->
      <div
        v-if="isOrchestratorRoot"
        class="absolute left-[2px] top-1 bottom-1 w-[3px] rounded-sm pointer-events-none"
        :style="{ background: `color-mix(in srgb, var(--accent-mauve) ${selected ? '80%' : '55%'}, transparent)` }"
      />

      <!-- Chevron toggle for orchestrator root -->
      <button
        v-if="isOrchestratorRoot"
        class="absolute left-[3px] top-1/2 -translate-y-1/2 w-[18px] h-5 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
        @click.stop="$emit('collapse-toggle', agent.sessionId)"
      >
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" stroke-width="1.3">
          <path v-if="childrenCollapsed" d="M2 1L6 4L2 7" />
          <path v-else d="M1 2L4 6L7 2" />
        </svg>
      </button>

      <!-- Connector lines for child agents -->
      <div
        v-if="depth > 0"
        class="absolute pointer-events-none"
        :style="connectorStyle"
      >
        <div class="absolute top-0 bottom-0 w-px bg-[var(--border-standard)]" style="left: 4px" />
        <div class="absolute w-[10px] h-px bg-[var(--border-standard)]" style="left: 4px; top: 50%" />
      </div>

      <!-- First line: dot + star + title -->
      <div class="flex items-center gap-1.5 min-w-0 h-5">
        <!-- Status dot -->
        <div
          class="shrink-0 rounded-full"
          :class="statusDotClass"
          :style="statusDotStyle"
        />

        <!-- Favorite star -->
        <span v-if="agent.favorite" class="shrink-0 text-[var(--accent-yellow)] text-[10px] leading-none">&#9733;</span>

        <!-- Title (inline editable) -->
        <input
          v-if="isEditing"
          ref="editInput"
          v-model="editText"
          class="text-[13px] font-medium truncate bg-transparent border border-[var(--accent-teal)] rounded px-1 outline-none text-[var(--text-primary)] w-full min-w-0"
          @keydown.enter="commitRename"
          @keydown.escape="cancelRename"
          @blur="commitRename"
          @click.stop
        />
        <span v-else class="text-[13px] font-medium truncate" :class="selected ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'">
          {{ agent.title || 'New Agent' }}
        </span>

        <!-- Epic badge -->
        <span
          v-if="agent.epicId"
          class="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full leading-none"
          style="background: color-mix(in srgb, var(--accent-mauve) 20%, transparent); color: var(--accent-mauve)"
        >
          Epic {{ shortEpicId }}
        </span>

        <!-- Unviewed dot -->
        <div
          v-if="unviewed"
          class="shrink-0 w-2 h-2 rounded-full"
          style="background: var(--accent-mauve)"
        />

        <!-- Delete button (on hover) -->
        <button
          v-show="hovered"
          @click.stop="$emit('delete', agent.sessionId)"
          class="shrink-0 ml-auto w-5 h-5 flex items-center justify-center rounded text-[var(--text-faint)] hover:text-[var(--accent-red)] hover:bg-white/[0.05]"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.2">
            <path d="M2 2L8 8M8 2L2 8" />
          </svg>
        </button>
      </div>

      <!-- Second line: activity or timestamp -->
      <div class="flex items-center gap-1.5 min-w-0 h-4 mt-0.5" :style="{ paddingLeft: agent.favorite ? '22px' : '14px' }">
        <!-- Collapsed badge for orchestrator roots -->
        <span v-if="isOrchestratorRoot && childrenCollapsed && childCount > 0" class="text-[11px] text-[var(--accent-mauve)]">
          {{ childCount }} agent{{ childCount > 1 ? 's' : '' }}
        </span>
        <!-- Activity text when working -->
        <span v-else-if="agent.status === 'working' && agent.activity" class="text-[11px] text-[var(--accent-green)] truncate">
          {{ agent.activity }}
        </span>
        <!-- Relative timestamp when idle -->
        <span v-else-if="agent.updatedAt > 0" class="text-[11px] text-[var(--text-muted)]">
          {{ relativeTime }}
        </span>

        <!-- Cost badge -->
        <span v-if="agent.costUsd > 0" class="text-[11px] text-[var(--text-faint)] ml-auto">
          ${{ agent.costUsd.toFixed(2) }}
        </span>
      </div>
    </template>

    <!-- Context menu -->
    <Teleport to="body">
      <div
        v-if="contextMenuVisible"
        class="fixed z-50 bg-[var(--bg-raised)] border border-[var(--border-standard)] rounded-md py-1 shadow-lg min-w-[140px]"
        :style="{ left: `${contextMenuPos.x}px`, top: `${contextMenuPos.y}px` }"
        @click="contextMenuVisible = false"
      >
        <button class="w-full text-left px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]" @click="startRename()">
          Rename...
        </button>
        <button class="w-full text-left px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]" @click="$emit('favorite-toggle', agent.sessionId)">
          {{ agent.favorite ? 'Unfavorite' : 'Favorite' }}
        </button>
        <button class="w-full text-left px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]" @click="copySessionId()">
          Copy Session ID
        </button>
        <button class="w-full text-left px-3 py-1.5 text-xs text-[var(--accent-mauve)] hover:bg-[var(--bg-surface)]" @click="$emit('transform-to-epic', agent.sessionId)">
          Transform into Epic
        </button>
        <div class="h-px bg-[var(--border-subtle)] my-1" />
        <button class="w-full text-left px-3 py-1.5 text-xs text-[var(--accent-red)] hover:bg-[var(--bg-surface)]" @click="$emit('delete', agent.sessionId)">
          Delete
        </button>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import type { AgentSummary } from '../../engine/types';

// ── Props / Emits ────────────────────────────────────────────────────────

interface HierarchicalAgent extends AgentSummary {
  depth?: number;
  isOrchestratorRoot?: boolean;
  childCount?: number;
}

const props = defineProps<{
  agent: HierarchicalAgent;
  selected: boolean;
  collapsed?: boolean;
  childrenCollapsed?: boolean;
  unviewed?: boolean;
}>();

const emit = defineEmits<{
  select: [sessionId: string];
  delete: [sessionId: string];
  rename: [sessionId: string, newTitle: string];
  'favorite-toggle': [sessionId: string];
  'collapse-toggle': [sessionId: string];
  'transform-to-epic': [sessionId: string];
}>();

// ── Local state ──────────────────────────────────────────────────────────

const hovered = ref(false);
const contextMenuVisible = ref(false);
const contextMenuPos = ref({ x: 0, y: 0 });
const isEditing = ref(false);
const editText = ref('');
const editInput = ref<HTMLInputElement | null>(null);

// ── Computed ─────────────────────────────────────────────────────────────

const shortEpicId = computed(() => {
  if (!props.agent.epicId) return '';
  return props.agent.epicId.length > 8
    ? props.agent.epicId.slice(0, 8)
    : props.agent.epicId;
});

const depth = computed(() => (props.agent as HierarchicalAgent).depth ?? 0);
const isOrchestratorRoot = computed(() => (props.agent as HierarchicalAgent).isOrchestratorRoot ?? false);
const childCount = computed(() => (props.agent as HierarchicalAgent).childCount ?? 0);

// Intensity: based on edit count (proxy for turn count) + recency
const intensity = computed(() => {
  const turnIntensity = Math.min(1, props.agent.editCount / 8);
  let recencyBoost = 0;
  if (props.agent.updatedAt > 0) {
    const ageSecs = Math.floor(Date.now() / 1000) - props.agent.updatedAt;
    if (ageSecs < 3600) {
      recencyBoost = 0.3 * (1 - ageSecs / 3600);
    } else if (ageSecs < 86400) {
      recencyBoost = 0.1 * (1 - ageSecs / 86400);
    }
  }
  return Math.min(1, turnIntensity + recencyBoost);
});

const intensityWashColor = computed(() => {
  const alpha = Math.round(intensity.value * 100);
  const color = props.agent.status === 'working' ? 'var(--accent-green)' : 'var(--accent-teal)';
  return `color-mix(in srgb, ${color} ${Math.round((alpha / 255) * 100)}%, transparent)`;
});

// Status dot styling
const statusDotClass = computed(() => {
  if (props.agent.status === 'blocked') return 'bg-[var(--accent-yellow)]';
  if (props.agent.status === 'working') return 'bg-[var(--accent-green)] animate-pulse-dot';
  return 'bg-[var(--border-standard)]';
});

const statusDotStyle = computed(() => {
  const isActive = props.agent.status === 'working' || props.agent.status === 'blocked';
  return {
    width: isActive ? '8px' : '6px',
    height: isActive ? '8px' : '6px',
  };
});

const collapsedDotStyle = computed(() => {
  const r = 5 + intensity.value * 2;
  return {
    width: `${r * 2}px`,
    height: `${r * 2}px`,
  };
});

const connectorStyle = computed(() => ({
  left: `${14 + (depth.value - 1) * 16}px`,
  top: '0',
  bottom: '0',
  width: '20px',
}));

// Relative time
const relativeTime = computed(() => {
  if (!props.agent.updatedAt) return '';
  const now = Math.floor(Date.now() / 1000);
  const ageSecs = now - props.agent.updatedAt;

  if (ageSecs < 60) return 'Just now';
  if (ageSecs < 3600) return `${Math.floor(ageSecs / 60)}m ago`;
  if (ageSecs < 86400) return `${Math.floor(ageSecs / 3600)}h ago`;

  const date = new Date(props.agent.updatedAt * 1000);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return 'Today ' + date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday ' + date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
});

// ── Inline rename ────────────────────────────────────────────────────────

function startRename() {
  editText.value = props.agent.title || '';
  isEditing.value = true;
  nextTick(() => {
    editInput.value?.focus();
    editInput.value?.select();
  });
}

function commitRename() {
  if (!isEditing.value) return;
  isEditing.value = false;
  const trimmed = editText.value.trim();
  if (trimmed && trimmed !== props.agent.title) {
    emit('rename', props.agent.sessionId, trimmed);
  }
}

function cancelRename() {
  isEditing.value = false;
}

function copySessionId() {
  navigator.clipboard.writeText(props.agent.sessionId);
}

// ── Context menu ─────────────────────────────────────────────────────────

function showContextMenu(e: MouseEvent) {
  contextMenuPos.value = { x: e.clientX, y: e.clientY };
  contextMenuVisible.value = true;
}

function closeContextMenu() {
  contextMenuVisible.value = false;
}

onMounted(() => {
  document.addEventListener('click', closeContextMenu);
});

onUnmounted(() => {
  document.removeEventListener('click', closeContextMenu);
});
</script>

<style scoped>
@keyframes pulse-dot {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}

.animate-pulse-dot {
  animation: pulse-dot 1.6s ease-in-out infinite;
}
</style>
