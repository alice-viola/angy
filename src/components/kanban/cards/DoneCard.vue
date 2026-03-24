<template>
  <div
    class="group rounded-md px-3 py-2 flex items-center gap-2 transition-colors select-none border-l-2"
    :class="cardClasses"
    @click="actions.onSingleClick"
    @dblclick="actions.onDoubleClick"
    @pointerdown="actions.onPointerDown"
  >
    <!-- Green checkmark -->
    <svg class="w-3 h-3 flex-shrink-0" fill="none" stroke="#10b981" stroke-width="2.5" viewBox="0 0 24 24">
      <path d="M20 6L9 17l-5-5" />
    </svg>

    <!-- Project color dot -->
    <span class="w-1.5 h-1.5 rounded-full flex-shrink-0" :style="{ backgroundColor: projectColor }" />

    <!-- Title -->
    <span class="text-[11px] text-txt-secondary truncate">{{ epic.title }}</span>

    <!-- File change count -->
    <span class="text-[10px] text-txt-faint ml-auto flex-shrink-0">{{ changeCount }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed, toRef } from 'vue';
import type { Epic } from '@/engine/KosTypes';
import { useProjectsStore } from '@/stores/projects';
import { useEpicCardActions } from '@/composables/useEpicCardActions';

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

const actions = useEpicCardActions({
  epic: toRef(props, 'epic'),
  selectable: toRef(props, 'selectable'),
  selected: toRef(props, 'selected'),
  emit,
});

const projectColor = computed(() => {
  const idx = projectsStore.projects.findIndex(p => p.id === props.epic.projectId);
  return ACCENT_COLORS[Math.max(0, idx) % ACCENT_COLORS.length];
});

const changeCount = computed(() => props.epic.lastAttemptFiles?.length ?? 0);

const cardClasses = computed(() => {
  if (props.selectable && props.selected) {
    return 'border-l-[var(--accent-teal)] bg-[var(--accent-teal)]/5 cursor-pointer';
  }
  return 'border-l-emerald-500/30 hover:bg-white/[0.03] cursor-grab active:cursor-grabbing';
});
</script>
