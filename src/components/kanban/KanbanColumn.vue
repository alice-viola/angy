<template>
  <div
    :style="{ width: boardColumn.width, opacity: boardColumn.opacity }"
    class="flex-none flex flex-col h-full"
  >
    <!-- Column header -->
    <div class="flex items-center gap-2 mb-2 px-1">
      <div
        :class="[
          'w-2 h-2 rounded-full',
          boardColumn.dotColor,
          boardColumn.breathe ? 'anim-breathe' : '',
        ]"
      />
      <span :class="['text-[11px] font-semibold uppercase tracking-wider', boardColumn.labelColor]">
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
      :data-drop-column="boardColumn.dropTarget"
      class="flex-1 flex flex-col gap-0.5 overflow-y-auto rounded-md border-2 border-transparent transition-colors py-1"
      :class="{ 'border-dashed border-[var(--accent-mauve)]/30': isDragOver }"
      :style="isDragOver ? { backgroundColor: 'color-mix(in srgb, var(--accent-mauve) 8%, transparent)' } : {}"
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
        class="w-full border border-dashed border-border-subtle rounded-md py-1.5 text-[10px] text-txt-muted hover:border-[var(--accent-mauve)]/40 hover:text-txt-secondary flex items-center justify-center gap-1.5 transition-colors mt-1"
        @click="emit('add-idea')"
      >
        <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
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
import { computed, type Component } from 'vue';
import type { Epic, EpicColumn } from '@/engine/KosTypes';
import { useEpicStore } from '@/stores/epics';
import { kanbanDnd } from '@/composables/useKanbanDnd';
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

// Column is highlighted when a drag is active AND this column is the hover target
const isDragOver = computed(() =>
  kanbanDnd.draggingEpicId !== null && kanbanDnd.hoverColumn === props.boardColumn.dropTarget,
);

const columnEpics = computed(() => {
  let items = epicStore.epicsByColumns(props.projectIds, props.boardColumn.columns);
  if (props.filterText) {
    const q = props.filterText.toLowerCase();
    items = items.filter((e) => e.title.toLowerCase().includes(q));
  }
  return items;
});

const showClearAll = computed(() =>
  ['done', 'discarded', 'icebox', 'review-inbox'].includes(props.boardColumn.key),
);

const emptyDescriptions: Record<string, string> = {
  idea: 'Your ideas will appear here',
  upcoming: 'No upcoming epics',
  todo: 'Queue is empty',
  icebox: 'Icebox is empty',
  active: 'No epics in progress',
  review: 'Nothing to review',
  'review-inbox': 'Inbox is empty',
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

async function clearAll() {
  for (const epic of columnEpics.value) {
    await epicStore.deleteEpic(epic.id);
  }
}
</script>
