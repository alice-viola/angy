import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { AgentSummary } from '../engine/types';
import { useSessionsStore } from './sessions';

// ── Fleet Store ─────────────────────────────────────────────────────────

export const useFleetStore = defineStore('fleet', () => {
  // ── State ──────────────────────────────────────────────────────────
  const agents = ref<AgentSummary[]>([]);
  const selectedAgentId = ref<string | null>(null);
  const collapsedRoots = ref<Set<string>>(new Set());
  const manuallyExpandedRoots = ref<Set<string>>(new Set());
  const unviewedSessions = ref<Set<string>>(new Set());

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

  return {
    // State
    agents,
    selectedAgentId,
    collapsedRoots,
    unviewedSessions,
    // Getters
    hierarchicalAgents,
    rootAgents,
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

interface HierarchicalAgent extends AgentSummary {
  depth: number;
  isOrchestratorRoot: boolean;
  childCount: number;
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

  function visit(id: string, depth: number) {
    const agent = byId.get(id);
    if (!agent) return;

    const children = childrenMap.get(id) ?? [];
    const isOrchestratorRoot = depth === 0 && children.length > 0;

    result.push({
      ...agent,
      depth,
      isOrchestratorRoot,
      childCount: children.length,
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
