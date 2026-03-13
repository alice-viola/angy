<template>
  <div class="flex flex-col h-full bg-[var(--bg-base)]">
    <!-- Git ops panel -->
    <GitOpsPanel v-if="showGitOps && projectId" ref="gitOpsPanelRef" :projectId="projectId" />

    <!-- Two-row header -->
    <div class="flex flex-col gap-1.5 px-4 pt-3 pb-2">
      <!-- Row 1: title, subtitle, filter input, actions -->
      <div class="flex items-center gap-3">
        <div class="flex flex-col mr-auto">
          <h2 class="text-base font-semibold text-txt-primary leading-tight">Board</h2>
          <span class="text-[10px] text-txt-muted">
            {{ epicCount }} epic{{ epicCount !== 1 ? 's' : '' }} across {{ activeProjectCount }} project{{ activeProjectCount !== 1 ? 's' : '' }}
          </span>
        </div>

        <!-- Search input -->
        <div class="relative">
          <svg class="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-txt-faint pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            v-model="filterQuery"
            type="text"
            placeholder="Filter epics…"
            class="w-44 pl-7 pr-2 py-1 rounded-lg bg-raised border border-border-subtle text-xs text-txt-primary placeholder:text-txt-faint focus:outline-none focus:border-[var(--accent-mauve)]/40 transition-colors"
          />
        </div>

        <!-- Schedule Now -->
        <button
          class="px-2.5 py-1 rounded-lg text-[11px] font-medium text-txt-secondary bg-raised border border-border-subtle hover:border-border-standard hover:text-txt-primary transition-colors"
          title="Trigger scheduler tick"
          @click="onScheduleNow"
        >
          Schedule Now
        </button>

        <!-- Add Epic -->
        <button
          class="px-2.5 py-1 rounded-lg text-[11px] font-medium text-white bg-[var(--accent-mauve)] hover:opacity-90 transition-opacity flex items-center gap-1"
          @click="addEpic"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add Epic
        </button>
      </div>

      <!-- Row 2: Project filter chips -->
      <ProjectFilterChips
        :selectedIds="filterStore.selectedProjectIds"
        :projects="chipProjects"
        popoverId="kanban-project-filter"
        @toggle="onFilterToggle"
        @remove="onFilterToggle"
      />
    </div>

    <!-- Board + Detail panel -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Columns -->
      <div class="flex-1 flex flex-col overflow-hidden">
        <div class="flex-1 flex gap-2 p-2 overflow-x-auto">
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

    <!-- Git tree dialog -->
    <GitTreeDialog
      :visible="showGitTree"
      @close="showGitTree = false"
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
import { ref, computed, watch } from 'vue';
import type { SchedulerConfig } from '@/engine/KosTypes';
import { useUiStore } from '@/stores/ui';
import { useEpicStore } from '@/stores/epics';
import { useProjectsStore } from '@/stores/projects';
import { useFilterStore } from '@/stores/filter';
import { Scheduler } from '@/engine/Scheduler';
import KanbanColumn from './KanbanColumn.vue';
import type { BoardColumn } from './KanbanColumn.vue';
import EpicDetailPanel from './EpicDetailPanel.vue';
import ProjectFilterChips from '@/components/common/ProjectFilterChips.vue';
import SchedulerConfigDialog from './SchedulerConfigDialog.vue';
import GitTreeDialog from './GitTreeDialog.vue';
import GitOpsPanel from './GitOpsPanel.vue';
import MergeEpicsDialog from './MergeEpicsDialog.vue';

const ui = useUiStore();
const epicStore = useEpicStore();
const projectsStore = useProjectsStore();
const filterStore = useFilterStore();

// Sync filter store from ui.kanbanProjectIds (ui is the write target, filterStore is the read target)
watch(
  () => ui.kanbanProjectIds,
  (ids) => filterStore.applySelection(ids),
  { immediate: true },
);

const gitOpsPanelRef = ref<InstanceType<typeof GitOpsPanel> | null>(null);
const selectedEpicId = ref<string | null>(null);
const isNewEpic = ref(false);
const showSchedulerConfig = ref(false);
const showGitTree = ref(false);
const showGitOps = ref(false);
const mergeMode = ref(false);
const selectedEpicIds = ref<string[]>([]);
const showMergeDialog = ref(false);
const filterQuery = ref('');

const projectId = computed(() => ui.activeProjectId ?? '');

// ── Derived data ──────────────────────────────────────────────────────

const chipProjects = computed(() =>
  projectsStore.projects.map((p) => ({ id: p.id, name: p.name })),
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
    label: 'Ideas',
    width: '15%',
    dotColor: 'bg-[var(--accent-mauve)]',
    labelColor: 'text-[var(--accent-mauve)]',
    opacity: 1,
    breathe: false,
    addButton: true,
  },
  {
    key: 'upcoming',
    columns: ['backlog', 'todo'],
    dropTarget: 'todo',
    label: 'Upcoming',
    width: '18%',
    dotColor: 'bg-[var(--accent-cyan)]',
    labelColor: 'text-[var(--accent-cyan)]',
    opacity: 1,
    breathe: false,
  },
  {
    key: 'active',
    columns: ['in-progress'],
    dropTarget: 'in-progress',
    label: 'Active',
    width: '22%',
    dotColor: 'bg-[var(--accent-yellow)]',
    labelColor: 'text-[var(--accent-yellow)]',
    opacity: 1,
    breathe: true,
  },
  {
    key: 'review',
    columns: ['review'],
    dropTarget: 'review',
    label: 'Review',
    width: '18%',
    dotColor: 'bg-[var(--accent-peach)]',
    labelColor: 'text-[var(--accent-peach)]',
    opacity: 1,
    breathe: false,
  },
  {
    key: 'done',
    columns: ['done'],
    dropTarget: 'done',
    label: 'Done',
    width: '14%',
    dotColor: 'bg-[var(--accent-green)]',
    labelColor: 'text-[var(--accent-green)]',
    opacity: 0.7,
    breathe: false,
  },
  {
    key: 'discarded',
    columns: ['discarded'],
    dropTarget: 'discarded',
    label: 'Discarded',
    width: '13%',
    dotColor: 'bg-txt-faint',
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

async function onSchedulerConfigSaved(config: SchedulerConfig) {
  await Scheduler.getInstance().saveConfig(config);
}

function onFilterToggle(projectId: string) {
  ui.toggleKanbanProject(projectId);
}

function onToggleSelect(epicId: string) {
  const idx = selectedEpicIds.value.indexOf(epicId);
  if (idx >= 0) {
    selectedEpicIds.value.splice(idx, 1);
  } else {
    selectedEpicIds.value.push(epicId);
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
  openGitTree: () => { showGitTree.value = true },
  openSchedulerConfig: () => { showSchedulerConfig.value = true },
  toggleGitOps: () => { showGitOps.value = !showGitOps.value },
  toggleMergeMode: () => {
    mergeMode.value = !mergeMode.value;
    if (!mergeMode.value) {
      selectedEpicIds.value = [];
    }
  },
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
