/**
 * Scheduler — automatic epic-to-orchestrator dispatcher.
 *
 * Periodically ticks, scores "todo" epics by priority, checks dependencies
 * and repo locks, and spawns orchestrators via OrchestratorPool.
 *
 * UI-independent: uses EpicRepository / ProjectRepository interfaces
 * instead of Pinia stores. The Database is accessed via the repositories
 * and a direct reference for config/log.
 */

import type { Epic, SchedulerConfig, SchedulerAction, RepoLock, PriorityHint, ComplexityEstimate, OrchestratorOptions } from './KosTypes';
import type { OrchestratorPool } from './OrchestratorPool';
import type { Database } from './Database';
import type { EpicRepository, ProjectRepository } from './repositories';
import { engineBus } from './EventBus';

// ── Priority & Complexity Score Maps ──────────────────────────────────────

const PRIORITY_SCORE: Record<PriorityHint, number> = {
  critical: 1.0,
  high: 0.75,
  medium: 0.5,
  low: 0.25,
  none: 0.0,
};

const COMPLEXITY_SCORE: Record<ComplexityEstimate, number> = {
  trivial: 1.0,
  small: 0.8,
  medium: 0.6,
  large: 0.4,
  epic: 0.2,
};

// ── Scheduler (singleton) ─────────────────────────────────────────────────

export class Scheduler {
  private config!: SchedulerConfig;
  private repoLocks: Map<string, RepoLock> = new Map();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private tickPromise: Promise<void> | null = null;
  private running: boolean = false;
  private epicRepo: EpicRepository | null = null;
  private projectRepo: ProjectRepository | null = null;
  private db: Database | null = null;
  private pool: OrchestratorPool | null = null;

  private static instance: Scheduler | null = null;

  static getInstance(): Scheduler {
    if (!Scheduler.instance) {
      Scheduler.instance = new Scheduler();
    }
    return Scheduler.instance;
  }

  // ── Configuration ──────────────────────────────────────────────────────

  setPool(pool: OrchestratorPool): void {
    this.pool = pool;
  }

  /** Set repository interfaces (preferred — no Pinia dependency). */
  setRepositories(epics: EpicRepository, projects: ProjectRepository): void {
    this.epicRepo = epics;
    this.projectRepo = projects;
  }

  /** Set database for config/log (used when repositories are set). */
  setDatabase(db: Database): void {
    this.db = db;
  }

  // ── Initialization ────────────────────────────────────────────────────

  /** Initialize the scheduler. Uses epicRepo/projectRepo set via setRepositories(). */
  async initialize(): Promise<void> {
    console.log(`[Scheduler] initialize called, pool=${!!this.pool}, repoMode=${!!this.epicRepo}`);

    await this.loadConfig();
    this.repoLocks.clear();
    console.log(`[Scheduler] Config loaded: enabled=${this.config.enabled}, tickInterval=${this.config.tickIntervalMs}ms, maxConcurrent=${this.config.maxConcurrentEpics}`);

    // Reload from DB to ensure we have the latest state
    await this.refreshCache();

    // Recover epics stuck in 'in-progress' (crash recovery)
    const allEpics = this.getAllEpics();
    const staleEpics = allEpics.filter(
      (e: Epic) => e.column === 'in-progress' && (!this.pool || !this.pool.isEpicActive(e.id)),
    );
    if (staleEpics.length > 0) {
      console.log(`[Scheduler] Recovering ${staleEpics.length} stale in-progress epics`);
    }
    for (const epic of staleEpics) {
      await this.doMoveEpic(epic.id, 'todo');
      await this.logAction({
        type: 'recovered',
        epicId: epic.id,
        timestamp: new Date().toISOString(),
        details: `Recovered stale in-progress epic on startup: ${epic.title}`,
      });
      console.log(`[Scheduler] Recovered stale epic: ${epic.title}`);
    }

    if (this.config.enabled) {
      console.log(`[Scheduler] Auto-starting scheduler (enabled=true)`);
      this.start();
    } else {
      console.log(`[Scheduler] Scheduler disabled — not starting tick timer`);
    }
  }

  // ── Data access (via repositories) ──────────────────────────────────────

  /** Reload in-memory caches from DB so we pick up changes made by the UI layer. */
  private async refreshCache(): Promise<void> {
    if (this.epicRepo) await this.epicRepo.reload();
    if (this.projectRepo) await this.projectRepo.reload();
  }

  private getAllEpics(): Epic[] {
    if (this.epicRepo) return this.epicRepo.listEpics();
    return [];
  }

  private async doMoveEpic(id: string, column: string): Promise<void> {
    if (this.epicRepo) {
      await this.epicRepo.moveEpic(id, column as any);
      this.emitEpicUpdated(id);
    }
  }

  private async doUpdateEpic(id: string, updates: Partial<Epic>): Promise<void> {
    if (this.epicRepo) {
      await this.epicRepo.updateEpic(id, updates);
      this.emitEpicUpdated(id);
    }
  }

  private async doIncrementRejection(id: string): Promise<void> {
    if (this.epicRepo) {
      await this.epicRepo.incrementRejection(id);
      this.emitEpicUpdated(id);
    }
  }

  private emitEpicUpdated(id: string): void {
    if (!this.epicRepo) return;
    const epic = this.epicRepo.getEpic(id);
    if (epic) {
      engineBus.emit('epic:updated', { epicId: id, epic: structuredClone(epic) });
    }
  }

  private getReposForEpic(epic: Epic): any[] {
    if (this.projectRepo) {
      return this.projectRepo.reposByProjectId(epic.projectId)
        .filter(r => epic.targetRepoIds.includes(r.id));
    }
    return [];
  }

  private getDb(): Database | null {
    return this.db ?? null;
  }

  // ── Config ────────────────────────────────────────────────────────────

  async loadConfig(): Promise<SchedulerConfig> {
    const db = this.getDb();
    if (db) {
      this.config = await db.loadSchedulerConfig();
    } else {
      // Fallback defaults
      this.config = {
        enabled: true,
        tickIntervalMs: 30000,
        maxConcurrentEpics: 3,
        dailyCostBudget: 50.0,
        weights: { manualHint: 0.4, dependencyDepth: 0.2, age: 0.15, complexity: 0.15, rejectionPenalty: 0.1 },
      };
    }
    // Return a clone to prevent Vue reactivity from wrapping the internal config object
    return structuredClone(this.config);
  }

  async saveConfig(config: SchedulerConfig): Promise<void> {
    // Clone to strip any Vue reactive proxy before passing to Tauri IPC
    const plain = structuredClone(config);
    const prevTickInterval = this.config?.tickIntervalMs;

    const db = this.getDb();
    if (db) {
      await db.saveSchedulerConfig(plain);
    }
    this.config = plain;

    // Reconcile running state with new config
    if (plain.enabled && !this.isRunning()) {
      this.start();
    } else if (!plain.enabled && this.isRunning()) {
      await this.stop();
    } else if (this.isRunning() && plain.tickIntervalMs !== prevTickInterval) {
      // Restart with new tick interval
      await this.stop();
      this.start();
    }
  }

  // ── Priority Scoring ──────────────────────────────────────────────────

  computePriorityScore(epic: Epic): number {
    const w = this.config.weights;

    const manualScore = (PRIORITY_SCORE[epic.priorityHint] ?? 0.5) * w.manualHint;

    const depthScore = epic.dependsOn.length === 0
      ? 1.0
      : Math.max(0, 1.0 - epic.dependsOn.length * 0.2);
    const dependencyScore = depthScore * w.dependencyDepth;

    const ageMs = Date.now() - new Date(epic.createdAt).getTime();
    const ageDays = Math.max(0, ageMs / (1000 * 60 * 60 * 24));
    const ageNormalized = Math.min(ageDays / 30, 1.0);
    const ageScore = ageNormalized * w.age;

    const complexityScore = (COMPLEXITY_SCORE[epic.complexity] ?? 0.6) * w.complexity;

    const rejectionPenalty = Math.max(0, 1.0 - epic.rejectionCount * 0.2);
    const rejectionScore = rejectionPenalty * w.rejectionPenalty;

    return manualScore + dependencyScore + ageScore + complexityScore + rejectionScore;
  }

  // ── Repo Locking ──────────────────────────────────────────────────────

  canAcquireRepos(epic: Epic): boolean {
    if (epic.targetRepoIds.length === 0) return true;
    const LOCK_TTL_MS = 10 * 60 * 1000; // 10 minutes
    const now = Date.now();
    for (const repoId of epic.targetRepoIds) {
      const lock = this.repoLocks.get(repoId);
      if (lock) {
        if (now - new Date(lock.acquiredAt).getTime() < LOCK_TTL_MS) {
          return false;
        }
        this.repoLocks.delete(repoId);
        console.log(`[Scheduler] Auto-expired stale repo lock: repo=${repoId}, epic=${lock.epicId}`);
      }
    }
    return true;
  }

  acquireRepos(epic: Epic): void {
    const now = new Date().toISOString();
    for (const repoId of epic.targetRepoIds) {
      this.repoLocks.set(repoId, { repoId, epicId: epic.id, acquiredAt: now });
    }
  }

  releaseRepos(epicId: string): void {
    for (const [repoId, lock] of this.repoLocks) {
      if (lock.epicId === epicId) {
        this.repoLocks.delete(repoId);
      }
    }
  }

  // ── Dependency Checking ───────────────────────────────────────────────

  isBlocked(epic: Epic, allEpics: Epic[]): boolean {
    if (epic.dependsOn.length === 0) return false;

    const visited = new Set<string>();
    const stack = [...epic.dependsOn];

    while (stack.length > 0) {
      const depId = stack.pop()!;
      if (depId === epic.id) {
        // Cycle detected
        console.error(`[Scheduler] Circular dependency detected involving epic: ${epic.id}`);
        return true; // treat as blocked
      }
      if (visited.has(depId)) continue;
      visited.add(depId);

      const dep = allEpics.find(e => e.id === depId);
      if (!dep || dep.column !== 'done') return true; // dependency not done = blocked

      // Traverse transitive dependencies
      for (const transitiveDep of dep.dependsOn) {
        if (!visited.has(transitiveDep)) {
          stack.push(transitiveDep);
        }
      }
    }
    return false;
  }

  // ── Main Tick ─────────────────────────────────────────────────────────

  async tick(): Promise<SchedulerAction[]> {
    const actions: SchedulerAction[] = [];

    try {
      await this.refreshCache();

      let allEpics = this.getAllEpics();

      // ── Health check: recover orphaned in-progress epics ────────────
      if (this.pool) {
        const GRACE_MS = 5 * 60 * 1000;
        const now = Date.now();
        const inProgress = allEpics.filter((e: Epic) => e.column === 'in-progress');
        for (const epic of inProgress) {
          if (this.pool.isEpicActive(epic.id)) continue;
          if (!epic.startedAt || now - new Date(epic.startedAt).getTime() <= GRACE_MS) continue;

          console.log(`[Scheduler] Health check: recovering orphaned epic ${epic.id} ("${epic.title}")`);
          this.releaseRepos(epic.id);
          await this.doMoveEpic(epic.id, 'todo');

          const action: SchedulerAction = {
            type: 'recovered',
            epicId: epic.id,
            timestamp: new Date().toISOString(),
            details: `Recovered orphaned in-progress epic during tick: ${epic.title}`,
          };
          await this.logAction(action);
          actions.push(action);
        }
        // Re-fetch since we may have moved epics
        allEpics = this.getAllEpics();
      }

      // ── Budget guard: skip scheduling if daily budget exhausted ──────
      const db = this.getDb();
      let todaySpend = 0;
      if (db && this.config.dailyCostBudget > 0) {
        const todayMidnight = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
        todaySpend = await db.totalCostSince(todayMidnight);
        if (todaySpend >= this.config.dailyCostBudget) {
          console.log(`[Scheduler] Daily budget exhausted ($${todaySpend.toFixed(2)} / $${this.config.dailyCostBudget.toFixed(2)}) — skipping scheduling`);
          return actions;
        }
      }
      const budgetRemaining = (db && this.config.dailyCostBudget > 0)
        ? this.config.dailyCostBudget - todaySpend
        : null;

      const inProgressCount = allEpics.filter((e: Epic) => e.column === 'in-progress').length;
      let slotsAvailable = this.config.maxConcurrentEpics - inProgressCount;

      const todoEpics = allEpics
        .filter((e: Epic) => e.column === 'todo')
        .map((e: Epic) => ({ epic: e, score: this.computePriorityScore(e) }))
        .sort((a: { score: number }, b: { score: number }) => b.score - a.score);

      console.log(`[Scheduler] tick: ${inProgressCount} in-progress, ${todoEpics.length} todo, ${slotsAvailable} slots available, pool=${!!this.pool}`);

      for (const { epic, score } of todoEpics) {
        if (slotsAvailable <= 0) break;
        if (this.isBlocked(epic, allEpics)) {
          console.log(`[Scheduler] Skipping blocked epic: ${epic.id} ("${epic.title}")`);
          continue;
        }
        if (!this.canAcquireRepos(epic)) {
          console.log(`[Scheduler] Skipping epic (repo locked): ${epic.id} ("${epic.title}")`);
          continue;
        }
        if (this.config.maxConcurrentPerProject && this.config.maxConcurrentPerProject > 0) {
          const inProgressForProject = allEpics.filter(
            (e: Epic) => e.column === 'in-progress' && e.projectId === epic.projectId
          ).length;
          if (inProgressForProject >= this.config.maxConcurrentPerProject) {
            console.log(`[Scheduler] Skipping epic (project concurrency limit): ${epic.id} ("${epic.title}")`);
            continue;
          }
        }

        console.log(`[Scheduler] Starting epic: ${epic.id} ("${epic.title}") score=${score.toFixed(3)}`);
        await this.executeStart(epic, budgetRemaining);
        await this.doUpdateEpic(epic.id, { computedScore: score });
        slotsAvailable--;

        actions.push({
          type: 'start',
          epicId: epic.id,
          timestamp: new Date().toISOString(),
          details: `Score: ${score.toFixed(3)}`,
        });
      }
    } catch (err) {
      console.error('[Scheduler] tick error:', err);
      engineBus.emit('scheduler:error', {
        title: 'Scheduler tick failed',
        message: err instanceof Error ? err.message : String(err),
      });
      actions.push({
        type: 'error',
        epicId: '',
        timestamp: new Date().toISOString(),
        details: String(err),
      });
    }

    return actions;
  }

  // ── Epic Lifecycle ────────────────────────────────────────────────────

  async executeStart(epic: Epic, budgetRemaining: number | null = null): Promise<void> {
    console.log(`[Scheduler] executeStart: epic=${epic.id} ("${epic.title}") pool=${!!this.pool}`);

    await this.refreshCache();
    await this.doMoveEpic(epic.id, 'in-progress');
    this.acquireRepos(epic);

    await this.logAction({
      type: 'start',
      epicId: epic.id,
      timestamp: new Date().toISOString(),
      details: `Started epic: ${epic.title}`,
    });

    if (this.pool) {
      const repos = this.getReposForEpic(epic);

      const repoPaths: Record<string, string> = {};
      for (const r of repos) {
        repoPaths[r.id] = r.path;
      }

      const options: OrchestratorOptions = {
        epicId: epic.id,
        projectId: epic.projectId,
        repoPaths,
        depth: 0,
        maxDepth: 3,
        parentSessionId: null,
        budgetRemaining,
      };

      try {
        console.log(`[Scheduler] Calling pool.spawnRoot for epic: ${epic.id}`);
        const sessionId = await this.pool.spawnRoot(epic.id, options, epic, repos);
        console.log(`[Scheduler] Orchestrator spawned for epic ${epic.id}, session: ${sessionId}`);
        // Store the root session ID on the epic so we can navigate back to it
        await this.doUpdateEpic(epic.id, { rootSessionId: sessionId });
        engineBus.emit('scheduler:info', {
          epicId: epic.id,
          title: 'Epic started',
          message: `"${epic.title}" is now in progress`,
        });
      } catch (err) {
        console.error(`[Scheduler] Failed to spawn orchestrator for epic ${epic.id}:`, err);
        engineBus.emit('scheduler:error', {
          epicId: epic.id,
          title: 'Failed to start epic',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      console.error(`[Scheduler] No pool available — cannot spawn orchestrator for epic: ${epic.id}`);
      engineBus.emit('scheduler:error', {
        epicId: epic.id,
        title: 'No orchestrator pool',
        message: 'Scheduler pool is not configured.',
      });
    }
  }

  async moveToReview(epicId: string): Promise<void> {
    await this.doMoveEpic(epicId, 'review');
    this.releaseRepos(epicId);

    await this.logAction({
      type: 'to-review',
      epicId,
      timestamp: new Date().toISOString(),
      details: 'Moved to review',
    });

    if (this.pool) {
      await this.pool.removeEpic(epicId);
    }
  }

  async approveEpic(epicId: string): Promise<void> {
    try {
      await this.doMoveEpic(epicId, 'done');

      await this.logAction({
        type: 'approve',
        epicId,
        timestamp: new Date().toISOString(),
        details: 'Approved',
      });

      if (this.pool) {
        await this.pool.removeEpic(epicId);
      }
    } catch (err) {
      console.error(`[Scheduler] Failed to approve epic ${epicId}:`, err);
      engineBus.emit('scheduler:error', {
        epicId,
        title: 'Failed to approve epic',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async rejectEpic(epicId: string, feedback: string): Promise<void> {
    try {
      await this.refreshCache();
      this.releaseRepos(epicId);
      await this.doIncrementRejection(epicId);
      await this.doUpdateEpic(epicId, { rejectionFeedback: feedback });

      const epic = this.getAllEpics().find(e => e.id === epicId);
      const targetColumn = epic && epic.rejectionCount >= 5 ? 'backlog' : 'todo';
      await this.doMoveEpic(epicId, targetColumn);

      if (targetColumn === 'backlog') {
        engineBus.emit('scheduler:info', {
          epicId,
          title: 'Epic moved to backlog',
          message: `Epic exceeded 5 rejections and was moved to backlog`,
        });
      }

      await this.logAction({
        type: 'reject',
        epicId,
        timestamp: new Date().toISOString(),
        details: feedback,
      });
    } catch (err) {
      console.error(`[Scheduler] Failed to reject epic ${epicId}:`, err);
      engineBus.emit('scheduler:error', {
        epicId,
        title: 'Failed to reject epic',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── Timer Control ─────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    this.tickTimer = setInterval(() => {
      if (this.tickPromise) return; // skip if previous tick still running
      this.tickPromise = this.tick()
        .then(() => {})
        .catch((err) => console.error('[Scheduler] tick failed:', err))
        .finally(() => { this.tickPromise = null; });
    }, this.config.tickIntervalMs);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.tickPromise) {
      await this.tickPromise;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  // ── Log ───────────────────────────────────────────────────────────────

  async getLog(limit?: number): Promise<SchedulerAction[]> {
    const db = this.getDb();
    if (!db) return [];
    return db.loadSchedulerLog(limit);
  }

  private async logAction(action: SchedulerAction): Promise<void> {
    try {
      const db = this.getDb();
      if (db) {
        await db.appendSchedulerLog(action);
      }
    } catch (err) {
      console.error('[Scheduler] Failed to log action:', err);
    }
  }
}
