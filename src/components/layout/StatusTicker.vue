<script setup lang="ts">
import { computed, ref, nextTick, onMounted, onUnmounted } from 'vue';
import { useFleetStore, PROJECT_COLORS } from '@/stores/fleet';
import { useEpicStore } from '@/stores/epics';
import { useProjectsStore } from '@/stores/projects';
import { useUiStore } from '@/stores/ui';
import { useGitStore } from '@/stores/git';

const fleetStore = useFleetStore();
const epicStore = useEpicStore();
const projectsStore = useProjectsStore();
const ui = useUiStore();
const gitStore = useGitStore();

// ── Branch menu ──
const branchMenuOpen = ref(false);
const branchSearch = ref('');
const branchBtnWrapRef = ref<HTMLElement | null>(null);
const branchDropdownRef = ref<HTMLElement | null>(null);
const branchSearchRef = ref<HTMLInputElement | null>(null);
const branchBtnRef = ref<HTMLElement | null>(null);
const dropdownStyle = ref({ left: '0px', bottom: '0px' });

const MAX_BRANCHES = 15;

const filteredBranches = computed(() => {
  const q = branchSearch.value.trim().toLowerCase();
  const localNames = new Set(gitStore.branches.filter(b => b.isLocal).map(b => b.name));
  const unique = gitStore.branches.filter(b => b.isLocal || !localNames.has(b.name));
  const matched = q ? unique.filter(b => b.name.toLowerCase().includes(q)) : unique;
  // Current branch first, then the rest, capped
  const current = matched.filter(b => b.isCurrent);
  const rest = matched.filter(b => !b.isCurrent);
  return [...current, ...rest].slice(0, MAX_BRANCHES);
});

function toggleBranchMenu() {
  branchMenuOpen.value = !branchMenuOpen.value;
  if (branchMenuOpen.value) {
    branchSearch.value = '';
    gitStore.manager.listBranches();
    if (branchBtnRef.value) {
      const rect = branchBtnRef.value.getBoundingClientRect();
      dropdownStyle.value = {
        left: `${rect.left}px`,
        bottom: `${window.innerHeight - rect.top + 4}px`,
      };
    }
    nextTick(() => branchSearchRef.value?.focus());
  }
}

const currentBranchName = computed(() => gitStore.branch || ui.currentBranch);

function switchBranch(name: string) {
  if (name !== currentBranchName.value) {
    gitStore.manager.checkoutBranch(name);
  }
  branchMenuOpen.value = false;
}

function createNewBranch() {
  const name = branchSearch.value.trim();
  if (!name) return;
  gitStore.manager.createBranch(name, true);
  branchMenuOpen.value = false;
}

function onBranchInputEnter() {
  const q = branchSearch.value.trim();
  const exact = filteredBranches.value.find(b => b.name === q);
  if (exact) {
    switchBranch(exact.name);
  } else if (q) {
    createNewBranch();
  }
}

function onClickOutside(e: MouseEvent) {
  const target = e.target as Node;
  if (branchBtnWrapRef.value?.contains(target)) return;
  if (branchDropdownRef.value?.contains(target)) return;
  branchMenuOpen.value = false;
}

onMounted(() => document.addEventListener('mousedown', onClickOutside));
onUnmounted(() => document.removeEventListener('mousedown', onClickOutside));

const projectProgress = computed(() => {
  return projectsStore.projects
    .map((project, idx) => {
      const epics = epicStore.epicsByProject(project.id);
      const inProgress = epics.filter(e => e.column === 'in-progress');
      const total = epics.filter(e => ['in-progress', 'review', 'done'].includes(e.column)).length;
      const done = epics.filter(e => e.column === 'done').length;

      let phaseLabel: string | null = null;
      let phaseProgress: { current: number; total: number } | undefined;
      for (const epic of inProgress) {
        const activity = ui.epicActivities.get(epic.id);
        if (activity) {
          phaseLabel = activity.label;
          phaseProgress = activity.progress;
          break;
        }
      }

      return {
        projectId: project.id,
        name: project.name,
        color: PROJECT_COLORS[idx % PROJECT_COLORS.length],
        done,
        total,
        phaseLabel,
        phaseProgress,
      };
    })
    .filter(p => p.total > 0);
});

const recentActivities = computed(() => fleetStore.recentActivities);
const activeCount = computed(() => fleetStore.activeCount);
</script>

<template>
  <div
    class="fixed bottom-0 right-0 h-7 z-40 bg-base/90 backdrop-blur-sm border-t border-border-subtle flex items-center px-3 gap-4 overflow-hidden transition-all duration-200"
    :class="ui.navRailExpanded ? 'left-36' : 'left-14'"
  >
    <!-- Left zone: project progress badges -->
    <div class="flex items-center gap-3 shrink-0 px-4 mr-3 border-r border-border-standard pr-4">
      <template v-for="proj in projectProgress" :key="proj.projectId">
        <div class="flex items-center gap-1.5">
          <span class="w-1.5 h-1.5 rounded-full flex-shrink-0 anim-breathe" :style="{ backgroundColor: proj.color }"></span>
          <span v-if="proj.phaseLabel" class="text-[10px] text-txt-muted font-mono leading-none">
            {{ proj.name }}
            <span class="text-teal">{{ proj.phaseLabel }}</span>
            <template v-if="proj.phaseProgress"> {{ proj.phaseProgress.current }}/{{ proj.phaseProgress.total }}</template>
          </span>
          <span v-else class="text-[10px] text-txt-muted font-mono leading-none">{{ proj.name }} {{ proj.done }}/{{ proj.total }} done</span>
        </div>
      </template>
    </div>

    <!-- Separator (only if there are projects) -->
    <div v-if="projectProgress.length > 0" class="w-px h-3 bg-border-standard flex-shrink-0"></div>

    <!-- Summary text -->
    <span class="text-[10px] text-txt-faint flex-shrink-0">{{ activeCount }} agent{{ activeCount === 1 ? '' : 's' }} active</span>

    <!-- Branch selector -->
    <template v-if="currentBranchName">
      <div class="w-px h-3 bg-border-standard flex-shrink-0"></div>
      <div class="flex-shrink-0" ref="branchBtnWrapRef">
        <button
          ref="branchBtnRef"
          @click="toggleBranchMenu"
          class="flex items-center gap-1 text-[10px] text-orange-400 hover:text-orange-300 transition-colors"
          title="Switch branch"
        >
          <span>&#x2387;</span>
          <span>{{ currentBranchName }}</span>
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" stroke-width="1.5" class="opacity-50">
            <path d="M2 3L4 5L6 3" />
          </svg>
        </button>
      </div>

      <!-- Branch dropdown (teleported to body to escape overflow-hidden) -->
      <Teleport to="body">
        <div
          v-if="branchMenuOpen"
          ref="branchDropdownRef"
          class="fixed w-56 bg-surface border border-border-subtle rounded-md shadow-lg z-[9999] overflow-hidden"
          :style="dropdownStyle"
        >
          <div class="p-1.5 border-b border-border-subtle">
            <input
              ref="branchSearchRef"
              v-model="branchSearch"
              @keydown.enter="onBranchInputEnter"
              @keydown.escape="branchMenuOpen = false"
              class="w-full px-2 py-1 text-[11px] bg-base text-txt-primary border border-border-subtle rounded outline-none focus:border-blue-500"
              placeholder="Search or create branch…"
            />
          </div>

          <button
            v-if="branchSearch.trim() && !filteredBranches.some(b => b.name === branchSearch.trim())"
            @click="createNewBranch"
            class="w-full px-3 py-1.5 text-left text-[11px] text-orange-400 hover:bg-raised-hover flex items-center gap-1.5 border-b border-border-subtle"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M5 2V8M2 5H8" />
            </svg>
            Create <span class="font-medium">{{ branchSearch.trim() }}</span>
          </button>

          <div class="max-h-48 overflow-y-auto">
            <button
              v-for="b in filteredBranches"
              :key="b.name + (b.remoteName || '')"
              @click="switchBranch(b.name)"
              class="w-full px-3 py-1.5 text-left text-[11px] hover:bg-raised-hover flex items-center gap-1.5 transition-colors"
              :class="b.isCurrent ? 'text-teal' : 'text-txt-secondary'"
            >
              <span v-if="b.isCurrent" class="text-teal">&#x2713;</span>
              <span v-else class="w-[10px]"></span>
              <span class="truncate">{{ b.name }}</span>
              <span v-if="b.remoteName" class="text-txt-faint ml-auto text-[9px]">{{ b.remoteName }}</span>
            </button>
            <div v-if="filteredBranches.length === 0" class="px-3 py-2 text-[11px] text-txt-faint">
              No branches found
            </div>
          </div>
        </div>
      </Teleport>
    </template>

    <!-- Terminal toggle -->
    <div class="ml-auto flex-shrink-0 flex items-center gap-1 pl-2">
      <button
        @click="ui.toggleTerminal()"
        class="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors"
        :class="ui.terminalVisible
          ? 'text-[var(--accent-teal)] bg-white/[0.06]'
          : 'text-[var(--text-faint)] hover:text-[var(--text-muted)]'"
        title="Toggle terminal"
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4">
          <rect x="1" y="2" width="10" height="8" rx="1"/>
          <polyline points="3,5 5,6 3,7"/>
          <line x1="6" y1="7" x2="9" y2="7"/>
        </svg>
      </button>
    </div>

    <!-- Right zone: scrolling ticker (only when there are activities) -->
    <template v-if="recentActivities.length > 0">
      <div class="w-px h-3 bg-border-standard flex-shrink-0"></div>
      <div class="flex-1 overflow-hidden relative">
        <!-- Duplicate items for seamless loop -->
        <div class="ticker-track flex items-center gap-4 whitespace-nowrap">
          <template v-for="(item, _idx) in [...recentActivities, ...recentActivities]" :key="`${_idx}-${item.name}`">
            <div class="flex items-center gap-1.5 flex-shrink-0">
              <!-- Status dot -->
              <span
                class="w-1.5 h-1.5 rounded-full flex-shrink-0"
                :class="item.status === 'working' ? 'bg-teal anim-breathe' : item.status === 'done' ? 'bg-emerald-400' : item.status === 'error' ? 'bg-red-400' : item.status === 'blocked' ? 'bg-yellow-400' : 'bg-txt-faint'"
              ></span>
              <!-- Agent name -->
              <span class="text-[10px] leading-none" :class="item.status === 'working' ? 'text-teal' : item.status === 'done' ? 'text-emerald-400' : 'text-txt-secondary'">{{ item.name }}</span>
              <!-- Separator -->
              <span class="text-border-standard">&middot;</span>
              <!-- Activity text -->
              <span class="text-[10px] text-txt-muted leading-none">{{ item.activity }}</span>
            </div>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>
