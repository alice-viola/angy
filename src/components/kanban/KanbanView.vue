<template>
  <div class="flex flex-col h-full bg-[var(--bg-base)]">
    <!-- Board + Detail panel -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Columns -->
      <div class="flex-1 flex flex-col overflow-hidden">
        <SectionTip tipId="kanban-intro" title="Epic Board" icon="📋">
          <p>Drag epics across columns to manage their lifecycle. Move an epic to <strong>In Progress</strong> to start an AI orchestration pipeline. Epics in <strong>Review</strong> need your approval before completing.</p>
        </SectionTip>
        <div class="flex-1 flex gap-2 p-2 overflow-x-auto">
        <KanbanColumn
          v-for="col in columns"
          :key="col"
          :column="col"
          :projectIds="ui.kanbanProjectIds"
          :filterText="ui.kanbanFilterText"
          @selectEpic="onSelectEpic($event)"
          @addEpic="addEpic"
          @dropEpic="onDropEpic"
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { EpicColumn, SchedulerConfig } from '@/engine/KosTypes';
import { useUiStore } from '@/stores/ui';
import { useEpicStore } from '@/stores/epics';
import { engineBus } from '@/engine/EventBus';
import { Scheduler } from '@/engine/Scheduler';
import KanbanColumn from './KanbanColumn.vue';
import EpicDetailPanel from './EpicDetailPanel.vue';
import SectionTip from '@/components/common/SectionTip.vue';
import SchedulerConfigDialog from './SchedulerConfigDialog.vue';
import GitTreeDialog from './GitTreeDialog.vue';

const ui = useUiStore();
const epicStore = useEpicStore();

const selectedEpicId = ref<string | null>(null);
const isNewEpic = ref(false);
const showSchedulerConfig = ref(false);
const showGitTree = ref(false);

const columns: EpicColumn[] = ['idea', 'backlog', 'todo', 'in-progress', 'review', 'done', 'discarded'];
const projectId = computed(() => ui.activeProjectId ?? '');

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

defineExpose({
  addEpic,
  scheduleNow: onScheduleNow,
  openGitTree: () => { showGitTree.value = true },
  openSchedulerConfig: () => { showSchedulerConfig.value = true },
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
