/**
 * AngyEngine — top-level facade for the entire engine layer.
 *
 * Owns all singletons (Database, SessionService, ProcessManager,
 * OrchestratorPool, Scheduler, BranchManager) and provides a clean API
 * for the full lifecycle: from project creation to epic scheduling.
 *
 * Can be used:
 *   - Headlessly (no Vue, no DOM) — e.g., CLI, tests, server
 *   - From the UI layer — Pinia stores observe engine state via events
 *
 * Initialization:
 *   const engine = AngyEngine.getInstance();
 *   await engine.initialize();
 *   // ... use engine ...
 *   await engine.shutdown();
 */

import { Database } from './Database';
import { SessionService } from './SessionService';
import { ProcessManager } from './ProcessManager';
import { OrchestratorPool } from './OrchestratorPool';
import { BranchManager } from './BranchManager';
import { Scheduler } from './Scheduler';
import { HeadlessHandle } from './HeadlessHandle';
import { engineBus } from './EventBus';
import type { AgentHandle, ProcessOptions } from './types';
import type { Epic, EpicColumn, Project, ProjectRepo, OrchestratorOptions } from './KosTypes';
import {
  DatabaseEpicRepository,
  DatabaseProjectRepository,
  type EpicRepository,
  type ProjectRepository,
} from './repositories';
import { detectTechnologies } from './TechDetector';
import { HybridPipelineRunner } from './HybridPipelineRunner';
import { PipelineStateStore } from './PipelineStateStore';
import { ClaudeHealthMonitor } from './ClaudeHealthMonitor';
import { CodexHealthMonitor } from './CodexHealthMonitor';
import { ServerProcess } from './ServerProcess';
import { AngyCodeProcessManager } from './AngyCodeProcessManager';
import { setAngyCodeProcessManager } from '../composables/useEngine';

// ── Singleton ────────────────────────────────────────────────────────────

let _instance: AngyEngine | null = null;

// ── Engine ───────────────────────────────────────────────────────────────

export class AngyEngine {
  // ── Core services ──────────────────────────────────────────────────
  readonly db: Database;
  readonly sessions: SessionService;
  readonly processes: ProcessManager;
  readonly pool: OrchestratorPool;
  readonly branchManager: BranchManager;
  readonly scheduler: Scheduler;
  readonly bus = engineBus;

  // ── Repositories (data access) ─────────────────────────────────────
  readonly epics: EpicRepository;
  readonly projects: ProjectRepository;

  // ── Recovery services ──────────────────────────────────────────────
  readonly pipelineStateStore: PipelineStateStore;
  readonly healthMonitor: ClaudeHealthMonitor;
  readonly codexHealthMonitor: CodexHealthMonitor;

  // ── AngyCode (Gemini) services ────────────────────────────────────
  private serverProcess: ServerProcess;
  private acpm: AngyCodeProcessManager | null = null;

  // ── Active pipeline runners ────────────────────────────────────────
  private hybridRunners = new Map<string, HybridPipelineRunner>();

  private _initialized = false;

  private constructor() {
    this.db = new Database();
    this.sessions = new SessionService(this.db);
    this.processes = new ProcessManager(this.db);
    this.branchManager = new BranchManager(this.db);
    this.pool = OrchestratorPool.getInstance(this.branchManager, this.db);
    this.scheduler = Scheduler.getInstance();
    this.epics = new DatabaseEpicRepository(this.db);
    this.projects = new DatabaseProjectRepository(this.db);
    this.pipelineStateStore = new PipelineStateStore(this.db);
    this.healthMonitor = new ClaudeHealthMonitor();
    this.codexHealthMonitor = new CodexHealthMonitor();
    this.serverProcess = new ServerProcess();
  }

  static getInstance(): AngyEngine {
    if (!_instance) {
      _instance = new AngyEngine();
    }
    return _instance;
  }

  /** Reset singleton (for testing). */
  static resetInstance(): void {
    _instance = null;
    OrchestratorPool.resetInstance();
  }

  isInitialized(): boolean {
    return this._initialized;
  }

  // ── Initialization / Shutdown ──────────────────────────────────────

  async initialize(dbPath?: string, options?: { primaryWindow?: boolean }): Promise<void> {
    if (this._initialized) return;

    const isPrimary = options?.primaryWindow ?? true;

    // 1. Open database
    const ok = await this.db.open(dbPath);
    if (!ok) throw new Error('Failed to open database');

    // 2. Load persisted data
    await this.sessions.loadFromDatabase();
    if (isPrimary) {
      await this.sessions.deleteStalePendingSessions();
    }
    await (this.epics as DatabaseEpicRepository).reload();
    await (this.projects as DatabaseProjectRepository).reload();

    // All windows need DB access on the scheduler (for config read/write)
    this.scheduler.setDatabase(this.db);

    // Primary-only: wire orchestration, scheduler, lifecycle, and server
    if (isPrimary) {
      // 3. Wire orchestrator pool
      this.pool.setOrchestratorFactory(
        (epicId, options, epic, repos) => this.spawnEpicOrchestrator(epicId, options, epic, repos),
      );
      this.pool.setResumeFactory(
        (epicId, epic, repos) => this.resumeHybridPipeline(epicId, epic, repos),
      );

      // 4. Wire scheduler (but don't initialize — caller decides when to start)
      this.scheduler.setPool(this.pool);
      this.scheduler.setRepositories(this.epics, this.projects);

      // 5. Listen for epic lifecycle events
      this.wireEpicLifecycleEvents();

      // 6. Reconcile orphaned worktrees
      await this.reconcileWorktrees();

      // 7. Start angycode-server (non-blocking — Gemini models unavailable if this fails)
      try {
        await this.serverProcess.start();
        this.acpm = new AngyCodeProcessManager(this.db);
        this.acpm.setBaseUrl(this.serverProcess.getBaseUrl());
        setAngyCodeProcessManager(this.acpm);
        // Persist the server URL so secondary windows can connect
        await this.db.setAppSetting('angycode_server_url', this.serverProcess.getBaseUrl());
        console.log('[AngyEngine] angycode-server started at', this.serverProcess.getBaseUrl());
      } catch (err) {
        console.error('[AngyEngine] Failed to start angycode-server — Gemini models will be unavailable:', err);
      }
    } else {
      // Secondary window: connect to the existing angycode-server started by the primary window
      try {
        const serverUrl = await this.db.getAppSetting('angycode_server_url');
        if (serverUrl) {
          // Verify the server is reachable before wiring up
          const healthRes = await fetch(`${serverUrl}/health`).catch(() => null);
          if (healthRes && healthRes.ok) {
            this.acpm = new AngyCodeProcessManager(this.db);
            this.acpm.setBaseUrl(serverUrl);
            setAngyCodeProcessManager(this.acpm);
            console.log('[AngyEngine] Secondary window connected to angycode-server at', serverUrl);
          } else {
            console.warn('[AngyEngine] angycode-server not reachable at', serverUrl, '— Gemini models will be unavailable in this window');
          }
        }
      } catch (err) {
        console.warn('[AngyEngine] Secondary window failed to connect to angycode-server:', err);
      }
    }

    this._initialized = true;
    console.log(`[AngyEngine] Initialized (${isPrimary ? 'primary' : 'secondary'} window)`);
  }

  async shutdown(): Promise<void> {
    await this.scheduler.stop();
    this.healthMonitor.cancel();
    this.codexHealthMonitor.cancel();
    for (const runner of this.hybridRunners.values()) {
      runner.cancel();
    }
    this.hybridRunners.clear();
    // Clear persisted server URL before stopping, so secondary windows don't find a stale URL
    if (this.serverProcess.isRunning()) {
      await this.db.setAppSetting('angycode_server_url', '').catch(() => {});
    }
    await this.serverProcess.stop();
    await this.db.close();
    this._initialized = false;
    console.log('[AngyEngine] Shut down');
  }

  // ── Agent execution ────────────────────────────────────────────────

  /**
   * Run a single agent (non-orchestrator) message.
   * Returns the ClaudeProcess. The handle receives all streaming output.
   */
  runAgent(
    sessionId: string,
    message: string,
    handle: AgentHandle,
    options: ProcessOptions,
  ) {
    return this.processes.sendMessage(sessionId, message, handle, options);
  }

  private selectHealthMonitor(model?: string): ClaudeHealthMonitor | CodexHealthMonitor {
    return model?.startsWith('codex-') ? this.codexHealthMonitor : this.healthMonitor;
  }

  cancelAgent(sessionId: string): void {
    this.processes.cancelProcess(sessionId);
  }

  // ── Epic orchestration ─────────────────────────────────────────────

  /**
   * Start orchestration for an epic. Called by the scheduler or manually.
   * Routes ALL pipeline types through HybridPipelineRunner.
   */
  private async spawnEpicOrchestrator(
    epicId: string,
    options: OrchestratorOptions,
    epic: Epic,
    repos: ProjectRepo[],
  ): Promise<string> {
    console.log(`[AngyEngine] Spawning pipeline for epic: ${epicId} ("${epic.title}")`);
    return this.runHybridPipeline(epicId, options, epic, repos);
  }

  /** Cancel an epic's orchestration — kills all processes and releases resources. */
  async cancelEpicOrchestration(epicId: string): Promise<void> {
    // 1. Kill all running processes for this epic (root + children)
    const sessionIds = this.pool.getSessionsForEpic(epicId);
    for (const sid of sessionIds) {
      if (this.acpm?.isRunning(sid)) {
        this.acpm.cancel(sid);
      } else {
        this.processes.cancelProcess(sid);
      }
    }

    // 2. Cancel the hybrid runner state machine
    const runner = this.hybridRunners.get(epicId);
    if (runner) {
      runner.cancel();
      this.hybridRunners.delete(epicId);
    }

    // 3. Restore repos to default branch (for branch-ON epics)
    await this.restoreReposForEpic(epicId);

    // 4. Release repo locks and clean up pool tracking
    this.scheduler.releaseRepos(epicId);
    await this.pool.removeEpic(epicId);

    console.log(`[AngyEngine] Cancelled epic orchestration: ${epicId}, killed ${sessionIds.length} session(s)`);
  }

  /**
   * Suspend an epic's orchestration — gracefully stop while preserving checkpoint
   * so it can be resumed later. Unlike cancel, does NOT restore repos to default branch.
   */
  async suspendEpicOrchestration(epicId: string): Promise<void> {
    // 1. Kill all running processes for this epic (root + children)
    const sessionIds = this.pool.getSessionsForEpic(epicId);
    for (const sid of sessionIds) {
      if (this.acpm?.isRunning(sid)) {
        this.acpm.cancel(sid);
      } else {
        this.processes.cancelProcess(sid);
      }
    }

    // 2. Cancel hybrid runner (forces a final checkpoint)
    const runner = this.hybridRunners.get(epicId);
    if (runner) {
      runner.cancel();
      this.hybridRunners.delete(epicId);
    }

    // 3. Do NOT restore repos — keep the working branch intact for resume

    // 4. Release repo locks and clean up pool tracking
    this.scheduler.releaseRepos(epicId);
    await this.pool.removeEpic(epicId);

    // 5. Set suspendedAt and move epic to todo
    const now = new Date().toISOString();
    await this.epics.updateEpic(epicId, { suspendedAt: now, column: 'todo' as EpicColumn });
    this.emitEpicUpdated(epicId);

    console.log(`[AngyEngine] Suspended epic orchestration: ${epicId}, killed ${sessionIds.length} session(s)`);
  }

  activeEpicCount(): number {
    return this.hybridRunners.size;
  }

  // ── Convenience: Project CRUD ──────────────────────────────────────

  async createProject(name: string, description = ''): Promise<Project> {
    const project: Project = {
      id: crypto.randomUUID(),
      name,
      description,
      color: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.db.saveProject(project);
    await (this.projects as DatabaseProjectRepository).reload();
    return project;
  }

  async deleteProject(id: string): Promise<void> {
    await this.db.deleteProject(id);
    await (this.projects as DatabaseProjectRepository).reload();
    await (this.epics as DatabaseEpicRepository).reload();
  }

  async addRepo(projectId: string, path: string, name: string, defaultBranch = 'main'): Promise<ProjectRepo> {
    const repo: ProjectRepo = {
      id: crypto.randomUUID(),
      projectId,
      path,
      name,
      defaultBranch,
    };
    await this.db.saveProjectRepo({ ...repo, projectId });
    await (this.projects as DatabaseProjectRepository).reload();
    return repo;
  }

  async removeRepo(repoId: string): Promise<void> {
    await this.db.deleteProjectRepo(repoId);
    await (this.projects as DatabaseProjectRepository).reload();
  }

  // ── Convenience: Epic CRUD ─────────────────────────────────────────

  async createEpic(
    projectId: string,
    title: string,
    opts?: Partial<Pick<Epic, 'description' | 'acceptanceCriteria' | 'priorityHint' | 'complexity' | 'model' | 'targetRepoIds' | 'dependsOn' | 'pipelineType' | 'useWorktree' | 'baseBranch'>>,
  ): Promise<Epic> {
    const now = new Date().toISOString();
    const epic: Epic = {
      id: crypto.randomUUID(),
      projectId,
      title,
      description: opts?.description ?? '',
      acceptanceCriteria: opts?.acceptanceCriteria ?? '',
      column: 'idea',
      priorityHint: opts?.priorityHint ?? 'medium',
      complexity: opts?.complexity ?? 'medium',
      model: opts?.model ?? '',
      targetRepoIds: opts?.targetRepoIds ?? [],
      pipelineType: opts?.pipelineType ?? 'hybrid',
      useGitBranch: false,
      useWorktree: opts?.useWorktree ?? false,
      baseBranch: opts?.baseBranch ?? null,
      dependsOn: opts?.dependsOn ?? [],
      runAfter: null,
      rejectionCount: 0,
      rejectionFeedback: '',
      lastAttemptFiles: [],
      lastValidationResults: [],
      lastArchitectPlan: '',
      computedScore: 0,
      rootSessionId: null,
      costTotal: 0,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
      suspendedAt: null,
    };
    await this.epics.saveEpic(epic);
    return epic;
  }

  async moveEpic(id: string, column: EpicColumn): Promise<void> {
    await this.epics.moveEpic(id, column);
  }

  async deleteEpic(id: string): Promise<void> {
    await this.branchManager.deleteEpicBranches(id);
    await this.epics.deleteEpic(id);
  }

  // ── Hybrid pipeline (coded state machine) ──────────────────────────

  private async runHybridPipeline(
    epicId: string,
    options: OrchestratorOptions,
    epic: Epic,
    repos: ProjectRepo[],
  ): Promise<string> {
    console.log(`[AngyEngine] Running hybrid pipeline for epic: ${epicId} ("${epic.title}")`);

    const handle = new HeadlessHandle(this.db, this.sessions.manager);
    handle.onPersistSession = (sid) => {
      this.sessions.persistSession(sid);
    };

    // Compute workspace: prefer worktree paths from options.repoPaths (set by OrchestratorPool)
    let workspace: string;
    const effectivePaths = repos.map(r => options.repoPaths[r.id] || r.path).filter(Boolean);
    if (effectivePaths.length === 0) {
      workspace = '.';
    } else if (effectivePaths.length === 1) {
      workspace = effectivePaths[0];
    } else {
      const segments = effectivePaths.map(p => p.split('/'));
      const commonParts: string[] = [];
      for (let i = 0; i < segments[0].length; i++) {
        const seg = segments[0][i];
        if (segments.every(s => s[i] === seg)) commonParts.push(seg);
        else break;
      }
      workspace = commonParts.join('/') || '/';
    }

    const detectedProfiles = await detectTechnologies(workspace);

    // Determine pipeline type and rejection context
    const hasRejection = epic.rejectionCount > 0 && !!epic.rejectionFeedback;
    const pipelineType = (hasRejection && (epic.pipelineType === 'hybrid' || epic.pipelineType === 'fix'))
      ? 'fix' as const
      : epic.pipelineType;
    const rejectionContext = hasRejection ? {
      feedback: epic.rejectionFeedback!,
      lastAttemptFiles: epic.lastAttemptFiles,
      lastValidationResults: epic.lastValidationResults,
      lastArchitectPlan: epic.lastArchitectPlan,
    } : undefined;

    const runner = new HybridPipelineRunner({
      handle,
      processes: this.processes,
      acpm: this.acpm ?? undefined,
      sessions: this.sessions,
      workspace,
      model: epic.model || undefined,
      epicId,
      autoProfiles: detectedProfiles,
      complexity: epic.complexity,
      pipelineConfig: epic.pipelineConfig,
      stateStore: this.pipelineStateStore,
      healthMonitor: this.selectHealthMonitor(epic.model || undefined),
      pipelineType,
      rejectionContext,
    });

    // Create a root session for the pipeline
    const rootSid = await this.sessions.createSession(workspace, 'orchestrator');
    const rootInfo = this.sessions.getSession(rootSid);
    if (rootInfo) {
      rootInfo.epicId = epicId;
      rootInfo.title = epic.title;
    }
    await this.sessions.persistSession(rootSid);
    runner.setRootSessionId(rootSid);
    engineBus.emit('session:created', { sessionId: rootSid });

    // Wire pipeline events to engine bus
    runner.on('phaseChanged', (e) => {
      engineBus.emit('epic:phaseChanged', { epicId, phase: e.phase });
    });
    runner.on('delegationStarted', (e) => {
      engineBus.emit('orchestrator:delegationStarted', {
        role: e.role,
        task: e.task,
        parentSessionId: e.parentSessionId,
      });
    });
    runner.on('completed', (e) => {
      this.hybridRunners.delete(epicId);
      engineBus.emit('epic:completed', { epicId, summary: e.summary });
    });
    runner.on('failed', (e) => {
      this.hybridRunners.delete(epicId);
      engineBus.emit('epic:failed', { epicId, reason: e.reason });
    });
    runner.on('artifactsCollected', async (e) => {
      try {
        const fileSet = new Set<string>();
        for (const child of e.childOutputs) {
          const matches = child.output.match(/(?:^|\s)((?:src|lib|app|test|tests)\/[\w/.-]+\.\w+)/gm);
          if (matches) {
            for (const m of matches) fileSet.add(m.trim());
          }
        }
        const architectOutput = e.childOutputs.find(c => c.role === 'architect');
        await this.epics.updateEpic(epicId, {
          lastAttemptFiles: Array.from(fileSet).slice(0, 50),
          lastValidationResults: [],
          lastArchitectPlan: architectOutput?.output || '',
        });
        this.emitEpicUpdated(epicId);
      } catch (err) {
        console.error(`[AngyEngine] Failed to persist hybrid artifacts for epic ${epicId}:`, err);
      }
    });

    this.hybridRunners.set(epicId, runner);

    // Build goal
    const repoLines = repos.map(r => `- ${r.name}: ${r.path}`).join('\n');
    const goal =
      `# Epic: ${epic.title}\n\n` +
      `## Description\n${epic.description}\n\n` +
      `## Target Repos\n${repoLines || '(none)'}\n\n` +
      `**Important:** Only work within the listed repositories above.`;

    // Run in background (don't await — let it run asynchronously)
    runner.run(goal, epic.acceptanceCriteria).catch(err => {
      console.error(`[AngyEngine] Hybrid pipeline crashed for ${epicId}:`, err);
      this.hybridRunners.delete(epicId);
      engineBus.emit('epic:failed', { epicId, reason: err?.message || String(err) });
    });

    return rootSid;
  }

  // ── Pipeline recovery (resume from crash) ────────────────────────

  /**
   * Attempt to resume a hybrid pipeline for an epic from its persisted snapshot.
   * Returns the root session ID if resume succeeded, null if no snapshot found.
   */
  async resumeHybridPipeline(
    epicId: string,
    epic: Epic,
    _repos: ProjectRepo[],
  ): Promise<string | null> {
    const snapshot = await this.pipelineStateStore.load(epicId);
    if (!snapshot || !this.pipelineStateStore.isResumable(snapshot)) {
      console.log(`[AngyEngine] No resumable snapshot for epic ${epicId}`);
      return null;
    }

    const doneTodos = snapshot.todoQueue.filter(t => t.status === 'done').length;
    const totalTodos = snapshot.todoQueue.length;
    console.log(`[AngyEngine] Resuming hybrid pipeline for epic ${epicId}: phase=${snapshot.phase}, todos=${doneTodos}/${totalTodos}`);

    const handle = new HeadlessHandle(this.db, this.sessions.manager);
    handle.onPersistSession = (sid) => {
      this.sessions.persistSession(sid);
    };

    // Resolve workspace: prefer worktree path from branch records over snapshot
    let workspace = snapshot.workspace;
    const branches = await this.branchManager.getEpicBranches(epicId);
    const wtBranch = branches.find(b => b.worktreePath && b.status === 'active');
    if (wtBranch) {
      workspace = wtBranch.worktreePath!;
      console.log(`[AngyEngine] Resume: overriding workspace with worktree path: ${workspace}`);
    }
    const detectedProfiles = await detectTechnologies(workspace);

    const runner = new HybridPipelineRunner({
      handle,
      processes: this.processes,
      acpm: this.acpm ?? undefined,
      sessions: this.sessions,
      workspace,
      model: snapshot.model || epic.model || undefined,
      epicId,
      autoProfiles: detectedProfiles,
      complexity: epic.complexity,
      pipelineConfig: epic.pipelineConfig,
      stateStore: this.pipelineStateStore,
      healthMonitor: this.selectHealthMonitor(snapshot.model || epic.model || undefined),
    });

    const rootSid = await this.sessions.createSession(workspace, 'orchestrator');
    const rootInfo = this.sessions.getSession(rootSid);
    if (rootInfo) {
      rootInfo.epicId = epicId;
      rootInfo.title = epic.title;
    }
    await this.sessions.persistSession(rootSid);
    runner.setRootSessionId(rootSid);
    engineBus.emit('session:created', { sessionId: rootSid });

    runner.on('phaseChanged', (e) => {
      engineBus.emit('epic:phaseChanged', { epicId, phase: e.phase });
    });
    runner.on('delegationStarted', (e) => {
      engineBus.emit('orchestrator:delegationStarted', {
        role: e.role,
        task: e.task,
        parentSessionId: e.parentSessionId,
      });
    });
    runner.on('completed', (e) => {
      this.hybridRunners.delete(epicId);
      engineBus.emit('epic:completed', { epicId, summary: e.summary });
    });
    runner.on('failed', (e) => {
      this.hybridRunners.delete(epicId);
      engineBus.emit('epic:failed', { epicId, reason: e.reason });
    });
    runner.on('artifactsCollected', async (e) => {
      try {
        const fileSet = new Set<string>();
        for (const child of e.childOutputs) {
          const matches = child.output.match(/(?:^|\s)((?:src|lib|app|test|tests)\/[\w/.-]+\.\w+)/gm);
          if (matches) {
            for (const m of matches) fileSet.add(m.trim());
          }
        }
        const architectOutput = e.childOutputs.find(c => c.role === 'architect');
        await this.epics.updateEpic(epicId, {
          lastAttemptFiles: Array.from(fileSet).slice(0, 50),
          lastValidationResults: [],
          lastArchitectPlan: architectOutput?.output || '',
        });
        this.emitEpicUpdated(epicId);
      } catch (err) {
        console.error(`[AngyEngine] Failed to persist hybrid artifacts for epic ${epicId}:`, err);
      }
    });

    this.hybridRunners.set(epicId, runner);

    runner.resume(snapshot).catch(err => {
      console.error(`[AngyEngine] Hybrid pipeline resume crashed for ${epicId}:`, err);
      this.hybridRunners.delete(epicId);
      engineBus.emit('epic:failed', { epicId, reason: err?.message || String(err) });
    });

    return rootSid;
  }

  // ── Scheduler control ──────────────────────────────────────────────

  startScheduler(): void {
    this.scheduler.start();
  }

  async stopScheduler(): Promise<void> {
    await this.scheduler.stop();
  }

  // ── Private: event wiring ──────────────────────────────────────────

  private emitEpicUpdated(epicId: string): void {
    const epic = this.epics.getEpic(epicId);
    if (epic) {
      engineBus.emit('epic:updated', { epicId, epic: structuredClone(epic) });
    }
  }

  /**
   * For branch-ON epics: commit any uncommitted work and restore the default branch.
   * For branch-OFF (tracking) epics: no-op — user manages git.
   */
  async restoreReposForEpic(epicId: string): Promise<void> {
    const epic = this.epics.getEpic(epicId);
    const branches = await this.branchManager.getEpicBranches(epicId);

    for (const branch of branches) {
      if (branch.status !== 'active') continue;

      const repo = await this.db.loadProjectRepo(branch.repoId);
      if (!repo) continue;

      if (branch.worktreePath) {
        // Worktree: commit work inside the worktree directory, don't touch main repo
        await this.branchManager.commitEpicWork(branch.worktreePath, epic?.title ?? epicId);
      } else {
        // Checkout-based: commit and restore base branch in main repo
        await this.branchManager.commitEpicWork(repo.path, epic?.title ?? epicId);
        await this.branchManager.restoreBranch(repo.path, branch.baseBranch);
      }
    }
  }

  // ── Worktree cleanup ──────────────────────────────────────────────

  private hasRunAfterSuccessor(epicId: string): boolean {
    const allEpics = this.epics.listEpics();
    return allEpics.some(e =>
      e.runAfter === epicId && e.column !== 'done' && e.column !== 'discarded',
    );
  }

  private async cleanupWorktreesForEpic(epicId: string): Promise<void> {
    if (this.hasRunAfterSuccessor(epicId)) {
      console.log(`[AngyEngine] Skipping worktree cleanup for ${epicId} — has runAfter successor`);
      return;
    }

    const branches = await this.branchManager.getEpicBranches(epicId);
    for (const branch of branches) {
      if (!branch.worktreePath) continue;
      const repo = await this.db.loadProjectRepo(branch.repoId);
      if (!repo) continue;
      await this.branchManager.removeWorktree(repo.path, branch.worktreePath);
    }
  }

  async reconcileWorktrees(): Promise<void> {
    try {
      const allBranches = await this.db.loadAllEpicBranches();
      const knownWorktreePaths = new Set(
        allBranches.filter(b => b.worktreePath).map(b => b.worktreePath!),
      );

      const allProjects = this.projects.listProjects();
      const allRepos: ProjectRepo[] = [];
      for (const proj of allProjects) {
        allRepos.push(...this.projects.reposByProjectId(proj.id));
      }
      for (const repo of allRepos) {
        const worktrees = await this.branchManager.listWorktrees(repo.path);
        for (const wt of worktrees) {
          // Skip the main repo itself
          if (wt === repo.path) continue;
          if (!knownWorktreePaths.has(wt)) {
            console.log(`[AngyEngine] reconcileWorktrees: removing orphan ${wt}`);
            await this.branchManager.removeWorktree(repo.path, wt);
          }
        }
      }
    } catch (err) {
      console.warn('[AngyEngine] reconcileWorktrees error:', err);
    }
  }

  private wireEpicLifecycleEvents(): void {
    // When an epic completes, commit work in the worktree/branch then move to review.
    // Worktrees are kept alive so the user can test during review.
    engineBus.on('epic:completed', async ({ epicId }) => {
      try {
        await this.restoreReposForEpic(epicId);
      } catch (err) {
        console.error(`[AngyEngine] restoreReposForEpic failed for ${epicId}:`, err);
      }
      try {
        await this.scheduler.moveToReview(epicId);
      } catch (err) {
        console.error(`[AngyEngine] moveToReview failed for ${epicId}, forcing pool cleanup:`, err);
        await this.pool.removeEpic(epicId).catch(() => {});
      }
      engineBus.emit('epic:storeSyncNeeded');
    });

    // When an epic fails, move it to review (as failed) so the user can inspect it.
    // rejectionFeedback is set so fix-mode kicks in if the user manually retries.
    engineBus.on('epic:failed', async ({ epicId, reason }) => {
      try {
        await this.restoreReposForEpic(epicId);
      } catch (err) {
        console.error(`[AngyEngine] restoreReposForEpic failed for ${epicId}:`, err);
      }
      try {
        await this.scheduler.moveToReviewFailed(epicId, `Agent failed: ${reason}`);
      } catch (err) {
        console.error(`[AngyEngine] moveToReviewFailed failed for ${epicId}, forcing pool cleanup:`, err);
        await this.pool.removeEpic(epicId).catch(() => {});
      }
      engineBus.emit('epic:storeSyncNeeded');
    });

    // Clean up worktrees when epic is approved via scheduler
    engineBus.on('epic:updated', async ({ epicId, epic }) => {
      if (epic.column === 'done' || epic.column === 'discarded') {
        try {
          await this.cleanupWorktreesForEpic(epicId);
        } catch (err) {
          console.error(`[AngyEngine] Failed to cleanup worktrees for epic ${epicId}:`, err);
        }
      }
    });

    // Clean up worktrees when epic is moved to done/discarded via UI (drag-and-drop)
    engineBus.on('epic:requestWorktreeCleanup', async ({ epicId }) => {
      try {
        console.log(`[AngyEngine] Worktree cleanup requested for epic ${epicId}`);
        await this.cleanupWorktreesForEpic(epicId);
      } catch (err) {
        console.error(`[AngyEngine] Failed to cleanup worktrees for epic ${epicId}:`, err);
      }
    });

    // Persist cost entries and accumulate epic cost totals
    engineBus.on('agent:costUpdate', async (data) => {
      try {
        // Resolve epicId: prefer event payload, fall back to pool lookup
        const epicId = data.epicId || this.pool.getEpicForSession(data.sessionId) || '';

        await this.db.saveCostEntry({
          sessionId: data.sessionId,
          epicId,
          costUsd: data.costUsd,
          inputTokens: data.inputTokens,
          outputTokens: data.outputTokens,
          timestamp: new Date().toISOString(),
        });

        // Update epic cost total if associated with an epic
        if (epicId) {
          const epic = this.epics.getEpic(epicId);
          if (epic) {
            await this.epics.updateEpic(epicId, {
              costTotal: (epic.costTotal ?? 0) + data.costUsd,
            });
            this.emitEpicUpdated(epicId);
          }

          // TODO: implement budget enforcement on HybridPipelineRunner
        }
      } catch (err) {
        console.error('[AngyEngine] Failed to persist cost entry:', err);
      }
    });
  }
}
