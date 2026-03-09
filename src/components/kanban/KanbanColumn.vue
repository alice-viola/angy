<template>
  <div class="flex flex-col flex-1 min-w-[160px] h-full">
    <!-- Column header -->
    <div
      class="flex items-center gap-2 px-3 py-2 rounded-t-lg border-b-2"
      :style="{ borderColor: headerColor }"
    >
      <span class="text-xs font-semibold text-[var(--text-primary)]">{{ columnLabel }}</span>
      <span
        class="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[var(--bg-raised)] text-[var(--text-muted)]"
      >
        {{ epics.length }}
      </span>
      <button
        v-if="(column === 'done' || column === 'discarded') && epics.length > 0"
        class="ml-auto text-[10px] text-[var(--text-muted)] hover:text-[var(--accent-red)] transition-colors"
        :title="`Clear all ${column} epics`"
        @click="clearAll"
      >
        Clear all
      </button>
    </div>

    <!-- Epic cards -->
    <div
      class="flex-1 overflow-y-auto p-2 space-y-2 bg-[var(--bg-base)] rounded-b-lg transition-colors border-2 border-transparent"
      :class="{ 'border-dashed border-[var(--accent-mauve)]/30': isDragOver }"
      :style="isDragOver ? { backgroundColor: 'color-mix(in srgb, var(--accent-mauve) 8%, transparent)' } : {}"
      @dragover.prevent="onDragOver"
      @dragenter.prevent="isDragOver = true"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <EpicCard
        v-for="epic in epics"
        :key="epic.id"
        :epic="epic"
        @select="emit('selectEpic', $event)"
      />

      <!-- Add Epic button (idea column only) -->
      <button
        v-if="column === 'idea'"
        class="w-full flex items-center justify-center gap-1 text-xs text-[var(--text-muted)]
               py-2 rounded-lg border border-dashed border-[var(--border-subtle)]
               hover:text-[var(--text-secondary)] hover:border-[var(--border-standard)]
               transition-colors"
        @click="emit('addEpic')"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        Add Epic
      </button>

      <p
        v-if="epics.length === 0 && column !== 'idea'"
        class="text-[10px] text-[var(--text-muted)] text-center py-4 italic"
      >
        {{ emptyText }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { EpicColumn } from '@/engine/KosTypes';
import { useEpicStore } from '@/stores/epics';
import EpicCard from './EpicCard.vue';

const props = defineProps<{
  column: EpicColumn;
  projectIds: string[];
  filterText?: string;
}>();

const emit = defineEmits<{
  selectEpic: [id: string];
  addEpic: [];
  dropEpic: [payload: { epicId: string; column: EpicColumn }];
}>();

const isDragOver = ref(false);

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
  if (epicId) {
    emit('dropEpic', { epicId, column: props.column });
  }
}

const epicStore = useEpicStore();

async function clearAll() {
  for (const epic of epics.value) {
    await epicStore.deleteEpic(epic.id);
  }
}

const epics = computed(() => {
  let items = epicStore.epicsByColumn(props.projectIds, props.column);
  if (props.filterText) {
    const q = props.filterText.toLowerCase();
    items = items.filter((e) => e.title.toLowerCase().includes(q));
  }
  return items;
});

const columnLabel = computed(() =>
  props.column.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
);

const emptyDescriptions: Record<EpicColumn, string> = {
  idea: "Capture rough ideas here. They won't be scheduled until moved to Backlog.",
  backlog: 'Epics waiting to be planned and refined.',
  todo: 'Ready for work. The scheduler picks these up automatically.',
  'in-progress': 'AI agents are actively working on these.',
  review: 'Completed work waiting for your review.',
  done: 'Finished and approved epics.',
  discarded: 'Epics that were abandoned or failed.',
};

const emptyText = computed(() => emptyDescriptions[props.column]);

const headerColor = computed(() => {
  const map: Record<EpicColumn, string> = {
    idea: 'var(--accent-mauve)',
    backlog: 'var(--accent-blue)',
    todo: 'var(--accent-teal)',
    'in-progress': 'var(--accent-yellow)',
    review: 'var(--accent-peach)',
    done: 'var(--accent-green)',
    discarded: 'var(--accent-red)',
  };
  return map[props.column];
});
</script>
