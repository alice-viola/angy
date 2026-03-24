<script setup lang="ts">
import { computed } from 'vue';
import type { Project } from '@/engine/KosTypes';
import type { AgentSummary } from '@/engine/types';
import { useUiStore } from '@/stores/ui';
import { useEpicStore } from '@/stores/epics';
import WaveBar from '@/components/common/WaveBar.vue';

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

const accentColorVar = computed(() => `var(--accent-${accent.value})`);
const accentHoverClass = computed(() => {
  const map: Record<string, string> = {
    ember: 'group-hover:text-ember-400',
    cyan: 'group-hover:text-cyan-400',
    teal: 'group-hover:text-teal-400',
    rose: 'group-hover:text-rose-400',
    mauve: 'group-hover:text-[var(--accent-mauve)]',
    blue: 'group-hover:text-[var(--accent-blue)]',
  };
  return map[accent.value] ?? 'group-hover:text-ember-400';
});

const isActive = computed(() => props.activeEpicCount > 0 || props.agents.some(a => a.status !== 'idle'));
const activeAgents = computed(() => props.agents.filter(a => a.status !== 'idle'));
const epicCount = computed(() => epicStore.epicsByProject(props.project.id).length);
const nextTodoEpic = computed(() =>
  epicStore.epicsByProject(props.project.id).find(e => e.column === 'todo')
);

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #f59e0b, #ea580c)',
  'linear-gradient(135deg, #10b981, #059669)',
  'linear-gradient(135deg, #22d3ee, #0891b2)',
  'linear-gradient(135deg, #cba6f7, #a855f7)',
];

function goToBoard() { ui.navigateToKanban(props.project.id); }
function goToAgents() { ui.navigateToEpic(null, props.project.id); }
function goToCode() { ui.openProjectTab(props.project.id); ui.switchToMode('code'); }
function handleRun() {
  if (nextTodoEpic.value) {
    epicStore.moveEpic(nextTodoEpic.value.id, 'in-progress');
  }
}
</script>

<template>
  <div
    class="bg-surface rounded-2xl p-5 overflow-hidden relative cursor-pointer group card-lift anim-fade-in"
    :class="isActive
      ? 'border border-teal/20 anim-shimmer'
      : 'border border-border-subtle hover:border-ember/20'"
    :style="{ animationDelay: props.index * 50 + 'ms' }"
    @click="ui.navigateToProject(props.project.id)"
  >
    <!-- Accent stripe -->
    <div
      class="accent-stripe"
      :style="isActive ? { backgroundColor: accentColorVar } : { backgroundColor: 'var(--text-faint)' }"
    />

    <div class="pl-3">
      <!-- Row 1: Icon + Status -->
      <div class="flex items-center justify-between mb-3">
        <div
          class="w-10 h-10 rounded-xl flex items-center justify-center"
          :style="{ backgroundColor: `color-mix(in srgb, ${accentColorVar} 10%, transparent)` }"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" :stroke="accentColorVar" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="3" /><path d="M9 3v18M3 9h18" />
          </svg>
        </div>
        <div class="flex items-center gap-1.5">
          <template v-if="isActive">
            <span class="w-2 h-2 rounded-full bg-teal anim-breathe" />
            <span class="text-[10px] text-teal font-medium uppercase tracking-wider">active</span>
          </template>
          <template v-else>
            <span class="text-[10px] text-txt-faint font-medium uppercase tracking-wider">idle</span>
          </template>
        </div>
      </div>

      <!-- Row 2: Title -->
      <h3
        class="text-base font-semibold text-txt-primary mb-1 transition-colors"
        :class="accentHoverClass"
      >{{ project.name }}</h3>

      <!-- Row 3: Description -->
      <p v-if="project.description" class="text-xs text-txt-muted mb-4 line-clamp-2">
        {{ project.description }}
      </p>

      <!-- Row 4: Stats -->
      <div class="flex items-center gap-4 text-xs text-txt-muted">
        <span class="flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" />
          </svg>
          {{ repoCount }} repo{{ repoCount !== 1 ? 's' : '' }}
        </span>
        <span class="flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" />
          </svg>
          {{ epicCount }} epic{{ epicCount !== 1 ? 's' : '' }}
        </span>
        <span v-if="activeEpicCount > 0" class="flex items-center gap-1.5 text-teal">
          <span class="w-1.5 h-1.5 rounded-full bg-teal" />
          {{ activeEpicCount }} active
        </span>
      </div>

      <!-- Row 5: Agent activity strip -->
      <div class="mt-4 pt-3 border-t border-white/[0.04] flex items-center gap-2">
        <template v-if="activeAgents.length > 0">
          <div class="flex -space-x-1.5">
            <div
              v-for="(agent, i) in activeAgents.slice(0, 3)"
              :key="agent.sessionId"
              class="w-5 h-5 rounded-md border border-base text-[8px] font-bold text-white flex items-center justify-center"
              :style="{ background: AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length] }"
            >
              {{ agent.title?.charAt(0).toUpperCase() ?? '?' }}
            </div>
          </div>
          <WaveBar :count="3" />
          <span class="text-[10px] text-txt-muted truncate">
            {{ activeAgents[0]?.title ?? 'Agent' }} working…
          </span>
        </template>
        <template v-else>
          <span class="text-[10px] text-txt-faint">No active agents</span>
        </template>
      </div>

      <!-- Row 6: Quick actions (hover) -->
      <div class="mt-3 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity" @click.stop>
        <button class="text-[10px] px-2.5 py-1 rounded-md bg-raised hover:bg-raised-hover text-txt-secondary transition-colors" @click="goToBoard">Board</button>
        <button class="text-[10px] px-2.5 py-1 rounded-md bg-raised hover:bg-raised-hover text-txt-secondary transition-colors" @click="goToAgents">Agents</button>
        <button class="text-[10px] px-2.5 py-1 rounded-md bg-raised hover:bg-raised-hover text-txt-secondary transition-colors" @click="goToCode">Code</button>
        <button class="text-[10px] px-2.5 py-1 rounded-md bg-raised hover:bg-raised-hover text-txt-secondary transition-colors" @click="emit('open-settings')">Settings</button>
        <button
          v-if="nextTodoEpic"
          class="text-[10px] px-2.5 py-1 rounded-md bg-ember/10 hover:bg-ember/20 text-ember transition-colors ml-auto"
          @click="handleRun"
        >Run</button>
      </div>
    </div>
  </div>
</template>
