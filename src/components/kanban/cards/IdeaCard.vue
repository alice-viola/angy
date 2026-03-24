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
      </div>
      <div class="flex items-center gap-2 mt-0.5">
        <span class="text-[10px] text-txt-faint">{{ projectName }}</span>
        <span v-if="actions.branchName.value" class="text-[10px] text-txt-faint font-mono truncate">{{ actions.branchName.value }}</span>
      </div>
    </div>

    <!-- Action -->
    <button
      class="text-[10px] px-1.5 py-0.5 bg-[var(--accent-teal)]/10 hover:bg-[var(--accent-teal)]/20 text-[var(--accent-teal)] rounded transition-colors flex-shrink-0"
      @click.stop="sendToQueue"
    >
      Queue
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, toRef } from 'vue';
import type { Epic } from '@/engine/KosTypes';
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

function sendToQueue() {
  epicStore.moveEpic(props.epic.id, 'todo');
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
  return 'border-l-purple-500/40 hover:bg-white/[0.03] cursor-grab active:cursor-grabbing';
});
</script>
