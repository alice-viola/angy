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

const accentStyles = computed(() => {
  const colorVar = `var(--accent-${accent.value})`;
  return {
    iconBg: { backgroundColor: `color-mix(in srgb, ${colorVar} 10%, transparent)` },
    stripe: { backgroundColor: colorVar },
  };
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
function goToAgents() { ui.activeProjectId = props.project.id; ui.switchToMode('agents'); }
function goToCode() { ui.activeProjectId = props.project.id; ui.switchToMode('code'); }
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
      ? 'border border-teal/20 anim-shimmer card-glow-active'
      : 'border border-border-subtle hover:border-ember/20'"
    :style="{ animationDelay: props.index * 50 + 'ms' }"
    @click="ui.navigateToProject(props.project.id)"
  >
    <!-- Accent stripe -->
    <div
      class="accent-stripe"
      :style="isActive ? accentStyles.stripe : { backgroundColor: 'var(--text-faint)' }"
    />

    <!-- Row 1: Icon + Status -->
    <div class="flex items-center justify-between mb-3">
      <div class="w-10 h-10 rounded-xl flex items-center justify-center" :style="accentStyles.iconBg">
        <svg class="w-5 h-5 text-txt-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      </div>
      <div class="flex items-center gap-1.5">
        <template v-if="isActive">
          <span class="w-2 h-2 rounded-full bg-teal anim-breathe" />
          <span class="text-[10px] text-teal font-medium uppercase tracking-wider">Active</span>
        </template>
        <template v-else>
          <span class="text-[10px] text-txt-faint font-medium uppercase tracking-wider">Idle</span>
        </template>
        <button
          class="ml-1 w-6 h-6 rounded flex items-center justify-center text-txt-faint hover:text-txt-secondary transition-colors opacity-0 group-hover:opacity-100"
          title="Settings"
          @click.stop="emit('open-settings')"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Row 2: Title -->
    <h3 class="text-sm font-semibold text-txt-primary mb-1">{{ project.name }}</h3>

    <!-- Row 3: Description -->
    <p v-if="project.description" class="text-[11px] text-txt-muted line-clamp-2 leading-relaxed mb-3">
      {{ project.description }}
    </p>

    <!-- Row 4: Stats -->
    <div class="flex items-center gap-3">
      <div class="flex items-center gap-1 text-[10px] text-txt-muted">
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        <span>{{ repoCount }}</span>
      </div>
      <div class="flex items-center gap-1 text-[10px] text-txt-muted">
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        <span>{{ epicCount }}</span>
      </div>
      <div v-if="activeEpicCount > 0" class="text-[10px] text-teal">
        {{ activeEpicCount }} active
      </div>
    </div>

    <!-- Row 5: Agent activity strip -->
    <div class="border-t border-white/[0.04] mt-4 pt-3">
      <template v-if="activeAgents.length > 0">
        <div class="flex items-center gap-2">
          <div class="flex -space-x-1.5">
            <div
              v-for="(agent, i) in activeAgents.slice(0, 3)"
              :key="agent.sessionId"
              class="w-5 h-5 rounded-md text-[8px] font-bold text-white flex items-center justify-center"
              :style="{ background: AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length] }"
            >
              {{ agent.title?.charAt(0).toUpperCase() ?? '?' }}
            </div>
          </div>
          <div class="flex items-end gap-0.5 h-4">
            <div class="wave-bar" />
            <div class="wave-bar" />
            <div class="wave-bar" />
          </div>
          <span class="text-[10px] text-txt-muted truncate">
            {{ activeAgents.length }} agent{{ activeAgents.length > 1 ? 's' : '' }} working
          </span>
        </div>
      </template>
      <template v-else>
        <span class="text-[10px] text-txt-faint">No active agents</span>
      </template>
    </div>

    <!-- Row 6: Quick actions (hover) -->
    <div class="flex items-center gap-1.5 mt-3 opacity-0 group-hover:opacity-100 transition-opacity" @click.stop>
      <button class="text-[10px] px-2.5 py-1 rounded-md bg-raised hover:bg-raised-hover text-txt-secondary transition-colors" @click="goToBoard">Board</button>
      <button class="text-[10px] px-2.5 py-1 rounded-md bg-raised hover:bg-raised-hover text-txt-secondary transition-colors" @click="goToAgents">Agents</button>
      <button class="text-[10px] px-2.5 py-1 rounded-md bg-raised hover:bg-raised-hover text-txt-secondary transition-colors" @click="goToCode">Code</button>
      <button
        v-if="nextTodoEpic"
        class="text-[10px] px-2.5 py-1 rounded-md bg-ember/10 hover:bg-ember/20 text-ember transition-colors"
        @click="handleRun"
      >Run</button>
    </div>
  </div>
</template>
