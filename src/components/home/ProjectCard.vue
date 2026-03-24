<script setup lang="ts">
import { computed } from 'vue';
import type { Project } from '@/engine/KosTypes';
import type { AgentSummary } from '@/engine/types';
import { useUiStore } from '@/stores/ui';
import { useEpicStore } from '@/stores/epics';

const props = defineProps<{
  project: Project;
  agents: AgentSummary[];
  activeEpicCount: number;
  repoCount: number;
  index: number;
}>();

const emit = defineEmits<{
  'open-settings': [];
}>();

const ui = useUiStore();
const epicStore = useEpicStore();

const ACCENT_COLORS = ['ember', 'cyan', 'teal', 'rose', 'mauve', 'blue'] as const;
const accent = computed(() => ACCENT_COLORS[props.index % ACCENT_COLORS.length]);

const borderColorClass = computed(() => {
  const map: Record<string, string> = {
    ember: 'border-l-ember-500/50',
    cyan: 'border-l-cyan-500/50',
    teal: 'border-l-teal/50',
    rose: 'border-l-rose-500/50',
    mauve: 'border-l-purple-500/50',
    blue: 'border-l-blue-500/50',
  };
  return map[accent.value] ?? 'border-l-ember-500/50';
});

const accentColorVar = computed(() => `var(--accent-${accent.value})`);

const isActive = computed(() => props.activeEpicCount > 0 || props.agents.some(a => a.status !== 'idle'));
const epicCount = computed(() => epicStore.epicsByProject(props.project.id).length);
const nextTodoEpic = computed(() =>
  epicStore.epicsByProject(props.project.id).find(e => e.column === 'todo')
);

function handleRun() {
  if (nextTodoEpic.value) {
    epicStore.moveEpic(nextTodoEpic.value.id, 'in-progress');
  }
}
</script>

<template>
  <div
    class="group relative flex items-center gap-2.5 px-3 py-2 rounded-md transition-colors cursor-pointer border-l-2"
    :class="[
      borderColorClass,
      isActive ? 'bg-white/[0.02]' : 'hover:bg-white/[0.03]'
    ]"
    @click="ui.navigateToProject(props.project.id)"
  >
    <!-- Icon -->
    <div
      class="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
      :style="{ backgroundColor: `color-mix(in srgb, ${accentColorVar} 12%, transparent)` }"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" :stroke="accentColorVar" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="3" /><path d="M9 3v18M3 9h18" />
      </svg>
    </div>

    <!-- Main content -->
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2">
        <span class="text-[12px] font-medium text-txt-primary truncate">{{ project.name }}</span>
        <span v-if="isActive" class="w-1.5 h-1.5 rounded-full bg-teal flex-shrink-0" />
      </div>
      <div class="flex items-center gap-2 text-[10px] text-txt-faint">
        <span>{{ repoCount }} repo{{ repoCount !== 1 ? 's' : '' }}</span>
        <span class="text-txt-faint/50">·</span>
        <span>{{ epicCount }} epic{{ epicCount !== 1 ? 's' : '' }}</span>
        <template v-if="activeEpicCount > 0">
          <span class="text-txt-faint/50">·</span>
          <span class="text-teal">{{ activeEpicCount }} running</span>
        </template>
      </div>
    </div>

    <!-- Right side: Quick actions (visible on hover) -->
    <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" @click.stop>
      <button
        class="text-[9px] px-1.5 py-0.5 rounded bg-raised hover:bg-raised-hover text-txt-secondary transition-colors"
        @click="ui.navigateToKanban(props.project.id)"
      >Board</button>
      <button
        class="text-[9px] px-1.5 py-0.5 rounded bg-raised hover:bg-raised-hover text-txt-secondary transition-colors"
        @click="emit('open-settings')"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"/><path d="M12 1v4m0 14v4m-9-9h4m14 0h4m-3.3-6.3-2.8 2.8m-9.8 9.8-2.8 2.8m0-15.6 2.8 2.8m9.8 9.8 2.8 2.8"/>
        </svg>
      </button>
      <button
        v-if="nextTodoEpic"
        class="text-[9px] px-1.5 py-0.5 rounded bg-ember-500/10 hover:bg-ember-500/20 text-ember-400 transition-colors"
        @click="handleRun"
      >Run</button>
    </div>
  </div>
</template>
