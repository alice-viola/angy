<template>
  <div
    class="group relative rounded-xl border p-3.5 transition-colors select-none"
    :class="cardClasses"
    style="box-shadow: 0 0 16px -6px rgba(251,146,60,0.10)"
    @click="actions.onSingleClick"
    @dblclick="actions.onDoubleClick"
    @pointerdown="actions.onPointerDown"
  >
    <div class="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-orange-400" />

    <div class="pl-2.5">
      <!-- Top row: Epic ID + project dot + project name + review badge -->
      <div class="flex items-center gap-2 mb-1.5">
        <span class="w-1.5 h-1.5 rounded-full" :style="{ backgroundColor: projectColor }" />
        <span class="text-[10px] text-txt-faint">{{ projectName }}</span>
        <span class="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 ml-auto">review</span>
      </div>

      <!-- Title -->
      <p class="text-xs text-txt-primary font-medium leading-snug mb-2">{{ epic.title }}</p>

      <!-- Branch -->
      <div v-if="actions.branchName.value" class="flex items-center gap-1 mb-2">
        <svg class="w-3 h-3 text-orange-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
        <span class="text-[10px] text-orange-400 font-mono truncate">{{ actions.branchName.value }}</span>
      </div>

      <!-- Needs review + changes -->
      <div class="flex items-center gap-2 mb-3">
        <span class="text-[10px] text-orange-400 flex items-center gap-1">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
          </svg>
          needs review
        </span>
        <span v-if="changeCount > 0" class="text-[10px] text-txt-faint">{{ changeCount }} changes</span>
      </div>

      <!-- Action Buttons -->
      <div class="flex items-center gap-2 mt-2 pt-2 border-t border-border-subtle">
        <button
          class="flex-1 py-1.5 px-2 bg-[var(--accent-green)]/10 text-[var(--accent-green)] hover:bg-[var(--accent-green)] hover:text-white rounded text-[11px] font-medium transition-colors"
          @click.stop="approveEpic"
        >
          Approve
        </button>
        <button
          class="flex-1 py-1.5 px-2 bg-[var(--accent-red)]/10 text-[var(--accent-red)] hover:bg-[var(--accent-red)] hover:text-white rounded text-[11px] font-medium transition-colors"
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
  return 'border-orange-400/20 bg-surface cursor-grab active:cursor-grabbing';
});
</script>
