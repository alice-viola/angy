<template>
  <div
    :style="{ width: boardColumn.width, opacity: boardColumn.opacity }"
    class="flex-none flex flex-col h-full"
  >
    <!-- Column header -->
    <div class="flex items-center gap-2 mb-3">
      <div
        :class="[
          'w-2 h-2 rounded-full',
          boardColumn.dotColor,
          boardColumn.breathe ? 'anim-breathe' : '',
        ]"
      />
      <span :class="['text-xs font-semibold uppercase tracking-wider', boardColumn.labelColor]">
        {{ boardColumn.label }}
      </span>
      <span class="text-[10px] text-txt-faint">{{ columnEpics.length }}</span>
      <button
        v-if="showClearAll && columnEpics.length > 0"
        class="text-[10px] text-txt-muted hover:text-[var(--accent-red)] ml-auto transition-colors"
        :title="`Clear all ${boardColumn.label.toLowerCase()} epics`"
        @click="clearAll"
      >
        Clear all
      </button>
    </div>

    <!-- Body: scrollable card list + drop zone -->
    <div
      class="flex-1 flex flex-col gap-2 overflow-y-auto pr-1 rounded-lg border-2 border-transparent transition-colors p-1"
      :class="{ 'border-dashed border-[var(--accent-mauve)]/30': isDragOver }"
      :style="isDragOver ? { backgroundColor: 'color-mix(in srgb, var(--accent-mauve) 8%, transparent)' } : {}"
      @dragover.prevent="onDragOver"
      @dragenter.prevent="isDragOver = true"
      @dragleave="onDragLeave"
      @drop.prevent="onDrop"
    >
      <component
        v-for="epic in columnEpics"
        :key="epic.id"
        :is="cardComponent(epic)"
        :epic="epic"
        :selectable="mergeMode"
        :selected="selectedEpicIds.includes(epic.id)"
        @select="emit('epic-select', $event)"
        @toggle-select="emit('epic-toggle-select', $event)"
      />

      <!-- Add Idea button -->
      <button
        v-if="boardColumn.addButton"
        class="w-full border border-dashed border-border-standard rounded-lg py-2 text-[11px] text-txt-muted hover:border-[var(--accent-mauve)]/40 hover:text-txt-secondary flex items-center justify-center gap-1.5 transition-colors"
        @click="emit('add-idea')"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        Add Idea
      </button>

      <!-- Empty state -->
      <p
        v-if="columnEpics.length === 0 && !boardColumn.addButton"
        class="text-[10px] text-txt-muted text-center py-4 italic"
      >
        {{ emptyText }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, type Component } from 'vue';
import type { Epic, EpicColumn } from '@/engine/KosTypes';
import { useEpicStore } from '@/stores/epics';
import { engineBus } from '@/engine/EventBus';
import IdeaCard from './cards/IdeaCard.vue';
import UpcomingCard from './cards/UpcomingCard.vue';
import ActiveCard from './cards/ActiveCard.vue';
import ReviewCard from './cards/ReviewCard.vue';
import DoneCard from './cards/DoneCard.vue';

export interface BoardColumn {
  key: string;
  columns: EpicColumn[];
  dropTarget: EpicColumn;
  label: string;
  width: string;
  dotColor: string;
  labelColor: string;
  opacity: number;
  breathe: boolean;
  addButton?: boolean;
}

const props = withDefaults(defineProps<{
  boardColumn: BoardColumn;
  projectIds: string[];
  filterText?: string;
  mergeMode?: boolean;
  selectedEpicIds?: string[];
}>(), {
  mergeMode: false,
  selectedEpicIds: () => [],
});

const emit = defineEmits<{
  'epic-select': [id: string];
  'epic-toggle-select': [id: string];
  'add-idea': [];
}>();

const epicStore = useEpicStore();
const isDragOver = ref(false);

const columnEpics = computed(() => {
  let items = epicStore.epicsByColumns(props.projectIds, props.boardColumn.columns);
  if (props.filterText) {
    const q = props.filterText.toLowerCase();
    items = items.filter((e) => e.title.toLowerCase().includes(q));
  }
  return items;
});

const showClearAll = computed(() =>
  props.boardColumn.key === 'done' || props.boardColumn.key === 'discarded',
);

const emptyDescriptions: Record<string, string> = {
  idea: 'Your ideas will appear here',
  upcoming: 'No upcoming epics',
  active: 'No epics in progress',
  review: 'Nothing to review',
  done: 'No completed epics',
  discarded: 'Discarded epics appear here',
};

const emptyText = computed(() => emptyDescriptions[props.boardColumn.key] ?? '');

function cardComponent(epic: Epic): Component {
  switch (epic.column) {
    case 'idea': return IdeaCard;
    case 'backlog':
    case 'todo': return UpcomingCard;
    case 'in-progress': return ActiveCard;
    case 'review': return ReviewCard;
    case 'done':
    case 'discarded': return DoneCard;
    default: return IdeaCard;
  }
}

// ── Drag-and-drop ─────────────────────────────────────────────────────

function onDragOver(e: DragEvent) {
  e.dataTransfer!.dropEffect = 'move';
}

function onDragLeave(e: DragEvent) {
  const target = e.currentTarget as HTMLElement;
  if (!target.contains(e.relatedTarget as Node)) {
    isDragOver.value = false;
  }
}

function onDrop(e: DragEvent) {
  isDragOver.value = false;
  const epicId = e.dataTransfer!.getData('text/plain');
  if (!epicId) return;

  const targetColumn = props.boardColumn.dropTarget;
  if (targetColumn === 'in-progress') {
    engineBus.emit('epic:requestStart', { epicId });
  } else {
    epicStore.moveEpic(epicId, targetColumn);
  }
}

async function clearAll() {
  for (const epic of columnEpics.value) {
    await epicStore.deleteEpic(epic.id);
  }
}
</script>
