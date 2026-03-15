<template>
  <div class="flex flex-col h-full bg-[var(--bg-base)]">
    <!-- Git ops panel -->
    <GitOpsPanel v-if="showGitOps && projectId" ref="gitOpsPanelRef" :projectId="projectId" />

    <!-- Two-row header -->
    <header class="flex-shrink-0 bg-window/50 border-b border-border-subtle">
      <!-- Row 1: title, subtitle, filter input, actions -->
      <div class="relative h-12 flex items-center px-5 gap-3">
        <span class="text-sm font-semibold text-txt-primary">Board</span>
        <span class="text-xs text-txt-muted">
          {{ epicCount }} epic{{ epicCount !== 1 ? 's' : '' }} across {{ activeProjectCount }} active project{{ activeProjectCount !== 1 ? 's' : '' }}
        </span>

        <!-- Git tools — centered -->
        <div class="absolute left-1/2 -translate-x-1/2 flex items-center gap-3">
          <!-- Git Tree -->
          <button
            class="text-txt-muted hover:text-txt-primary transition-colors"
            title="Git branch tree"
            @click="ui.switchToMode('git-graph')"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
          </button>

          <!-- Git Ops -->
          <button
            class="text-txt-muted hover:text-txt-primary transition-colors"
            title="Toggle git status panel"
            @click="showGitOps = !showGitOps"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 3v12" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
          </button>

          <!-- Merge Epics -->
          <button
            class="text-txt-muted hover:text-txt-primary transition-colors"
            :class="mergeMode ? 'text-[var(--accent-teal)]' : ''"
            title="Toggle merge mode"
            @click="toggleMergeMode"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="18" cy="18" r="3" />
              <circle cx="6" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M6 9v3a6 6 0 0 0 6 6h3" />
              <path d="M6 9v9" />
            </svg>
          </button>
        </div>

        <div class="flex-1" />

        <!-- Search input -->
        <div class="flex items-center bg-raised rounded-lg px-3 py-1.5 gap-2 w-48">
          <svg class="w-3.5 h-3.5 text-txt-faint flex-shrink-0" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            v-model="filterQuery"
            type="text"
            placeholder="Filter epics..."
            class="bg-transparent text-xs text-txt-primary placeholder:text-txt-faint outline-none w-full"
          />
        </div>

        <!-- Scheduler toggle -->
        <button
          class="relative w-9 h-5 rounded-full transition-colors"
          :class="schedulerEnabled ? 'bg-[var(--accent-green)]' : 'bg-[var(--bg-raised)]'"
          title="Enable/disable auto-scheduler"
          @click="toggleSchedulerEnabled"
        >
          <span
            class="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform"
            :class="schedulerEnabled ? 'left-[18px]' : 'left-0.5'"
          />
        </button>

        <!-- Schedule Now -->
        <button
          class="text-xs text-txt-muted hover:text-txt-secondary transition-colors px-2 py-1.5"
          title="Trigger scheduler tick"
          @click="onScheduleNow"
        >
          Schedule Now
        </button>

        <!-- Add Epic -->
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-base bg-gradient-to-r from-ember-500 to-ember-600 hover:brightness-110 transition"
          @click="addEpic"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add Epic
        </button>
      </div>

      <!-- Row 2: Project filter chips -->
      <div class="flex items-center px-4 py-2 border-t border-border-subtle">
        <ProjectFilterChips
          :selectedIds="filterStore.selectedProjectIds"
          :projects="chipProjects"
          popoverId="kanban-project-filter"
          @toggle="onFilterToggle"
          @remove="onFilterToggle"
        />
      </div>
    </header>

    <!-- Board + Detail panel -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Columns -->
      <div class="flex-1 flex flex-col overflow-hidden">
        <div class="flex-1 flex gap-3 p-4 overflow-x-auto">
          <KanbanColumn
            v-for="col in boardColumns"
            :key="col.key"
            :boardColumn="col"
            :projectIds="filterStore.selectedProjectIds"
            :filterText="filterQuery"
            :mergeMode="mergeMode"
            :selectedEpicIds="selectedEpicIds"
            @epic-select="onSelectEpic($event)"
            @epic-toggle-select="onToggleSelect"
            @add-idea="addEpic"
          />
        </div>
      </div>

      <!-- Detail panel slide-out -->
      <transition name="slide">
        <EpicDetailPanel
          v-if="selectedEpicId"
          :epicId="selectedEpicId"
          :isNew="isNewEpic"
          @close="selectedEpicId = null"
          @created="isNewEpic = false"
        />
      </transition>
    </div>

    <!-- Merge mode floating action bar -->
    <div
      v-if="mergeMode && selectedEpicIds.length > 0"
      class="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-5 py-2.5 rounded-xl
             bg-[var(--bg-window)]/90 backdrop-blur-md border border-[var(--border-subtle)] shadow-2xl shadow-black/30"
    >
      <span class="text-xs font-medium text-[var(--text-secondary)]">
        {{ selectedEpicIds.length }} epic{{ selectedEpicIds.length !== 1 ? 's' : '' }} selected
      </span>
      <button
        class="px-3 py-1.5 text-xs rounded-lg font-medium bg-[var(--accent-teal)] text-white hover:opacity-90 transition-opacity"
        @click="showMergeDialog = true"
      >
        Merge Selected
      </button>
      <button
        class="px-3 py-1.5 text-xs rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        @click="exitMergeMode"
      >
        Cancel
      </button>
    </div>

    <!-- Scheduler config dialog -->
    <SchedulerConfigDialog
      :visible="showSchedulerConfig"
      @close="showSchedulerConfig = false"
      @save="onSchedulerConfigSaved"
    />

    <!-- Merge epics dialog -->
    <MergeEpicsDialog
      :visible="showMergeDialog"
      :projectId="projectId"
      :selectedEpicIds="selectedEpicIds"
      @update:visible="showMergeDialog = $event"
      @close="onMergeComplete"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { SchedulerConfig } from '@/engine/KosTypes';
import { useUiStore } from '@/stores/ui';
import { useEpicStore } from '@/stores/epics';
import { useProjectsStore } from '@/stores/projects';
import { useFilterStore } from '@/stores/filter';
import { PROJECT_COLORS } from '@/stores/fleet';
import { Scheduler } from '@/engine/Scheduler';
import KanbanColumn from './KanbanColumn.vue';
import type { BoardColumn } from './KanbanColumn.vue';
import EpicDetailPanel from './EpicDetailPanel.vue';
import ProjectFilterChips from '@/components/common/ProjectFilterChips.vue';
import SchedulerConfigDialog from './SchedulerConfigDialog.vue';
import GitOpsPanel from './GitOpsPanel.vue';
import MergeEpicsDialog from './MergeEpicsDialog.vue';

const ui = useUiStore();
const epicStore = useEpicStore();
const projectsStore = useProjectsStore();
const filterStore = useFilterStore();

onMounted(async () => {
  if (filterStore.selectedProjectIds.length === 0) {
    filterStore.applyPreset('active');
  }
  try {
    const config = await Scheduler.getInstance().loadConfig();
    schedulerEnabled.value = config.enabled;
  } catch {}
});

const gitOpsPanelRef = ref<InstanceType<typeof GitOpsPanel> | null>(null);
const selectedEpicId = ref<string | null>(null);
const isNewEpic = ref(false);
const showSchedulerConfig = ref(false);
const showGitOps = ref(false);
const mergeMode = ref(false);
const selectedEpicIds = ref<string[]>([]);
const showMergeDialog = ref(false);
const filterQuery = ref('');
const schedulerEnabled = ref(false);

const projectId = computed(() => ui.activeProjectId ?? '');

// ── Derived data ──────────────────────────────────────────────────────

const chipProjects = computed(() =>
  projectsStore.projects.map((p, idx) => ({
    id: p.id,
    name: p.name,
    color: PROJECT_COLORS[idx % PROJECT_COLORS.length],
  })),
);

const epicCount = computed(() =>
  epicStore.epicsByColumns(filterStore.selectedProjectIds, ['idea', 'backlog', 'todo', 'in-progress', 'review', 'done', 'discarded']).length,
);

const activeProjectCount = computed(() => filterStore.selectedProjectIds.length);

// ── Board columns config ──────────────────────────────────────────────

const boardColumns = computed<BoardColumn[]>(() => [
  {
    key: 'idea',
    columns: ['idea'],
    dropTarget: 'idea',
    label: 'Idea',
    width: '220px',
    dotColor: 'bg-purple-400/80',
    labelColor: 'text-txt-faint',
    opacity: 1,
    breathe: false,
    addButton: true,
  },
  {
    key: 'upcoming',
    columns: ['backlog', 'todo'],
    dropTarget: 'todo',
    label: 'Upcoming',
    width: '250px',
    dotColor: 'bg-blue-400/80',
    labelColor: 'text-txt-faint',
    opacity: 1,
    breathe: false,
  },
  {
    key: 'active',
    columns: ['in-progress'],
    dropTarget: 'in-progress',
    label: 'Active',
    width: '340px',
    dotColor: 'bg-ember',
    labelColor: 'text-ember-400',
    opacity: 1,
    breathe: true,
  },
  {
    key: 'review',
    columns: ['review'],
    dropTarget: 'review',
    label: 'Review',
    width: '270px',
    dotColor: 'bg-orange-400',
    labelColor: 'text-orange-400',
    opacity: 1,
    breathe: true,
  },
  {
    key: 'done',
    columns: ['done'],
    dropTarget: 'done',
    label: 'Done',
    width: '220px',
    dotColor: 'bg-emerald-400',
    labelColor: 'text-txt-faint',
    opacity: 0.7,
    breathe: false,
  },
  {
    key: 'discarded',
    columns: ['discarded'],
    dropTarget: 'discarded',
    label: 'Discarded',
    width: '180px',
    dotColor: 'bg-red-400/60',
    labelColor: 'text-txt-faint',
    opacity: 0.5,
    breathe: false,
  },
]);

// ── Handlers ──────────────────────────────────────────────────────────

function onSelectEpic(epicId: string) {
  selectedEpicId.value = epicId;
  isNewEpic.value = false;
}

async function addEpic() {
  if (!projectId.value) return;
  const epic = await epicStore.createEpic(projectId.value, 'New Epic');
  selectedEpicId.value = epic.id;
  isNewEpic.value = true;
}

function onScheduleNow() {
  Scheduler.getInstance().tick();
}

async function toggleSchedulerEnabled() {
  const scheduler = Scheduler.getInstance();
  try {
    const config = await scheduler.loadConfig();
    config.enabled = !config.enabled;
    await scheduler.saveConfig(config);
    schedulerEnabled.value = config.enabled;
  } catch (e) {
    console.error('Failed to toggle scheduler:', e);
  }
}

async function onSchedulerConfigSaved(config: SchedulerConfig) {
  await Scheduler.getInstance().saveConfig(config);
}

function onFilterToggle(projectId: string) {
  filterStore.toggleProject(projectId);
}

function onToggleSelect(epicId: string) {
  const idx = selectedEpicIds.value.indexOf(epicId);
  if (idx >= 0) {
    selectedEpicIds.value.splice(idx, 1);
  } else {
    selectedEpicIds.value.push(epicId);
  }
}

function toggleMergeMode() {
  mergeMode.value = !mergeMode.value;
  if (!mergeMode.value) {
    selectedEpicIds.value = [];
  }
}

function exitMergeMode() {
  mergeMode.value = false;
  selectedEpicIds.value = [];
}

function onMergeComplete() {
  showMergeDialog.value = false;
  mergeMode.value = false;
  selectedEpicIds.value = [];
  gitOpsPanelRef.value?.refresh();
}

defineExpose({
  addEpic,
  scheduleNow: onScheduleNow,
  openSchedulerConfig: () => { showSchedulerConfig.value = true },
  toggleGitOps: () => { showGitOps.value = !showGitOps.value },
  toggleMergeMode,
});
</script>

<style scoped>
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.2s ease;
}
.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
}
</style>
