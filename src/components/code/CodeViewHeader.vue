<template>
  <div class="flex items-center px-5 h-12 bg-[var(--bg-window)]/50 border-b border-[var(--border-subtle)]">
    <!-- Left group -->
    <span class="text-sm font-semibold text-txt-primary">Code</span>
    <span class="text-txt-faint mx-2">&middot;</span>

    <!-- Project switcher -->
    <button
      ref="projBtnRef"
      class="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-standard)] hover:border-cyan-400/30 transition-colors"
      @click="toggleProjectPicker"
    >
      <span class="w-1.5 h-1.5 rounded-full flex-shrink-0" :style="{ background: activeProjectColor }" />
      <span class="font-medium">{{ activeProjectName }}</span>
      <svg class="w-3 h-3 text-txt-faint" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
    </button>

    <span class="text-txt-faint mx-1 text-[10px]">/</span>

    <!-- Repo switcher -->
    <div class="relative">
      <button
        ref="repoBtnRef"
        class="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-standard)] hover:border-ember-500/30 transition-colors"
        @click="repoPickerOpen = !repoPickerOpen"
      >
        <svg class="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>
        <span class="font-mono text-[10px]">{{ codeStore.activeRepo?.name ?? 'Select Repo' }}</span>
        <svg class="w-3 h-3 text-txt-faint" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
      </button>

      <!-- Repo picker dropdown -->
      <div
        v-if="repoPickerOpen"
        ref="repoDropdownRef"
        class="absolute z-50 top-full mt-1 w-60 bg-[var(--bg-surface)] border border-[var(--border-standard)] rounded-xl shadow-2xl shadow-black/40 py-1"
        style="backdrop-filter: blur(12px)"
      >
        <div
          v-for="repo in repos"
          :key="repo.id"
          class="flex items-center gap-2 px-3 py-2 rounded cursor-pointer mx-1 transition-colors"
          :class="repo.id === codeStore.activeRepoId
            ? 'bg-ember-500/5 border-l-2 border-ember-500 text-ember-400'
            : 'hover:bg-white/[0.03]'"
          @click="onRepoSelect(repo.id)"
        >
          <!-- Code brackets icon -->
          <svg class="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
          </svg>
          <div class="flex flex-col min-w-0">
            <span class="text-xs text-txt-primary truncate">{{ repo.name }}</span>
            <span class="text-[10px] text-txt-muted font-mono truncate">{{ repo.defaultBranch }}</span>
          </div>
          <!-- Checkmark for selected -->
          <svg v-if="repo.id === codeStore.activeRepoId" class="w-3 h-3 ml-auto flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <div v-if="repos.length === 0" class="px-3 py-2 text-xs text-txt-muted">No repos</div>
      </div>
    </div>

    <!-- Spacer -->
    <div class="flex-1" />

    <!-- Branch indicator -->
    <div v-if="gitStore.branch" class="flex items-center">
      <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5" />
      <span class="text-[10px] font-mono text-txt-faint">{{ gitStore.branch }}</span>
    </div>

    <!-- Project picker popover -->
    <PopoverPanel
      v-if="projectPickerOpen"
      id="code-proj-picker"
      mode="single"
      :groups="projectGroups"
      :selected-ids="selectedProjectIds"
      :panel-style="projectPickerStyle"
      :searchable="false"
      @select="onProjectSelect"
      @close="projectPickerOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useCodeStore } from '@/stores/code';
import { useUiStore } from '@/stores/ui';
import { useProjectsStore } from '@/stores/projects';
import { useGitStore } from '@/stores/git';
import { useFilterStore } from '@/stores/filter';
import PopoverPanel from '@/components/common/PopoverPanel.vue';

const PROJECT_COLORS = ['#f59e0b', '#10b981', '#22d3ee', '#cba6f7', '#f38ba8', '#a6e3a1', '#f9e2af', '#FF6B8A'];

const codeStore = useCodeStore();
const ui = useUiStore();
const projectsStore = useProjectsStore();
const gitStore = useGitStore();
const filterStore = useFilterStore();

const projBtnRef = ref<HTMLButtonElement | null>(null);
const repoBtnRef = ref<HTMLButtonElement | null>(null);
const repoDropdownRef = ref<HTMLElement | null>(null);

// ── Project picker ─────────────────────────────────────────────────────

const projectPickerOpen = ref(false);
const projectPickerStyle = ref<Record<string, string>>({});

const activeProjectName = computed(() => {
  if (!ui.activeProjectId) return 'Select Project';
  return projectsStore.projects.find(p => p.id === ui.activeProjectId)?.name ?? 'Select Project';
});

const activeProjectColor = computed(() => {
  if (!ui.activeProjectId) return PROJECT_COLORS[0];
  const idx = projectsStore.projects.findIndex(p => p.id === ui.activeProjectId);
  return PROJECT_COLORS[Math.max(0, idx) % PROJECT_COLORS.length];
});

const projectGroups = computed(() => [{
  label: 'Projects',
  items: projectsStore.projects.map((p, idx) => ({
    id: p.id,
    name: p.name,
    color: PROJECT_COLORS[idx % PROJECT_COLORS.length],
  })),
}]);

const selectedProjectIds = computed(() =>
  ui.activeProjectId ? [ui.activeProjectId] : []
);

async function toggleProjectPicker() {
  if (projectPickerOpen.value) {
    projectPickerOpen.value = false;
    return;
  }
  if (projBtnRef.value) {
    const rect = projBtnRef.value.getBoundingClientRect();
    projectPickerStyle.value = {
      top: `${rect.bottom + 4}px`,
      left: `${rect.left}px`,
    };
  }
  projectPickerOpen.value = true;
  await nextTick();
}

function onProjectSelect(id: string) {
  ui.activeProjectId = id;
  projectPickerOpen.value = false;
  const projectRepos = projectsStore.reposByProjectId(id);
  if (projectRepos.length > 0) {
    codeStore.selectRepo(projectRepos[0].id);
  }
}

// ── Repo picker ────────────────────────────────────────────────────────

const repoPickerOpen = ref(false);

const repos = computed(() => {
  if (!ui.activeProjectId) return [];
  return projectsStore.reposByProjectId(ui.activeProjectId);
});

function onRepoSelect(repoId: string) {
  codeStore.selectRepo(repoId);
  repoPickerOpen.value = false;
}

// Close repo picker on outside click
function onDocumentMousedown(e: MouseEvent) {
  if (!repoPickerOpen.value) return;
  const target = e.target as Node;
  if (repoBtnRef.value?.contains(target)) return;
  if (repoDropdownRef.value?.contains(target)) return;
  repoPickerOpen.value = false;
}

onMounted(() => {
  document.addEventListener('mousedown', onDocumentMousedown);
  // Auto-select first project if none is active (e.g. coming from kanban/fleet)
  if (!ui.activeProjectId && projectsStore.projects.length > 0) {
    const firstId = filterStore.selectedProjectIds[0] ?? projectsStore.projects[0].id;
    onProjectSelect(firstId);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentMousedown);
});
</script>
