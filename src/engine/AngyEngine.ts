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
import { Orchestrator, SPECIALIST_PROMPTS, SPECIALIST_TOOLS } from './Orchestrator';
import type { OrchestratorChatPanelAPI } from './Orchestrator';
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

  // ── Epic orchestrators ─────────────────────────────────────────────
  private epicOrchestrators = new Map<string, Orchestrator>();

  private _initialized = false;

  private constructor() {
    this.db = new Database();
    this.sessions = new SessionService(this.db);
    this.processes = new ProcessManager();
    this.branchManager = new BranchManager(this.db);
    this.pool = OrchestratorPool.getInstance(this.branchManager);
    this.scheduler = Scheduler.getInstance();
    this.epics = new DatabaseEpicRepository(this.db);
    this.projects = new DatabaseProjectRepository(this.db);
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

  async initialize(dbPath?: string): Promise<void> {
    if (this._initialized) return;

    // 1. Open database
    const ok = await this.db.open(dbPath);
    if (!ok) throw new Error('Failed to open database');

    // 2. Load persisted data
    await this.sessions.loadFromDatabase();
    await this.sessions.deleteStalePendingSessions();
    await (this.epics as DatabaseEpicRepository).reload();
    await (this.projects as DatabaseProjectRepository).reload();

    // 3. Wire orchestrator pool
    this.pool.setOrchestratorFactory(
      (epicId, options, epic, repos) => this.spawnEpicOrchestrator(epicId, options, epic, repos),
    );

    // 4. Wire process manager → orchestrator lookup
    this.processes.setOrchestratorLookup(
      (sessionId) => this.getOrchestratorForSession(sessionId),
    );

    // 5. Wire scheduler (but don't initialize — caller decides when to start)
    this.scheduler.setPool(this.pool);
    this.scheduler.setDatabase(this.db);
    this.scheduler.setRepositories(this.epics, this.projects);

    // 6. Listen for epic lifecycle events
    this.wireEpicLifecycleEvents();

    this._initialized = true;
    console.log('[AngyEngine] Initialized');
  }

  async shutdown(): Promise<void> {
    await this.scheduler.stop();
    // Cancel all running processes
    for (const orch of this.epicOrchestrators.values()) {
      orch.cancel();
    }
    this.epicOrchestrators.clear();
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

  cancelAgent(sessionId: string): void {
    this.processes.cancelProcess(sessionId);
  }

  // ── Epic orchestration ─────────────────────────────────────────────

  /**
   * Start orchestration for an epic. Called by the scheduler or manually.
   * Creates an Orchestrator with a HeadlessHandle (no UI dependency).
   */
  private async spawnEpicOrchestrator(
    epicId: string,
    options: OrchestratorOptions,
    epic: Epic,
    repos: ProjectRepo[],
  ): Promise<string> {
    console.log(`[AngyEngine] Spawning orchestrator for epic: ${epicId} ("${epic.title}")`);

    const orch = new Orchestrator();
    orch.setEpicOptions(options);
    if (epic.rejectionCount > 0 && epic.rejectionFeedback) {
      orch.setPipelineType('fix');
    } else {
      orch.setPipelineType(epic.pipelineType);
    }
    this.wireOrchestratorEvents(orch, epicId);
    this.epicOrchestrators.set(epicId, orch);

    // Create a HeadlessHandle for this orchestrator
    const handle = new HeadlessHandle(this.db, this.sessions.manager);
    handle.onDelegateFinished = (childSid, result) => {
      this.sessions.persistSession(childSid);
      orch.onDelegateFinished(childSid, result);
    };
    handle.onPersistSession = (sid) => {
      this.sessions.persistSession(sid);
    };

    // Compute workspace as the common parent directory of all target repos
    let workspace: string;
    if (repos.length === 0) {
      workspace = '.';
    } else if (repos.length === 1) {
      workspace = repos[0].path || '.';
    } else {
      // Find common parent directory of all repo paths
      const paths = repos.map(r => r.path).filter(Boolean);
      if (paths.length === 0) {
        workspace = '.';
      } else if (paths.length === 1) {
        workspace = paths[0];
      } else {
        const segments = paths.map(p => p.split('/'));
        const commonParts: string[] = [];
        for (let i = 0; i < segments[0].length; i++) {
          const seg = segments[0][i];
          if (segments.every(s => s[i] === seg)) {
            commonParts.push(seg);
          } else {
            break;
          }
        }
        workspace = commonParts.join('/') || '/';
      }
    }

    // Build OrchestratorChatPanelAPI backed by HeadlessHandle + ProcessManager
    const panelAPI = this.buildHeadlessPanelAPI(handle, orch, workspace, epic.model || undefined);
    orch.setChatPanel(panelAPI);
    orch.setWorkspace(workspace);

    // Build goal message
    const repoLines = repos.map(r => `- ${r.name}: ${r.path}`).join('\n');
    let goal =
      `# Epic: ${epic.title}\n\n` +
      `## Description\n${epic.description}\n\n` +
      `## Acceptance Criteria (Definition of Done)\n${epic.acceptanceCriteria}\n\n` +
      `## Target Repos\n${repoLines || '(none)'}\n\n` +
      `**Important:** Only work within the listed repositories above. Do not explore or modify files outside these repo paths.\n\n`;

    if (epic.rejectionCount > 0 && epic.rejectionFeedback) {
      goal +=
        `## IMPORTANT: Previous Attempt Rejected (attempt #${epic.rejectionCount})\n` +
        `The previous implementation was reviewed and rejected. You MUST address the following feedback before anything else:\n\n` +
        `${epic.rejectionFeedback}\n\n`;

      // Include artifacts from the previous attempt
      if (epic.lastAttemptFiles && epic.lastAttemptFiles.length > 0) {
        goal += `### Files Modified in Previous Attempt\n`;
        for (const f of epic.lastAttemptFiles.slice(0, 30)) {
          goal += `- ${f}\n`;
        }
        goal += '\n';
      }
      if (epic.lastValidationResults && epic.lastValidationResults.length > 0) {
        goal += `### Validation Results from Previous Attempt\n`;
        for (const v of epic.lastValidationResults.slice(0, 10)) {
          goal += `- \`${v.command}\` — ${v.passed ? 'PASSED' : 'FAILED'}\n`;
          if (!v.passed && v.output) {
            goal += `  Output: ${v.output.substring(0, 300)}\n`;
          }
        }
        goal += '\n';
      }
      if (epic.lastArchitectPlan) {
        goal += `### Architect Plan from Previous Attempt\n${epic.lastArchitectPlan.slice(-4000)}\n\n`;
      }

      goal += `Start by using diagnose() to inspect the current state, then fix the issues described above.\n`;
    } else {
      goal += `Implement this epic end-to-end. Start by delegating to an architect to analyze the codebase and design the solution.`;
    }

    const sessionId = await orch.start(goal);

    const sessionInfo = this.sessions.getSession(sessionId);
    if (sessionInfo) {
      sessionInfo.epicId = epicId;
      await this.sessions.persistSession(sessionId);
      // Emit session:created so the Pinia store picks up the root
      // session immediately (with epicId already set)
      engineBus.emit('session:created', { sessionId });
    }

    console.log(`[AngyEngine] Epic orchestrator started: epic=${epicId}, session=${sessionId}`);
    return sessionId;
  }

  /**
   * Build an OrchestratorChatPanelAPI that uses HeadlessHandle + ProcessManager.
   * No Vue, no ChatPanel, no DOM dependency.
   */
  private buildHeadlessPanelAPI(
    handle: HeadlessHandle,
    _orch: Orchestrator,
    workspace: string,
    model?: string,
  ): OrchestratorChatPanelAPI {
    return {
      newChat: async (ws?: string) => {
        return this.sessions.createSession(ws || workspace, 'orchestrator');
      },

      configureSession: (sid: string, mode: string, _profileIds: string[]) => {
        const info = this.sessions.getSession(sid);
        if (info) {
          info.title = info.title || `${mode} session`;
        }
      },

      sendMessageToSession: async (sid: string, msg: string) => {
        await handle.prepareForSend(sid, msg);
        this.processes.sendMessage(sid, msg, handle, {
          workingDir: workspace,
          mode: 'orchestrator',
          model,
          systemPrompt: _orch.getSystemPrompt(),
          resumeSessionId: handle.getRealSessionId(sid) || undefined,
          epicEnabled: !!_orch.getEpicOptions(),
          autoCommit: _orch.isAutoCommitEnabled(),
        });
      },

      delegateToChild: async (
        parentSessionId: string,
        task: string,
        context: string,
        specialistProfileId: string,
        contextProfileIds: string[],
        agentName?: string,
        teamId?: string,
        teammates?: string[],
        workingDir?: string,
      ) => {
        const resolvedDir = workingDir || workspace;

        const childSid = this.sessions.manager.createChildSession(
          parentSessionId, resolvedDir, 'agent', task,
        );
        const childInfo = this.sessions.getSession(childSid);

        if (childInfo) {
          if (agentName) {
            childInfo.title = agentName.charAt(0).toUpperCase() + agentName.slice(1);
          }
          const epicId = this.pool.getEpicForSession(parentSessionId);
          if (epicId) {
            childInfo.epicId = epicId;
          }
        }

        await this.sessions.persistSession(childSid);
        engineBus.emit('session:created', { sessionId: childSid, parentSessionId });

        // Build system prompt: specialist identity + orchestrator context + team coordination
        const promptParts: string[] = [];

        const role = specialistProfileId.replace('specialist-', '');
        const specialistPrompt = SPECIALIST_PROMPTS[role];
        if (specialistPrompt) {
          promptParts.push(specialistPrompt);
        }

        if (context) {
          const truncated = context.length > 4000
            ? context.substring(0, 4000) + '\n...(truncated)'
            : context;
          promptParts.push(`## Context from orchestrator\n${truncated}`);
        }

        if (teammates?.length && agentName) {
          promptParts.push(
            `Your agent name is "${agentName}". ` +
            `You are on a team with: ${teammates.join(', ')}. ` +
            `Use send_message(to, content) and check_inbox() to coordinate.`,
          );
        }

        const toolList = SPECIALIST_TOOLS[role];
        if (toolList) {
          promptParts.push(`\nYou have access to these tools: ${toolList}. Use only these tools.`);
        }

        const systemPrompt = promptParts.join('\n\n');

        this.processes.sendMessage(childSid, task, handle, {
          workingDir: resolvedDir,
          mode: 'agent',
          model,
          systemPrompt,
          agentName,
          teamId,
          profileIds: contextProfileIds.length > 0 ? contextProfileIds : undefined,
          specialistRole: role,
        });

        return childSid;
      },

      cancelChild: (sessionId: string) => {
        this.processes.cancelProcess(sessionId);
      },

      sessionFinalOutput: (sid: string) => {
        return handle.getLastAssistantContent(sid);
      },
    };
  }

  // ── Orchestrator lookup ────────────────────────────────────────────

  /** Find the Orchestrator instance responsible for a given session ID. */
  getOrchestratorForSession(sessionId: string): Orchestrator | null {
    // Check epic orchestrators
    for (const [_epicId, orch] of this.epicOrchestrators) {
      if (orch.isRunning() && orch.sessionId() === sessionId) {
        return orch;
      }
    }
    // Check pool for sub-orchestrator sessions
    const epicId = this.pool.getEpicForSession(sessionId);
    if (epicId) {
      return this.epicOrchestrators.get(epicId) ?? null;
    }
    return null;
  }

  /** Cancel an epic's orchestration — kills all processes and releases resources. */
  async cancelEpicOrchestration(epicId: string): Promise<void> {
    // 1. Kill all running processes for this epic (root + children)
    const sessionIds = this.pool.getSessionsForEpic(epicId);
    for (const sid of sessionIds) {
      this.processes.cancelProcess(sid);
    }

    // 2. Cancel the orchestrator state machine
    const orch = this.epicOrchestrators.get(epicId);
    if (orch) {
      orch.cancel();
      this.epicOrchestrators.delete(epicId);
    }

    // 3. Restore repos to default branch (for branch-ON epics)
    await this.restoreReposForEpic(epicId);

    // 4. Release repo locks and clean up pool tracking
    this.scheduler.releaseRepos(epicId);
    await this.pool.removeEpic(epicId);

    console.log(`[AngyEngine] Cancelled epic orchestration: ${epicId}, killed ${sessionIds.length} session(s)`);
  }

  activeEpicCount(): number {
    return this.epicOrchestrators.size;
  }

  // ── Convenience: Project CRUD ──────────────────────────────────────

  async createProject(name: string, description = ''): Promise<Project> {
    const project: Project = {
      id: crypto.randomUUID(),
      name,
      description,
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
    opts?: Partial<Pick<Epic, 'description' | 'acceptanceCriteria' | 'priorityHint' | 'complexity' | 'model' | 'targetRepoIds' | 'dependsOn' | 'pipelineType'>>,
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
      pipelineType: opts?.pipelineType ?? 'create',
      useGitBranch: false,
      dependsOn: opts?.dependsOn ?? [],
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

  // ── Scheduler control ──────────────────────────────────────────────

  startScheduler(): void {
    this.scheduler.start();
  }

  async stopScheduler(): Promise<void> {
    await this.scheduler.stop();
  }

  // ── Private: event wiring ──────────────────────────────────────────

  private wireOrchestratorEvents(orch: Orchestrator, epicId: string): void {
    orch.on('phaseChanged', (e) => {
      engineBus.emit('epic:phaseChanged', { epicId, phase: e.phase });
    });
    orch.on('delegationStarted', (e) => {
      engineBus.emit('orchestrator:delegationStarted', {
        role: e.role,
        task: e.task,
        parentSessionId: e.parentSessionId,
      });
    });
    orch.on('completed', (e) => {
      this.epicOrchestrators.delete(epicId);
      engineBus.emit('epic:completed', { epicId, summary: e.summary });
    });
    orch.on('failed', (e) => {
      this.epicOrchestrators.delete(epicId);
      engineBus.emit('epic:failed', { epicId, reason: e.reason });
    });
    orch.on('subOrchestratorSpawned', (e) => {
      engineBus.emit('epic:subOrchestratorSpawned', e);
    });
    orch.on('checkpointCreated', (e) => {
      engineBus.emit('orchestrator:checkpointCreated', {
        hash: e.hash,
        message: e.message,
      });
    });

    orch.on('artifactsCollected', async (e) => {
      try {
        // Extract file list from child outputs (look for common file path patterns)
        const fileSet = new Set<string>();
        for (const child of e.childOutputs) {
          const matches = child.output.match(/(?:^|\s)((?:src|lib|app|test|tests)\/[\w/.-]+\.\w+)/gm);
          if (matches) {
            for (const m of matches) fileSet.add(m.trim());
          }
        }

        // Extract architect plan from architect child outputs
        const architectOutput = e.childOutputs.find(c => c.role === 'architect');
        const architectPlan = architectOutput?.output.substring(0, 3000) || '';

        await this.epics.updateEpic(epicId, {
          lastAttemptFiles: Array.from(fileSet).slice(0, 50),
          lastValidationResults: [],
          lastArchitectPlan: architectPlan,
        });
        this.emitEpicUpdated(epicId);
      } catch (err) {
        console.error(`[AngyEngine] Failed to persist artifacts for epic ${epicId}:`, err);
      }
    });
  }

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

      await this.branchManager.commitEpicWork(repo.path, epic?.title ?? epicId);
      await this.branchManager.restoreBranch(repo.path, branch.baseBranch);
    }
  }

  private wireEpicLifecycleEvents(): void {
    // When an epic completes, restore repos then move to review
    engineBus.on('epic:completed', async ({ epicId }) => {
      try {
        await this.restoreReposForEpic(epicId);
        await this.scheduler.moveToReview(epicId);
      } catch (err) {
        console.error(`[AngyEngine] Failed to move epic ${epicId} to review:`, err);
      }
      engineBus.emit('epic:storeSyncNeeded');
    });

    // When an epic fails, restore repos then move back to todo
    engineBus.on('epic:failed', async ({ epicId, reason }) => {
      try {
        await this.restoreReposForEpic(epicId);
        await this.scheduler.rejectEpic(epicId, `Agent failed: ${reason}`);
      } catch (err) {
        console.error(`[AngyEngine] Failed to reject epic ${epicId}:`, err);
      }
      engineBus.emit('epic:storeSyncNeeded');
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
        }
      } catch (err) {
        console.error('[AngyEngine] Failed to persist cost entry:', err);
      }
    });
  }
}
