<template>
  <div
    class="group relative flex items-center gap-2.5 px-3 py-2 rounded-md transition-colors select-none border-l-2"
    :class="cardClasses"
    @click="actions.onSingleClick"
    @dblclick="actions.onDoubleClick"
    @pointerdown="actions.onPointerDown"
  >
    <!-- Project dot -->
    <span class="w-1.5 h-1.5 rounded-full flex-shrink-0" :style="{ backgroundColor: projectColor }" />

    <!-- Content -->
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-1.5">
        <span class="text-xs font-medium text-txt-primary truncate">{{ epic.title }}</span>
        <PriorityBadge v-if="epic.priorityHint !== 'none'" :priority="epic.priorityHint" class="flex-shrink-0" />
        <span v-if="epic.suspendedAt" class="text-[9px] px-1 py-0 rounded bg-amber-500/15 text-amber-400 flex-shrink-0">suspended</span>
      </div>
      <div class="flex items-center gap-2 mt-0.5">
        <span class="text-[10px] text-txt-faint">{{ projectName }}</span>
        <span v-if="actions.branchName.value" class="text-[10px] text-txt-faint font-mono truncate">{{ actions.branchName.value }}</span>
        <!-- Blocking reasons inline -->
        <span
          v-for="reason in blockingReasons"
          :key="reason.type + (reason.relatedEpicId ?? '')"
          :class="reasonClass(reason)"
        >{{ reasonShortLabel(reason) }}</span>
      </div>
    </div>

    <!-- Actions -->
    <div class="flex items-center gap-1 flex-shrink-0">
      <button
        v-if="epic.suspendedAt"
        class="p-1 rounded text-amber-400 hover:bg-amber-500/20 transition-colors"
        title="Resume"
        @click.stop="actions.resumeEpic"
      >
        <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z" /></svg>
      </button>
      <button
        class="text-[10px] px-1.5 py-0.5 bg-white/[0.03] hover:bg-white/[0.06] text-txt-secondary rounded transition-colors"
        @click.stop="sendToIcebox"
      >
        Icebox
      </button>
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
  const base = 'text-[9px] px-1 py-0 rounded';
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
    return 'border-l-[var(--accent-teal)] bg-[var(--accent-teal)]/5 cursor-pointer';
  }
  return 'border-l-ember-500/40 hover:bg-white/[0.03] cursor-grab active:cursor-grabbing';
});
</script>
