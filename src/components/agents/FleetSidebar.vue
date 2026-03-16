<template>
  <div class="flex flex-col h-full bg-base border-r border-border-subtle w-72 flex-shrink-0">
    <!-- Fleet header -->
    <div class="px-3 py-2.5 border-b border-border-subtle flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="text-[11px] font-semibold uppercase tracking-wider text-txt-muted">Fleet</span>
        <span class="text-[10px] text-txt-faint">{{ visibleAgentCount }} total</span>
      </div>
      <div class="flex items-center gap-0.5">
        <!-- Search toggle -->
        <button
          class="w-[26px] h-[26px] rounded-full flex items-center justify-center transition-colors"
          :class="searchOpen ? 'bg-ember-500/15 text-ember-400' : 'text-txt-muted hover:bg-raised hover:text-txt-primary'"
          @click="toggleSearch"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5L14 14" />
          </svg>
        </button>
        <!-- Three-dot menu -->
        <div class="relative" ref="menuRoot">
          <button
            class="w-[26px] h-[26px] rounded-full flex items-center justify-center text-txt-muted hover:bg-raised hover:text-txt-primary transition-colors"
            @click="menuOpen = !menuOpen"
          >
            <svg class="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="8" cy="3" r="1.2" />
              <circle cx="8" cy="8" r="1.2" />
              <circle cx="8" cy="13" r="1.2" />
            </svg>
          </button>
          <div
            v-if="menuOpen"
            class="absolute right-0 top-full mt-1 w-52 bg-raised border border-border-standard rounded-lg shadow-lg overflow-hidden z-30"
          >
            <button
              class="w-full text-left px-3 py-2 text-[11px] text-txt-secondary hover:bg-white/[0.05] transition-colors"
              @click="deleteVisible"
            >
              Delete visible chats ({{ visibleAgentCount }})
            </button>
            <button
              class="w-full text-left px-3 py-2 text-[11px] text-txt-secondary hover:bg-white/[0.05] transition-colors"
              @click="deleteOlderThanToday"
            >
              Delete chats older than today
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Search bar (collapsible) -->
    <div v-if="searchOpen" class="px-3 py-2 border-b border-border-subtle">
      <input
        ref="searchInput"
        v-model="searchQuery"
        type="text"
        placeholder="Search agents..."
        class="w-full bg-raised rounded-md px-2.5 py-1.5 text-[11px] text-txt-primary placeholder:text-txt-faint outline-none border border-border-subtle focus:border-border-standard transition-colors"
      />
    </div>

    <!-- Filter tabs -->
    <div class="flex gap-1 px-3 py-2 border-b border-border-subtle">
      <button
        v-for="tab in filterTabs"
        :key="tab.key"
        class="text-[10px] px-2 py-0.5 rounded-full transition-colors"
        :class="activeFilter === tab.key
          ? 'bg-ember-500/15 text-ember-400'
          : 'text-txt-muted hover:text-txt-secondary'"
        @click="activeFilter = tab.key"
      >{{ tab.label }}</button>
    </div>

    <!-- Scrollable agent list -->
    <div class="flex-1 overflow-y-auto py-2">
      <template v-if="filteredGroups.length > 0">
        <div v-for="group in filteredGroups" :key="group.projectId" class="mb-1">
          <!-- Project section header -->
          <button
            class="w-full px-3 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-white/[0.03] transition-colors"
            @click="toggleGroup(group.projectId)"
          >
            <svg
              class="w-2.5 h-2.5 text-txt-muted flex-shrink-0 transition-transform duration-150"
              :class="collapsedGroups.has(group.projectId) ? '' : 'rotate-90'"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <path d="M3 1l4 4-4 4" />
            </svg>
            <span
              class="w-2 h-2 rounded-full flex-shrink-0"
              :style="{ backgroundColor: group.projectColor }"
            />
            <span class="text-[11px] font-medium truncate text-txt-secondary">{{ group.projectName }}</span>
            <span
              v-if="group.runningCount > 0"
              class="text-[9px] px-1.5 rounded-full bg-teal/10 text-teal flex-shrink-0"
            >{{ group.runningCount }}</span>
            <span class="text-[9px] text-txt-faint ml-auto flex-shrink-0">{{ group.agents.length }}</span>
          </button>

          <!-- Agent rows -->
          <div v-if="!collapsedGroups.has(group.projectId)" class="space-y-0.5 px-1">
            <FleetAgentRow
              v-for="agent in group.agents"
              :key="agent.sessionId"
              :agent="agent"
              :selected="fleetStore.selectedAgentId === agent.sessionId"
              class="anim-fade-in"
              @agent-selected="onAgentSelected"
              @delete="onDeleteAgent"
              @rename="onRenameAgent"
              @favorite-toggle="onFavoriteToggle"
              @export-chat="onExportChat"
            />
          </div>
        </div>
      </template>

      <!-- Empty state -->
      <div
        v-else
        class="flex flex-col items-center justify-center h-32 text-center px-6"
      >
        <svg class="w-6 h-6 mb-2 opacity-30 text-txt-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
        </svg>
        <span class="text-[11px] text-txt-muted">
          {{ searchQuery ? 'No matching agents' : activeFilter === 'all' ? 'No agents yet' : 'No matching agents' }}
        </span>
        <span class="text-[10px] text-txt-faint mt-1">
          {{ searchQuery ? 'Try a different search' : activeFilter === 'all' ? 'Press \u2318N or click + to start.' : 'Try a different filter' }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue';
import { useFleetStore } from '../../stores/fleet';
import { useFilterStore } from '../../stores/filter';
import { useEpicStore } from '../../stores/epics';
import { useProjectsStore } from '../../stores/projects';
import { useSessionsStore, getDatabase } from '../../stores/sessions';
import type { HierarchicalAgent } from '../../stores/fleet';
import FleetAgentRow from './FleetAgentRow.vue';

type FilterKey = 'all' | 'epics' | 'standalone';

const emit = defineEmits<{
  'agent-selected': [sessionId: string];
}>();

const fleetStore = useFleetStore();
const filterStore = useFilterStore();
const epicStore = useEpicStore();
const projectsStore = useProjectsStore();
const sessionsStore = useSessionsStore();

const activeFilter = ref<FilterKey>('all');
const collapsedGroups = ref<Set<string>>(new Set());
const searchOpen = ref(false);
const searchQuery = ref('');
const searchInput = ref<HTMLInputElement | null>(null);
const menuOpen = ref(false);
const menuRoot = ref<HTMLElement | null>(null);

const filterTabs: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'epics', label: 'Epics' },
  { key: 'standalone', label: 'Standalone' },
];

// ── Filter logic ─────────────────────────────────────────────────────

function matchesFilter(agent: HierarchicalAgent): boolean {
  switch (activeFilter.value) {
    case 'all': return true;
    case 'epics': return !!agent.epicId || agent.mode === 'orchestrator';
    case 'standalone': return !agent.epicId && agent.mode !== 'orchestrator';
  }
}

function matchesSearch(agent: HierarchicalAgent): boolean {
  if (!searchQuery.value) return true;
  const q = searchQuery.value.toLowerCase();
  return (agent.title || '').toLowerCase().includes(q)
    || (agent.activity || '').toLowerCase().includes(q)
    || agent.sessionId.toLowerCase().includes(q);
}

// ── Search ───────────────────────────────────────────────────────────

function toggleSearch() {
  searchOpen.value = !searchOpen.value;
  if (searchOpen.value) {
    nextTick(() => searchInput.value?.focus());
  } else {
    searchQuery.value = '';
  }
}

// ── Project filter workspace matching ────────────────────────────────

const selectedWorkspaces = computed(() => {
  const selected = filterStore.selectedProjectIds;
  if (selected.length === 0) return null;
  const paths = new Set<string>();
  for (const repo of projectsStore.repos) {
    if (selected.includes(repo.projectId)) paths.add(repo.path);
  }
  for (const group of fleetStore.agentsGroupedByProject) {
    if (!selected.includes(group.projectId)) continue;
    for (const agent of group.agents) {
      const info = sessionsStore.sessions.get(agent.sessionId);
      if (info?.workspace) paths.add(info.workspace);
    }
  }
  return paths;
});

function passesProjectFilter(agent: HierarchicalAgent, groupProjectId: string): boolean {
  const selected = filterStore.selectedProjectIds;
  if (selected.length === 0) return true;
  if (selected.includes(groupProjectId)) return true;
  const ws = selectedWorkspaces.value;
  if (ws) {
    const info = sessionsStore.sessions.get(agent.sessionId);
    if (info?.workspace && ws.has(info.workspace)) return true;
  }
  return false;
}

function resolveOrchestratorProject(agent: HierarchicalAgent): string | null {
  const epic = epicStore.epics.find(e => e.rootSessionId === agent.sessionId);
  return epic?.projectId ?? null;
}

// ── Filtered groups ──────────────────────────────────────────────────

const filteredGroups = computed(() => {
  const groupMap = new Map<string, typeof fleetStore.agentsGroupedByProject[number] & { agents: HierarchicalAgent[] }>();

  for (const group of fleetStore.agentsGroupedByProject) {
    for (const agent of group.agents) {
      if (agent.parentSessionId) continue;
      if (!matchesFilter(agent)) continue;
      if (!matchesSearch(agent)) continue;

      let targetGroup = group;
      if (group.projectId === '__unattached__') {
        const projectId = resolveOrchestratorProject(agent);
        if (projectId) {
          const realGroup = fleetStore.agentsGroupedByProject.find(g => g.projectId === projectId);
          if (realGroup) targetGroup = realGroup;
        }
      }

      if (!passesProjectFilter(agent, targetGroup.projectId)) continue;

      let bucket = groupMap.get(targetGroup.projectId);
      if (!bucket) {
        bucket = { ...targetGroup, agents: [] };
        groupMap.set(targetGroup.projectId, bucket);
      }
      bucket.agents.push(agent);
    }
  }

  return [...groupMap.values()]
    .map(g => ({ ...g, runningCount: g.agents.filter(a => a.status === 'working').length }))
    .filter(g => g.agents.length > 0)
    .sort((a, b) => {
      if (a.projectId === '__unattached__') return 1;
      if (b.projectId === '__unattached__') return -1;
      return a.projectName.localeCompare(b.projectName);
    });
});

const visibleAgentCount = computed(() =>
  filteredGroups.value.reduce((sum, g) => sum + g.agents.length, 0),
);

// ── Group toggle ─────────────────────────────────────────────────────

function toggleGroup(projectId: string) {
  if (collapsedGroups.value.has(projectId)) {
    collapsedGroups.value.delete(projectId);
  } else {
    collapsedGroups.value.add(projectId);
  }
}

// ── Agent actions ────────────────────────────────────────────────────

function onAgentSelected(sessionId: string) {
  fleetStore.selectAgent(sessionId);
  emit('agent-selected', sessionId);
}

function onDeleteAgent(sessionId: string) {
  sessionsStore.removeSession(sessionId);
  fleetStore.rebuildFromSessions();
}

function onRenameAgent(sessionId: string, newTitle: string) {
  sessionsStore.updateSessionTitle(sessionId, newTitle);
  fleetStore.rebuildFromSessions();
}

function onFavoriteToggle(sessionId: string) {
  sessionsStore.toggleFavorite(sessionId);
  fleetStore.rebuildFromSessions();
}

async function onExportChat(sessionId: string) {
  const db = getDatabase();
  const sessionInfo = sessionsStore.sessions.get(sessionId);
  if (!sessionInfo) return;

  // Collect all session IDs: root + all descendants (recursive)
  const allSessionIds = [sessionId];
  function collectChildren(parentId: string) {
    for (const agent of fleetStore.hierarchicalAgents) {
      if (agent.parentSessionId === parentId) {
        allSessionIds.push(agent.sessionId);
        collectChildren(agent.sessionId);
      }
    }
  }
  collectChildren(sessionId);

  // Load messages for all sessions from DB in parallel
  const sessions = await Promise.all(
    allSessionIds.map(async (sid) => {
      const info = sessionsStore.sessions.get(sid);
      const msgs = await db.loadMessages(sid);
      return {
        sessionId: sid,
        title: info?.title ?? '',
        mode: info?.mode ?? '',
        parentSessionId: info?.parentSessionId ?? null,
        messages: msgs.map(m => ({
          role: m.role,
          content: m.content,
          turnId: m.turnId,
          toolName: m.toolName || undefined,
          toolInput: m.toolInput || undefined,
          toolId: m.toolId || undefined,
          timestamp: m.timestamp,
        })),
      };
    }),
  );

  const exportData = {
    exportedAt: new Date().toISOString(),
    rootSessionId: sessionId,
    sessions,
  };

  const { save } = await import('@tauri-apps/plugin-dialog');
  const { writeTextFile } = await import('@tauri-apps/plugin-fs');

  const safeName = (sessionInfo.title || 'chat').replace(/[^a-z0-9_-]/gi, '_').substring(0, 40);
  const path = await save({
    defaultPath: `${safeName}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });

  if (path) {
    await writeTextFile(path, JSON.stringify(exportData, null, 2));
  }
}

// ── Bulk actions (three-dot menu) ────────────────────────────────────

function deleteVisible() {
  menuOpen.value = false;
  const ids = filteredGroups.value.flatMap(g => g.agents.map(a => a.sessionId));
  for (const sid of ids) {
    sessionsStore.removeSession(sid);
  }
  fleetStore.rebuildFromSessions();
}

function deleteOlderThanToday() {
  menuOpen.value = false;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayTs = Math.floor(todayStart.getTime() / 1000);

  const ids = filteredGroups.value
    .flatMap(g => g.agents)
    .filter(a => a.updatedAt < todayTs)
    .map(a => a.sessionId);
  for (const sid of ids) {
    sessionsStore.removeSession(sid);
  }
  fleetStore.rebuildFromSessions();
}

// ── Click outside ────────────────────────────────────────────────────

function onClickOutside(e: MouseEvent) {
  if (menuRoot.value && !menuRoot.value.contains(e.target as Node)) {
    menuOpen.value = false;
  }
}

onMounted(() => document.addEventListener('click', onClickOutside));
onUnmounted(() => document.removeEventListener('click', onClickOutside));
</script>
