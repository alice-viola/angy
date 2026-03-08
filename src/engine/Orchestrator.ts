import mitt from 'mitt';
import { Command } from '@tauri-apps/plugin-shell';
import type { OrchestratorOptions } from './KosTypes';

// ── Orchestrator Command (parsed from MCP tool calls) ────────────────────────

export interface OrchestratorCommand {
  action: 'delegate' | 'validate' | 'done' | 'fail' | 'checkpoint' | 'spawn_orchestrator' | 'diagnose' | 'unknown';
  role?: string;
  task?: string;
  command?: string;
  description?: string;
  summary?: string;
  reason?: string;
  message?: string;
  working_dir?: string;
  diagnoseAction?: string;
  target?: string;
}

// ── Pending Child (parallel delegation tracking) ─────────────────────────────

export interface PendingChild {
  sessionId: string;
  role: string;
  agentName: string; // e.g. "implementer-2"
  completed: boolean;
  output: string;
  workingDir?: string;
}

// ── Events ───────────────────────────────────────────────────────────────────

export type OrchestratorEvents = {
  phaseChanged: { phase: string };
  delegationStarted: { role: string; task: string; parentSessionId?: string };
  subOrchestratorSpawned: { task: string; depth: number; epicId: string };
  validationStarted: { command: string };
  validationResult: { passed: boolean; output: string };
  completed: { summary: string };
  failed: { reason: string };
  retrying: { reason: string; attempt: number };
  progressUpdate: { message: string };
  peerMessageSent: { from: string; to: string; content: string };
  checkpointCreated: { hash: string; message: string };
  artifactsCollected: {
    validations: Array<{ command: string; passed: boolean; output: string }>;
    childOutputs: Array<{ role: string; agentName: string; output: string }>;
  };
};

// ── ChatPanel interface (decouples from Vue component) ───────────────────────

export interface OrchestratorChatPanelAPI {
  newChat(workspace?: string): string | Promise<string>;
  configureSession(sessionId: string, mode: string, profileIds: string[]): void;
  sendMessageToSession(sessionId: string, message: string): void | Promise<void>;
  delegateToChild(
    parentSessionId: string,
    task: string,
    context: string,
    specialistProfileId: string,
    contextProfileIds: string[],
    agentName?: string,
    teamId?: string,
    teammates?: string[],
    workingDir?: string,
  ): string | Promise<string>;
  cancelChild?(sessionId: string): void;
  sessionFinalOutput(sessionId: string): string;
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

// ── Specialist identity prompts (used as system prompt for child agents) ──

export const SPECIALIST_PROMPTS: Record<string, string> = {
  architect:
    'You are a software architect. Analyze requirements, design solutions, identify risks, ' +
    'and produce detailed implementation plans. Do NOT write code — focus on design.',
  implementer:
    'You are a senior software engineer. Write clean, production-quality code following best practices. ' +
    'Focus on correctness, readability, and minimal complexity.',
  reviewer:
    'You are a code reviewer. Review code for bugs, security issues, performance problems, and style. ' +
    'Provide specific, actionable feedback with line references.',
  tester:
    'You are a QA engineer. Write comprehensive tests covering edge cases, error conditions, and happy paths. ' +
    'Focus on meaningful test coverage.',
  debugger:
    'You are a debugging specialist. Given an error, test failure, or rejection feedback, systematically ' +
    'investigate the codebase to identify the root cause. Read the relevant files, trace the logic, and ' +
    'produce a precise diagnosis with exact file paths and line numbers. Do NOT fix the code — only diagnose.',
};

// ── Tool restriction sets per specialist role (Phase 4.2: sandboxing) ────

export const SPECIALIST_TOOLS: Record<string, string> = {
  architect: 'Read,Glob,Grep,Task',
  implementer: 'Bash,Read,Edit,Write,Glob,Grep,Task',
  reviewer: 'Read,Glob,Grep',
  tester: 'Bash,Read,Edit,Write,Glob,Grep,Task',
  debugger: 'Bash,Read,Glob,Grep',
};

/**
 * System prompt for orchestrator sessions.
 * Passed via --append-system-prompt to guide Claude to use MCP tools exclusively.
 */
export const ORCHESTRATOR_SYSTEM_PROMPT =
  `You are an autonomous project orchestrator. You receive a high-level goal and must ` +
  `break it down into steps, delegate work to specialist agents, validate results, ` +
  `and iterate until the goal is fully achieved.\n\n` +
  `# CRITICAL: Every response MUST include a tool call\n\n` +
  `You MUST call exactly one of the provided MCP tools in EVERY response. ` +
  `You may include brief reasoning text before the tool call, but the tool call is MANDATORY. ` +
  `A response with ONLY text and no tool call is an error.\n\n` +
  `Available tools (these are the ONLY tools you can use):\n` +
  `- delegate(role, task, working_dir?) — Assign work to a specialist agent.\n` +
  `  Roles: architect (designs/plans), implementer (writes code), reviewer (reviews code), ` +
  `tester (writes/runs tests), debugger (diagnoses issues).\n` +
  `  Optional working_dir sets the agent's working directory.\n` +
  `- validate(command) — Run a shell command to verify work (build, test, lint).\n` +
  `- diagnose(action, target?) — Inspect codebase state without modifying anything.\n` +
  `  Actions: git_diff (working tree changes), git_log (recent commits), ` +
  `git_status (repo status), file_contents (read a file via target path).\n` +
  `- done(summary) — Report the goal is fully achieved.\n` +
  `- fail(reason) — Report unrecoverable failure.\n\n` +
  `# Important constraints\n\n` +
  `- You have NO direct file access. You CANNOT read, write, search, or browse files yourself.\n` +
  `- Do NOT use Read, Write, Edit, Grep, Glob, Bash, or any other tools — only the tools listed above.\n` +
  `- If you need to understand code or files, delegate to an architect, debugger, or use diagnose().\n` +
  `- If you need to modify code, delegate to an implementer.\n` +
  `- If you need to run a command, use validate().\n\n` +
  `# Workflow\n\n` +
  `1. Delegate to architect to analyze requirements and design the solution.\n` +
  `2. Delegate to implementer to write the actual code.\n` +
  `3. Validate with build/test commands.\n` +
  `4. If validation fails, delegate fixes to implementer and re-validate.\n` +
  `5. Optionally delegate to reviewer for code review.\n` +
  `6. Call done() when work is complete and validated.\n\n` +
  `# Rules\n\n` +
  `- You may call MULTIPLE delegate tools in a single turn to run agents in parallel.\n` +
  `- For validate, diagnose, done, and fail — call exactly ONE per turn.\n` +
  `- Write detailed, specific task descriptions when delegating.\n` +
  `- The architect analyzes and designs; the implementer writes code; the debugger diagnoses.\n` +
  `- Always validate after implementation.\n` +
  `- When you receive agent results, immediately proceed to the next tool call.`;

/**
 * Additional workflow instructions appended when the orchestrator is in fix mode
 * (epic was rejected and is being retried).
 */
export const ORCHESTRATOR_FIX_WORKFLOW =
  `\n\n# Fix Workflow (previous attempt was rejected)\n\n` +
  `Your previous attempt was rejected. Follow this modified workflow:\n\n` +
  `1. Use diagnose(action="git_diff") to see the current state of code from the previous attempt.\n` +
  `2. Delegate to a debugger to analyze the rejection feedback and identify exactly what went wrong.\n` +
  `3. Delegate to an implementer with SPECIFIC fix instructions (exact files, exact changes). ` +
  `Do NOT re-implement from scratch unless the debugger recommends it.\n` +
  `4. Validate with the same commands that failed before.\n` +
  `5. If validation passes, delegate to a reviewer to verify the fix addresses the original feedback.\n` +
  `6. Call done() only after the reviewer confirms the fix.\n\n` +
  `IMPORTANT: Do NOT re-architect the entire solution. Start by understanding what is broken.\n`;

export class Orchestrator {
  private events = mitt<OrchestratorEvents>();
  on = this.events.on.bind(this.events);
  off = this.events.off.bind(this.events);

  private chatPanel: OrchestratorChatPanelAPI | null = null;
  private workspace = '';
  private _sessionId = '';
  private _running = false;
  private _currentPhase = '';
  private _totalDelegations = 0;
  private _totalRetries = 0;
  private _stepAttempts = 0;
  private mcpCommandReceived = false;
  private teamId = '';
  private agentCounter = 0;
  private contextProfileIds: string[] = [];
  private pendingChildren = new Map<string, PendingChild>();
  private orchestratorTurnDone = false;
  private pendingFeedResult = '';
  private autoCommit = false;
  private gitAvailable = false;
  private epicOptions: OrchestratorOptions | null = null;
  private _fixMode = false;
  private childTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private validationResults: Array<{ command: string; passed: boolean; output: string }> = [];
  private childOutputs: Array<{ role: string; agentName: string; output: string }> = [];
  private orchestrationLog: Array<{ timestamp: number; event: string; details: string }> = [];

  static readonly MCP_SERVER_NAME = 'c3p2-orchestrator';
  static readonly MAX_STEP_ATTEMPTS = 5;
  static readonly MAX_TOTAL_DELEGATIONS = 100;
  static readonly CHILD_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

  setChatPanel(panel: OrchestratorChatPanelAPI) { this.chatPanel = panel; }
  setWorkspace(ws: string) { this.workspace = ws; }
  setEpicOptions(opts: OrchestratorOptions | null) { this.epicOptions = opts; }
  getEpicOptions() { return this.epicOptions; }
  setFixMode(fix: boolean) { this._fixMode = fix; }
  isFixMode() { return this._fixMode; }
  isRunning() { return this._running; }
  isEpicScoped() { return this.epicOptions !== null; }
  sessionId() { return this._sessionId; }
  currentPhase() { return this._currentPhase; }
  totalDelegations() { return this._totalDelegations; }
  getOrchestrationLog() { return this.orchestrationLog; }

  private logEvent(event: string, details: string = '') {
    this.orchestrationLog.push({ timestamp: Date.now(), event, details });
    console.log(`[Orchestrator] ${event}${details ? ': ' + details : ''}`);
  }

  // ── Install MCP server to ~/.angy/mcp/ and register in ~/.claude.json ───

  static async ensureMcpServerInstalled(): Promise<boolean> {
    try {
      const { mkdir, readTextFile, writeTextFile } = await import('@tauri-apps/plugin-fs');
      const { homeDir, join, resolveResource } = await import('@tauri-apps/api/path');

      const home = await homeDir();
      const mcpDir = await join(home, '.angy', 'mcp');
      const targetPath = await join(mcpDir, 'orchestrator_server.py');
      const claudeConfigPath = await join(home, '.claude.json');

      // Ensure directory exists
      try { await mkdir(mcpDir, { recursive: true }); } catch { /* exists */ }

      // Check if script exists and is current version
      let needsInstall = true;
      try {
        const existing = await readTextFile(targetPath);
        if (existing.includes('version: 2.0.0')) {
          needsInstall = false;
        }
      } catch { /* doesn't exist */ }

      if (needsInstall) {
        // Read from bundled resources
        try {
          const srcPath = await resolveResource('resources/mcp/orchestrator_server.py');
          const content = await readTextFile(srcPath);
          await writeTextFile(targetPath, content);
        } catch {
          console.warn('[Orchestrator] Could not copy MCP script from resources');
          return false;
        }
      }

      // Register in ~/.claude.json
      let config: Record<string, any> = {};
      try {
        const existing = await readTextFile(claudeConfigPath);
        config = JSON.parse(existing);
      } catch { /* no config yet */ }

      let needsRegister = true;
      if (config.mcpServers?.[Orchestrator.MCP_SERVER_NAME]) {
        const srv = config.mcpServers[Orchestrator.MCP_SERVER_NAME];
        if (srv.args?.[0] === targetPath) {
          needsRegister = false;
        }
      }

      if (needsRegister) {
        if (!config.mcpServers) config.mcpServers = {};
        config.mcpServers[Orchestrator.MCP_SERVER_NAME] = {
          command: 'python3',
          args: [targetPath],
        };
        await writeTextFile(claudeConfigPath, JSON.stringify(config, null, 2) + '\n');
        console.log('[Orchestrator] Registered MCP server in', claudeConfigPath);
      }

      console.log('[Orchestrator] MCP server ready:', targetPath);
      return true;
    } catch (e) {
      console.error('[Orchestrator] ensureMcpServerInstalled failed:', e);
      return false;
    }
  }

  /** Remove the MCP server registration from ~/.claude.json (cleanup on shutdown). */
  static async cleanupMcpRegistration(): Promise<void> {
    try {
      const { readTextFile, writeTextFile } = await import('@tauri-apps/plugin-fs');
      const { homeDir, join } = await import('@tauri-apps/api/path');
      const home = await homeDir();
      const claudeConfigPath = await join(home, '.claude.json');

      const existing = await readTextFile(claudeConfigPath);
      const config = JSON.parse(existing);
      if (config.mcpServers?.[Orchestrator.MCP_SERVER_NAME]) {
        delete config.mcpServers[Orchestrator.MCP_SERVER_NAME];
        if (Object.keys(config.mcpServers).length === 0) {
          delete config.mcpServers;
        }
        await writeTextFile(claudeConfigPath, JSON.stringify(config, null, 2) + '\n');
        console.log('[Orchestrator] Cleaned up MCP server registration');
      }
    } catch {
      // Config may not exist or may already be clean
    }
  }

  // ── Start / Cancel ──────────────────────────────────────────────────────

  async start(goal: string, contextProfileIds: string[] = [], autoCommit = false): Promise<string> {
    if (!this.chatPanel || this._running) return '';

    // Ensure MCP server is installed and verify it's reachable
    const mcpOk = await Orchestrator.ensureMcpServerInstalled();
    if (!mcpOk) {
      console.error('[Orchestrator] MCP server installation failed — aborting start');
      this.events.emit('failed', { reason: 'MCP server installation failed. Check that python3 is available.' });
      return '';
    }

    this.autoCommit = autoCommit;
    if (autoCommit) await this.detectGit();

    this._running = true;
    this.contextProfileIds = contextProfileIds;
    this._totalDelegations = 0;
    this._totalRetries = 0;
    this._stepAttempts = 0;
    this.mcpCommandReceived = false;
    this.orchestratorTurnDone = false;
    this.pendingFeedResult = '';
    this.pendingChildren.clear();
    this.childTimeouts.clear();
    this.validationResults = [];
    this.childOutputs = [];
    this.orchestrationLog = [];
    this.agentCounter = 0;
    this._currentPhase = 'planning';
    this.events.emit('phaseChanged', { phase: this._currentPhase });

    this.teamId = crypto.randomUUID();

    try {
      const { mkdir } = await import('@tauri-apps/plugin-fs');
      const { homeDir, join } = await import('@tauri-apps/api/path');
      const home = await homeDir();
      await mkdir(await join(home, '.angy', 'inboxes', this.teamId), { recursive: true });
    } catch (e) {
      console.warn('[Orchestrator] Failed to create inbox directory:', e);
    }

    this._sessionId = await this.chatPanel.newChat();
    this.chatPanel.configureSession(
      this._sessionId, 'orchestrator', ['specialist-orchestrator'],
    );

    this.logEvent('started', `session=${this._sessionId}, team=${this.teamId}, fixMode=${this._fixMode}`);

    const initialMessage = Orchestrator.buildInitialMessage(goal, {
      autoCommit: this.autoCommit,
      gitAvailable: this.gitAvailable,
      epicOptions: this.epicOptions,
      fixMode: this._fixMode,
      epicContext: this.getEpicSystemPromptAddition(),
    });

    this.chatPanel.sendMessageToSession(this._sessionId, initialMessage);
    return this._sessionId;
  }

  /**
   * Build the initial user message sent to the orchestrator.
   * Single source of truth — used by both start() and ChatPanel standalone mode.
   */
  static buildInitialMessage(goal: string, options?: {
    autoCommit?: boolean;
    gitAvailable?: boolean;
    epicOptions?: OrchestratorOptions | null;
    fixMode?: boolean;
    epicContext?: string;
  }): string {
    const opts = options || {};

    const checkpointLine = (opts.autoCommit && opts.gitAvailable)
      ? `- \`checkpoint(message)\` — create a git checkpoint commit to save progress\n`
      : '';

    const spawnLine = opts.epicOptions
      ? `- \`spawn_orchestrator(task, working_dir?)\` — spawn a child orchestrator for complex sub-tasks\n`
      : '';

    let message =
      `# Goal\n\n${goal}\n\n` +
      `# Instructions\n\n` +
      `You are an autonomous orchestrator. Analyze this goal and begin working toward it.\n\n` +
      `CRITICAL: You MUST call exactly one MCP tool in every response. ` +
      `You have NO file access — you cannot read, write, or search files. ` +
      `Your ONLY tools are:\n` +
      `- \`delegate(role, task, working_dir?)\` — assign work to architect/implementer/reviewer/tester/debugger\n` +
      `- \`validate(command, description)\` — run a shell command to verify the work\n` +
      `- \`diagnose(action, target?)\` — inspect codebase state (git_diff, git_log, git_status, file_contents)\n` +
      checkpointLine +
      spawnLine +
      `- \`done(summary)\` — report the goal is fully achieved\n` +
      `- \`fail(reason)\` — report unrecoverable failure\n\n` +
      `You may call MULTIPLE delegate tools in a single turn to run agents in parallel.\n` +
      `For validate, diagnose, done, and fail — call exactly ONE per turn.\n\n` +
      `Do NOT output plain text without a tool call. Every response needs a tool call.\n\n`;

    if (opts.epicContext) {
      message += opts.epicContext;
    }

    if (opts.fixMode) {
      message += `Start by calling diagnose(action="git_diff") to see the current state, ` +
        `then delegate to a debugger to analyze the rejection feedback.\n`;
    } else {
      message += `Start now by calling delegate(role="architect", task="...") to analyze the codebase and design the solution.\n`;
    }

    return message;
  }

  /**
   * Attach to an existing session (used when orchestrate mode is triggered from the input bar).
   * Unlike start(), this does NOT create a new session or send an initial message.
   */
  async attachToSession(sessionId: string, autoCommit = false): Promise<void> {
    if (!this.chatPanel || this._running) return;

    await Orchestrator.ensureMcpServerInstalled();

    this.autoCommit = autoCommit;
    if (autoCommit) await this.detectGit();

    this._running = true;
    this._sessionId = sessionId;
    this.contextProfileIds = [];
    this._totalDelegations = 0;
    this._totalRetries = 0;
    this._stepAttempts = 0;
    this.mcpCommandReceived = false;
    this.orchestratorTurnDone = false;
    this.pendingFeedResult = '';
    this.pendingChildren.clear();
    this.childTimeouts.clear();
    this.validationResults = [];
    this.childOutputs = [];
    this.orchestrationLog = [];
    this.agentCounter = 0;
    this._currentPhase = 'planning';
    this.events.emit('phaseChanged', { phase: this._currentPhase });

    this.teamId = crypto.randomUUID();

    try {
      const { mkdir } = await import('@tauri-apps/plugin-fs');
      const { homeDir, join } = await import('@tauri-apps/api/path');
      const home = await homeDir();
      await mkdir(await join(home, '.angy', 'inboxes', this.teamId), { recursive: true });
    } catch (e) {
      console.warn('[Orchestrator] Failed to create inbox directory:', e);
    }

    this.logEvent('attached', `session=${sessionId}`);
  }

  cancel() {
    this._running = false;
    this._currentPhase = 'cancelled';
    this.events.emit('phaseChanged', { phase: this._currentPhase });
    for (const timeout of this.childTimeouts.values()) clearTimeout(timeout);
    this.childTimeouts.clear();
    this.cleanupInboxes();
    this.logEvent('cancelled');
  }

  // ── MCP Tool Interception (primary path) ───────────────────────────────

  onMcpToolCalled(sessionId: string, toolName: string, args: Record<string, any>) {
    if (!this._running) return;
    if (sessionId !== this._sessionId) return;

    // Extract action from tool name: mcp__c3p2-orchestrator__delegate → delegate
    const prefix = `mcp__${Orchestrator.MCP_SERVER_NAME}__`;
    if (!toolName.startsWith(prefix)) return;
    const action = toolName.substring(prefix.length);

    this.logEvent('mcpTool', `${action}: ${JSON.stringify(args).substring(0, 200)}`);

    if (action === 'send_message' || action === 'check_inbox') {
      return;
    }

    this.mcpCommandReceived = true;
    this._stepAttempts = 0;

    const cmd: OrchestratorCommand = { action: 'unknown' };

    switch (action) {
      case 'delegate':
        cmd.action = 'delegate';
        cmd.role = args.role || '';
        cmd.task = args.task || '';
        cmd.working_dir = args.working_dir || '';
        break;
      case 'validate':
        cmd.action = 'validate';
        cmd.command = args.command || '';
        cmd.description = args.description || 'Validation';
        break;
      case 'done':
        cmd.action = 'done';
        cmd.summary = args.summary || '';
        break;
      case 'fail':
        cmd.action = 'fail';
        cmd.reason = args.reason || '';
        break;
      case 'checkpoint':
        cmd.action = 'checkpoint';
        cmd.message = args.message || '';
        break;
      case 'spawn_orchestrator':
        cmd.action = 'spawn_orchestrator';
        cmd.task = args.task || '';
        cmd.working_dir = args.working_dir || '';
        break;
      case 'diagnose':
        cmd.action = 'diagnose';
        cmd.diagnoseAction = args.action || '';
        cmd.target = args.target || '';
        break;
      default:
        console.warn('[Orchestrator] Unknown MCP tool action:', action);
        return;
    }

    this.executeCommand(cmd);
  }

  // ── Session ID Tracking ────────────────────────────────────────────────

  onSessionIdChanged(oldId: string, newId: string) {
    if (!this._running) return;

    if (oldId === this._sessionId) {
      console.log(`[Orchestrator] Session ID changed: ${oldId} -> ${newId}`);
      this._sessionId = newId;
    }

    // Re-key pending children map if a child session ID changed
    const child = this.pendingChildren.get(oldId);
    if (child) {
      this.pendingChildren.delete(oldId);
      child.sessionId = newId;
      this.pendingChildren.set(newId, child);
    }
  }

  // ── Session Finished Processing (deferred feed) ───────────────────────

  onSessionFinishedProcessing(sessionId: string) {
    if (!this._running) return;
    if (sessionId !== this._sessionId) return;

    this.orchestratorTurnDone = true;

    // If a validation (or other fast operation) already produced a result
    // while the Claude CLI was still running, send it now.
    if (this.pendingFeedResult) {
      const result = this.pendingFeedResult;
      this.pendingFeedResult = '';
      this.mcpCommandReceived = false;
      this.orchestratorTurnDone = false;
      console.log('[Orchestrator] Sending deferred feed result');
      this.chatPanel?.sendMessageToSession(this._sessionId, result);
      return;
    }

    // If MCP tool was already handled this turn, skip text parsing
    if (this.mcpCommandReceived) {
      this.mcpCommandReceived = false;
      return;
    }

    // Fallback: try text parsing (MCP server may not be available)
    setTimeout(() => this.onOrchestratorTurnFinished(), 100);
  }

  // ── Delegation Callback ────────────────────────────────────────────────

  onDelegateFinished(childSessionId: string, output: string) {
    if (!this._running) return;

    const child = this.pendingChildren.get(childSessionId);
    if (!child) return;

    // Clear timeout watchdog
    const timeout = this.childTimeouts.get(childSessionId);
    if (timeout) {
      clearTimeout(timeout);
      this.childTimeouts.delete(childSessionId);
    }

    child.completed = true;
    child.output = output;

    // Track for artifact collection
    this.childOutputs.push({
      role: child.role,
      agentName: child.agentName,
      output: output.substring(0, 3000),
    });

    this.logEvent('childFinished', `${child.agentName} (${child.role})`);
    this.checkAllChildrenDone();
  }

  // ── Private: Fallback when MCP tool call was not intercepted ────────

  private onOrchestratorTurnFinished() {
    if (!this._running) return;

    for (const pc of this.pendingChildren.values()) {
      if (!pc.completed) return;
    }

    this._stepAttempts++;
    this.logEvent('noToolCall', `attempt ${this._stepAttempts}/${Orchestrator.MAX_STEP_ATTEMPTS}`);

    if (this._stepAttempts >= Orchestrator.MAX_STEP_ATTEMPTS) {
      this.emitArtifacts();
      this._running = false;
      this._currentPhase = 'failed';
      this.events.emit('phaseChanged', { phase: this._currentPhase });
      this.events.emit('failed', {
        reason: `Orchestrator failed to produce a valid tool call after ${Orchestrator.MAX_STEP_ATTEMPTS} attempts.`,
      });
      return;
    }

    let hint = '';
    if (this._currentPhase.includes('delegating') || this._currentPhase === 'planning') {
      if (this._totalDelegations === 0) {
        hint = this._fixMode
          ? ' Start by calling diagnose(action="git_diff") to inspect the current state.'
          : ' Start by calling delegate(role="architect", task="...") to analyze the codebase.';
      } else {
        hint = ' Call delegate(role="implementer", task="...") to write the code, ' +
          'or validate(command="...") to check existing work, or done(summary="...") if finished.';
      }
    }

    this.feedResult(
      `ERROR: Your response did not include a tool call. You MUST call one of: ` +
      `delegate, validate, diagnose, done, or fail. ` +
      `You cannot read files or use other tools — only MCP orchestrator tools.` +
      hint,
    );
  }

  // ── Command Execution (shared by MCP and fallback paths) ───────────────

  private executeCommand(cmd: OrchestratorCommand) {
    switch (cmd.action) {
      case 'delegate':
        this.executeDelegation(cmd);
        break;

      case 'validate':
        this.executeValidation(cmd);
        break;

      case 'diagnose':
        this.executeDiagnose(cmd);
        break;

      case 'done':
        this.emitArtifacts();
        this._running = false;
        this._currentPhase = 'completed';
        this.events.emit('phaseChanged', { phase: this._currentPhase });
        this.logEvent('completed', cmd.summary || '');
        for (const timeout of this.childTimeouts.values()) clearTimeout(timeout);
        this.childTimeouts.clear();
        this.cleanupInboxes();
        this.events.emit('completed', { summary: cmd.summary || '' });
        break;

      case 'fail':
        this.emitArtifacts();
        this._running = false;
        this._currentPhase = 'failed';
        this.events.emit('phaseChanged', { phase: this._currentPhase });
        this.logEvent('failed', cmd.reason || '');
        for (const timeout of this.childTimeouts.values()) clearTimeout(timeout);
        this.childTimeouts.clear();
        this.cleanupInboxes();
        this.events.emit('failed', { reason: cmd.reason || '' });
        break;

      case 'checkpoint':
        this.executeCheckpoint(cmd.message);
        break;

      case 'spawn_orchestrator':
        this.executeSpawnOrchestrator(cmd);
        break;

      default:
        this.feedResult('ERROR: Unknown action. Use delegate, validate, diagnose, done, or fail.');
        break;
    }
  }

  private async executeDelegation(cmd: OrchestratorCommand) {
    if (!cmd.role || !cmd.task || !this.chatPanel) return;

    if (this._totalDelegations >= Orchestrator.MAX_TOTAL_DELEGATIONS) {
      this.feedResult(
        `ERROR: Maximum delegation limit (${Orchestrator.MAX_TOTAL_DELEGATIONS}) reached. ` +
        `You must finish with 'done' or 'fail' now.`,
      );
      return;
    }
    this._totalDelegations++;

    const agentName = this.generateAgentName(cmd.role);
    this._currentPhase = `delegating to ${cmd.role}`;
    this.events.emit('phaseChanged', { phase: this._currentPhase });
    this.events.emit('delegationStarted', { role: cmd.role, task: cmd.task, parentSessionId: this._sessionId });

    const profileId = `specialist-${cmd.role.toLowerCase()}`;
    const context = this.chatPanel.sessionFinalOutput(this._sessionId);

    const teammates = Array.from(this.pendingChildren.values())
      .filter(c => !c.completed)
      .map(c => c.agentName);

    const workingDir = cmd.working_dir || undefined;

    const childId = await this.chatPanel.delegateToChild(
      this._sessionId,
      cmd.task,
      context,
      profileId,
      this.contextProfileIds,
      agentName,
      this.teamId,
      teammates,
      workingDir,
    );

    if (childId) {
      this.pendingChildren.set(childId, {
        sessionId: childId,
        role: cmd.role,
        agentName,
        completed: false,
        output: '',
        workingDir,
      });

      // Start timeout watchdog
      const timeout = setTimeout(() => {
        const child = this.pendingChildren.get(childId);
        if (child && !child.completed) {
          this.logEvent('childTimeout', `${agentName} (${cmd.role}) timed out after ${Orchestrator.CHILD_TIMEOUT_MS / 1000}s`);
          this.chatPanel?.cancelChild?.(childId);
          this.onDelegateFinished(
            childId,
            `ERROR: Agent ${agentName} timed out after ${Orchestrator.CHILD_TIMEOUT_MS / 1000} seconds. ` +
            `The task may be too complex or the agent may be stuck. Consider breaking it into smaller tasks.`,
          );
        }
      }, Orchestrator.CHILD_TIMEOUT_MS);
      this.childTimeouts.set(childId, timeout);

      this.logEvent('delegated', `${cmd.role}:${agentName} child=${childId} pending=${this.pendingChildren.size}`);
    }
  }

  private async executeValidation(cmd: OrchestratorCommand) {
    if (!cmd.command?.trim()) {
      this.feedResult("ERROR: validate requires a non-empty 'command' parameter.");
      return;
    }

    this._currentPhase = `validating: ${cmd.description || ''}`;
    this.events.emit('phaseChanged', { phase: this._currentPhase });
    this.events.emit('validationStarted', { command: cmd.command });

    try {
      const shellCmd = Command.create('exec-sh', ['-c', cmd.command], {
        cwd: this.workspace || undefined,
      });

      const output = await shellCmd.execute();
      const maxLen = output.code === 0 ? 3000 : 5000;
      const rawOutput = (output.stdout + '\n' + output.stderr).trim();
      const stdout = rawOutput.substring(0, maxLen);
      const passed = output.code === 0;

      this.events.emit('validationResult', { passed, output: stdout });
      this.validationResults.push({
        command: cmd.command,
        passed,
        output: stdout.substring(0, 2000),
      });

      if (passed) {
        this.logEvent('validationPassed', cmd.command);
        this.feedResult(
          `## Validation PASSED (exit code 0)\n\n` +
          `**Command:** \`${cmd.command}\`\n\n` +
          `**Output:**\n\`\`\`\n${stdout}\n\`\`\``,
        );
      } else {
        this._totalRetries++;
        this.logEvent('validationFailed', `exit=${output.code} cmd=${cmd.command}`);

        // Classify common error patterns
        const errorSummary = Orchestrator.classifyErrors(rawOutput);

        this.feedResult(
          `## Validation FAILED (exit code ${output.code})\n\n` +
          `**Command:** \`${cmd.command}\`\n` +
          (errorSummary ? `**Error Summary:** ${errorSummary}\n\n` : '\n') +
          `**Output:**\n\`\`\`\n${stdout}\n\`\`\``,
        );
      }
    } catch (e: any) {
      this.logEvent('validationError', e.message);
      this.feedResult(`Validation ERROR: ${e.message}`);
    }
  }

  /** Classify common error patterns in build/test output for structured feedback. */
  private static classifyErrors(output: string): string {
    const lines = output.split('\n');
    const parts: string[] = [];

    // Count compiler-style errors (file:line:col pattern)
    const compileErrors = lines.filter(l => /:\d+:\d+:\s*(error|Error)/.test(l));
    if (compileErrors.length > 0) {
      const files = new Set(compileErrors.map(l => l.split(':')[0]));
      parts.push(`${compileErrors.length} compile error(s) in ${files.size} file(s)`);
    }

    // Count test failures
    const failMatch = output.match(/(\d+)\s+(?:failing|failed|failures)/i);
    const passMatch = output.match(/(\d+)\s+(?:passing|passed)/i);
    if (failMatch) {
      parts.push(`${failMatch[1]} test(s) failed${passMatch ? `, ${passMatch[1]} passed` : ''}`);
    }

    // Lint errors
    const lintErrors = lines.filter(l => /^\s*\d+:\d+\s+(error|warning)\s/.test(l));
    if (lintErrors.length > 0) {
      const errors = lintErrors.filter(l => /\serror\s/.test(l)).length;
      const warnings = lintErrors.length - errors;
      parts.push(`${errors} lint error(s), ${warnings} warning(s)`);
    }

    // TypeScript errors
    const tsErrors = lines.filter(l => /error TS\d+:/.test(l));
    if (tsErrors.length > 0) {
      parts.push(`${tsErrors.length} TypeScript error(s)`);
    }

    return parts.join('; ');
  }

  // ── Diagnose (inspect codebase state without modifying) ────────────

  private async executeDiagnose(cmd: OrchestratorCommand) {
    const action = cmd.diagnoseAction || '';
    if (!action) {
      this.feedResult("ERROR: diagnose requires an 'action' parameter (git_diff, git_log, git_status, file_contents).");
      return;
    }

    this._currentPhase = `diagnosing: ${action}`;
    this.events.emit('phaseChanged', { phase: this._currentPhase });

    try {
      let shellCommand: string;
      switch (action) {
        case 'git_diff':
          shellCommand = 'git diff --stat && echo "---FULL DIFF---" && git diff';
          break;
        case 'git_log':
          shellCommand = `git log --oneline -${cmd.target || '15'}`;
          break;
        case 'git_status':
          shellCommand = 'git status';
          break;
        case 'file_contents':
          if (!cmd.target) {
            this.feedResult("ERROR: diagnose(action='file_contents') requires a 'target' parameter with the file path.");
            return;
          }
          shellCommand = `head -200 '${cmd.target.replace(/'/g, "'\\''")}'`;
          break;
        default:
          this.feedResult(`ERROR: Unknown diagnose action '${action}'. Use: git_diff, git_log, git_status, file_contents.`);
          return;
      }

      const shellCmd = Command.create('exec-sh', ['-c', shellCommand], {
        cwd: this.workspace || undefined,
      });
      const output = await shellCmd.execute();
      const result = (output.stdout + '\n' + output.stderr).trim().substring(0, 6000);

      this.logEvent('diagnose', `${action} exit=${output.code}`);
      this.feedResult(
        `## Diagnose: ${action}${cmd.target ? ` (${cmd.target})` : ''}\n\n` +
        `\`\`\`\n${result}\n\`\`\``,
      );
    } catch (e: any) {
      this.logEvent('diagnoseError', e.message);
      this.feedResult(`Diagnose ERROR: ${e.message}`);
    }
  }

  // ── Artifact Collection ────────────────────────────────────────────

  private emitArtifacts() {
    this.events.emit('artifactsCollected', {
      validations: this.validationResults,
      childOutputs: this.childOutputs,
    });
  }

  // ── Parallel Children Aggregation ──────────────────────────────────────

  private async checkAllChildrenDone() {
    const pending = Array.from(this.pendingChildren.values());
    if (pending.length === 0) return;
    if (pending.some(c => !c.completed)) return;

    // All done — aggregate results
    const parts = pending.map(
      pc => `## Agent '${pc.agentName}' (${pc.role}) completed\n\n${pc.output}`,
    );

    const count = pending.length;
    const roles = [...new Set(pending.map(pc => pc.role))].join(', ');
    this.pendingChildren.clear();

    // Auto-checkpoint: commit after each delegation batch completes
    let checkpointInfo = '';
    if (this.autoCommit && this.gitAvailable) {
      const commitMsg = `checkpoint: ${roles} phase completed`;
      const hash = await this.doGitCheckpoint(commitMsg);
      if (hash) {
        checkpointInfo = `\n\n**Checkpoint created:** commit ${hash} — "${commitMsg}"`;
        this.events.emit('checkpointCreated', { hash, message: commitMsg });
        console.log(`[Orchestrator] Auto-checkpoint after ${roles}: ${hash}`);
      }
    }

    this.feedResult(
      `${count} agent(s) completed successfully.${checkpointInfo}\n\n${parts.join('\n\n---\n\n')}\n\n` +
      `What should be done next?`,
    );
  }

  // ── Feed Result (deferred if process still running) ────────────────────

  private feedResult(resultText: string) {
    if (!this._running || !this.chatPanel) return;

    this.mcpCommandReceived = false;
    this.events.emit('progressUpdate', { message: resultText.substring(0, 100) + '...' });

    if (!this.orchestratorTurnDone) {
      // Claude CLI process is still running (common for fast validation commands).
      // Defer until onSessionFinishedProcessing picks it up.
      console.log('[Orchestrator] Deferring feed result (process still running)');
      this.pendingFeedResult = resultText;
      return;
    }

    // Process is done, safe to send the next message
    this.orchestratorTurnDone = false;
    this.pendingFeedResult = '';
    this.chatPanel.sendMessageToSession(this._sessionId, resultText);
  }

  // ── Spawn Sub-Orchestrator (Epic) ───────────────────────────────────────

  private async executeSpawnOrchestrator(cmd: OrchestratorCommand) {
    if (!cmd.task || !this.chatPanel) return;

    if (!this.epicOptions) {
      this.feedResult(
        'ERROR: spawn_orchestrator is only available in epic-scoped mode.',
      );
      return;
    }

    const currentDepth = this.epicOptions.depth;
    const maxDepth = this.epicOptions.maxDepth;

    if (currentDepth >= maxDepth) {
      this.feedResult(
        `ERROR: Maximum orchestrator depth (${maxDepth}) reached at depth ${currentDepth}. ` +
        `Use delegate() instead of spawn_orchestrator() to assign work directly.`,
      );
      return;
    }

    // Create child orchestrator options inheriting the epic context
    const childEpicOptions: OrchestratorOptions = {
      epicId: this.epicOptions.epicId,
      projectId: this.epicOptions.projectId,
      repoPaths: { ...this.epicOptions.repoPaths },
      depth: currentDepth + 1,
      maxDepth,
      parentSessionId: this._sessionId,
      budgetRemaining: this.epicOptions.budgetRemaining,
    };

    this._totalDelegations++;

    const agentName = `sub-orchestrator-${this.agentCounter + 1}`;
    this.agentCounter++;

    this._currentPhase = `spawning sub-orchestrator (depth ${childEpicOptions.depth})`;
    this.events.emit('phaseChanged', { phase: this._currentPhase });
    this.events.emit('subOrchestratorSpawned', {
      task: cmd.task,
      depth: childEpicOptions.depth,
      epicId: this.epicOptions.epicId,
    });

    // Determine working directory for the sub-orchestrator
    const workingDir = cmd.working_dir || undefined;

    // Use the existing delegation mechanism to create the child session
    // The child runs as an orchestrator (not a specialist agent)
    const context = this.chatPanel.sessionFinalOutput(this._sessionId);
    const childId = await this.chatPanel.delegateToChild(
      this._sessionId,
      cmd.task,
      context,
      'specialist-orchestrator',
      this.contextProfileIds,
      agentName,
      this.teamId,
      [],
      workingDir,
    );

    if (childId) {
      this.pendingChildren.set(childId, {
        sessionId: childId,
        role: 'sub-orchestrator',
        agentName,
        completed: false,
        output: '',
        workingDir,
      });

      console.log(
        `[Orchestrator] Spawned sub-orchestrator: ${agentName} depth=${childEpicOptions.depth} child=${childId}`,
      );
    }
  }

  // ── Epic System Prompt Addition ─────────────────────────────────────────

  /**
   * Generates additional system prompt context when epicOptions is set.
   * Includes epic details, target repos, and depth information.
   */
  getEpicSystemPromptAddition(): string {
    if (!this.epicOptions) return '';

    const opts = this.epicOptions;
    const lines: string[] = [
      '\n\n# Epic Orchestration Context\n',
      `You are an epic-scoped orchestrator.\n`,
      `- Epic ID: ${opts.epicId}`,
      `- Project ID: ${opts.projectId}`,
      `- Current depth: ${opts.depth} / max ${opts.maxDepth}`,
    ];

    if (opts.parentSessionId) {
      lines.push(`- Parent session: ${opts.parentSessionId}`);
    }

    if (opts.budgetRemaining !== null) {
      lines.push(`- Budget remaining: $${opts.budgetRemaining.toFixed(2)}`);
    }

    // Target repos
    const repoEntries = Object.entries(opts.repoPaths);
    if (repoEntries.length > 0) {
      lines.push('\n## Target Repositories\n');
      for (const [repoId, repoPath] of repoEntries) {
        lines.push(`- ${repoId}: \`${repoPath}\``);
      }
      lines.push(
        '\nUse the `working_dir` parameter on delegate() to run agents in specific repo directories.',
      );
    }

    // Depth-aware instructions
    if (opts.depth < opts.maxDepth) {
      lines.push(
        '\n## Sub-Orchestrator Spawning\n',
        'You can spawn child orchestrators for complex sub-tasks using spawn_orchestrator(task, working_dir).',
        `Current depth: ${opts.depth}. You can spawn ${opts.maxDepth - opts.depth} more level(s) of sub-orchestrators.`,
      );
    } else {
      lines.push(
        '\n## Depth Limit Reached\n',
        'You are at maximum orchestrator depth. Use delegate() for all work assignments.',
      );
    }

    return lines.join('\n');
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private generateAgentName(role: string): string {
    this.agentCounter++;
    return `${role.toLowerCase()}-${this.agentCounter}`;
  }

  private async cleanupInboxes() {
    if (!this.teamId) return;
    try {
      const { remove } = await import('@tauri-apps/plugin-fs');
      const { homeDir, join } = await import('@tauri-apps/api/path');
      const home = await homeDir();
      await remove(await join(home, '.angy', 'inboxes', this.teamId), { recursive: true });
    } catch { /* ok */ }
    this.teamId = '';
    this.pendingChildren.clear();
  }

  // ── Git Detection ───────────────────────────────────────────────────

  private async detectGit(): Promise<void> {
    try {
      const cmd = Command.create('exec-sh', ['-c', 'git rev-parse --is-inside-work-tree'], {
        cwd: this.workspace || undefined,
      });
      const output = await cmd.execute();
      this.gitAvailable = output.code === 0;
    } catch {
      this.gitAvailable = false;
    }
    console.log(`[Orchestrator] Git available: ${this.gitAvailable}`);
  }

  // ── Checkpoint Execution ──────────────────────────────────────────

  /**
   * Low-level git checkpoint: stage all + commit.
   * Returns the short commit hash on success, or null if nothing to commit / error.
   */
  private async doGitCheckpoint(message: string): Promise<string | null> {
    try {
      const addCmd = Command.create('exec-sh', ['-c', 'git add -A'], {
        cwd: this.workspace || undefined,
      });
      await addCmd.execute();

      const safeMsg = message.replace(/'/g, "'\\''");
      const commitCmd = Command.create('exec-sh',
        ['-c', `git commit -m '${safeMsg}'`], {
          cwd: this.workspace || undefined,
        });
      const commitOutput = await commitCmd.execute();

      if (commitOutput.code !== 0) {
        const stderr = commitOutput.stderr || '';
        if (stderr.includes('nothing to commit')) return null;
        console.warn('[Orchestrator] Checkpoint commit failed:', stderr.substring(0, 200));
        return null;
      }

      const hashCmd = Command.create('exec-sh', ['-c', 'git rev-parse --short HEAD'], {
        cwd: this.workspace || undefined,
      });
      const hashOutput = await hashCmd.execute();
      return hashOutput.stdout.trim();
    } catch (e: any) {
      console.warn('[Orchestrator] Checkpoint error:', e.message);
      return null;
    }
  }

  private async executeCheckpoint(message?: string) {
    if (!this.autoCommit || !this.gitAvailable) {
      this.feedResult('Checkpoint skipped (git not available or auto-commit disabled).');
      return;
    }

    const commitMsg = message || 'checkpoint';
    const hash = await this.doGitCheckpoint(commitMsg);

    if (!hash) {
      this.feedResult('Checkpoint: nothing to commit, working tree clean.');
      return;
    }

    console.log(`[Orchestrator] Checkpoint created: ${hash} — ${commitMsg}`);
    this.events.emit('checkpointCreated', { hash, message: commitMsg });
    this.feedResult(`Checkpoint created: commit ${hash} — "${commitMsg}"`);
  }

  // ── System Prompt (dynamic, includes checkpoint instructions if enabled) ──

  getSystemPrompt(): string {
    let prompt = ORCHESTRATOR_SYSTEM_PROMPT;

    if (this._fixMode) {
      prompt += ORCHESTRATOR_FIX_WORKFLOW;
    }

    if (this.autoCommit) {
      prompt +=
        `\n\n# Checkpointing\n\n` +
        `Auto-commit is enabled. After completing each phase (architect, implement, validate, review), ` +
        `call the checkpoint tool with a descriptive commit message summarizing what was accomplished ` +
        `in that phase. For example: checkpoint(message="Implemented user authentication module"). ` +
        `This creates incremental git commits so progress is not lost.`;
    }

    prompt += this.getEpicSystemPromptAddition();

    return prompt;
  }

  isAutoCommitEnabled(): boolean {
    return this.autoCommit;
  }
}
