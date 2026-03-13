<template>
  <div
    :draggable="!selectable"
    class="epic-card group rounded-[var(--radius-md)] border px-3 py-2.5"
    style="box-shadow: var(--shadow-sm)"
    :class="cardClasses"
    @click="onSingleClick"
    @dblclick="onDoubleClick"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
  >
    <!-- Project color stripe (multi-project mode) -->
    <div
      v-if="showProjectBadge && projectInfo"
      class="absolute left-0 top-1 bottom-1 w-[3px] rounded-sm"
      :style="{ background: projectInfo.color }"
    />
    <!-- Selection checkbox -->
    <div v-if="selectable" class="flex items-center justify-end mb-1">
      <div
        class="w-4 h-4 rounded border flex items-center justify-center transition-colors cursor-pointer"
        :class="selectCheckboxClasses"
        @click.stop="onToggleSelect"
      >
        <svg v-if="selected" class="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
    </div>
    <!-- Project badge (multi-project mode) -->
    <div v-if="showProjectBadge && projectInfo" class="flex items-center gap-1.5 mb-1">
      <div class="w-2 h-2 rounded-full shrink-0" :style="{ background: projectInfo.color }"></div>
      <span class="text-[var(--text-xs)] text-[var(--text-muted)] truncate">{{ projectInfo.name }}</span>
    </div>
    <!-- Title -->
    <div class="text-[var(--text-base)] font-medium text-[var(--text-primary)] leading-snug mb-1.5">
      {{ epic.title }}
    </div>

    <!-- Badges row -->
    <div class="flex items-center gap-1.5 flex-wrap">
      <!-- Priority badge -->
      <span
        class="text-[var(--text-xs)] font-semibold px-1.5 py-0.5 rounded-full"
        :class="priorityClass"
      >
        {{ epic.priorityHint }}
      </span>

      <!-- Status indicator -->
      <span v-if="epic.column === 'in-progress'" class="flex items-center gap-0.5 text-[var(--text-xs)] text-[var(--accent-blue)]">
        <span class="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent-blue)] animate-pulse" />
        running
        <button
          class="ml-0.5 p-0.5 rounded text-amber-400 hover:bg-amber-500/20 transition-colors"
          title="Suspend epic"
          @click.stop="suspendEpic"
        >
          <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 16 16"><rect x="4" y="3" width="3" height="10" rx="0.5" /><rect x="9" y="3" width="3" height="10" rx="0.5" /></svg>
        </button>
        <button
          class="p-0.5 rounded text-red-400 hover:bg-red-500/20 transition-colors"
          title="Stop epic"
          @click.stop="stopEpic"
        >
          <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" rx="1" /></svg>
        </button>
      </span>
      <span v-else-if="epic.suspendedAt && (epic.column === 'todo' || epic.column === 'backlog')" class="flex items-center gap-0.5 text-[var(--text-xs)] text-amber-400">
        suspended
        <button
          class="ml-0.5 p-0.5 rounded text-amber-400 hover:bg-amber-500/20 transition-colors"
          title="Resume epic"
          @click.stop="resumeEpic"
        >
          <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z" /></svg>
        </button>
      </span>
      <span v-else-if="epic.column === 'review'" class="flex items-center gap-0.5 text-[var(--text-xs)] text-[var(--accent-yellow)]">
        <svg class="w-3 h-3" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2c3.3 0 6 2.7 6 6s-2.7 6-6 6-6-2.7-6-6 2.7-6 6-6zm0 1C5.2 3 3 5.2 3 8s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5zm0 2a3 3 0 110 6 3 3 0 010-6z"/></svg>
        review
      </span>

      <!-- Agent count -->
      <span v-if="agentCount > 0" class="flex items-center gap-0.5 text-[var(--text-xs)] text-[var(--text-secondary)]">
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        {{ agentCount }}
      </span>
    </div>

    <!-- PR button (done epics with branches) -->
    <div v-if="epic.column === 'done' && branchName" class="flex items-center justify-end gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        class="p-1 rounded hover:bg-[var(--bg-raised)] transition-colors"
        :class="prLoading ? 'opacity-50 pointer-events-none text-[var(--text-faint)]' : prError ? 'text-red-400 hover:text-red-300' : 'text-[var(--text-faint)] hover:text-[var(--accent-green)]'"
        :title="prError || 'Create Pull Request'"
        @click.stop="createPR(epic.id, epic.projectId)"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 15v6m-3-3h6M6 9a3 3 0 100-6 3 3 0 000 6zm0 0v9m12-3a3 3 0 100-6 3 3 0 000 6z" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Epic } from '@/engine/KosTypes';
import { useUiStore } from '@/stores/ui';
import { useProjectsStore } from '@/stores/projects';

import { useEpicStore } from '@/stores/epics';
import { useSessionsStore } from '@/stores/sessions';
import { engineBus } from '@/engine/EventBus';
import { useCreatePR } from '@/composables/useCreatePR';

const props = withDefaults(defineProps<{
  epic: Epic;
  selectable?: boolean;
  selected?: boolean;
  showProjectBadge?: boolean;
}>(), {
  selectable: false,
  selected: false,
  showProjectBadge: false,
});
const emit = defineEmits<{
  select: [id: string];
  'toggle-select': [id: string];
}>();

const ui = useUiStore();
const projectsStore = useProjectsStore();
const epicStore = useEpicStore();
const sessionsStore = useSessionsStore();

const projectInfo = computed(() => {
  const project = projectsStore.projectById(props.epic.projectId);
  return project ? { name: project.name, color: project.color || '#cba6f7' } : null;
});

const branchName = computed(() => epicStore.epicBranchName(props.epic.id));
const { loading: prLoading, error: prError, createPR } = useCreatePR();

const hasBranch = computed(() => !!branchName.value);
const selectDisabled = computed(() => props.selectable && !hasBranch.value);

const cardClasses = computed(() => {
  if (props.selectable && selectDisabled.value) {
    return 'border-[var(--border-subtle)] bg-[var(--bg-surface)] opacity-40 cursor-not-allowed';
  }
  if (props.selectable && props.selected) {
    return 'border-[var(--accent-teal)] bg-[var(--accent-teal)]/5 cursor-pointer hover:border-[var(--accent-teal)]';
  }
  if (props.selectable) {
    return 'border-[var(--border-subtle)] bg-[var(--bg-surface)] cursor-pointer hover:border-[var(--border-standard)]';
  }
  return 'border-[var(--border-subtle)] bg-[var(--bg-surface)] cursor-grab active:cursor-grabbing hover:border-[var(--border-standard)]';
});

const selectCheckboxClasses = computed(() => {
  if (selectDisabled.value) {
    return 'border-[var(--border-subtle)] bg-[var(--bg-raised)] cursor-not-allowed';
  }
  if (props.selected) {
    return 'border-[var(--accent-teal)] bg-[var(--accent-teal)]';
  }
  return 'border-[var(--border-standard)] bg-transparent hover:border-[var(--accent-teal)]';
});

function onToggleSelect() {
  if (!selectDisabled.value) {
    emit('toggle-select', props.epic.id);
  }
}

const agentCount = computed(() => {
  const rootId = props.epic.rootSessionId;
  if (!rootId) return 0;
  let count = 0;
  for (const info of sessionsStore.sessions.values()) {
    if (info.sessionId === rootId || info.parentSessionId === rootId) {
      count++;
    }
  }
  return count;
});

// Debounce single click so double-click can cancel it
let clickTimer: ReturnType<typeof setTimeout> | null = null;

function onSingleClick() {
  if (props.selectable) {
    if (!selectDisabled.value) {
      emit('toggle-select', props.epic.id);
    }
    return;
  }
  if (clickTimer) clearTimeout(clickTimer);
  clickTimer = setTimeout(() => {
    clickTimer = null;
    emit('select', props.epic.id);
  }, 250);
}

function onDoubleClick() {
  if (clickTimer) {
    clearTimeout(clickTimer);
    clickTimer = null;
  }
  ui.navigateToEpic(props.epic.id, props.epic.projectId);
}

function stopEpic() {
  engineBus.emit('epic:requestStop', { epicId: props.epic.id });
}

function suspendEpic() {
  engineBus.emit('epic:requestSuspend', { epicId: props.epic.id });
}

function resumeEpic() {
  engineBus.emit('epic:requestStart', { epicId: props.epic.id });
}

function onDragStart(e: DragEvent) {
  e.dataTransfer!.effectAllowed = 'move';
  e.dataTransfer!.setData('text/plain', props.epic.id);
  (e.target as HTMLElement).classList.add('opacity-40');
}

function onDragEnd(e: DragEvent) {
  (e.target as HTMLElement).classList.remove('opacity-40');
}

const priorityClass = computed(() => {
  switch (props.epic.priorityHint) {
    case 'critical': return 'bg-red-500/20 text-red-400';
    case 'high': return 'bg-orange-500/20 text-orange-400';
    case 'medium': return 'bg-blue-500/20 text-blue-400';
    case 'low': return 'bg-gray-500/20 text-gray-400';
    default: return 'bg-gray-500/20 text-gray-500';
  }
});
</script>

<style scoped>
.epic-card {
  transition: all var(--transition-fast);
}
.epic-card:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}
</style>
