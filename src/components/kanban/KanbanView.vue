<template>
  <div class="flex flex-col h-full bg-[var(--bg-base)]">
    <!-- Toolbar -->
    <KanbanToolbar
      :projectName="toolbarTitle"
      v-model:filterText="filterText"
      @addEpic="addEpic"
      @scheduleNow="onScheduleNow"
      @openSchedulerConfig="showSchedulerConfig = true"
    >
      <!-- Multi-project selector slot -->
      <template #projectSelector>
        <!-- Single project: chat button only -->
        <button
          v-if="allProjects.length === 1"
          class="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-[var(--border-subtle)]
                 text-[var(--text-secondary)] hover:text-[var(--text-primary)]
                 hover:border-[var(--border-standard)] transition-colors"
          title="Open agent chat"
          @click="openProjectChat(allProjects[0].id)"
        >
          <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          Chat
        </button>

        <!-- Multiple projects: dropdown with per-project chat buttons -->
        <div v-else-if="allProjects.length > 1" class="relative" ref="dropdownRef">
          <button
            class="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-[var(--border-subtle)]
                   text-[var(--text-secondary)] hover:text-[var(--text-primary)]
                   hover:border-[var(--border-standard)] transition-colors"
            @click="showProjectDropdown = !showProjectDropdown"
          >
            <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            {{ ui.kanbanProjectIds.length }} project{{ ui.kanbanProjectIds.length !== 1 ? 's' : '' }}
            <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <div
            v-if="showProjectDropdown"
            class="absolute top-full left-0 mt-1 z-50 min-w-[200px] rounded-lg border border-[var(--border-subtle)]
                   bg-[var(--bg-window)] shadow-xl shadow-black/30 py-1"
          >
            <div
              v-for="p in allProjects"
              :key="p.id"
              class="flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--bg-raised)] transition-colors"
            >
              <label class="flex items-center gap-2 flex-1 text-xs text-[var(--text-secondary)] cursor-pointer">
                <input
                  type="checkbox"
                  :checked="ui.kanbanProjectIds.includes(p.id)"
                  class="accent-[var(--accent-mauve)]"
                  @change="ui.toggleKanbanProject(p.id)"
                />
                {{ p.name }}
              </label>
              <button
                class="text-[var(--text-muted)] hover:text-[var(--accent-teal)] transition-colors"
                title="Open agent chat"
                @click="openProjectChat(p.id)"
              >
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </template>
    </KanbanToolbar>

    <!-- Board + Detail panel -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Columns -->
      <div class="flex-1 flex gap-2 p-2 overflow-x-auto">
        <KanbanColumn
          v-for="col in columns"
          :key="col"
          :column="col"
          :projectIds="ui.kanbanProjectIds"
          :filterText="filterText"
          @selectEpic="selectedEpicId = $event"
          @addEpic="addEpic"
          @dropEpic="onDropEpic"
        />
      </div>

      <!-- Detail panel slide-out -->
      <transition name="slide">
        <EpicDetailPanel
          v-if="selectedEpicId"
          :epicId="selectedEpicId"
          @close="selectedEpicId = null"
        />
      </transition>
    </div>

    <!-- Scheduler config dialog -->
    <SchedulerConfigDialog
      :visible="showSchedulerConfig"
      @close="showSchedulerConfig = false"
      @save="onSchedulerConfigSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import type { EpicColumn, SchedulerConfig } from '@/engine/KosTypes';
import { useUiStore } from '@/stores/ui';
import { useProjectsStore } from '@/stores/projects';
import { useEpicStore } from '@/stores/epics';
import { engineBus } from '@/engine/EventBus';
import { Scheduler } from '@/engine/Scheduler';
import KanbanToolbar from './KanbanToolbar.vue';
import KanbanColumn from './KanbanColumn.vue';
import EpicDetailPanel from './EpicDetailPanel.vue';
import SchedulerConfigDialog from './SchedulerConfigDialog.vue';

const ui = useUiStore();
const projectsStore = useProjectsStore();
const epicStore = useEpicStore();

const selectedEpicId = ref<string | null>(null);
const filterText = ref('');
const showSchedulerConfig = ref(false);
const showProjectDropdown = ref(false);
const dropdownRef = ref<HTMLElement | null>(null);

const columns: EpicColumn[] = ['idea', 'backlog', 'todo', 'in-progress', 'review', 'done'];
const projectId = computed(() => ui.activeProjectId ?? '');

const allProjects = computed(() => projectsStore.projects);

const toolbarTitle = computed(() => {
  if (ui.kanbanProjectIds.length === 1) {
    return projectsStore.projectById(ui.kanbanProjectIds[0])?.name ?? 'Project';
  }
  return `${ui.kanbanProjectIds.length} Projects`;
});

function openProjectChat(projectId: string) {
  ui.activeProjectId = projectId;
  ui.activeEpicId = null;
  ui.switchToMode('manager');
}

async function addEpic() {
  if (!projectId.value) return;
  const epic = await epicStore.createEpic(projectId.value, 'New Epic');
  selectedEpicId.value = epic.id;
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
    await epicStore.moveEpic(epicId, column);
  }
}

async function onSchedulerConfigSaved(config: SchedulerConfig) {
  await Scheduler.getInstance().saveConfig(config);
}

// Close dropdown on outside click
function onClickOutside(e: MouseEvent) {
  if (dropdownRef.value && !dropdownRef.value.contains(e.target as Node)) {
    showProjectDropdown.value = false;
  }
}

onMounted(() => document.addEventListener('click', onClickOutside));
onUnmounted(() => document.removeEventListener('click', onClickOutside));
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
