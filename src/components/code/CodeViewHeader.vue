<template>
  <div class="flex items-center px-5 h-12 border-b border-[var(--border-subtle)]">
    <!-- Left group -->
    <span class="text-sm font-semibold text-txt-primary">Code</span>
    <span class="text-txt-faint mx-2">&middot;</span>

    <!-- Repo switcher -->
    <div class="relative">
      <button
        ref="repoBtnRef"
        class="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-standard)] hover:border-ember-500/30 transition-colors"
        @click="repoPickerOpen = !repoPickerOpen"
      >
        <svg class="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>
        <span class="font-mono text-[10px]">{{ codeStore.activeRepo?.name ?? 'Select Repo' }}</span>
        <svg v-if="repos.length > 1" class="w-3 h-3 text-txt-faint" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useCodeStore } from '@/stores/code';
import { useUiStore } from '@/stores/ui';
import { useProjectsStore } from '@/stores/projects';
import { useGitStore } from '@/stores/git';

const codeStore = useCodeStore();
const ui = useUiStore();
const projectsStore = useProjectsStore();
const gitStore = useGitStore();

const repoBtnRef = ref<HTMLButtonElement | null>(null);
const repoDropdownRef = ref<HTMLElement | null>(null);

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

// Sync repo when activeProjectId changes externally (e.g. from kanban/fleet)
watch(() => ui.activeProjectId, (projectId) => {
  if (!projectId) return;
  const projectRepos = projectsStore.reposByProjectId(projectId);
  // If the current repo doesn't belong to this project, pick the first one
  if (codeStore.activeRepoId && !projectRepos.some(r => r.id === codeStore.activeRepoId)) {
    if (projectRepos.length > 0) {
      codeStore.selectRepo(projectRepos[0].id);
    } else {
      codeStore.activeRepoId = null;
    }
  } else if (!codeStore.activeRepoId && projectRepos.length > 0) {
    codeStore.selectRepo(projectRepos[0].id);
  }
});

onMounted(() => {
  document.addEventListener('mousedown', onDocumentMousedown);
  // If project is already set but repo is stale, sync it now
  if (ui.activeProjectId) {
    const projectRepos = projectsStore.reposByProjectId(ui.activeProjectId);
    if (codeStore.activeRepoId && !projectRepos.some(r => r.id === codeStore.activeRepoId)) {
      if (projectRepos.length > 0) {
        codeStore.selectRepo(projectRepos[0].id);
      } else {
        codeStore.activeRepoId = null;
      }
    } else if (!codeStore.activeRepoId && projectRepos.length > 0) {
      codeStore.selectRepo(projectRepos[0].id);
    }
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentMousedown);
});
</script>
