import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Epic, EpicColumn, PriorityHint } from '@/engine/KosTypes';
import { getDatabase } from './sessions';

// ── Priority weight map for sorting ──────────────────────────────────────

const priorityWeight: Record<PriorityHint, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
};

// ── Helpers ──────────────────────────────────────────────────────────────

function generateId(): string {
  return `epic-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowISO(): string {
  return new Date().toISOString();
}

// ── Epic Store ───────────────────────────────────────────────────────────

export const useEpicStore = defineStore('epics', () => {
  // ── State ──────────────────────────────────────────────────────────
  const epics = ref<Epic[]>([]);
  const loading = ref<boolean>(false);

  // ── Getters ────────────────────────────────────────────────────────

  const epicById = computed(() => {
    return (id: string): Epic | undefined =>
      epics.value.find((e) => e.id === id);
  });

  const epicsByProject = computed(() => {
    return (projectId: string): Epic[] =>
      epics.value.filter((e) => e.projectId === projectId);
  });

  const epicsByColumn = computed(() => {
    return (projectIds: string | string[], column: EpicColumn): Epic[] => {
      const ids = Array.isArray(projectIds) ? projectIds : [projectIds];
      return epics.value
        .filter((e) => ids.includes(e.projectId) && e.column === column)
        .sort((a, b) => priorityWeight[b.priorityHint] - priorityWeight[a.priorityHint]);
    };
  });

  const activeEpics = computed(() =>
    epics.value.filter((e) => e.column === 'in-progress'),
  );

  const reviewEpics = computed(() =>
    epics.value.filter((e) => e.column === 'review'),
  );

  // ── Actions ────────────────────────────────────────────────────────

  async function loadAll(projectId?: string): Promise<void> {
    loading.value = true;
    try {
      const db = getDatabase();
      const loaded = await db.loadEpics(projectId);
      if (projectId) {
        // merge: keep epics from other projects, replace epics for this project
        const other = epics.value.filter((e) => e.projectId !== projectId);
        epics.value = [...other, ...loaded];
      } else {
        epics.value = loaded;
      }
    } catch (err) {
      console.error('[EpicStore] Failed to load epics:', err);
    } finally {
      loading.value = false;
    }
  }

  async function createEpic(
    projectId: string,
    title: string,
    opts?: Partial<Pick<Epic, 'description' | 'acceptanceCriteria' | 'priorityHint' | 'complexity' | 'targetRepoIds'>>,
  ): Promise<Epic> {
    const now = nowISO();
    const epic: Epic = {
      id: generateId(),
      projectId,
      title,
      description: opts?.description ?? '',
      acceptanceCriteria: opts?.acceptanceCriteria ?? '',
      column: 'idea',
      priorityHint: opts?.priorityHint ?? 'medium',
      complexity: opts?.complexity ?? 'medium',
      model: '',
      targetRepoIds: opts?.targetRepoIds ?? [],
      dependsOn: [],
      rejectionCount: 0,
      rejectionFeedback: '',
      computedScore: 0,
      rootSessionId: null,
      costTotal: 0,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
    };

    const db = getDatabase();
    await db.saveEpic(epic);
    epics.value.push(epic);
    return epic;
  }

  async function updateEpic(id: string, updates: Partial<Epic>): Promise<void> {
    const idx = epics.value.findIndex((e) => e.id === id);
    if (idx === -1) return;

    epics.value[idx] = {
      ...epics.value[idx],
      ...updates,
      updatedAt: nowISO(),
    };
    const db = getDatabase();
    await db.saveEpic(epics.value[idx]);
  }

  async function moveEpic(id: string, column: EpicColumn): Promise<void> {
    const idx = epics.value.findIndex((e) => e.id === id);
    if (idx === -1) return;

    const now = nowISO();
    const epic = epics.value[idx];

    const patch: Partial<Epic> = { column, updatedAt: now };
    if (column === 'todo' && epic.column === 'backlog') {
      patch.rejectionCount = 0;
    }
    if (column === 'in-progress' && !epic.startedAt) {
      patch.startedAt = now;
    }
    if (column === 'done' && !epic.completedAt) {
      patch.completedAt = now;
    }

    epics.value[idx] = { ...epic, ...patch };
    const db = getDatabase();
    await db.saveEpic(epics.value[idx]);
  }

  async function deleteEpic(id: string): Promise<void> {
    const db = getDatabase();
    await db.deleteEpic(id);
    epics.value = epics.value.filter((e) => e.id !== id);
  }

  function wouldCreateCycle(epicId: string, depId: string): boolean {
    const visited = new Set<string>();
    const stack = [depId];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === epicId) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      const ep = epics.value.find(e => e.id === current);
      if (ep) {
        for (const dep of ep.dependsOn) {
          if (!visited.has(dep)) stack.push(dep);
        }
      }
    }
    return false;
  }

  async function addDependency(epicId: string, dependsOnId: string): Promise<void> {
    const idx = epics.value.findIndex((e) => e.id === epicId);
    if (idx === -1) return;

    const epic = epics.value[idx];
    if (epic.dependsOn.includes(dependsOnId)) return;

    if (wouldCreateCycle(epicId, dependsOnId)) {
      console.warn(`[EpicStore] Refusing to add dependency ${epicId} -> ${dependsOnId}: would create a cycle`);
      return;
    }

    epics.value[idx] = {
      ...epic,
      dependsOn: [...epic.dependsOn, dependsOnId],
      updatedAt: nowISO(),
    };
    const db = getDatabase();
    await db.saveEpic(epics.value[idx]);
  }

  async function removeDependency(epicId: string, dependsOnId: string): Promise<void> {
    const idx = epics.value.findIndex((e) => e.id === epicId);
    if (idx === -1) return;

    const epic = epics.value[idx];
    epics.value[idx] = {
      ...epic,
      dependsOn: epic.dependsOn.filter((d) => d !== dependsOnId),
      updatedAt: nowISO(),
    };
    const db = getDatabase();
    await db.saveEpic(epics.value[idx]);
  }

  async function incrementRejection(id: string): Promise<void> {
    const idx = epics.value.findIndex((e) => e.id === id);
    if (idx === -1) return;

    const epic = epics.value[idx];
    epics.value[idx] = {
      ...epic,
      rejectionCount: epic.rejectionCount + 1,
      updatedAt: nowISO(),
    };
    const db = getDatabase();
    await db.saveEpic(epics.value[idx]);
  }

  async function initialize(): Promise<void> {
    await loadAll();
  }

  return {
    // State
    epics,
    loading,
    // Getters
    epicById,
    epicsByProject,
    epicsByColumn,
    activeEpics,
    reviewEpics,
    // Actions
    loadAll,
    createEpic,
    updateEpic,
    moveEpic,
    deleteEpic,
    addDependency,
    removeDependency,
    incrementRejection,
    initialize,
  };
});
