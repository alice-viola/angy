<template>
  <div
    :draggable="actions.cardDraggable.value"
    class="group relative rounded-xl border p-3 transition-colors"
    :class="cardClasses"
    @click="actions.onSingleClick"
    @dblclick="actions.onDoubleClick"
    @dragstart="actions.onDragStart"
    @dragend="actions.onDragEnd"
  >
    <!-- Accent stripe -->
    <div class="accent-stripe bg-[var(--accent-mauve)]" />

    <!-- Selection checkbox -->
    <div v-if="selectable" class="flex items-center justify-end mb-1">
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

    <!-- Priority badge -->
    <div class="flex items-center gap-1.5 flex-wrap mb-1.5">
      <PriorityBadge :priority="epic.priorityHint" />
      <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-raised text-txt-secondary">{{ epic.complexity }}</span>
    </div>

    <!-- Title -->
    <div class="text-sm font-medium text-txt-primary leading-snug mb-1">{{ epic.title }}</div>

    <!-- Description (1 line) -->
    <div v-if="epic.description" class="text-[11px] text-txt-muted truncate mb-1.5">{{ epic.description }}</div>

    <!-- Chain indicator -->
    <span
      v-if="epic.runAfter"
      class="flex items-center gap-0.5 text-[10px] text-[var(--accent-mauve)] mb-1.5"
      :title="`Runs after: ${actions.runAfterTitle.value}`"
    >
      <svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M13 5l7 7-7 7M5 12h15" />
      </svg>
      chain
    </span>

    <!-- Repo tags -->
    <div v-if="epic.targetRepoIds.length > 0" class="flex items-center gap-1 flex-wrap mb-1.5">
      <span
        v-for="repoId in epic.targetRepoIds"
        :key="repoId"
        class="text-[9px] px-1.5 py-0.5 rounded bg-raised text-txt-muted"
      >{{ repoName(repoId) }}</span>
    </div>

    <!-- Branch -->
    <div v-if="actions.branchName.value" class="flex items-center gap-1 mb-1.5">
      <svg class="w-3 h-3 text-txt-muted flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
        <path fill-rule="evenodd" d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z"/>
      </svg>
      <span class="text-[9px] px-1.5 py-0.5 rounded bg-raised text-[var(--accent-green)] font-mono truncate max-w-[140px]" :title="actions.branchName.value">
        {{ actions.branchName.value }}
      </span>
    </div>

    <!-- Move arrows -->
    <div class="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        v-if="actions.canMoveLeft.value"
        class="p-0.5 rounded text-txt-faint hover:text-txt-primary hover:bg-raised transition-colors"
        title="Move left"
        @click.stop="actions.moveLeft"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <button
        v-if="actions.canMoveRight.value"
        class="p-0.5 rounded text-txt-faint hover:text-txt-primary hover:bg-raised transition-colors"
        title="Move right"
        @click.stop="actions.moveRight"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, toRef } from 'vue';
import type { Epic } from '@/engine/KosTypes';
import { useProjectsStore } from '@/stores/projects';
import { useEpicCardActions } from '@/composables/useEpicCardActions';
import PriorityBadge from './PriorityBadge.vue';

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

const cardClasses = computed(() => {
  if (props.selectable && actions.selectDisabled.value) {
    return 'border-border-subtle bg-surface opacity-40 cursor-not-allowed';
  }
  if (props.selectable && props.selected) {
    return 'border-[var(--accent-teal)] bg-[var(--accent-teal)]/5 cursor-pointer';
  }
  if (props.selectable) {
    return 'border-border-subtle bg-surface cursor-pointer hover:border-border-standard';
  }
  return 'border-border-subtle bg-surface cursor-grab active:cursor-grabbing hover:border-purple-500/20 hover:shadow-md hover:shadow-black/20';
});

const checkboxClasses = computed(() => {
  if (actions.selectDisabled.value) return 'border-border-subtle bg-raised cursor-not-allowed';
  if (props.selected) return 'border-[var(--accent-teal)] bg-[var(--accent-teal)]';
  return 'border-border-standard bg-transparent hover:border-[var(--accent-teal)]';
});

function repoName(repoId: string) {
  const repos = projectsStore.reposByProjectId(props.epic.projectId);
  const repo = repos.find((r) => r.id === repoId);
  return repo?.name ?? repoId.slice(0, 8);
}
</script>
