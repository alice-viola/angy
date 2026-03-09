<template>
  <div
    draggable="true"
    class="group rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-2
           cursor-grab active:cursor-grabbing transition-all hover:border-[var(--border-standard)]
           hover:shadow-md hover:shadow-black/20"
    @click="onSingleClick"
    @dblclick="onDoubleClick"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
  >
    <!-- Title -->
    <div class="text-sm font-medium text-[var(--text-primary)] leading-snug mb-1.5">
      {{ epic.title }}
    </div>

    <!-- Badges row -->
    <div class="flex items-center gap-1.5 flex-wrap">
      <!-- Priority badge -->
      <span
        class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
        :class="priorityClass"
      >
        {{ epic.priorityHint }}
      </span>

      <!-- Complexity badge -->
      <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-raised)] text-[var(--text-secondary)]">
        {{ epic.complexity }}
      </span>

      <!-- Status indicator -->
      <span v-if="epic.column === 'in-progress'" class="flex items-center gap-0.5 text-[10px] text-[var(--accent-blue)]">
        <span class="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent-blue)] animate-pulse" />
        running
        <button
          class="ml-0.5 p-0.5 rounded text-red-400 hover:bg-red-500/20 transition-colors"
          title="Stop epic"
          @click.stop="stopEpic"
        >
          <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" rx="1" /></svg>
        </button>
      </span>
      <span v-else-if="epic.column === 'review'" class="flex items-center gap-0.5 text-[10px] text-[var(--accent-yellow)]">
        <svg class="w-3 h-3" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2c3.3 0 6 2.7 6 6s-2.7 6-6 6-6-2.7-6-6 2.7-6 6-6zm0 1C5.2 3 3 5.2 3 8s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5zm0 2a3 3 0 110 6 3 3 0 010-6z"/></svg>
        review
      </span>

      <!-- Agent count -->
      <span v-if="agentCount > 0" class="flex items-center gap-0.5 text-[10px] text-[var(--text-secondary)]">
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        {{ agentCount }}
      </span>
    </div>

    <!-- Repo tags -->
    <div v-if="epic.targetRepoIds.length > 0" class="flex items-center gap-1 flex-wrap mt-1.5">
      <span
        v-for="repoId in epic.targetRepoIds"
        :key="repoId"
        class="text-[9px] px-1.5 py-0.5 rounded bg-[var(--bg-raised)] text-[var(--text-muted)]"
      >
        {{ repoName(repoId) }}
      </span>
    </div>

    <!-- Branch -->
    <div v-if="branchName" class="flex items-center gap-1 mt-1.5">
      <svg class="w-3 h-3 text-[var(--text-muted)] flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
        <path fill-rule="evenodd" d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z"/>
      </svg>
      <span class="text-[9px] px-1.5 py-0.5 rounded bg-[var(--bg-raised)] text-[var(--accent-green)] font-mono truncate max-w-[140px]" :title="branchName">
        {{ branchName }}
      </span>
    </div>

    <!-- Move left/right arrows -->
    <div class="flex items-center justify-end gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        v-if="currentIndex > 0"
        class="p-0.5 rounded text-[var(--text-faint)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-raised)] transition-colors"
        title="Move left"
        @click.stop="moveLeft"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <button
        v-if="currentIndex >= 0 && currentIndex < columnOrder.length - 1"
        class="p-0.5 rounded text-[var(--text-faint)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-raised)] transition-colors"
        title="Move right"
        @click.stop="moveRight"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Epic, EpicColumn } from '@/engine/KosTypes';
import { useUiStore } from '@/stores/ui';
import { useProjectsStore } from '@/stores/projects';
import { useEpicStore } from '@/stores/epics';
import { useSessionsStore } from '@/stores/sessions';
import { engineBus } from '@/engine/EventBus';

const props = defineProps<{ epic: Epic }>();
const emit = defineEmits<{ select: [id: string] }>();

const ui = useUiStore();
const projectsStore = useProjectsStore();
const epicStore = useEpicStore();
const sessionsStore = useSessionsStore();

const branchName = computed(() => epicStore.epicBranchName(props.epic.id));

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

const columnOrder: EpicColumn[] = ['idea', 'backlog', 'todo', 'in-progress', 'review', 'done'];
const currentIndex = computed(() => columnOrder.indexOf(props.epic.column));

async function moveToColumn(targetColumn: EpicColumn) {
  if (targetColumn === 'in-progress') {
    // Route through scheduler so an orchestrator is spawned
    console.log(`[EpicCard] Requesting start for epic: ${props.epic.id}`);
    engineBus.emit('epic:requestStart', { epicId: props.epic.id });
  } else {
    await epicStore.moveEpic(props.epic.id, targetColumn);
  }
}

async function moveLeft() {
  const idx = currentIndex.value;
  if (idx > 0) {
    await moveToColumn(columnOrder[idx - 1]);
  }
}

async function moveRight() {
  const idx = currentIndex.value;
  if (idx < columnOrder.length - 1) {
    await moveToColumn(columnOrder[idx + 1]);
  }
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

function repoName(repoId: string) {
  const repos = projectsStore.reposByProjectId(props.epic.projectId);
  const repo = repos.find((r) => r.id === repoId);
  return repo?.name ?? repoId.slice(0, 8);
}
</script>
