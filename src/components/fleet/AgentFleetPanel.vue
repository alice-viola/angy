<template>
  <div class="flex flex-col h-full bg-[var(--bg-surface)]">
    <FleetHeader
      @new-agent="$emit('new-agent-requested')"
      @delete-all="$emit('delete-all-requested')"
      @delete-older="$emit('delete-older-requested')"
      @keep-today="$emit('keep-today-requested')"
    />

    <!-- Project filter row -->
    <div v-if="projectsStore.projects.length > 1" class="flex items-center gap-2 px-2 py-1.5 border-b border-[var(--border-subtle)]">
      <div class="relative flex-1" ref="fleetDropdownRef">
        <button
          class="w-full flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border transition-colors"
          :class="fleetAllSelected
            ? 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-standard)]'
            : 'border-[var(--accent-teal)] text-[var(--accent-teal)] bg-[color-mix(in_srgb,var(--accent-teal)_10%,transparent)]'"
          @click="fleetDropdownOpen = !fleetDropdownOpen"
        >
          <span class="flex items-center gap-0.5">
            <span
              v-for="p in fleetSelectedDots"
              :key="p.id"
              class="w-1.5 h-1.5 rounded-full shrink-0"
              :style="{ background: p.color || '#94e2d5' }"
            />
          </span>
          <span class="flex-1 text-left">{{ fleetDropdownLabel }}</span>
          <svg class="w-3 h-3 shrink-0 transition-transform" :class="fleetDropdownOpen && 'rotate-180'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <div
          v-if="fleetDropdownOpen"
          class="absolute left-0 top-full mt-1 z-50 w-full min-w-[180px] rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-lg)] py-1"
        >
          <!-- All option -->
          <button
            class="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)] transition-colors"
            :class="fleetAllSelected ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'"
            @click="showAllFleetProjects"
          >
            <span
              class="w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0"
              :class="fleetAllSelected
                ? 'bg-[var(--accent-teal)] border-[var(--accent-teal)]'
                : 'border-[var(--border-standard)]'"
            >
              <svg v-if="fleetAllSelected" class="w-2 h-2 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </span>
            All projects
          </button>

          <div class="my-1 h-px bg-[var(--border-subtle)]" />

          <button
            v-for="project in projectsStore.projects"
            :key="project.id"
            class="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)] transition-colors"
            :class="isFleetProjectSelected(project.id) ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'"
            @click="ui.toggleFleetProject(project.id)"
          >
            <span
              class="w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0"
              :style="isFleetProjectSelected(project.id)
                ? { background: project.color || '#94e2d5', borderColor: project.color || '#94e2d5' }
                : {}"
              :class="!isFleetProjectSelected(project.id) && 'border-[var(--border-standard)]'"
            >
              <svg v-if="isFleetProjectSelected(project.id)" class="w-2 h-2 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </span>
            <span class="w-2 h-2 rounded-full shrink-0" :style="{ background: project.color || '#94e2d5' }" />
            <span class="truncate">{{ project.name }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Agent list -->
    <div class="flex-1 overflow-y-auto py-1 px-1.5">
      <SectionTip tipId="fleet-intro" title="Agent Fleet">
        Each row is an AI agent conversation. Click + to start a new agent, or use <strong>Orchestrate</strong> mode to spawn a coordinated team. Agents spawned by an orchestrator appear as nested children.
      </SectionTip>

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
        <span class="text-xs text-[var(--text-faint)]">No agents yet. Press ⌘N or click + to start your first AI agent conversation.</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import AgentCard from './AgentCard.vue';
import FleetHeader from './FleetHeader.vue';
import SectionTip from '../common/SectionTip.vue';
import { useFleetStore } from '../../stores/fleet';
import { useUiStore } from '../../stores/ui';
import { useProjectsStore } from '../../stores/projects';
import { useEpicStore } from '../../stores/epics';
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
}>();

// ── Store ────────────────────────────────────────────────────────────────

const fleetStore = useFleetStore();
const ui = useUiStore();
const projectsStore = useProjectsStore();
const epicStore = useEpicStore();

// ── Fleet project dropdown ───────────────────────────────────────────────

const fleetDropdownRef = ref<HTMLElement | null>(null);
const fleetDropdownOpen = ref(false);

const fleetAllSelected = computed(() => ui.fleetProjectIds.length === 0);

const fleetDropdownLabel = computed(() => {
  if (fleetAllSelected.value) return 'All projects';
  if (ui.fleetProjectIds.length === 1) {
    const p = projectsStore.projects.find(p => p.id === ui.fleetProjectIds[0]);
    return p?.name ?? '1 project';
  }
  return `${ui.fleetProjectIds.length} projects`;
});

const fleetSelectedDots = computed(() =>
  fleetAllSelected.value
    ? projectsStore.projects.slice(0, 3)
    : projectsStore.projects.filter(p => ui.fleetProjectIds.includes(p.id)).slice(0, 3)
);

function isFleetProjectSelected(projectId: string): boolean {
  // When fleetProjectIds is empty = "all", treat each as selected
  return ui.fleetProjectIds.length === 0 || ui.fleetProjectIds.includes(projectId);
}

function showAllFleetProjects() {
  ui.fleetProjectIds = [];
}

function onClickOutside(e: MouseEvent) {
  if (fleetDropdownRef.value && !fleetDropdownRef.value.contains(e.target as Node)) {
    fleetDropdownOpen.value = false;
  }
}

onMounted(() => document.addEventListener('mousedown', onClickOutside));
onUnmounted(() => document.removeEventListener('mousedown', onClickOutside));

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

  // Build a set of allowed session IDs based on project filter
  const filterActive = ui.fleetProjectIds.length > 0;
  let allowedSessionIds: Set<string> | null = null;
  if (filterActive) {
    allowedSessionIds = new Set<string>();
    for (const agent of agents) {
      const projectId = resolveAgentProjectId(agent.sessionId, agent.epicId);
      if (projectId && ui.fleetProjectIds.includes(projectId)) {
        allowedSessionIds.add(agent.sessionId);
      }
    }
    // Also include children of allowed sessions so hierarchies stay intact
    for (const agent of agents) {
      if (agent.parentSessionId && allowedSessionIds.has(agent.parentSessionId)) {
        allowedSessionIds.add(agent.sessionId);
      }
    }
  }

  for (const agent of agents) {
    // Filter by project
    if (allowedSessionIds && !allowedSessionIds.has(agent.sessionId)) continue;

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

function resolveAgentProjectId(_sessionId: string, epicId?: string): string | null {
  if (epicId) {
    const epic = epicStore.epicById(epicId);
    if (epic) return epic.projectId;
  }
  // No epic link — can't determine project
  return null;
}

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
  const projectId = ui.activeProjectId ?? (projectsStore.projects.length === 1 ? projectsStore.projects[0].id : null);
  if (!projectId) {
    ui.addNotification('warning', 'No project selected', 'Select a project first, then transform a chat into an epic.');
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
