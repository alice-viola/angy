import mitt from 'mitt';
import { Command } from '@tauri-apps/plugin-shell';

// ── Orchestrator Command (parsed from MCP tool calls) ────────────────────────

export interface OrchestratorCommand {
  action: 'delegate' | 'validate' | 'done' | 'fail' | 'checkpoint' | 'unknown';
  role?: string;
  task?: string;
  command?: string;
  description?: string;
  summary?: string;
  reason?: string;
  message?: string;
}

// ── Pending Child (parallel delegation tracking) ─────────────────────────────

export interface PendingChild {
  sessionId: string;
  role: string;
  agentName: string; // e.g. "implementer-2"
  completed: boolean;
  output: string;
}

// ── Events ───────────────────────────────────────────────────────────────────

export type OrchestratorEvents = {
  phaseChanged: { phase: string };
  delegationStarted: { role: string; task: string };
  validationStarted: { command: string };
  validationResult: { passed: boolean; output: string };
  completed: { summary: string };
  failed: { reason: string };
  retrying: { reason: string; attempt: number };
  progressUpdate: { message: string };
  peerMessageSent: { from: string; to: string; content: string };
  checkpointCreated: { hash: string; message: string };
};

// ── ChatPanel interface (decouples from Vue component) ───────────────────────

export interface OrchestratorChatPanelAPI {
  newChat(workspace?: string): string;
  configureSession(sessionId: string, mode: string, profileIds: string[]): void;
  sendMessageToSession(sessionId: string, message: string): void;
  delegateToChild(
    parentSessionId: string,
    task: string,
    context: string,
    specialistProfileId: string,
    contextProfileIds: string[],
    agentName?: string,
    teamId?: string,
    teammates?: string[],
  ): string;
  sessionFinalOutput(sessionId: string): string;
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * System prompt for orchestrator sessions.
 * Matches the C++ specialist-orchestrator profile.
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
  `- delegate(role, task) — Assign work to a specialist agent.\n` +
  `  Roles: architect (analyzes codebase, writes design docs), ` +
  `implementer (writes code), reviewer (reviews code), tester (writes/runs tests).\n` +
  `- validate(command) — Run a shell command to verify work (build, test, lint).\n` +
  `- done(summary) — Report the goal is fully achieved.\n` +
  `- fail(reason) — Report unrecoverable failure.\n\n` +
  `# Important constraints\n\n` +
  `- You have NO direct file access. You CANNOT read, write, search, or browse files yourself.\n` +
  `- Do NOT use Read, Write, Edit, Grep, Glob, Bash, or any other tools — only the 4 tools above.\n` +
  `- If you need to understand code or files, delegate to an architect or reviewer.\n` +
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
  `- EVERY response must contain exactly ONE tool call. No exceptions.\n` +
  `- Write detailed, specific task descriptions when delegating.\n` +
  `- The architect analyzes and designs; the implementer writes code.\n` +
  `- Always validate after implementation.\n` +
  `- When you receive agent results, immediately proceed to the next tool call.`;

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

  static readonly MCP_SERVER_NAME = 'c3p2-orchestrator';
  static readonly MAX_STEP_ATTEMPTS = 5;
  static readonly MAX_TOTAL_DELEGATIONS = 100;

  setChatPanel(panel: OrchestratorChatPanelAPI) { this.chatPanel = panel; }
  setWorkspace(ws: string) { this.workspace = ws; }
  isRunning() { return this._running; }
  sessionId() { return this._sessionId; }
  currentPhase() { return this._currentPhase; }
  totalDelegations() { return this._totalDelegations; }

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
      console.warn('[Orchestrator] ensureMcpServerInstalled failed:', e);
      return false;
    }
  }

  // ── Start / Cancel ──────────────────────────────────────────────────────

  async start(goal: string, contextProfileIds: string[] = [], autoCommit = false): Promise<string> {
    if (!this.chatPanel || this._running) return '';

    // Ensure MCP server is installed
    await Orchestrator.ensureMcpServerInstalled();

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
    this.agentCounter = 0;
    this._currentPhase = 'planning';
    this.events.emit('phaseChanged', { phase: this._currentPhase });

    // Generate unique team ID for inbox scoping
    this.teamId = crypto.randomUUID();

    // Create inbox directory
    try {
      const { mkdir } = await import('@tauri-apps/plugin-fs');
      const { homeDir, join } = await import('@tauri-apps/api/path');
      const home = await homeDir();
      await mkdir(await join(home, '.angy', 'inboxes', this.teamId), { recursive: true });
    } catch { /* ok */ }

    // Create orchestrator session
    this._sessionId = this.chatPanel.newChat();
    this.chatPanel.configureSession(
      this._sessionId, 'orchestrator', ['specialist-orchestrator'],
    );

    console.log(`[Orchestrator] Started with goal, session: ${this._sessionId}, team: ${this.teamId}`);

    // Build and send the initial prompt
    const checkpointLine = (this.autoCommit && this.gitAvailable)
      ? `- \`checkpoint(message)\` — create a git checkpoint commit to save progress\n`
      : '';

    const initialMessage =
      `# Goal\n\n${goal}\n\n` +
      `# Instructions\n\n` +
      `You are an autonomous orchestrator. Analyze this goal and begin working toward it.\n\n` +
      `CRITICAL: You MUST call exactly one MCP tool in every response. ` +
      `You have NO file access — you cannot read, write, or search files. ` +
      `Your ONLY tools are:\n` +
      `- \`delegate(role, task)\` — assign work to architect/implementer/reviewer/tester\n` +
      `- \`validate(command, description)\` — run a shell command to verify the work\n` +
      checkpointLine +
      `- \`done(summary)\` — report the goal is fully achieved\n` +
      `- \`fail(reason)\` — report unrecoverable failure\n\n` +
      `You may call MULTIPLE delegate tools in a single turn to run agents in parallel.\n` +
      `For validate, done, and fail — call exactly ONE per turn.\n\n` +
      `Do NOT output plain text without a tool call. Every response needs a tool call.\n\n` +
      `Start now by calling delegate(role="architect", task="...") to analyze the codebase and design the solution.`;

    this.chatPanel.sendMessageToSession(this._sessionId, initialMessage);
    return this._sessionId;
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
    this.agentCounter = 0;
    this._currentPhase = 'planning';
    this.events.emit('phaseChanged', { phase: this._currentPhase });

    this.teamId = crypto.randomUUID();

    try {
      const { mkdir } = await import('@tauri-apps/plugin-fs');
      const { homeDir, join } = await import('@tauri-apps/api/path');
      const home = await homeDir();
      await mkdir(await join(home, '.angy', 'inboxes', this.teamId), { recursive: true });
    } catch { /* ok */ }

    console.log(`[Orchestrator] Attached to session: ${sessionId}, team: ${this.teamId}`);
  }

  cancel() {
    this._running = false;
    this._currentPhase = 'cancelled';
    this.events.emit('phaseChanged', { phase: this._currentPhase });
    this.cleanupInboxes();
  }

  // ── MCP Tool Interception (primary path) ───────────────────────────────

  onMcpToolCalled(sessionId: string, toolName: string, args: Record<string, any>) {
    if (!this._running) return;
    if (sessionId !== this._sessionId) return;

    // Extract action from tool name: mcp__c3p2-orchestrator__delegate → delegate
    const prefix = `mcp__${Orchestrator.MCP_SERVER_NAME}__`;
    if (!toolName.startsWith(prefix)) return;
    const action = toolName.substring(prefix.length);

    console.log(`[Orchestrator] MCP tool called: ${action}`, args);

    this.mcpCommandReceived = true;
    this._stepAttempts = 0;

    const cmd: OrchestratorCommand = { action: 'unknown' };

    switch (action) {
      case 'delegate':
        cmd.action = 'delegate';
        cmd.role = args.role || '';
        cmd.task = args.task || '';
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

    child.completed = true;
    child.output = output;

    console.log(`[Orchestrator] Agent ${child.agentName} finished (${child.role})`);
    this.checkAllChildrenDone();
  }

  // ── Private: Fallback text parsing ─────────────────────────────────────

  private onOrchestratorTurnFinished() {
    if (!this._running) return;

    // Still waiting for delegated children to finish
    for (const pc of this.pendingChildren.values()) {
      if (!pc.completed) return;
    }

    // Fallback text parsing — only reached if MCP tool call was not intercepted
    const output = this.chatPanel?.sessionFinalOutput(this._sessionId) || '';
    if (!output) return;

    const cmd = this.parseCommand(output);

    if (cmd.action === 'unknown') {
      this._stepAttempts++;
      console.log(`[Orchestrator] No MCP tool call found, attempt ${this._stepAttempts}/${Orchestrator.MAX_STEP_ATTEMPTS}`);
      if (this._stepAttempts >= Orchestrator.MAX_STEP_ATTEMPTS) {
        this._running = false;
        this._currentPhase = 'failed';
        this.events.emit('phaseChanged', { phase: this._currentPhase });
        this.events.emit('failed', {
          reason: `Orchestrator failed to produce a valid tool call after ${Orchestrator.MAX_STEP_ATTEMPTS} attempts.`,
        });
        return;
      }

      // Build a contextual hint based on orchestrator phase
      let hint = '';
      if (this._currentPhase.includes('delegating') || this._currentPhase === 'planning') {
        if (this._totalDelegations === 0) {
          hint = ' Start by calling delegate(role="architect", task="...") to analyze the codebase.';
        } else {
          hint = ' Call delegate(role="implementer", task="...") to write the code, ' +
            'or validate(command="...") to check existing work, or done(summary="...") if finished.';
        }
      }

      const toolList = this.autoCommit
        ? 'delegate, validate, checkpoint, done, or fail'
        : 'delegate, validate, done, or fail';
      const toolCount = this.autoCommit ? '5' : '4';
      this.feedResult(
        `ERROR: Your response did not include a tool call. You MUST call one of: ` +
        `${toolList}. ` +
        `You cannot read files or use other tools — only these ${toolCount} MCP tools.` +
        hint,
      );
      return;
    }

    this._stepAttempts = 0;
    this.executeCommand(cmd);
  }

  private parseCommand(text: string): OrchestratorCommand {
    const cmd: OrchestratorCommand = { action: 'unknown' };

    // Find ```command ... ``` or ```json ... ``` block (fallback when MCP not available)
    let start = text.lastIndexOf('```command');
    if (start < 0) {
      start = text.lastIndexOf('```json');
      if (start < 0) return cmd;
    }

    start = text.indexOf('\n', start);
    if (start < 0) return cmd;
    start++;

    const end = text.indexOf('```', start);
    if (end < 0) return cmd;

    const jsonStr = text.substring(start, end).trim();

    try {
      const j = JSON.parse(jsonStr);
      const action = j.action || '';

      if (action === 'delegate') {
        cmd.action = 'delegate';
        cmd.role = j.role || '';
        cmd.task = j.task || '';
      } else if (action === 'validate') {
        cmd.action = 'validate';
        cmd.command = j.command || j.task || j.cmd || '';
        cmd.description = j.description || 'Validation';
      } else if (action === 'done') {
        cmd.action = 'done';
        cmd.summary = j.summary || '';
      } else if (action === 'fail') {
        cmd.action = 'fail';
        cmd.reason = j.reason || '';
      } else if (action === 'checkpoint') {
        cmd.action = 'checkpoint';
        cmd.message = j.message || '';
      }
    } catch (e) {
      console.warn('[Orchestrator] JSON parse error:', e);
    }

    return cmd;
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

      case 'done':
        this._running = false;
        this._currentPhase = 'completed';
        this.events.emit('phaseChanged', { phase: this._currentPhase });
        console.log('[Orchestrator] Completed:', cmd.summary);
        this.cleanupInboxes();
        this.events.emit('completed', { summary: cmd.summary || '' });
        break;

      case 'fail':
        this._running = false;
        this._currentPhase = 'failed';
        this.events.emit('phaseChanged', { phase: this._currentPhase });
        console.log('[Orchestrator] Failed:', cmd.reason);
        this.cleanupInboxes();
        this.events.emit('failed', { reason: cmd.reason || '' });
        break;

      case 'checkpoint':
        this.executeCheckpoint(cmd.message);
        break;

      default:
        this.feedResult('ERROR: Unknown action. Use delegate, validate, done, or fail.');
        break;
    }
  }

  private executeDelegation(cmd: OrchestratorCommand) {
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
    this.events.emit('delegationStarted', { role: cmd.role, task: cmd.task });

    const profileId = `specialist-${cmd.role.toLowerCase()}`;

    // Get orchestrator's context summary for the child
    const context = this.chatPanel.sessionFinalOutput(this._sessionId);

    // Build teammate list from currently pending (non-completed) children
    const teammates = Array.from(this.pendingChildren.values())
      .filter(c => !c.completed)
      .map(c => c.agentName);

    const childId = this.chatPanel.delegateToChild(
      this._sessionId,
      cmd.task,
      context,
      profileId,
      this.contextProfileIds,
      agentName,
      this.teamId,
      teammates,
    );

    if (childId) {
      this.pendingChildren.set(childId, {
        sessionId: childId,
        role: cmd.role,
        agentName,
        completed: false,
        output: '',
      });

      console.log(`[Orchestrator] Delegated to ${cmd.role} agent: ${agentName} child: ${childId} pending: ${this.pendingChildren.size}`);
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
      const stdout = (output.stdout + '\n' + output.stderr).trim().substring(0, 3000);
      const passed = output.code === 0;

      this.events.emit('validationResult', { passed, output: stdout });

      if (passed) {
        this.feedResult(
          `Validation PASSED (exit code 0).\n\nOutput:\n\`\`\`\n${stdout}\n\`\`\``,
        );
      } else {
        this._totalRetries++;
        this.feedResult(
          `Validation FAILED (exit code ${output.code}).\n\nOutput:\n\`\`\`\n${stdout}\n\`\`\``,
        );
      }
    } catch (e: any) {
      this.feedResult(`Validation ERROR: ${e.message}`);
    }
  }

  // ── Parallel Children Aggregation ──────────────────────────────────────

  private checkAllChildrenDone() {
    const pending = Array.from(this.pendingChildren.values());
    if (pending.length === 0) return;
    if (pending.some(c => !c.completed)) return;

    // All done — aggregate results
    const parts = pending.map(
      pc => `## Agent '${pc.agentName}' (${pc.role}) completed\n\n${pc.output}`,
    );

    const count = pending.length;
    this.pendingChildren.clear();

    this.feedResult(
      `${count} agent(s) completed successfully.\n\n${parts.join('\n\n---\n\n')}\n\n` +
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

  private async executeCheckpoint(message?: string) {
    if (!this.autoCommit || !this.gitAvailable) {
      this.feedResult('Checkpoint skipped (git not available or auto-commit disabled).');
      return;
    }

    const commitMsg = message || 'checkpoint';

    try {
      // Stage all changes
      const addCmd = Command.create('exec-sh', ['-c', 'git add -A'], {
        cwd: this.workspace || undefined,
      });
      await addCmd.execute();

      // Commit (use single quotes with proper escaping to prevent shell expansion)
      const safeMsg = commitMsg.replace(/'/g, "'\\''");
      const commitCmd = Command.create('exec-sh',
        ['-c', `git commit -m '${safeMsg}'`], {
          cwd: this.workspace || undefined,
        });
      const commitOutput = await commitCmd.execute();

      if (commitOutput.code !== 0) {
        // Nothing to commit is fine — not an error
        const stderr = commitOutput.stderr || '';
        if (stderr.includes('nothing to commit')) {
          this.feedResult('Checkpoint: nothing to commit, working tree clean.');
          return;
        }
        this.feedResult(`Checkpoint commit failed: ${commitOutput.stderr.substring(0, 200)}`);
        return;
      }

      // Get short hash
      const hashCmd = Command.create('exec-sh', ['-c', 'git rev-parse --short HEAD'], {
        cwd: this.workspace || undefined,
      });
      const hashOutput = await hashCmd.execute();
      const hash = hashOutput.stdout.trim();

      console.log(`[Orchestrator] Checkpoint created: ${hash} — ${commitMsg}`);
      this.events.emit('checkpointCreated', { hash, message: commitMsg });

      this.feedResult(`Checkpoint created: commit ${hash} — "${commitMsg}"`);
    } catch (e: any) {
      this.feedResult(`Checkpoint error: ${e.message}`);
    }
  }

  // ── System Prompt (dynamic, includes checkpoint instructions if enabled) ──

  getSystemPrompt(): string {
    if (!this.autoCommit) return ORCHESTRATOR_SYSTEM_PROMPT;

    return ORCHESTRATOR_SYSTEM_PROMPT +
      `\n\n# Checkpointing\n\n` +
      `Auto-commit is enabled. After completing each phase (architect, implement, validate, review), ` +
      `call the checkpoint tool with a descriptive commit message summarizing what was accomplished ` +
      `in that phase. For example: checkpoint(message="Implemented user authentication module"). ` +
      `This creates incremental git commits so progress is not lost.`;
  }

  isAutoCommitEnabled(): boolean {
    return this.autoCommit;
  }
}
