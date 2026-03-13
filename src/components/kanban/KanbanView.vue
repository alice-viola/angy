<template>
  <div class="flex flex-col h-full bg-[var(--bg-base)]">
    <!-- Git ops panel -->
    <GitOpsPanel v-if="showGitOps && projectId" ref="gitOpsPanelRef" :projectId="projectId" />

    <!-- Board + Detail panel -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Columns -->
      <div class="flex-1 flex flex-col overflow-hidden">
        <SectionTip tipId="kanban-intro" title="Epic Board">
          <p>Drag epics across columns to manage their lifecycle. Move an epic to <strong>In Progress</strong> to start an AI orchestration pipeline. Epics in <strong>Review</strong> need your approval before completing.</p>
        </SectionTip>
        <div class="flex-1 flex gap-2 p-2 overflow-x-auto">
        <KanbanColumn
          v-for="col in columns"
          :key="col"
          :column="col"
          :projectIds="ui.kanbanProjectIds"
          :filterText="ui.kanbanFilterText"
          :mergeMode="mergeMode"
          :selectedEpicIds="selectedEpicIds"
          @selectEpic="onSelectEpic($event)"
          @addEpic="addEpic"
          @dropEpic="onDropEpic"
          @toggle-select="onToggleSelect"
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
             bg-[var(--bg-window)]/90 backdrop-blur-md border border-[var(--border-subtle)] shadow-[var(--shadow-lg)]"
    >
      <span class="text-xs font-medium text-[var(--text-secondary)]">
        {{ selectedEpicIds.length }} epic{{ selectedEpicIds.length !== 1 ? 's' : '' }} selected
      </span>
      <button
        class="px-3 py-1.5 text-xs rounded-[var(--radius-md)] font-medium bg-[var(--accent-teal)] text-white hover:opacity-90 transition-opacity"
        @click="showMergeDialog = true"
      >
        Merge Selected
      </button>
      <button
        class="px-3 py-1.5 text-xs rounded-[var(--radius-md)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        @click="exitMergeMode"
      >
        Cancel
      </button>
    </div>

    <!-- Project picker for Add Epic (multi-project) -->
    <Teleport to="body">
      <div
        v-if="showProjectPicker"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        @click.self="showProjectPicker = false"
      >
        <div class="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] shadow-[var(--shadow-lg)] p-4 min-w-[240px]">
          <p class="text-xs font-semibold text-[var(--text-primary)] mb-3">Create epic in which project?</p>
          <div class="space-y-1.5">
            <button
              v-for="project in pickerProjects"
              :key="project.id"
              class="w-full flex items-center gap-2 px-3 py-2 text-xs rounded-[var(--radius-md)]
                     text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
              @click="addEpicToProject(project.id)"
            >
              <div class="w-2.5 h-2.5 rounded-full shrink-0" :style="{ background: project.color || '#cba6f7' }" />
              {{ project.name }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

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
import { ref, computed } from 'vue';
import type { EpicColumn, SchedulerConfig } from '@/engine/KosTypes';
import { useUiStore } from '@/stores/ui';
import { useEpicStore } from '@/stores/epics';
import { useProjectsStore } from '@/stores/projects';
import { engineBus } from '@/engine/EventBus';
import { Scheduler } from '@/engine/Scheduler';
import KanbanColumn from './KanbanColumn.vue';
import EpicDetailPanel from './EpicDetailPanel.vue';
import SectionTip from '@/components/common/SectionTip.vue';
import SchedulerConfigDialog from './SchedulerConfigDialog.vue';
import GitTreeDialog from './GitTreeDialog.vue';
import GitOpsPanel from './GitOpsPanel.vue';
import MergeEpicsDialog from './MergeEpicsDialog.vue';

const ui = useUiStore();
const epicStore = useEpicStore();
const projectsStore = useProjectsStore();

const gitOpsPanelRef = ref<InstanceType<typeof GitOpsPanel> | null>(null);
const selectedEpicId = ref<string | null>(null);
const isNewEpic = ref(false);
const showSchedulerConfig = ref(false);
const showGitTree = ref(false);
const showGitOps = ref(false);
const mergeMode = ref(false);
const selectedEpicIds = ref<string[]>([]);
const showMergeDialog = ref(false);
const showProjectPicker = ref(false);

const columns: EpicColumn[] = ['idea', 'backlog', 'todo', 'in-progress', 'review', 'done', 'discarded'];
const projectId = computed(() => ui.activeProjectId ?? '');

// Projects visible on the kanban
const pickerProjects = computed(() =>
  projectsStore.projects.filter(p => ui.kanbanProjectIds.includes(p.id))
);

const isMultiProject = computed(() => ui.kanbanProjectIds.length > 1);

function onSelectEpic(epicId: string) {
  selectedEpicId.value = epicId;
  isNewEpic.value = false;
}

async function addEpic() {
  if (isMultiProject.value) {
    // Show project picker
    showProjectPicker.value = true;
    return;
  }
  const targetProjectId = ui.kanbanProjectIds[0] || projectId.value;
  if (!targetProjectId) return;
  await addEpicToProject(targetProjectId);
}

async function addEpicToProject(targetProjectId: string) {
  showProjectPicker.value = false;
  const epic = await epicStore.createEpic(targetProjectId, 'New Epic');
  selectedEpicId.value = epic.id;
  isNewEpic.value = true;
}

function onScheduleNow() {
  Scheduler.getInstance().tick();
}

async function onDropEpic({ epicId, column }: { epicId: string; column: EpicColumn }) {
  const epic = epicStore.epicById(epicId);
  if (!epic || epic.column === column) return;
  if (column === 'in-progress') {
    engineBus.emit('epic:requestStart', { epicId });
  } else {
    // If moving FROM in-progress, stop the orchestrator (but don't let it move to backlog)
    if (epic.column === 'in-progress') {
      engineBus.emit('epic:requestStop', { epicId, targetColumn: column });
    } else {
      await epicStore.moveEpic(epicId, column);
    }
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
