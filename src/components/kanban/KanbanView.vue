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
          {{ epicCount }} epic{{ epicCount !== 1 ? 's' : '' }} in this project
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
    </header>

    <!-- Board + Detail panel -->
    <div class="flex flex-1 overflow-hidden">
      <!-- 3-Column Pipeline Layout -->
      <div class="flex-1 flex gap-4 p-4 overflow-hidden">
        
        <!-- 1. The Queue (Left Column) -->
        <div class="flex flex-col gap-4 flex-[1] min-w-[320px] max-w-[400px]">
          <!-- Active Queue (todo) -->
          <div class="flex-[1] flex flex-col min-h-0 bg-[var(--bg-surface)]/30 rounded-xl border border-[var(--border-subtle)] p-3">
            <KanbanColumn
              v-if="queueTodoColumn"
              :boardColumn="queueTodoColumn"
              :projectIds="[projectId]"
              :filterText="filterQuery"
              :mergeMode="mergeMode"
              :selectedEpicIds="selectedEpicIds"
              @epic-select="onSelectEpic($event)"
              @epic-toggle-select="onToggleSelect"
            />
          </div>
          
          <!-- Icebox / Drafts (idea, backlog) -->
          <div class="flex-[1] flex flex-col min-h-0 bg-[var(--bg-surface)]/10 rounded-xl border border-[var(--border-subtle)] border-dashed p-3 opacity-60 hover:opacity-100 transition-opacity">
            <KanbanColumn
              v-if="queueIceboxColumn"
              :boardColumn="queueIceboxColumn"
              :projectIds="[projectId]"
              :filterText="filterQuery"
              :mergeMode="mergeMode"
              :selectedEpicIds="selectedEpicIds"
              @epic-select="onSelectEpic($event)"
              @epic-toggle-select="onToggleSelect"
              @add-idea="addEpic"
            />
          </div>
        </div>

        <!-- 2. Live Execution Graph (Center Column) -->
        <div class="flex-[2] flex flex-col min-w-[400px] min-h-0">
          <LiveExecutionGraph
            v-if="projectId"
            :projectId="projectId"
            @epic-select="onSelectEpic($event)"
          />
        </div>

        <!-- 3. Review Inbox (Right Column) -->
        <div class="flex flex-col flex-[1] min-w-[320px] max-w-[400px] bg-[var(--bg-surface)]/30 rounded-xl border border-[var(--border-subtle)] p-3 min-h-0">
          <KanbanColumn
            v-if="reviewInboxColumn"
            :boardColumn="reviewInboxColumn"
            :projectIds="[projectId]"
            :filterText="filterQuery"
            :mergeMode="mergeMode"
            :selectedEpicIds="selectedEpicIds"
            @epic-select="onSelectEpic($event)"
            @epic-toggle-select="onToggleSelect"
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
import { Scheduler } from '@/engine/Scheduler';
import KanbanColumn from './KanbanColumn.vue';
import LiveExecutionGraph from './LiveExecutionGraph.vue';
import type { BoardColumn } from './KanbanColumn.vue';
import EpicDetailPanel from './EpicDetailPanel.vue';
import SchedulerConfigDialog from './SchedulerConfigDialog.vue';
import GitOpsPanel from './GitOpsPanel.vue';
import MergeEpicsDialog from './MergeEpicsDialog.vue';

const ui = useUiStore();
const epicStore = useEpicStore();

onMounted(async () => {
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

const epicCount = computed(() =>
  epicStore.epicsByColumns([projectId.value], ['idea', 'backlog', 'todo', 'in-progress', 'review', 'done', 'discarded']).length,
);

// ── Board columns config ──────────────────────────────────────────────

const queueTodoColumn = computed<BoardColumn>(() => ({
  key: 'todo',
  columns: ['todo'],
  dropTarget: 'todo',
  label: 'Active Queue',
  width: '100%',
  dotColor: 'bg-blue-400/80',
  labelColor: 'text-txt-faint',
  opacity: 1,
  breathe: false,
}));

const queueIceboxColumn = computed<BoardColumn>(() => ({
  key: 'icebox',
  columns: ['idea', 'backlog'],
  dropTarget: 'idea',
  label: 'Icebox',
  width: '100%',
  dotColor: 'bg-purple-400/80',
  labelColor: 'text-txt-faint',
  opacity: 1,
  breathe: false,
  addButton: true,
}));

const reviewInboxColumn = computed<BoardColumn>(() => ({
  key: 'review-inbox',
  columns: ['review', 'done', 'discarded'],
  dropTarget: 'review',
  label: 'Review Inbox',
  width: '100%',
  dotColor: 'bg-orange-400',
  labelColor: 'text-orange-400',
  opacity: 1,
  breathe: false,
}));

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
