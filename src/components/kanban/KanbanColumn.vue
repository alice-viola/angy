<template>
  <div class="flex flex-col flex-1 min-w-[200px] h-full">
    <!-- Column header -->
    <div
      class="flex items-center gap-2 px-3 py-2 rounded-t-lg"
    >
      <div class="w-1 h-4 rounded-full" :style="{ background: headerColor }" />
      <span class="text-xs font-semibold text-[var(--text-primary)]">{{ columnLabel }}</span>
      <span
        class="text-[var(--text-xs)] font-medium px-1.5 py-0.5 rounded-full bg-[var(--bg-raised)] text-[var(--text-muted)]"
      >
        {{ epics.length }}
      </span>
      <button
        v-if="(column === 'done' || column === 'discarded') && epics.length > 0"
        class="ml-auto text-[var(--text-xs)] text-[var(--text-muted)] hover:text-[var(--accent-red)] transition-colors"
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
        :selectable="mergeMode"
        :selected="selectedEpicIds.includes(epic.id)"
        :showProjectBadge="isMultiProject"
        @select="emit('selectEpic', $event)"
        @toggle-select="emit('toggle-select', $event)"
      />

      <!-- Add Epic button (idea column only) -->
      <button
        v-if="column === 'idea'"
        class="w-full flex items-center justify-center gap-1 text-xs text-[var(--text-muted)]
               py-2 rounded-[var(--radius-md)] border border-dashed border-[var(--border-subtle)]
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
        class="text-[var(--text-xs)] text-[var(--text-muted)] text-center py-4"
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

const props = withDefaults(defineProps<{
  column: EpicColumn;
  projectIds: string[];
  filterText?: string;
  mergeMode?: boolean;
  selectedEpicIds?: string[];
}>(), {
  mergeMode: false,
  selectedEpicIds: () => [],
});

const emit = defineEmits<{
  selectEpic: [id: string];
  addEpic: [];
  dropEpic: [payload: { epicId: string; column: EpicColumn }];
  'toggle-select': [id: string];
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

const isMultiProject = computed(() => props.projectIds.length > 1);

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
    idea: 'color-mix(in srgb, var(--accent-mauve) 60%, transparent)',
    backlog: 'color-mix(in srgb, var(--accent-blue) 60%, transparent)',
    todo: 'color-mix(in srgb, var(--accent-teal) 60%, transparent)',
    'in-progress': 'color-mix(in srgb, var(--accent-yellow) 60%, transparent)',
    review: 'color-mix(in srgb, var(--accent-peach) 60%, transparent)',
    done: 'color-mix(in srgb, var(--accent-green) 60%, transparent)',
    discarded: 'color-mix(in srgb, var(--accent-red) 60%, transparent)',
  };
  return map[props.column];
});
</script>
