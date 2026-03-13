<template>
  <div class="flex items-center gap-3">
    <!-- Project multi-select dropdown -->
    <div class="relative" ref="projectDropdownRef">
      <button
        class="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border transition-colors shrink-0"
        :class="allSelected
          ? 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-standard)]'
          : 'border-[var(--accent-mauve)] text-[var(--accent-mauve)] bg-[color-mix(in_srgb,var(--accent-mauve)_10%,transparent)]'"
        @click="projectDropdownOpen = !projectDropdownOpen"
      >
        <!-- Color dots for selected projects (up to 3) -->
        <span class="flex items-center gap-0.5">
          <span
            v-for="p in selectedProjectDots"
            :key="p.id"
            class="w-1.5 h-1.5 rounded-full shrink-0"
            :style="{ background: p.color || '#cba6f7' }"
          />
        </span>
        {{ dropdownLabel }}
        <svg class="w-3 h-3 shrink-0 transition-transform" :class="projectDropdownOpen && 'rotate-180'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <!-- Dropdown panel -->
      <div
        v-if="projectDropdownOpen"
        class="absolute left-0 top-full mt-1 z-50 min-w-[180px] rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-lg)] py-1"
      >
        <!-- All option -->
        <button
          class="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)] transition-colors"
          :class="allSelected ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'"
          @click="showAllProjects"
        >
          <span
            class="w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors"
            :class="allSelected
              ? 'bg-[var(--accent-mauve)] border-[var(--accent-mauve)]'
              : 'border-[var(--border-standard)]'"
          >
            <svg v-if="allSelected" class="w-2 h-2 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </span>
          All projects
        </button>

        <div class="my-1 h-px bg-[var(--border-subtle)]" />

        <!-- Per-project rows -->
        <button
          v-for="project in allProjects"
          :key="project.id"
          class="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)] transition-colors"
          :class="ui.kanbanProjectIds.includes(project.id) ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'"
          @click="ui.toggleKanbanProject(project.id)"
        >
          <span
            class="w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors"
            :style="ui.kanbanProjectIds.includes(project.id)
              ? { background: project.color || '#cba6f7', borderColor: project.color || '#cba6f7' }
              : {}"
            :class="!ui.kanbanProjectIds.includes(project.id) && 'border-[var(--border-standard)]'"
          >
            <svg v-if="ui.kanbanProjectIds.includes(project.id)" class="w-2 h-2 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </span>
          <span class="w-2 h-2 rounded-full shrink-0" :style="{ background: project.color || '#cba6f7' }" />
          <span class="truncate">{{ project.name }}</span>
        </button>
      </div>
    </div>

    <!-- Separator -->
    <div class="w-px h-4 bg-[var(--border-subtle)]" />

    <!-- Filter input -->
    <div class="relative">
      <svg class="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        :value="ui.kanbanFilterText"
        placeholder="Filter epics..."
        class="pl-7 pr-2 py-1 text-xs rounded border border-[var(--border-subtle)] bg-[var(--bg-base)]
               text-[var(--text-primary)] placeholder:text-[var(--text-muted)] w-40
               focus:outline-none focus:border-[var(--accent-mauve)] transition-colors"
        @input="ui.kanbanFilterText = ($event.target as HTMLInputElement).value"
      />
    </div>

    <!-- Add Epic -->
    <button
      class="flex items-center gap-1 text-xs px-2.5 py-1 rounded
             bg-[var(--accent-mauve)] text-[var(--bg-base)] font-medium
             hover:opacity-90 transition-opacity"
      @click="$emit('add-epic')"
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
      @click="$emit('schedule-now')"
    >
      Schedule Now
    </button>

    <!-- Separator -->
    <div class="w-px h-4 bg-[var(--border-subtle)]" />

    <!-- Agents -->
    <button
      class="flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-[var(--border-subtle)]
             text-[var(--text-secondary)] hover:text-[var(--text-primary)]
             hover:border-[var(--border-standard)] transition-colors"
      title="Go to Agent Fleet"
      @click="goToMode('manager')"
    >
      <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
      Agents
    </button>

    <!-- Code -->
    <button
      class="flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-[var(--border-subtle)]
             text-[var(--text-secondary)] hover:text-[var(--text-primary)]
             hover:border-[var(--border-standard)] transition-colors"
      title="Go to Code Editor"
      @click="goToMode('editor')"
    >
      <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
      Code
    </button>

    <!-- Separator -->
    <div class="w-px h-4 bg-[var(--border-subtle)]" />

    <!-- Git Status -->
    <button
      class="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
      title="Toggle git status panel"
      @click="$emit('toggle-git-ops')"
    >
      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 3v12"/>
        <circle cx="18" cy="6" r="3"/>
        <circle cx="6" cy="18" r="3"/>
        <path d="M18 9a9 9 0 0 1-9 9"/>
      </svg>
    </button>

    <!-- Git Tree -->
    <button
      class="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
      title="Git branch tree"
      @click="$emit('open-git-tree')"
    >
      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="6" y1="3" x2="6" y2="15"/>
        <circle cx="18" cy="6" r="3"/>
        <circle cx="6" cy="18" r="3"/>
        <path d="M18 9a9 9 0 0 1-9 9"/>
      </svg>
    </button>

    <!-- Merge Epics -->
    <button
      class="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
      title="Toggle merge mode"
      @click="$emit('toggle-merge-mode')"
    >
      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="18" cy="18" r="3"/>
        <circle cx="6" cy="6" r="3"/>
        <circle cx="6" cy="18" r="3"/>
        <path d="M6 9v3a6 6 0 0 0 6 6h3"/>
        <path d="M6 9v9"/>
      </svg>
    </button>

    <!-- Scheduler Config -->
    <button
      class="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
      title="Scheduler settings"
      @click="$emit('open-scheduler-config')"
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useUiStore } from '@/stores/ui';
import { useProjectsStore } from '@/stores/projects';

const ui = useUiStore();
const projectsStore = useProjectsStore();
const projectDropdownRef = ref<HTMLElement | null>(null);
const projectDropdownOpen = ref(false);

const allProjects = computed(() => projectsStore.projects);

const allSelected = computed(() =>
  ui.kanbanProjectIds.length === projectsStore.projects.length && projectsStore.projects.length > 0
);

const dropdownLabel = computed(() => {
  if (allSelected.value) return 'All projects';
  if (ui.kanbanProjectIds.length === 1) {
    const p = projectsStore.projects.find(p => p.id === ui.kanbanProjectIds[0]);
    return p?.name ?? '1 project';
  }
  return `${ui.kanbanProjectIds.length} projects`;
});

const selectedProjectDots = computed(() =>
  allProjects.value
    .filter(p => ui.kanbanProjectIds.includes(p.id))
    .slice(0, 3)
);

function showAllProjects() {
  ui.showAllProjectsOnKanban(projectsStore.projects.map(p => p.id));
}

function goToMode(mode: 'manager' | 'editor') {
  if (ui.activeProjectId) {
    const repos = projectsStore.reposByProjectId(ui.activeProjectId);
    if (repos.length > 0) {
      ui.workspacePath = repos[0].path;
    }
  }
  ui.switchToMode(mode);
}

function onClickOutside(e: MouseEvent) {
  if (projectDropdownRef.value && !projectDropdownRef.value.contains(e.target as Node)) {
    projectDropdownOpen.value = false;
  }
}

onMounted(() => document.addEventListener('mousedown', onClickOutside));
onUnmounted(() => document.removeEventListener('mousedown', onClickOutside));

defineEmits<{
  'add-epic': [];
  'schedule-now': [];
  'open-git-tree': [];
  'open-scheduler-config': [];
  'toggle-git-ops': [];
  'toggle-merge-mode': [];
}>();
</script>
