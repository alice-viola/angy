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

import type { Epic, SchedulerConfig, SchedulerAction, RepoLock, PriorityHint, ComplexityEstimate, OrchestratorOptions, BlockingReason } from './KosTypes';
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
  private epicsPendingResume = new Set<string>();

  private static instance: Scheduler | null = null;

  static getInstance(): Scheduler {
    if (!Scheduler.instance) {
      Scheduler.instance = new Scheduler();
    }
    return Scheduler.instance;
  }

  static resetInstance(): void {
    Scheduler.instance = null;
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
    // Instead of just moving to 'todo', attempt to resume from persisted pipeline state
    const allEpics = this.getAllEpics();
    const staleEpics = allEpics.filter(
      (e: Epic) => e.column === 'in-progress' && (!this.pool || !this.pool.isEpicActive(e.id)),
    );
    if (staleEpics.length > 0) {
      console.log(`[Scheduler] Recovering ${staleEpics.length} stale in-progress epics (will attempt resume)`);
    }
    for (const epic of staleEpics) {
      // Move to 'todo' first so the scheduler can re-pick them up with tryResume=true
      await this.doMoveEpic(epic.id, 'todo');
      // Mark for resume so next tick will use resumeOrSpawnRoot
      this.epicsPendingResume.add(epic.id);
      await this.logAction({
        type: 'recovered',
        epicId: epic.id,
        timestamp: new Date().toISOString(),
        details: `Recovered stale in-progress epic on startup (will attempt resume): ${epic.title}`,
      });
      console.log(`[Scheduler] Recovered stale epic (pending resume): ${epic.title}`);
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
      const allRepos = this.projectRepo.reposByProjectId(epic.projectId);
      if (epic.targetRepoIds.length === 0) {
        return allRepos;
      }
      return allRepos.filter(r => epic.targetRepoIds.includes(r.id));
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

    // Sync pool max depth with config
    if (this.pool) {
      this.pool.setMaxDepth(this.config.maxOrchestratorDepth ?? 3);
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

    // Sync pool max depth with updated config
    if (this.pool) {
      this.pool.setMaxDepth(plain.maxOrchestratorDepth ?? 3);
    }

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

  private resolveRepoIds(epic: Epic): string[] {
    if (epic.targetRepoIds.length > 0) return epic.targetRepoIds;
    if (this.projectRepo) {
      return this.projectRepo.reposByProjectId(epic.projectId).map(r => r.id);
    }
    return [];
  }

  canAcquireRepos(epic: Epic): boolean {
    if (epic.useWorktree) return true;
    const repoIds = this.resolveRepoIds(epic);
    for (const repoId of repoIds) {
      if (this.repoLocks.has(repoId)) return false;
    }
    return true;
  }

  acquireRepos(epic: Epic): void {
    if (epic.useWorktree) return;
    const repoIds = this.resolveRepoIds(epic);
    const now = new Date().toISOString();
    for (const repoId of repoIds) {
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
    // runAfter: unblocks only when the predecessor reaches 'review' or 'done'
    if (epic.runAfter) {
      const predecessor = allEpics.find(e => e.id === epic.runAfter);
      if (predecessor && predecessor.column !== 'review' && predecessor.column !== 'done') {
        return true;
      }
      // predecessor deleted or already at review/done → not blocked by runAfter
    }

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

  // ── Blocking Reasons ─────────────────────────────────────────────────

  getBlockingReasons(epic: Epic, allEpics: Epic[]): BlockingReason[] {
    const reasons: BlockingReason[] = [];

    // runAfter
    if (epic.runAfter) {
      const predecessor = allEpics.find(e => e.id === epic.runAfter);
      if (predecessor && predecessor.column !== 'review' && predecessor.column !== 'done') {
        reasons.push({ type: 'runAfter', label: `Waiting for '${predecessor.title}' to finish`, relatedEpicId: epic.runAfter });
      }
    }

    // dependency
    for (const depId of epic.dependsOn) {
      const dep = allEpics.find(e => e.id === depId);
      if (!dep || dep.column !== 'done') {
        reasons.push({ type: 'dependency', label: `Blocked by '${dep?.title ?? depId}'`, relatedEpicId: depId });
      }
    }

    // repoLock (skip for worktree epics)
    if (!epic.useWorktree) {
      const repoIds = this.resolveRepoIds(epic);
      for (const repoId of repoIds) {
        const lock = this.repoLocks.get(repoId);
        if (lock && lock.epicId !== epic.id) {
          const lockingEpic = allEpics.find(e => e.id === lock.epicId);
          reasons.push({ type: 'repoLock', label: `Repo locked by '${lockingEpic?.title ?? lock.epicId}'`, relatedEpicId: lock.epicId, relatedRepoId: repoId });
        }
      }
    }

    // concurrency
    const inProgressCount = allEpics.filter(e => e.column === 'in-progress').length;
    if (inProgressCount >= this.config.maxConcurrentEpics) {
      reasons.push({ type: 'concurrency', label: 'Global concurrency limit reached' });
    }

    // projectConcurrency
    if (this.config.maxConcurrentPerProject && this.config.maxConcurrentPerProject > 0) {
      const inProgressForProject = allEpics.filter(e => e.column === 'in-progress' && e.projectId === epic.projectId).length;
      if (inProgressForProject >= this.config.maxConcurrentPerProject) {
        reasons.push({ type: 'projectConcurrency', label: 'Project concurrency limit reached' });
      }
    }

    // budget
    // Note: budget check is async in tick(), so we can only flag if config says budget is 0
    // The actual budget check happens in tick() — this is a best-effort indicator

    return reasons;
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

          console.log(`[Scheduler] Health check: recovering orphaned epic ${epic.id} ("${epic.title}") — will attempt resume`);
          this.releaseRepos(epic.id);
          await this.doMoveEpic(epic.id, 'todo');
          this.epicsPendingResume.add(epic.id);

          const action: SchedulerAction = {
            type: 'recovered',
            epicId: epic.id,
            timestamp: new Date().toISOString(),
            details: `Recovered orphaned in-progress epic during tick (pending resume): ${epic.title}`,
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

        const tryResume = this.epicsPendingResume.has(epic.id) || !!epic.suspendedAt;
        if (this.epicsPendingResume.has(epic.id)) {
          this.epicsPendingResume.delete(epic.id);
        }

        console.log(`[Scheduler] ${tryResume ? 'Resuming' : 'Starting'} epic: ${epic.id} ("${epic.title}") score=${score.toFixed(3)}`);
        const started = await this.executeStart(epic, budgetRemaining, tryResume);
        if (!started) continue;

        await this.doUpdateEpic(epic.id, { computedScore: score });
        slotsAvailable--;

        actions.push({
          type: tryResume ? 'recovered' : 'start',
          epicId: epic.id,
          timestamp: new Date().toISOString(),
          details: tryResume ? `Resumed (score: ${score.toFixed(3)})` : `Score: ${score.toFixed(3)}`,
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

    // Emit blocking reasons for todo/backlog epics
    const blockingReasons: Record<string, BlockingReason[]> = {};
    const currentEpics = this.getAllEpics();
    for (const epic of currentEpics.filter(e => e.column === 'todo' || e.column === 'backlog')) {
      const r = this.getBlockingReasons(epic, currentEpics);
      if (r.length > 0) blockingReasons[epic.id] = r;
    }
    engineBus.emit('scheduler:blockingReasons', { reasons: blockingReasons });

    return actions;
  }

  // ── Epic Lifecycle ────────────────────────────────────────────────────

  async executeStart(epic: Epic, budgetRemaining: number | null = null, tryResume = false): Promise<boolean> {
    console.log(`[Scheduler] executeStart: epic=${epic.id} ("${epic.title}") pool=${!!this.pool} tryResume=${tryResume}`);

    await this.refreshCache();

    const freshEpic = this.getAllEpics().find(e => e.id === epic.id);
    if (!freshEpic || freshEpic.column !== epic.column) {
      console.log(`[Scheduler] Aborting executeStart: epic ${epic.id} ("${epic.title}") column changed since scheduling (was: '${epic.column}', now: '${freshEpic?.column ?? 'deleted'}')`);
      return false;
    }

    // ── Parallel agents: duplicate epic N times and discard original ──────
    const parallelCount = freshEpic.parallelAgentCount ?? 1;
    if (parallelCount > 1 && this.epicRepo) {
      const now = new Date().toISOString();
      // Strip existing X-suffix so re-scheduling doesn't double-suffix
      const baseTitle = freshEpic.title.replace(/ X\d+$/, '');
      console.log(`[Scheduler] Duplicating epic "${baseTitle}" x${parallelCount} for parallel execution`);

      for (let i = 1; i <= parallelCount; i++) {
        const clone: Epic = {
          ...freshEpic,
          id: crypto.randomUUID(),
          title: `${baseTitle} X${i}`,
          parallelAgentCount: 1,
          column: 'todo',
          rootSessionId: null,
          costTotal: 0,
          computedScore: 0,
          startedAt: null,
          completedAt: null,
          suspendedAt: null,
          rejectionCount: 0,
          rejectionFeedback: '',
          lastAttemptFiles: [],
          lastValidationResults: [],
          lastArchitectPlan: '',
          createdAt: now,
          updatedAt: now,
        };
        await this.epicRepo.saveEpic(clone);
      }

      // Discard the template epic
      await this.doMoveEpic(freshEpic.id, 'discarded');
      engineBus.emit('epic:storeSyncNeeded');

      await this.logAction({
        type: 'start',
        epicId: freshEpic.id,
        timestamp: now,
        details: `Split "${baseTitle}" into ${parallelCount} parallel copies (X1–X${parallelCount})`,
      });

      return false; // clones will be picked up on the next scheduler tick
    }

    await this.doMoveEpic(epic.id, 'in-progress');
    if (freshEpic.suspendedAt) {
      await this.doUpdateEpic(epic.id, { suspendedAt: null });
    }
    this.acquireRepos(freshEpic);

    await this.logAction({
      type: 'start',
      epicId: freshEpic.id,
      timestamp: new Date().toISOString(),
      details: tryResume ? `Resumed epic: ${freshEpic.title}` : `Started epic: ${freshEpic.title}`,
    });

    if (this.pool) {
      const repos = this.getReposForEpic(freshEpic);

      const repoPaths: Record<string, string> = {};
      for (const r of repos) {
        repoPaths[r.id] = r.path;
      }

      const options: OrchestratorOptions = {
        epicId: freshEpic.id,
        projectId: freshEpic.projectId,
        repoPaths,
        depth: 0,
        maxDepth: this.config.maxOrchestratorDepth ?? 3,
        parentSessionId: null,
        budgetRemaining,
        maxConcurrentChildren: this.config.maxConcurrentChildren ?? 3,
        subOrchestratorTimeoutMs: this.config.subOrchestratorTimeoutMs ?? 30 * 60 * 1000,
      };

      try {
        let sessionId: string;
        if (tryResume) {
          console.log(`[Scheduler] Attempting resume for epic: ${freshEpic.id}`);
          sessionId = await this.pool.resumeOrSpawnRoot(freshEpic.id, options, freshEpic, repos);
        } else {
          console.log(`[Scheduler] Calling pool.spawnRoot for epic: ${freshEpic.id}`);
          sessionId = await this.pool.spawnRoot(freshEpic.id, options, freshEpic, repos);
        }
        console.log(`[Scheduler] Orchestrator ${tryResume ? 'resumed/spawned' : 'spawned'} for epic ${freshEpic.id}, session: ${sessionId}`);
        await this.doUpdateEpic(freshEpic.id, { rootSessionId: sessionId });
        engineBus.emit('scheduler:info', {
          epicId: freshEpic.id,
          title: tryResume ? 'Epic resumed' : 'Epic started',
          message: `"${freshEpic.title}" is now in progress`,
        });
      } catch (err) {
        console.error(`[Scheduler] Failed to spawn orchestrator for epic ${freshEpic.id}:`, err);
        engineBus.emit('scheduler:error', {
          epicId: freshEpic.id,
          title: 'Failed to start epic',
          message: err instanceof Error ? err.message : String(err),
        });
        return false;
      }
    } else {
      console.error(`[Scheduler] No pool available — cannot spawn orchestrator for epic: ${freshEpic.id}`);
      engineBus.emit('scheduler:error', {
        epicId: freshEpic.id,
        title: 'No orchestrator pool',
        message: 'Scheduler pool is not configured.',
      });
      return false;
    }

    return true;
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
