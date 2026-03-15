<template>
  <div class="flex flex-col h-full bg-[var(--bg-base)]">
    <!-- Header -->
    <div class="flex-shrink-0 h-12 flex items-center justify-between px-4 bg-[var(--bg-window)]/50 border-b border-[var(--border-subtle)]">
      <!-- Left: title + repo selector -->
      <div class="flex items-center gap-2">
        <svg class="w-4 h-4 text-[var(--accent-teal)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="6" y1="3" x2="6" y2="15"/>
          <circle cx="18" cy="6" r="3"/>
          <circle cx="6" cy="18" r="3"/>
          <path d="M18 9a9 9 0 0 1-9 9"/>
        </svg>
        <h2 class="text-sm font-semibold text-[var(--text-primary)]">Git Graph</h2>

        <div v-if="allRepos.length > 1" class="relative ml-2">
          <select
            v-model="selectedRepoIdx"
            class="text-xs pl-2 pr-6 py-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)]
                   text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-ember)]
                   transition-colors appearance-none cursor-pointer"
            style="color-scheme: dark"
          >
            <option v-for="(repo, idx) in allRepos" :key="repo.id" :value="idx">{{ repo.name }}</option>
          </select>
          <svg class="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--text-muted)] pointer-events-none" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      <!-- Center: zoom controls + legend toggle -->
      <div class="flex items-center gap-1">
        <button
          class="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1"
          title="Zoom out"
          @click="canvasRef?.setZoom((canvasRef?.zoom ?? 1) * 0.8)"
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
        </button>
        <button
          class="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1"
          title="Zoom in"
          @click="canvasRef?.setZoom((canvasRef?.zoom ?? 1) * 1.25)"
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/><line x1="11" y1="8" x2="11" y2="14"/>
          </svg>
        </button>
        <button
          class="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1"
          title="Fit to screen"
          @click="canvasRef?.fitToScreen()"
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
          </svg>
        </button>
        <div class="w-px h-4 bg-[var(--border-subtle)] mx-1" />
        <button
          class="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1"
          :class="{ 'text-[var(--text-primary)]': showLegend }"
          title="Toggle legend"
          @click="showLegend = !showLegend"
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
          </svg>
        </button>
      </div>

      <!-- Right: commit count + refresh -->
      <div class="flex items-center gap-2">
        <span class="text-[10px] text-[var(--text-faint)]">
          {{ nodes.length }} commits
        </span>
        <button
          class="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1"
          title="Refresh"
          :disabled="loading"
          @click="refresh"
        >
          <svg
            class="w-3.5 h-3.5"
            :class="{ 'animate-spin': loading }"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M21 12a9 9 0 1 1-9-9"/>
            <polyline points="21 3 21 9 15 9"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- Empty states -->
    <div v-if="!projectId" class="flex-1 flex flex-col items-center justify-center text-center">
      <svg class="w-12 h-12 text-[var(--text-faint)] mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <line x1="6" y1="3" x2="6" y2="15"/>
        <circle cx="18" cy="6" r="3"/>
        <circle cx="6" cy="18" r="3"/>
        <path d="M18 9a9 9 0 0 1-9 9"/>
      </svg>
      <span class="text-xs text-[var(--text-muted)]">Select a project to view its git history</span>
      <span class="text-[10px] text-[var(--text-faint)] mt-1">Use the project filter in the sidebar</span>
    </div>

    <div v-else-if="allRepos.length === 0" class="flex-1 flex flex-col items-center justify-center text-center">
      <svg class="w-12 h-12 text-[var(--text-faint)] mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <line x1="6" y1="3" x2="6" y2="15"/>
        <circle cx="18" cy="6" r="3"/>
        <circle cx="6" cy="18" r="3"/>
        <path d="M18 9a9 9 0 0 1-9 9"/>
      </svg>
      <span class="text-xs text-[var(--text-muted)]">No repositories configured</span>
      <span class="text-[10px] text-[var(--text-faint)] mt-1">Add a repository to this project first</span>
    </div>

    <div v-else-if="loading && nodes.length === 0" class="flex-1 flex items-center justify-center">
      <span class="text-xs text-[var(--text-muted)]">Loading commit history...</span>
    </div>

    <div v-else-if="!loading && nodes.length === 0" class="flex-1 flex flex-col items-center justify-center text-center">
      <svg class="w-12 h-12 text-[var(--text-faint)] mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <line x1="6" y1="3" x2="6" y2="15"/>
        <circle cx="18" cy="6" r="3"/>
        <circle cx="6" cy="18" r="3"/>
        <path d="M18 9a9 9 0 0 1-9 9"/>
      </svg>
      <span class="text-xs text-[var(--text-muted)]">No commits found</span>
      <span class="text-[10px] text-[var(--text-faint)] mt-1">This repository may not have any commits yet</span>
    </div>

    <!-- Main body -->
    <template v-else>
      <div class="flex flex-1 overflow-hidden min-h-0">
        <!-- Canvas area -->
        <div class="flex-1 overflow-hidden relative">
          <GitGraphCanvas
            ref="canvasRef"
            :nodes="nodes"
            :edges="edges"
            :width="graphWidth"
            :height="graphHeight"
            :selected-hash="selectedCommitHash"
            @select-commit="onSelectCommit"
            @hover-commit="() => {}"
          />
        </div>

        <!-- Detail panel (slide in) -->
        <transition name="slide-panel">
          <GitGraphCommitDetail
            v-if="selectedNode"
            :commit="selectedNode"
            @navigate-epic="onNavigateEpic"
            @close="selectedCommitHash = null"
          />
        </transition>
      </div>

      <!-- Legend -->
      <GitGraphLegend
        v-if="showLegend"
        :branch-colors="branchColors"
        :epic-branches="epicStore.epicBranches"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, toRef, onMounted } from 'vue';
import { useGitStore } from '@/stores/git';
import { useProjectsStore } from '@/stores/projects';
import { useFilterStore } from '@/stores/filter';
import { useEpicStore } from '@/stores/epics';
import { useUiStore } from '@/stores/ui';
import { useGitGraph } from '@/composables/useGitGraph';
import GitGraphCanvas from './GitGraphCanvas.vue';
import GitGraphLegend from './GitGraphLegend.vue';
import GitGraphCommitDetail from './GitGraphCommitDetail.vue';

const gitStore = useGitStore();
const projectsStore = useProjectsStore();
const filterStore = useFilterStore();
const epicStore = useEpicStore();
const ui = useUiStore();

const loading = ref(false);
const selectedRepoIdx = ref(0);
const selectedCommitHash = ref<string | null>(null);
const showLegend = ref(false);
const canvasRef = ref<InstanceType<typeof GitGraphCanvas> | null>(null);

const projectId = computed(() => filterStore.selectedProjectIds[0] ?? null);

const allRepos = computed(() => {
  if (!projectId.value) return [];
  return projectsStore.reposByProjectId(projectId.value);
});

const workDir = computed(() => {
  const repo = allRepos.value[selectedRepoIdx.value];
  return repo ? repo.path : '';
});

const commits = toRef(gitStore, 'commits');

// Build inverted epicBranchInfo: branchName -> { epicId, epicTitle }
const epicBranchInfo = computed(() => {
  const map = new Map<string, { epicId: string; epicTitle: string }>();
  for (const [epicId, branches] of epicStore.epicBranches) {
    const epic = epicStore.epicById(epicId);
    const title = epic?.title ?? epicId;
    for (const eb of branches) {
      if (!map.has(eb.branchName)) {
        map.set(eb.branchName, { epicId, epicTitle: title });
      }
    }
  }
  return map;
});

const { nodes, edges, width: graphWidth, height: graphHeight, branchColors } = useGitGraph(commits, epicBranchInfo);

const selectedNode = computed(() => {
  if (!selectedCommitHash.value) return null;
  return nodes.value.find(n => n.commit.hash === selectedCommitHash.value) ?? null;
});

// Fetch log on mount and when repo changes
function refresh() {
  if (workDir.value) {
    loading.value = true;
    gitStore.fetchLog(workDir.value);
  }
}

watch(workDir, (dir) => {
  if (dir) {
    selectedCommitHash.value = null;
    loading.value = true;
    gitStore.fetchLog(dir);
  }
});

watch(commits, () => {
  loading.value = false;
});

onMounted(() => {
  if (workDir.value) {
    loading.value = true;
    gitStore.fetchLog(workDir.value);
  }
});

function onSelectCommit(hash: string) {
  selectedCommitHash.value = selectedCommitHash.value === hash ? null : hash;
}

function onNavigateEpic(epicId: string) {
  const epic = epicStore.epicById(epicId);
  if (epic) {
    ui.navigateToEpic(epicId, epic.projectId);
  }
}
</script>

<style scoped>
.slide-panel-enter-active,
.slide-panel-leave-active {
  transition: transform 0.2s ease;
}
.slide-panel-enter-from,
.slide-panel-leave-to {
  transform: translateX(100%);
}
</style>
