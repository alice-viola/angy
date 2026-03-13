<template>
  <div class="flex items-center gap-3 px-4 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
    <!-- Project filter chips -->
    <div class="flex items-center gap-1.5 overflow-x-auto shrink-0">
      <!-- "All" chip -->
      <button
        class="flex items-center gap-1 text-[var(--text-xs)] px-2 py-1 rounded-full border transition-colors shrink-0"
        :class="allSelected
          ? 'border-[var(--accent-mauve)] bg-[color-mix(in_srgb,var(--accent-mauve)_15%,transparent)] text-[var(--text-primary)]'
          : 'border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-[var(--border-standard)]'"
        @click="$emit('showAll')"
      >All</button>
      <!-- Per-project chips -->
      <button
        v-for="project in projects"
        :key="project.id"
        class="flex items-center gap-1 text-[var(--text-xs)] px-2 py-1 rounded-full border transition-colors shrink-0"
        :class="activeIds.includes(project.id)
          ? 'border-[var(--border-standard)] text-[var(--text-primary)]'
          : 'border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-[var(--border-standard)] opacity-50'"
        @click="$emit('toggleProject', project.id)"
      >
        <div class="w-2 h-2 rounded-full shrink-0" :style="{ background: project.color || '#cba6f7' }" />
        {{ project.name }}
      </button>
    </div>

    <!-- Spacer -->
    <div class="flex-1" />

    <!-- Search -->
    <div class="relative">
      <svg class="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        :value="filterText"
        placeholder="Filter epics..."
        class="pl-7 pr-2 py-1 text-xs rounded border border-[var(--border-subtle)] bg-[var(--bg-base)]
               text-[var(--text-primary)] placeholder:text-[var(--text-muted)] w-40
               focus:outline-none focus:border-[var(--accent-mauve)] transition-colors"
        @input="$emit('update:filterText', ($event.target as HTMLInputElement).value)"
      />
    </div>

    <!-- Add Epic -->
    <button
      class="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded
             bg-[var(--accent-mauve)] text-[var(--bg-base)] font-medium
             hover:opacity-90 transition-opacity"
      @click="$emit('addEpic')"
    >
      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
      </svg>
      Add Epic
    </button>

    <!-- Schedule Now -->
    <button
      class="text-xs px-2.5 py-1 rounded border border-[var(--border-subtle)]
             text-[var(--text-secondary)] hover:text-[var(--text-primary)]
             hover:border-[var(--border-standard)] transition-colors"
      @click="$emit('scheduleNow')"
    >
      Schedule
    </button>

    <!-- Git Tree -->
    <button
      class="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
      title="Git branch tree"
      @click="$emit('openGitTree')"
    >
      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="6" y1="3" x2="6" y2="15"/>
        <circle cx="18" cy="6" r="3"/>
        <circle cx="6" cy="18" r="3"/>
        <path d="M18 9a9 9 0 0 1-9 9"/>
      </svg>
    </button>

    <!-- Settings -->
    <button
      class="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
      @click="$emit('openSchedulerConfig')"
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import type { Project } from '@/engine/KosTypes';

defineProps<{
  projects: Project[];
  activeIds: string[];
  filterText?: string;
  allSelected?: boolean;
}>();

defineEmits<{
  addEpic: [];
  scheduleNow: [];
  openSchedulerConfig: [];
  openGitTree: [];
  toggleProject: [projectId: string];
  showAll: [];
  'update:filterText': [value: string];
}>();
</script>
