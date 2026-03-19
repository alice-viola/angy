import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { AgentSummary } from '../engine/types';
import { useSessionsStore } from './sessions';
import { useEpicStore } from './epics';
import { useProjectsStore } from './projects';

// ── Constants ───────────────────────────────────────────────────────────

export const PROJECT_COLORS = ['#f59e0b', '#10b981', '#22d3ee', '#cba6f7', '#f38ba8', '#a6e3a1', '#f9e2af', '#FF6B8A'];

// ── Fleet Store ─────────────────────────────────────────────────────────

export const useFleetStore = defineStore('fleet', () => {
  // ── State ──────────────────────────────────────────────────────────
  const agents = ref<AgentSummary[]>([]);
  const selectedAgentId = ref<string | null>(null);
  const collapsedRoots = ref<Set<string>>(new Set());
  const manuallyExpandedRoots = ref<Set<string>>(new Set());
  const unviewedSessions = ref<Set<string>>(new Set());
  const effectsExpanded = ref(true);

  // ── Getters ────────────────────────────────────────────────────────

  /** Agents sorted with parent/child nesting, depth calculated */
  const hierarchicalAgents = computed(() => {
    return buildHierarchicalOrder(agents.value);
  });

  /** Root agents (no parent) */
  const rootAgents = computed(() => {
    return agents.value.filter((a) => !a.parentSessionId);
  });

  /** Children of a specific parent */
  function childrenOf(parentId: string): AgentSummary[] {
    return agents.value.filter((a) => a.parentSessionId === parentId);
  }

  /** Agents belonging to a specific project (resolved via epicId → Epic.projectId) */
  const agentsByProject = computed(() => {
    return (projectId: string): AgentSummary[] => {
      const epicStore = useEpicStore();
      return agents.value.filter((a) => {
        if (!a.epicId) return false;
        const epic = epicStore.epicById(a.epicId);
        return epic?.projectId === projectId;
      });
    };
  });

  /** Active (non-idle) agents belonging to a specific project */
  const activeAgentsByProject = computed(() => {
    return (projectId: string): AgentSummary[] => {
      const epicStore = useEpicStore();
      return agents.value.filter((a) => {
        if (!a.epicId) return false;
        const epic = epicStore.epicById(a.epicId);
        return epic?.projectId === projectId && a.status !== 'idle';
      });
    };
  });

  // ── Actions ────────────────────────────────────────────────────────

  /** Rebuild agent list from sessions store */
  function rebuildFromSessions() {
    const sessionsStore = useSessionsStore();
    const newAgents: AgentSummary[] = [];

    for (const info of sessionsStore.sessions.values()) {
      // Find existing agent to preserve runtime fields (editCount, costUsd, etc.)
      const existing = agents.value.find((a) => a.sessionId === info.sessionId);

      newAgents.push({
        sessionId: info.sessionId,
        title: info.title,
        status: existing?.status ?? 'idle',
        activity: existing?.activity ?? '',
        editCount: existing?.editCount ?? 0,
        costUsd: existing?.costUsd ?? 0,
        mode: info.mode,
        favorite: info.favorite,
        updatedAt: info.updatedAt,
        workspace: info.workspace,
        parentSessionId: info.parentSessionId,
        epicId: info.epicId,
      });
    }

    // Sort by updatedAt descending
    newAgents.sort((a, b) => b.updatedAt - a.updatedAt);
    agents.value = newAgents;

    // Auto-collapse new orchestrator roots (multi-agent groups) by default
    for (const agent of newAgents) {
      if (!agent.parentSessionId && newAgents.some((b) => b.parentSessionId === agent.sessionId)) {
        if (!manuallyExpandedRoots.value.has(agent.sessionId)) {
          collapsedRoots.value.add(agent.sessionId);
        }
      }
    }
  }

  /** Update a single agent's fields (partial update) */
  function updateAgent(summary: Partial<AgentSummary> & { sessionId: string }) {
    const idx = agents.value.findIndex((a) => a.sessionId === summary.sessionId);
    if (idx !== -1) {
      agents.value[idx] = { ...agents.value[idx], ...summary };
    }
  }

  /** Select an agent (syncs with sessions store) */
  function selectAgent(sessionId: string) {
    selectedAgentId.value = sessionId;
    const sessionsStore = useSessionsStore();
    sessionsStore.selectSession(sessionId);
  }

  /** Toggle collapsed state for an orchestrator root */
  function toggleCollapsed(rootId: string) {
    if (collapsedRoots.value.has(rootId)) {
      collapsedRoots.value.delete(rootId);
      manuallyExpandedRoots.value.add(rootId);
    } else {
      collapsedRoots.value.add(rootId);
      manuallyExpandedRoots.value.delete(rootId);
      // If selected agent is a descendant of this root, select the root instead
      if (selectedAgentId.value && isDescendantOf(selectedAgentId.value, rootId)) {
        selectAgent(rootId);
      }
    }
  }

  function isCollapsed(rootId: string): boolean {
    return collapsedRoots.value.has(rootId);
  }

  // ── Unviewed session tracking ─────────────────────────────────────

  function markUnviewed(sessionId: string) {
    unviewedSessions.value.add(sessionId);
  }

  function markViewed(sessionId: string) {
    unviewedSessions.value.delete(sessionId);
  }

  function isUnviewed(sessionId: string): boolean {
    return unviewedSessions.value.has(sessionId);
  }

  // ── Hierarchy helpers ──────────────────────────────────────────────

  function isDescendantOf(sessionId: string, ancestorId: string): boolean {
    const agentMap = new Map(agents.value.map((a) => [a.sessionId, a]));
    let current = sessionId;
    while (true) {
      const agent = agentMap.get(current);
      if (!agent?.parentSessionId) return false;
      if (agent.parentSessionId === ancestorId) return true;
      current = agent.parentSessionId;
    }
  }

  // ── Ticker getters ───────────────────────────────────────────────

  const recentActivities = computed(() =>
    agents.value
      .filter(a => a.activity !== '')
      .map(a => ({ name: a.title, status: a.status, activity: a.activity }))
  );

  const activeCount = computed(() =>
    agents.value.filter(a => a.status === 'working').length
  );

  // ── Project-grouped agents ────────────────────────────────────────

  /** Agents grouped by project, with '__unattached__' for sessions not linked to any project */
  const agentsGroupedByProject = computed(() => {
    const epicStore = useEpicStore();
    const projectsStore = useProjectsStore();
    const sessionsStore = useSessionsStore();

    const groupMap = new Map<string, {
      projectId: string;
      projectName: string;
      projectColor: string;
      agents: HierarchicalAgent[];
    }>();

    function projectMeta(project: { id: string; name: string }) {
      const idx = projectsStore.projects.findIndex((p) => p.id === project.id);
      return { id: project.id, name: project.name, color: PROJECT_COLORS[idx % PROJECT_COLORS.length] };
    }

    // Pass 1: resolve agents that have an epicId (guaranteed project link)
    // and collect workspace → project mappings from those resolved agents.
    const workspaceToProject = new Map<string, { id: string; name: string; color: string }>();
    const unresolvedAgents: HierarchicalAgent[] = [];

    for (const agent of hierarchicalAgents.value) {
      let resolved: { id: string; name: string; color: string } | null = null;

      if (agent.epicId) {
        const epic = epicStore.epicById(agent.epicId);
        if (epic?.projectId) {
          const project = projectsStore.projectById(epic.projectId);
          if (project) resolved = projectMeta(project);
        }
      }

      if (resolved) {
        // Learn the workspace → project mapping from this resolved agent
        const info = sessionsStore.sessions.get(agent.sessionId);
        if (info?.workspace && !workspaceToProject.has(info.workspace)) {
          workspaceToProject.set(info.workspace, resolved);
        }

        let group = groupMap.get(resolved.id);
        if (!group) {
          group = { projectId: resolved.id, projectName: resolved.name, projectColor: resolved.color, agents: [] };
          groupMap.set(resolved.id, group);
        }
        group.agents.push(agent);
      } else {
        unresolvedAgents.push(agent);
      }
    }

    // Also seed from ProjectRepo paths
    for (const repo of projectsStore.repos) {
      if (!workspaceToProject.has(repo.path)) {
        const project = projectsStore.projectById(repo.projectId);
        if (project) workspaceToProject.set(repo.path, projectMeta(project));
      }
    }

    // Pass 2: resolve remaining agents via workspace matching
    for (const agent of unresolvedAgents) {
      let resolved: { id: string; name: string; color: string } | null = null;

      const info = sessionsStore.sessions.get(agent.sessionId);
      if (info?.workspace) {
        // Exact match first, then prefix match
        resolved = workspaceToProject.get(info.workspace) ?? null;
        if (!resolved) {
          for (const [repoPath, proj] of workspaceToProject) {
            if (info.workspace.startsWith(repoPath + '/') || repoPath.startsWith(info.workspace + '/')) {
              resolved = proj;
              break;
            }
          }
        }
      }

      const projectId = resolved?.id ?? '__unattached__';
      const projectName = resolved?.name ?? 'Standalone';
      const projectColor = resolved?.color ?? '#64748b';

      let group = groupMap.get(projectId);
      if (!group) {
        group = { projectId, projectName, projectColor, agents: [] };
        groupMap.set(projectId, group);
      }
      group.agents.push(agent);
    }

    const groups = [...groupMap.values()].map((g) => ({
      ...g,
      runningCount: g.agents.filter((a) => a.status === 'working').length,
      totalCost: g.agents.reduce((sum, a) => sum + (a.costUsd ?? 0), 0),
    }));

    groups.sort((a, b) => {
      if (a.projectId === '__unattached__') return 1;
      if (b.projectId === '__unattached__') return -1;
      return a.projectName.localeCompare(b.projectName);
    });

    return groups;
  });

  return {
    // State
    agents,
    selectedAgentId,
    collapsedRoots,
    unviewedSessions,
    effectsExpanded,
    // Getters
    hierarchicalAgents,
    rootAgents,
    agentsByProject,
    activeAgentsByProject,
    agentsGroupedByProject,
    recentActivities,
    activeCount,
    // Actions
    childrenOf,
    rebuildFromSessions,
    updateAgent,
    selectAgent,
    toggleCollapsed,
    isCollapsed,
    isDescendantOf,
    markUnviewed,
    markViewed,
    isUnviewed,
  };
});

// ── Build hierarchical ordering ─────────────────────────────────────────

export interface HierarchicalAgent extends AgentSummary {
  depth: number;
  isOrchestratorRoot: boolean;
  childCount: number;
  isSubOrchestrator: boolean;
  orchestratorDepth: number;
}

function buildHierarchicalOrder(flat: AgentSummary[]): HierarchicalAgent[] {
  const byId = new Map<string, AgentSummary>();
  const childrenMap = new Map<string, string[]>();
  const roots: string[] = [];

  for (const a of flat) {
    byId.set(a.sessionId, a);
    if (!a.parentSessionId) {
      roots.push(a.sessionId);
    } else {
      const list = childrenMap.get(a.parentSessionId) ?? [];
      list.push(a.sessionId);
      childrenMap.set(a.parentSessionId, list);
    }
  }

  // Promote orphans (children whose parent was deleted) to roots
  for (const [parentId, children] of childrenMap) {
    if (!byId.has(parentId)) {
      for (const orphanId of children) {
        roots.push(orphanId);
      }
    }
  }

  const result: HierarchicalAgent[] = [];

  /** Count how many ancestors in the parent chain have mode === 'orchestrator'. */
  function computeOrchestratorDepth(id: string): number {
    let orchDepth = 0;
    let current = byId.get(id)?.parentSessionId;
    while (current) {
      const parent = byId.get(current);
      if (!parent) break;
      if (parent.mode === 'orchestrator') orchDepth++;
      current = parent.parentSessionId;
    }
    return orchDepth;
  }

  function visit(id: string, depth: number) {
    const agent = byId.get(id);
    if (!agent) return;

    const children = childrenMap.get(id) ?? [];
    const isOrchestratorRoot = depth === 0 && children.length > 0;
    const isSubOrchestrator = agent.mode === 'orchestrator' && !!agent.parentSessionId;

    result.push({
      ...agent,
      depth,
      isOrchestratorRoot,
      childCount: children.length,
      isSubOrchestrator,
      orchestratorDepth: isSubOrchestrator ? computeOrchestratorDepth(id) : 0,
    });

    // Sort children by updatedAt ascending (oldest first = stable order)
    const sortedChildren = [...children].sort((a, b) => {
      const aAgent = byId.get(a);
      const bAgent = byId.get(b);
      return (aAgent?.updatedAt ?? 0) - (bAgent?.updatedAt ?? 0);
    });

    for (const childId of sortedChildren) {
      visit(childId, depth + 1);
    }
  }

  for (const rootId of roots) {
    visit(rootId, 0);
  }

  return result;
}
