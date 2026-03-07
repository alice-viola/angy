<template>
  <div class="flex flex-col h-full bg-[var(--bg-surface)]">
    <FleetHeader
      :view-mode="ui.viewMode"
      @new-agent="$emit('new-agent-requested')"
      @delete-all="$emit('delete-all-requested')"
      @delete-older="$emit('delete-older-requested')"
      @keep-today="$emit('keep-today-requested')"
      @toggle-view="$emit('toggle-view')"
      @orchestrate="$emit('orchestrate')"
      @enter-mission-control="$emit('enter-mission-control')"
    />

    <!-- Agent list -->
    <div class="flex-1 overflow-y-auto py-1 px-1.5">
      <template v-for="agent in visibleAgents" :key="agent.sessionId">
        <!-- Date divider -->
        <div
          v-if="agent._dateGroup && agent._dateGroup !== agent._prevDateGroup"
          class="text-[11px] font-semibold tracking-wide text-[var(--text-muted)] px-3 pt-3 pb-1"
          :class="{ 'border-t border-[var(--border-subtle)]': agent._prevDateGroup !== '' }"
        >
          {{ agent._dateGroup }}
        </div>

        <AgentCard
          :agent="agent"
          :selected="agent.sessionId === fleetStore.selectedAgentId"
          :collapsed="panelCollapsed"
          :children-collapsed="fleetStore.isCollapsed(agent.sessionId)"
          :unviewed="fleetStore.isUnviewed(agent.sessionId)"
          @select="onAgentSelect"
          @delete="sid => $emit('delete-requested', sid)"
          @rename="(sid, title) => $emit('rename-requested', sid, title)"
          @favorite-toggle="sid => $emit('favorite-toggled', sid)"
          @collapse-toggle="onCollapseToggle"
          @transform-to-epic="onTransformToEpic"
        />
      </template>

      <!-- Empty state -->
      <div v-if="visibleAgents.length === 0" class="flex items-center justify-center h-full">
        <span class="text-xs text-[var(--text-faint)]">No agents yet</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import AgentCard from './AgentCard.vue';
import FleetHeader from './FleetHeader.vue';
import { useFleetStore } from '../../stores/fleet';
import { useUiStore } from '../../stores/ui';
import { transformChatToEpic } from '../../composables/useEpicFromChat';
import type { AgentStatus } from '../../engine/types';

// ── Props / Emits ────────────────────────────────────────────────────────

defineProps<{
  panelCollapsed?: boolean;
}>();

const emit = defineEmits<{
  'agent-selected': [sessionId: string];
  'new-agent-requested': [];
  'delete-requested': [sessionId: string];
  'delete-all-requested': [];
  'delete-older-requested': [];
  'keep-today-requested': [];
  'rename-requested': [sessionId: string, newTitle: string];
  'favorite-toggled': [sessionId: string];
  'toggle-view': [];
  'orchestrate': [];
  'enter-mission-control': [];
}>();

// ── Store ────────────────────────────────────────────────────────────────

const fleetStore = useFleetStore();
const ui = useUiStore();

// ── Computed ─────────────────────────────────────────────────────────────

interface VisibleAgent {
  sessionId: string;
  title: string;
  status: AgentStatus;
  activity: string;
  editCount: number;
  costUsd: number;
  mode: string;
  favorite: boolean;
  updatedAt: number;
  parentSessionId?: string;
  epicId?: string;
  depth: number;
  isOrchestratorRoot: boolean;
  childCount: number;
  _dateGroup: string;
  _prevDateGroup: string;
}

const visibleAgents = computed(() => {
  const agents = fleetStore.hierarchicalAgents;
  const result: VisibleAgent[] = [];
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  let prevDateGroup = '';
  const hiddenRoots = fleetStore.collapsedRoots;

  for (const agent of agents) {
    // Hide children of collapsed roots
    if (agent.parentSessionId && isHiddenByCollapse(agent.sessionId, agent.parentSessionId, agents, hiddenRoots)) {
      continue;
    }

    // Calculate date group
    let dateGroup = '';
    if (agent.updatedAt > 0) {
      const date = new Date(agent.updatedAt * 1000);
      if (date.toDateString() === today.toDateString()) {
        dateGroup = 'Today';
      } else if (date.toDateString() === yesterday.toDateString()) {
        dateGroup = 'Yesterday';
      } else {
        dateGroup = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
      }
    }

    result.push({
      ...agent,
      _dateGroup: dateGroup,
      _prevDateGroup: prevDateGroup,
    });

    if (dateGroup) prevDateGroup = dateGroup;
  }

  return result;
});

// ── Helpers ──────────────────────────────────────────────────────────────

function isHiddenByCollapse(
  _sessionId: string,
  parentId: string | undefined,
  agents: Array<{ sessionId: string; parentSessionId?: string }>,
  hiddenRoots: Set<string>,
): boolean {
  let current = parentId;
  while (current) {
    if (hiddenRoots.has(current)) return true;
    const parent = agents.find((a) => a.sessionId === current);
    current = parent?.parentSessionId;
  }
  return false;
}

// ── Event handlers ───────────────────────────────────────────────────────

function onAgentSelect(sessionId: string) {
  fleetStore.selectAgent(sessionId);
  emit('agent-selected', sessionId);
}

function onCollapseToggle(rootId: string) {
  fleetStore.toggleCollapsed(rootId);
}

async function onTransformToEpic(sessionId: string) {
  const projectId = ui.activeProjectId;
  if (!projectId) {
    ui.addNotification('warning', 'No project selected', 'Open a project in Kanban view first, then transform a chat into an epic.');
    return;
  }

  ui.addNotification('info', 'Analyzing conversation...', 'Claude is extracting an epic from this chat.');

  try {
    await transformChatToEpic(sessionId, projectId);
    ui.addNotification('success', 'Epic created', 'Your new epic is in the Ideas column in Kanban.');
    ui.navigateToKanban(projectId);
  } catch (e) {
    ui.addNotification('error', 'Epic creation failed', String(e));
  }
}
</script>
