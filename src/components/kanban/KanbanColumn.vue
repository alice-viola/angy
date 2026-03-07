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
    </div>

    <!-- Epic cards -->
    <div class="flex-1 overflow-y-auto p-2 space-y-2 bg-[var(--bg-base)] rounded-b-lg">
      <EpicCard
        v-for="epic in epics"
        :key="epic.id"
        :epic="epic"
        @select="$emit('selectEpic', $event)"
      />

      <!-- Add Epic button (idea column only) -->
      <button
        v-if="column === 'idea'"
        class="w-full flex items-center justify-center gap-1 text-xs text-[var(--text-muted)]
               py-2 rounded-lg border border-dashed border-[var(--border-subtle)]
               hover:text-[var(--text-secondary)] hover:border-[var(--border-standard)]
               transition-colors"
        @click="$emit('addEpic')"
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
        No epics
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { EpicColumn } from '@/engine/KosTypes';
import { useEpicStore } from '@/stores/epics';
import EpicCard from './EpicCard.vue';

const props = defineProps<{
  column: EpicColumn;
  projectIds: string[];
  filterText?: string;
}>();

defineEmits<{
  selectEpic: [id: string];
  addEpic: [];
}>();

const epicStore = useEpicStore();

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

const headerColor = computed(() => {
  const map: Record<EpicColumn, string> = {
    idea: 'var(--accent-mauve)',
    backlog: 'var(--accent-blue)',
    todo: 'var(--accent-teal)',
    'in-progress': 'var(--accent-yellow)',
    review: 'var(--accent-peach)',
    done: 'var(--accent-green)',
  };
  return map[props.column];
});
</script>
