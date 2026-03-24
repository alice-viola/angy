<template>
  <div class="h-10 flex items-center px-2 bg-[var(--bg-base)] border-b border-[var(--border-subtle)] shrink-0 gap-1 overflow-x-auto no-scrollbar">
    <button
      v-for="projectId in ui.openProjectIds"
      :key="projectId"
      class="group relative flex items-center h-8 min-w-[120px] max-w-[200px] px-3 rounded-t-lg transition-colors border-b-2 cursor-pointer"
      :class="[
        ui.activeProjectId === projectId
          ? 'border-amber-500 text-[var(--text-primary)] font-medium'
          : 'border-transparent hover:bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
      ]"
      @click="ui.switchProjectTab(projectId)"
    >
      <div 
        class="w-2 h-2 rounded-full shrink-0 mr-2" 
        :style="{ backgroundColor: getProjectColor(projectId) }"
      />
      <span class="text-xs truncate flex-1 text-left select-none">{{ getProjectName(projectId) }}</span>
      
      <!-- Close button -->
      <div 
        class="w-5 h-5 ml-2 rounded flex items-center justify-center hover:bg-[var(--bg-hover)] text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors opacity-0 group-hover:opacity-100"
        :class="{ 'opacity-100': ui.activeProjectId === projectId }"
        @click.stop="ui.closeProjectTab(projectId)"
        title="Close project"
      >
        <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
      
    </button>
    
    <!-- Add new project tab button -->
    <button
      class="w-8 h-8 ml-1 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] transition-colors"
      title="Open project (Home)"
      @click="ui.navigateHome()"
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { useUiStore } from '@/stores/ui';
import { useProjectsStore } from '@/stores/projects';

const ui = useUiStore();
const projectsStore = useProjectsStore();

function getProjectName(id: string) {
  return projectsStore.projectById(id)?.name || 'Unknown Project';
}

function getProjectColor(id: string) {
  return projectsStore.projectById(id)?.color || '#94e2d5'; // default teal
}
</script>

<style scoped>
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
