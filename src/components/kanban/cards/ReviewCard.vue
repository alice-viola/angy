<template>
  <div
    class="group relative rounded-lg border border-orange-400/20 p-3 transition-colors select-none"
    :class="cardClasses"
    @click="actions.onSingleClick"
    @dblclick="actions.onDoubleClick"
    @pointerdown="actions.onPointerDown"
  >
    <div class="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-orange-400" />

    <div class="pl-2.5">
      <!-- Top row: project dot + project name + review badge -->
      <div class="flex items-center gap-2 mb-1.5">
        <span class="w-1.5 h-1.5 rounded-full" :style="{ backgroundColor: projectColor }" />
        <span class="text-[10px] text-txt-faint">{{ projectName }}</span>
        <span class="text-[9px] px-1 py-0 rounded bg-orange-500/15 text-orange-400 ml-auto">review</span>
      </div>

      <!-- Title -->
      <p class="text-xs text-txt-primary font-medium leading-snug">{{ epic.title }}</p>

      <!-- Needs review + changes -->
      <div class="flex items-center gap-2 mt-1">
        <span class="text-[10px] text-orange-400 flex items-center gap-1">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
          </svg>
          needs review
        </span>
        <span v-if="changeCount > 0" class="text-[10px] text-txt-faint">{{ changeCount }} changes</span>
      </div>

      <!-- Action Buttons -->
      <div class="flex items-center gap-2 mt-2.5">
        <button
          class="flex-1 py-1 px-2 bg-[var(--accent-green)]/10 text-[var(--accent-green)] hover:bg-[var(--accent-green)]/20 rounded text-[11px] font-medium transition-colors"
          @click.stop="approveEpic"
        >
          Approve
        </button>
        <button
          class="flex-1 py-1 px-2 bg-[var(--accent-red)]/10 text-[var(--accent-red)] hover:bg-[var(--accent-red)]/20 rounded text-[11px] font-medium transition-colors"
          @click.stop="rejectEpic"
        >
          Reject
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, toRef } from 'vue';
import type { Epic } from '@/engine/KosTypes';
import { useProjectsStore } from '@/stores/projects';
import { useEpicCardActions } from '@/composables/useEpicCardActions';
import { useEpicStore } from '@/stores/epics';

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

const actions = useEpicCardActions({
  epic: toRef(props, 'epic'),
  selectable: toRef(props, 'selectable'),
  selected: toRef(props, 'selected'),
  emit,
});

function approveEpic() {
  epicStore.moveEpic(props.epic.id, 'done');
}

function rejectEpic() {
  epicStore.moveEpic(props.epic.id, 'todo');
  epicStore.incrementRejection(props.epic.id);
}

const projectName = computed(() => {
  const p = projectsStore.projects.find(p => p.id === props.epic.projectId);
  return p?.name ?? props.epic.projectId.slice(0, 8);
});

const projectColor = computed(() => {
  const idx = projectsStore.projects.findIndex(p => p.id === props.epic.projectId);
  return ACCENT_COLORS[Math.max(0, idx) % ACCENT_COLORS.length];
});

const changeCount = computed(() => props.epic.lastAttemptFiles?.length ?? 0);

const cardClasses = computed(() => {
  if (props.selectable && props.selected) {
    return 'border-[var(--accent-teal)] bg-[var(--accent-teal)]/5 cursor-pointer';
  }
  return 'bg-white/[0.02] hover:bg-white/[0.04] cursor-grab active:cursor-grabbing';
});
</script>
