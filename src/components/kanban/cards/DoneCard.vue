<template>
  <div
    :draggable="actions.cardDraggable.value"
    class="group relative rounded-lg px-3 py-2 flex items-center gap-2 transition-colors"
    :class="cardClasses"
    @click="actions.onSingleClick"
    @dblclick="actions.onDoubleClick"
    @dragstart="actions.onDragStart"
    @dragend="actions.onDragEnd"
  >
    <!-- Selection checkbox (merge mode) -->
    <div v-if="selectable" class="flex-shrink-0">
      <div
        class="w-4 h-4 rounded border flex items-center justify-center transition-colors cursor-pointer"
        :class="checkboxClasses"
        @click.stop="actions.onToggleSelect"
      >
        <svg v-if="selected" class="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
    </div>

    <!-- Green checkmark -->
    <svg v-if="!selectable" class="w-3 h-3 text-emerald-400 flex-shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M2.5 6l2.5 2.5 4.5-5" />
    </svg>

    <!-- Title -->
    <span class="text-sm text-txt-secondary truncate flex-1">{{ epic.title }}</span>

    <!-- Branch + PR button (hover visible) -->
    <div class="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
      <span v-if="actions.branchName.value" class="text-[9px] px-1.5 py-0.5 rounded bg-raised text-[var(--accent-green)] font-mono truncate max-w-[100px]" :title="actions.branchName.value">
        {{ actions.branchName.value }}
      </span>
      <button
        v-if="epic.column === 'done' && actions.branchName.value"
        class="p-0.5 rounded hover:bg-raised transition-colors"
        :class="prLoading ? 'opacity-50 pointer-events-none text-txt-faint' : prError ? 'text-red-400 hover:text-red-300' : 'text-txt-faint hover:text-[var(--accent-green)]'"
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
import { computed, toRef } from 'vue';
import type { Epic } from '@/engine/KosTypes';
import { useEpicCardActions } from '@/composables/useEpicCardActions';
import { useCreatePR } from '@/composables/useCreatePR';

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

const { loading: prLoading, error: prError, createPR } = useCreatePR();

const actions = useEpicCardActions({
  epic: toRef(props, 'epic'),
  selectable: toRef(props, 'selectable'),
  selected: toRef(props, 'selected'),
  emit,
});

const cardClasses = computed(() => {
  if (props.selectable && actions.selectDisabled.value) {
    return 'bg-white/[0.02] border border-white/[0.03] opacity-40 cursor-not-allowed';
  }
  if (props.selectable && props.selected) {
    return 'border border-[var(--accent-teal)] bg-[var(--accent-teal)]/5 cursor-pointer';
  }
  if (props.selectable) {
    return 'bg-white/[0.02] border border-white/[0.03] cursor-pointer hover:bg-white/[0.04]';
  }
  return 'bg-white/[0.02] border border-white/[0.03] cursor-grab active:cursor-grabbing hover:bg-white/[0.04]';
});

const checkboxClasses = computed(() => {
  if (actions.selectDisabled.value) return 'border-border-subtle bg-raised cursor-not-allowed';
  if (props.selected) return 'border-[var(--accent-teal)] bg-[var(--accent-teal)]';
  return 'border-border-standard bg-transparent hover:border-[var(--accent-teal)]';
});
</script>
