<template>
  <div
    class="group relative rounded-xl border p-3 transition-colors select-none"
    :class="cardClasses"
    @click="actions.onSingleClick"
    @dblclick="actions.onDoubleClick"
    @pointerdown="actions.onPointerDown"
  >
    <div class="absolute left-0 top-2 bottom-2 w-[3px] rounded-r" :style="{ backgroundColor: projectColor + '66' }" />

    <div class="pl-2.5">
      <!-- Top row: Epic ID + project dot + project name + priority -->
      <div class="flex items-center gap-2 mb-1.5">
        <span class="w-1.5 h-1.5 rounded-full" :style="{ backgroundColor: projectColor }" />
        <span class="text-[10px] text-txt-faint">{{ projectName }}</span>
        <PriorityBadge v-if="epic.priorityHint !== 'none'" :priority="epic.priorityHint" class="ml-auto" />
      </div>

      <!-- Title -->
      <p class="text-xs text-txt-primary font-medium leading-snug">{{ epic.title }}</p>

      <!-- Blocking reasons -->
      <div v-if="blockingReasons.length" class="flex flex-wrap gap-1 mt-1">
        <span
          v-for="reason in blockingReasons"
          :key="reason.type + (reason.relatedEpicId ?? '')"
          :class="reasonClass(reason)"
        >{{ reasonShortLabel(reason) }}</span>
      </div>

      <!-- Action / State bar -->
      <div class="flex items-center gap-1 mt-1.5 justify-between">
        <div class="flex items-center gap-1">
          <svg v-if="actions.branchName.value" class="w-3 h-3 text-txt-faint flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />
          </svg>
          <span v-if="actions.branchName.value" class="text-[10px] text-txt-faint font-mono truncate">{{ actions.branchName.value }}</span>

          <span v-if="epic.suspendedAt" class="text-[10px] text-amber-400 ml-1">suspended</span>
          <button
            v-if="epic.suspendedAt"
            class="p-0.5 rounded text-amber-400 hover:bg-amber-500/20 transition-colors"
            title="Resume"
            @click.stop="actions.resumeEpic"
          >
            <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z" /></svg>
          </button>
        </div>
        
        <button
          class="text-[10px] px-1.5 py-0.5 bg-border-subtle hover:bg-border-standard text-txt-secondary rounded transition-colors"
          @click.stop="sendToIcebox"
        >
          Icebox
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, toRef } from 'vue';
import type { Epic, BlockingReason } from '@/engine/KosTypes';
import { useProjectsStore } from '@/stores/projects';
import { useEpicStore } from '@/stores/epics';
import { useEpicCardActions } from '@/composables/useEpicCardActions';
import PriorityBadge from './PriorityBadge.vue';

const ACCENT_COLORS = ['#f59e0b', '#22d3ee', '#10b981', '#FF6B8A', '#cba6f7', '#89b4fa'];

const props = withDefaults(defineProps<{
  epic: Epic;
  selectable?: boolean;
  selected?: boolean;
}>(), {
  selectable: false,
  selected: false,
});

const emit = defineEmits<{
  select: [id: string];
  'toggle-select': [id: string];
}>();

const projectsStore = useProjectsStore();
const epicStore = useEpicStore();

function sendToIcebox() {
  epicStore.moveEpic(props.epic.id, 'backlog');
}

const blockingReasons = computed(() => epicStore.getBlockingReasons(props.epic.id));

function reasonClass(reason: BlockingReason): string {
  const base = 'text-[10px] px-1.5 py-0.5 rounded-full';
  if (reason.type === 'runAfter' || reason.type === 'dependency')
    return `${base} bg-amber-500/10 text-amber-400`;
  if (reason.type === 'repoLock')
    return `${base} bg-red-500/10 text-red-400`;
  if (reason.type === 'concurrency' || reason.type === 'projectConcurrency')
    return `${base} bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]`;
  return `${base} bg-[var(--accent-yellow)]/10 text-[var(--accent-yellow)]`;
}

function reasonShortLabel(reason: BlockingReason): string {
  const map: Record<string, string> = {
    runAfter: 'after', dependency: 'dep', repoLock: 'locked',
    concurrency: 'limit', projectConcurrency: 'proj limit', budget: 'budget',
  };
  return map[reason.type] ?? reason.type;
}

const actions = useEpicCardActions({
  epic: toRef(props, 'epic'),
  selectable: toRef(props, 'selectable'),
  selected: toRef(props, 'selected'),
  emit,
});

const projectName = computed(() => {
  const p = projectsStore.projects.find(p => p.id === props.epic.projectId);
  return p?.name ?? props.epic.projectId.slice(0, 8);
});

const projectColor = computed(() => {
  const idx = projectsStore.projects.findIndex(p => p.id === props.epic.projectId);
  return ACCENT_COLORS[Math.max(0, idx) % ACCENT_COLORS.length];
});

const cardClasses = computed(() => {
  if (props.selectable && props.selected) {
    return 'border-[var(--accent-teal)] bg-[var(--accent-teal)]/5 cursor-pointer';
  }
  return 'border-border-subtle bg-surface cursor-grab active:cursor-grabbing hover:border-ember-500/20';
});
</script>
