<script setup lang="ts">
import { computed } from 'vue';
import { useFleetStore, PROJECT_COLORS } from '@/stores/fleet';
import { useEpicStore } from '@/stores/epics';
import { useProjectsStore } from '@/stores/projects';

const fleetStore = useFleetStore();
const epicStore = useEpicStore();
const projectsStore = useProjectsStore();

const projectProgress = computed(() => {
  return projectsStore.projects
    .map((project, idx) => {
      const epics = epicStore.epicsByProject(project.id);
      const total = epics.filter(e => ['in-progress', 'review', 'done'].includes(e.column)).length;
      const done = epics.filter(e => e.column === 'done').length;
      return {
        projectId: project.id,
        name: project.name,
        color: PROJECT_COLORS[idx % PROJECT_COLORS.length],
        done,
        total,
      };
    })
    .filter(p => p.total > 0);
});

const recentActivities = computed(() => fleetStore.recentActivities);
const activeCount = computed(() => fleetStore.activeCount);
</script>

<template>
  <div class="fixed bottom-0 left-14 right-0 h-7 z-40 bg-base/90 backdrop-blur-sm border-t border-border-subtle flex items-center px-3 gap-4 overflow-hidden">
    <!-- Left zone: project progress badges -->
    <div class="flex items-center gap-3 shrink-0 px-4 mr-3 border-r border-border-standard pr-4">
      <template v-for="proj in projectProgress" :key="proj.projectId">
        <div class="flex items-center gap-1.5">
          <span class="w-1.5 h-1.5 rounded-full flex-shrink-0 anim-breathe" :style="{ backgroundColor: proj.color }"></span>
          <span class="text-[10px] text-txt-muted font-mono leading-none">{{ proj.name }} building {{ proj.done }}/{{ proj.total }}</span>
        </div>
      </template>
    </div>

    <!-- Separator (only if there are projects) -->
    <div v-if="projectProgress.length > 0" class="w-px h-3 bg-border-standard flex-shrink-0"></div>

    <!-- Summary text -->
    <span class="text-[10px] text-txt-faint flex-shrink-0">{{ activeCount }} agent{{ activeCount === 1 ? '' : 's' }} active</span>

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
