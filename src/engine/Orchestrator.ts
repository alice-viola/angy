import mitt from 'mitt';
import { Command } from '@tauri-apps/plugin-shell';
import type { OrchestratorOptions, EpicPipelineType } from './KosTypes';
import type { TechProfile } from './TechDetector';

// ── Orchestrator Command (parsed from MCP tool calls) ────────────────────────

export interface OrchestratorCommand {
  action: 'delegate' | 'done' | 'fail' | 'checkpoint' | 'spawn_orchestrator' | 'diagnose' | 'unknown';
  role?: string;
  task?: string;
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
  completed: { summary: string };
  failed: { reason: string };
  retrying: { reason: string; attempt: number };
  progressUpdate: { message: string };
  peerMessageSent: { from: string; to: string; content: string };
  checkpointCreated: { hash: string; message: string };
  artifactsCollected: {
    childOutputs: Array<{ role: string; agentName: string; output: string }>;
  };
  autoProfilesDetected: { profiles: TechProfile[] };
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
    'You are a software architect agent. You analyze codebases and design solutions.\n\n' +
    'Your output MUST follow this structure:\n' +
    '## ANALYSIS\nSummary of the problem and current codebase state.\n\n' +
    '## FILES TO MODIFY\nList each file path and what changes are needed.\n\n' +
    '## FILES TO CREATE\nList any new files needed (prefer modifying existing files).\n\n' +
    '## KEY DECISIONS\nNumbered list of architectural choices with brief rationale.\n\n' +
    '## RISKS\nPotential issues or edge cases to watch for.\n\n' +
    '## IMPLEMENTATION STEPS\n' +
    'Ordered steps with specific file references. Group independent steps that can be parallelized. ' +
    'Note dependencies between steps.\n\n' +
    'Ground your analysis in the actual codebase. Read relevant files before making recommendations. ' +
    'Identify existing patterns and conventions to follow.\n\n' +
    'Pipeline context: You are typically the first agent in a workflow. Your output is passed directly to implementers, so be specific and actionable.',
  implementer:
    'You are an implementer agent. You write production-quality code.\n\n' +
    'Follow these principles:\n' +
    '- Follow the architect\'s plan exactly — implement what was specified, nothing more\n' +
    '- Match the existing codebase style, conventions, and patterns\n' +
    '- Read surrounding code before making changes to understand context\n' +
    '- Make minimal, focused changes — avoid refactoring code outside your task scope\n' +
    '- Prefer editing existing files over creating new ones\n\n' +
    'When you receive a task with an architect\'s plan, implement each step methodically. ' +
    'If the plan is ambiguous, make the simplest choice that fits the codebase.\n\n' +
    'Pipeline context: You receive the architect\'s plan as input. Your output is verified by a tester and reviewed by a reviewer. Write code that is ready for both.',
  reviewer:
    'You are a code reviewer agent. You review changes for correctness, style, and completeness.\n\n' +
    'Your review MUST end with a verdict section:\n' +
    '## VERDICT: APPROVE or REQUEST_CHANGES\n\n' +
    'If requesting changes, list each issue with a severity:\n' +
    '- **CRITICAL**: Bugs, security issues, data loss risks — must fix before merge\n' +
    '- **MAJOR**: Logic errors, missing edge cases, API contract violations — should fix\n' +
    '- **NIT**: Style preferences, naming suggestions — fix if convenient\n\n' +
    'Focus on correctness and adherence to the task requirements. Check that the implementation ' +
    'matches the architect\'s plan. Only request changes for stylistic preferences that match ' +
    'the existing codebase conventions.\n\n' +
    'Pipeline context: You review after the implementer has written code. Your verdict determines whether the workflow proceeds to done (APPROVE) or cycles back for fixes (REQUEST_CHANGES). The orchestrator passes your feedback to the implementer for fixes.',
  tester:
    'You are a tester agent. You verify that code works correctly.\n\n' +
    'Follow this procedure:\n' +
    '1. **BUILD**: Build the project and report any compilation errors\n' +
    '2. **EXISTING TESTS**: Run the existing test suite and report results\n' +
    '3. **NEW TESTS**: If the task warrants it, write targeted tests for the changed code\n\n' +
    'Report results in this format:\n' +
    '## BUILD\nPass/Fail + any error output\n\n' +
    '## EXISTING TESTS\nPass/Fail + summary (X passed, Y failed) + any failure details\n\n' +
    '## NEW TESTS\nList of tests written and their results, or "Not applicable" with reasoning\n\n' +
    'Pipeline context: You run after the implementer has written code, sometimes in parallel with the reviewer. Your results determine whether fixes are needed. Report clearly so the orchestrator can decide next steps.',
  debugger:
    'You are a debugger agent. You diagnose and fix issues in code.\n\n' +
    'Follow this methodology:\n' +
    '1. Reproduce the issue — understand the symptoms and error messages\n' +
    '2. Form hypotheses — identify likely causes based on the error context\n' +
    '3. Investigate systematically — read relevant code, check recent changes, trace data flow\n' +
    '4. Identify root cause — pinpoint the exact location and mechanism of failure\n\n' +
    'Your output MUST include:\n' +
    '## ROOT CAUSE\nWhat is causing the issue and why.\n\n' +
    '## LOCATION\nSpecific file(s) and line(s) where the problem originates.\n\n' +
    '## EVIDENCE\nError messages, log output, or code snippets that confirm your diagnosis.\n\n' +
    '## FIX\nThe specific code changes needed to resolve the issue. Implement the fix directly.\n\n' +
    'Pipeline context: You are called when something is broken. Your diagnosis is passed to an implementer who will apply the fix. Be specific about the root cause and location so the implementer can act on it directly.',
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
// ── Base prompt (shared between create and fix) ─────────────────────────

const ORCHESTRATOR_PREAMBLE =
  `You are an autonomous project orchestrator. You receive a high-level goal and must ` +
  `break it down into steps, delegate work to specialist agents, and iterate until ` +
  `the goal is fully achieved.\n\n` +
  `# Tool Usage\n\n` +
  `Include at least one tool call in every response. You may include brief reasoning text before tool calls.\n\n` +
  `Available tools:\n` +
  `- delegate(role, task, working_dir?) — Assign work to a specialist agent.\n` +
  `  Roles: architect (designs/plans), implementer (writes code), reviewer (reviews code), ` +
  `tester (writes/runs tests, verifies builds), debugger (diagnoses issues).\n` +
  `  Optional working_dir sets the agent's working directory.\n` +
  `- diagnose(action, target?) — Inspect codebase state without modifying anything.\n` +
  `  Actions: git_diff (working tree changes), git_log (recent commits), ` +
  `git_status (repo status), file_contents (read a file via target path).\n` +
  `- done(summary) — Report the goal is fully achieved.\n` +
  `- fail(reason) — Report unrecoverable failure.\n\n` +
  `You may call multiple delegate() tools in a single turn to run agents in parallel when their tasks are independent.\n` +
  `For diagnose(), done(), and fail() — call exactly one per turn.\n\n` +
  `# Project Context\n{project_context}\n\n` +
  `# Constraints\n\n` +
  `- You have no direct file access. To understand code, delegate to an architect or debugger, or use diagnose(file_contents).\n` +
  `- To modify code, delegate to an implementer.\n` +
  `- To run builds or tests, delegate to a tester.\n` +
  `- Write detailed, specific task descriptions when delegating. Include all context the specialist needs — ` +
  `they have no access to prior conversation.\n\n`;

const ORCHESTRATOR_RULES =
  `# Delegation Guidelines\n\n` +
  `- When delegating to an implementer, include the architect's full analysis and plan in the task description. ` +
  `The implementer cannot see previous agent outputs.\n` +
  `- When delegating to a reviewer, include the original goal/requirements so they can verify completeness.\n` +
  `- When delegating to a tester, specify what was changed and what to focus testing on.\n` +
  `- When delegating to a debugger, include the full error output and any relevant context from previous agents.\n` +
  `- After receiving agent results, proceed to the next step. ` +
  `Do not re-read code that an agent has already analyzed.\n` +
  `- If all acceptance criteria are met and tests pass, call done() immediately.\n`;

const ORCHESTRATOR_EXAMPLE =
  `# Example Delegation Chain\n\n` +
  `Here is an example of an ideal workflow for a small task:\n\n` +
  `1. delegate(role="architect", task="Analyze the user authentication module in src/auth/. The goal is to add rate limiting to login attempts. Read the existing code and design the solution with specific file changes needed.")\n` +
  `   → Architect returns: analysis, files to modify (src/auth/login.ts, src/auth/middleware.ts), implementation steps\n\n` +
  `2. delegate(role="implementer", task="Implement rate limiting for login attempts. [Full architect plan pasted here]. Follow the plan exactly.")\n` +
  `   → Implementer modifies the files per the plan\n\n` +
  `3. delegate(role="tester", task="Build the project and run tests. The login rate limiting was added in src/auth/login.ts and src/auth/middleware.ts.")\n` +
  `   → Tester reports: BUILD PASS, EXISTING TESTS PASS\n\n` +
  `4. delegate(role="reviewer", task="Review the rate limiting implementation. Original goal: add rate limiting to login attempts. [Architect plan summary].")\n` +
  `   → Reviewer returns: VERDICT: APPROVE\n\n` +
  `5. done(summary="Added login rate limiting: max 5 attempts per 15 minutes per IP, implemented in src/auth/login.ts with middleware in src/auth/middleware.ts. All tests pass, review approved.")\n\n`;

const CREATE_WORKFLOW =
  `# Workflow\n\n` +
  `1. **Plan**: Delegate to an architect to analyze the codebase and design the solution.\n` +
  `2. **Implement**: Delegate to implementer(s) to write the code. Include the architect's full plan in the task description.\n` +
  `   - For small, single-file changes: use one implementer.\n` +
  `   - For changes spanning multiple independent files/modules: use multiple implementers in parallel, one per module.\n` +
  `   - For changes with sequential dependencies: use one implementer or chain them sequentially.\n` +
  `3. **Verify**: Delegate to a tester to build and run tests. You may run the tester in parallel with the reviewer.\n` +
  `4. **Review**: Delegate to a reviewer to check the implementation against the original requirements.\n` +
  `5. **Fix**: If the tester or reviewer finds issues, delegate fixes to an implementer, then re-verify. ` +
  `Maximum 3 fix-retry cycles — if issues persist after 3 retries, call fail() with a summary of unresolved issues.\n` +
  `6. **Complete**: When tests pass and review is approved, call done() with a summary.\n\n` +
  `# Definition of Done\n` +
  `Before calling done(), verify:\n` +
  `- All acceptance criteria from the goal are satisfied\n` +
  `- The build succeeds\n` +
  `- Existing tests pass\n` +
  `- The reviewer has approved (or re-approved after fixes)\n\n`;

const FIX_WORKFLOW =
  `# Fix Workflow\n\n` +
  `This workflow repairs specific issues in existing code. Use targeted fixes rather than broad redesigns — ` +
  `the goal is to resolve the reported problem with minimal changes.\n\n` +
  `1. **Diagnose**: Delegate to a debugger to identify the root cause. Include the full error output and any reproduction steps.\n` +
  `2. **Fix**: Delegate to an implementer with the debugger's analysis. Include the root cause, affected files, and suggested fix.\n` +
  `3. **Verify**: Delegate to a tester to confirm the fix resolves the issue and existing tests still pass.\n` +
  `4. **Review**: Delegate to a reviewer to check the fix. Include the original error and the debugger's root cause analysis for context.\n` +
  `5. **Iterate**: If the reviewer requests changes, pass their feedback to an implementer and re-verify. ` +
  `Maximum 2 review-retry cycles — if issues persist, call fail() with the unresolved feedback.\n` +
  `6. **Complete**: When tests pass and review is approved, call done().\n\n` +
  `The architect role is not used in fix workflows because fixes should be scoped to the specific problem, ` +
  `not redesigned from scratch.\n\n`;

const INVESTIGATE_WORKFLOW =
  `# Investigation Workflow\n\n` +
  `This is a **read-only investigation**. You must NOT modify any code. Your goal is to produce ` +
  `a structured investigation report that answers the questions in the goal.\n\n` +
  `1. **Analyze**: Delegate to an architect to read and analyze the relevant parts of the codebase.\n` +
  `   - Use diagnose() to inspect git state, read specific files, or check repo status.\n` +
  `   - For broad analysis, delegate to an architect with a focused question.\n` +
  `   - You may run multiple architect delegations in parallel to investigate different areas.\n` +
  `2. **Synthesize**: After collecting all findings, synthesize them into a structured report.\n` +
  `3. **Complete**: Call done(summary="...") with the full investigation report.\n\n` +
  `## Output Format\n` +
  `Your done() summary MUST follow this structure:\n` +
  `## FINDINGS\nKey discoveries and answers to the investigation questions.\n\n` +
  `## EVIDENCE\nSpecific file paths, code snippets, and data points that support the findings.\n\n` +
  `## CONCLUSIONS\nSynthesized conclusions and actionable recommendations.\n\n` +
  `## OPEN QUESTIONS\nAnything that could not be determined and would need further investigation.\n\n` +
  `# Constraints\n` +
  `- **Read-only**: Do NOT delegate to implementer or tester roles. Only use architect and debugger.\n` +
  `- Do NOT modify files, run builds, or create branches.\n` +
  `- Focus on answering the specific questions in the goal.\n` +
  `- Be thorough — read actual code, don't speculate.\n\n`;

const PLAN_WORKFLOW =
  `# Planning Workflow\n\n` +
  `This is a **read-only planning** session. You must NOT modify any code. Your goal is to produce ` +
  `a structured architectural plan for the changes described in the goal.\n\n` +
  `1. **Analyze**: Delegate to an architect to read the codebase and design the solution.\n` +
  `   - The architect should analyze the current code structure, identify files to modify/create,\n` +
  `     and produce a detailed implementation plan.\n` +
  `   - Use diagnose() to inspect git state or read specific files for additional context.\n` +
  `   - For complex plans, you may delegate to multiple architects to analyze different subsystems.\n` +
  `2. **Synthesize**: Combine architect findings into a comprehensive plan.\n` +
  `3. **Complete**: Call done(summary="...") with the full architectural plan.\n\n` +
  `## Output Format\n` +
  `Your done() summary MUST follow this structure:\n` +
  `## ANALYSIS\nSummary of the current codebase state relevant to the planned changes.\n\n` +
  `## FILES TO MODIFY\nList each file path with a description of what changes are needed.\n\n` +
  `## FILES TO CREATE\nAny new files needed, with their purpose and contents outline.\n\n` +
  `## IMPLEMENTATION STEPS\nOrdered, specific steps to implement the plan. Group parallelizable steps.\n` +
  `Note dependencies between steps.\n\n` +
  `## KEY DECISIONS\nArchitectural choices made and their rationale.\n\n` +
  `## RISKS\nPotential issues, edge cases, and migration concerns.\n\n` +
  `## ESTIMATED COMPLEXITY\nOverall assessment of the effort required.\n\n` +
  `# Constraints\n` +
  `- **Read-only**: Do NOT delegate to implementer or tester roles. Only use architect.\n` +
  `- Do NOT modify files, run builds, or create branches.\n` +
  `- Ground the plan in actual code — read files before recommending changes.\n` +
  `- Be specific enough that an implementer could follow the plan directly.\n\n`;

/**
 * System prompt for CREATION orchestrator sessions.
 */
export const ORCHESTRATOR_SYSTEM_PROMPT = ORCHESTRATOR_PREAMBLE + ORCHESTRATOR_RULES + ORCHESTRATOR_EXAMPLE + CREATE_WORKFLOW;

/**
 * System prompt for FIX orchestrator sessions.
 * Replaces the creation workflow with the fix workflow.
 */
export const ORCHESTRATOR_FIX_PROMPT = ORCHESTRATOR_PREAMBLE + ORCHESTRATOR_RULES + ORCHESTRATOR_EXAMPLE + FIX_WORKFLOW;

export const ORCHESTRATOR_INVESTIGATE_PROMPT = ORCHESTRATOR_PREAMBLE + ORCHESTRATOR_RULES + INVESTIGATE_WORKFLOW;
export const ORCHESTRATOR_PLAN_PROMPT = ORCHESTRATOR_PREAMBLE + ORCHESTRATOR_RULES + PLAN_WORKFLOW;

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
  private _stepAttempts = 0;
  private mcpCommandReceived = false;
  private teamId = '';
  private agentCounter = 0;
  private contextProfileIds: string[] = [];
  private pendingChildren = new Map<string, PendingChild>();
  private orchestratorTurnDone = false;
  private turnResults: string[] = [];
  private autoCommit = false;
  private gitAvailable = false;
  private epicOptions: OrchestratorOptions | null = null;
  private _pipelineType: EpicPipelineType = 'create';
  private childTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private childOutputs: Array<{ role: string; agentName: string; output: string }> = [];
  private orchestrationLog: Array<{ timestamp: number; event: string; details: string }> = [];
  private autoProfiles: TechProfile[] = [];

  static readonly MCP_SERVER_NAME = 'c3p2-orchestrator';
  static readonly MAX_STEP_ATTEMPTS = 5;
  static readonly MAX_TOTAL_DELEGATIONS = 100;
  static readonly CHILD_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

  setChatPanel(panel: OrchestratorChatPanelAPI) { this.chatPanel = panel; }
  setWorkspace(ws: string) { this.workspace = ws; }
  setEpicOptions(opts: OrchestratorOptions | null) { this.epicOptions = opts; }
  getEpicOptions() { return this.epicOptions; }
  setPipelineType(type: EpicPipelineType) { this._pipelineType = type; }
  getPipelineType() { return this._pipelineType; }
  isFixMode() { return this._pipelineType === 'fix'; }
  isReadOnly() { return this._pipelineType === 'investigate' || this._pipelineType === 'plan'; }
  isRunning() { return this._running; }
  isEpicScoped() { return this.epicOptions !== null; }
  sessionId() { return this._sessionId; }
  currentPhase() { return this._currentPhase; }
  totalDelegations() { return this._totalDelegations; }
  getOrchestrationLog() { return this.orchestrationLog; }

  setAutoProfiles(profiles: TechProfile[]): void {
    this.autoProfiles = profiles;
    if (profiles.length > 0) {
      this.logEvent('autoProfilesDetected', profiles.map(p => p.name).join(', '));
      this.events.emit('autoProfilesDetected', { profiles });
    }
  }
  getAutoProfiles(): TechProfile[] { return this.autoProfiles; }
  getAutoProfileIds(): string[] { return this.autoProfiles.map(p => p.id); }

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
        if (existing.includes('version: 4.0.0')) {
          needsInstall = false;
        }
      } catch { /* doesn't exist */ }

      if (needsInstall) {
        try {
          const srcPath = await resolveResource('resources/mcp/orchestrator_server.py');
          console.log('[Orchestrator] Copying MCP script from', srcPath, 'to', targetPath);
          const content = await readTextFile(srcPath);
          await writeTextFile(targetPath, content);
          console.log('[Orchestrator] MCP script installed successfully');
        } catch (copyErr) {
          console.warn('[Orchestrator] Could not copy MCP script from resources:', copyErr);
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

    const mcpOk = await Orchestrator.ensureMcpServerInstalled();
    if (!mcpOk) {
      console.warn('[Orchestrator] MCP server installation/update failed — continuing (server may already be installed from a previous run)');
    }

    this.autoCommit = autoCommit;
    if (autoCommit) await this.detectGit();

    this._running = true;
    this.contextProfileIds = contextProfileIds;
    this._totalDelegations = 0;
    this._stepAttempts = 0;
    this.mcpCommandReceived = false;
    this.orchestratorTurnDone = false;
    this.turnResults = [];
    this.pendingChildren.clear();
    this.childTimeouts.clear();
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

    this.logEvent('started', `session=${this._sessionId}, team=${this.teamId}, pipelineType=${this._pipelineType}`);

    const initialMessage = Orchestrator.buildInitialMessage(goal, {
      autoCommit: this.autoCommit,
      gitAvailable: this.gitAvailable,
      epicOptions: this.epicOptions,
      pipelineType: this._pipelineType,
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
    pipelineType?: EpicPipelineType;
    epicContext?: string;
  }): string {
    const opts = options || {};
    const pipelineType: EpicPipelineType = opts.pipelineType || (opts.fixMode ? 'fix' : 'create');
    const isReadOnly = pipelineType === 'investigate' || pipelineType === 'plan';

    const extraTools: string[] = [];
    if (opts.autoCommit && opts.gitAvailable && !isReadOnly) {
      extraTools.push(`- \`checkpoint(message)\` — create a git checkpoint commit to save progress`);
    }
    if (opts.epicOptions && !isReadOnly) {
      extraTools.push(`- \`spawn_orchestrator(task, working_dir?)\` — spawn a child orchestrator for complex sub-tasks`);
    }

    let message = `# Goal\n\n${goal}\n\n`;

    if (extraTools.length > 0) {
      message += `# Additional Tools\n${extraTools.join('\n')}\n\n`;
    }

    if (opts.epicContext) {
      message += opts.epicContext;
    }

    const toolNames = ['delegate', 'diagnose'];
    if (opts.autoCommit && opts.gitAvailable && !isReadOnly) toolNames.push('checkpoint');
    if (opts.epicOptions && !isReadOnly) toolNames.push('spawn_orchestrator');
    toolNames.push('done', 'fail');
    message += `Available tools: ${toolNames.join(', ')}. See system prompt for details.\n\n`;

    switch (pipelineType) {
      case 'fix':
        message += `Start by calling diagnose(action="git_diff") to see the current state, ` +
          `then delegate to a debugger to analyze the rejection feedback.\n`;
        break;
      case 'investigate':
        message += `Start by calling delegate(role="architect", task="...") to analyze the codebase and investigate the questions above.\n`;
        break;
      case 'plan':
        message += `Start by calling delegate(role="architect", task="...") to analyze the codebase and design the solution described above.\n`;
        break;
      default:
        message += `Start by calling delegate(role="architect", task="...") to analyze the codebase and design the solution.\n`;
        break;
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
    this._stepAttempts = 0;
    this.mcpCommandReceived = false;
    this.orchestratorTurnDone = false;
    this.turnResults = [];
    this.pendingChildren.clear();
    this.childTimeouts.clear();
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

    // Reset per-turn tracking on the first tool call of a new turn
    if (!this.mcpCommandReceived) {
      this.turnResults = [];
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

    // Try to flush any accumulated turn results now that the process is done.
    // Results may have been queued while the Claude CLI was still running.
    if (this.turnResults.length > 0) {
      this.mcpCommandReceived = false;
      this.flushTurnResults();
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

    // Escalating recovery messages — generic nudge → concrete suggestion → forced termination
    let message: string;
    if (this._stepAttempts <= 2) {
      let hint = '';
      if (this._totalDelegations === 0) {
        if (this._pipelineType === 'fix') {
          hint = ' Start by calling diagnose(action="git_diff") to inspect the current state.';
        } else {
          hint = ' Start by calling delegate(role="architect", task="...") to analyze the codebase.';
        }
      } else {
        hint = ' Call delegate(role="implementer", task="...") to write the code, ' +
          'or delegate(role="tester", task="verify builds") to check existing work, or done(summary="...") if finished.';
      }
      message =
        `ERROR: Your response did not include a tool call. You MUST call one of: ` +
        `delegate, diagnose, done, or fail. ` +
        `You cannot read files or use other tools — only MCP orchestrator tools.` +
        hint;
    } else if (this._stepAttempts === 3) {
      message =
        `ERROR: No tool call detected (attempt ${this._stepAttempts}/${Orchestrator.MAX_STEP_ATTEMPTS}). ` +
        `You have completed ${this._totalDelegations} delegation(s) so far. ` +
        `You MUST call exactly one tool now. Choose one:\n` +
        `- done(summary="<describe what was accomplished>") — if all work is complete\n` +
        `- fail(reason="<explain why>") — if the goal cannot be achieved\n` +
        `- delegate(role="implementer", task="<specific task>") — if more work is needed\n` +
        `- delegate(role="tester", task="verify builds pass") — to verify existing work`;
    } else {
      message =
        `FINAL WARNING (attempt ${this._stepAttempts}/${Orchestrator.MAX_STEP_ATTEMPTS}): ` +
        `You must call done() or fail() NOW. ` +
        `Next response without a tool call will terminate this orchestration as failed. ` +
        `Call done(summary="...") if any progress was made, or fail(reason="...") otherwise.`;
    }

    this.feedResult(message);
  }

  // ── Command Execution (shared by MCP and fallback paths) ───────────────

  private executeCommand(cmd: OrchestratorCommand) {
    switch (cmd.action) {
      case 'delegate':
        this.executeDelegation(cmd);
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
        this.feedResult('ERROR: Unknown action. Use delegate, diagnose, done, or fail.');
        break;
    }
  }

  private async executeDelegation(cmd: OrchestratorCommand) {
    if (!cmd.role || !cmd.task || !this.chatPanel) return;

    if (this.isReadOnly()) {
      const allowedRoles = ['architect', 'debugger'];
      if (!allowedRoles.includes(cmd.role!.toLowerCase())) {
        this.feedResult(
          `ERROR: Role "${cmd.role}" is not allowed in ${this._pipelineType} pipelines. ` +
          `Only architect and debugger roles are permitted. This is a read-only pipeline.`
        );
        return;
      }
    }

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

  // ── Diagnose (inspect codebase state — executed by MCP server) ─────

  /**
   * Diagnose: state tracking only.
   * The MCP server executes the command synchronously and returns real results
   * directly to Claude. The orchestrator only tracks phase/events.
   */
  private executeDiagnose(cmd: OrchestratorCommand) {
    this._currentPhase = `diagnosing: ${cmd.diagnoseAction || ''}`;
    this.events.emit('phaseChanged', { phase: this._currentPhase });
    this.logEvent('diagnose', `action=${cmd.diagnoseAction || ''} target=${cmd.target || ''}`);
  }

  // ── Artifact Collection ────────────────────────────────────────────

  private emitArtifacts() {
    this.events.emit('artifactsCollected', {
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

    this.enqueueTurnResult(
      `${count} agent(s) completed successfully.${checkpointInfo}\n\n${parts.join('\n\n---\n\n')}\n\n` +
      `IMPORTANT: Respond with exactly one tool call. Choose one:\n` +
      `- delegate(role, task) — if more work is needed\n` +
      `- delegate(role="tester", task="verify builds/tests pass") — to verify the work\n` +
      `- done(summary) — if all work is complete`,
    );
    this.flushTurnResults();
  }

  // ── Turn Result Accumulation ────────────────────────────────────────────
  //
  // When the orchestrator calls multiple tools in one turn (e.g. multiple delegates),
  // results arrive independently. We accumulate them and only send a single combined
  // message back when ALL operations from the turn are complete.

  /**
   * Queue a result string for the current turn.
   * Does NOT send immediately — call flushTurnResults() to check if all
   * pending operations are done and send the combined result.
   */
  private enqueueTurnResult(resultText: string) {
    if (!this._running || !this.chatPanel) return;
    this.events.emit('progressUpdate', { message: resultText.substring(0, 100) + '...' });
    this.turnResults.push(resultText);
  }

  /**
   * Check whether all pending operations for the current turn are done.
   * If so, concatenate all queued results and send as one message.
   * If not, defer — the last completing operation will trigger the flush.
   */
  private flushTurnResults() {
    if (!this._running || !this.chatPanel) return;
    if (this.turnResults.length === 0) return;

    // Wait for all children to complete (if any were spawned this turn)
    for (const pc of this.pendingChildren.values()) {
      if (!pc.completed) return;
    }

    // Not safe to send yet — the Claude process is still running
    if (!this.orchestratorTurnDone) {
      console.log('[Orchestrator] Deferring flush (process still running)');
      return;
    }

    // All done — combine and send
    const combined = this.turnResults.join('\n\n---\n\n');
    this.turnResults = [];
    this.orchestratorTurnDone = false;
    this.chatPanel.sendMessageToSession(this._sessionId, combined);
  }

  /**
   * Legacy convenience: enqueue a result and immediately attempt to flush.
   * Used by single-result paths (diagnose, checkpoint, error messages, fallback).
   */
  private feedResult(resultText: string) {
    this.enqueueTurnResult(resultText);
    this.flushTurnResults();
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
    let prompt: string;
    switch (this._pipelineType) {
      case 'fix':
        prompt = ORCHESTRATOR_FIX_PROMPT;
        break;
      case 'investigate':
        prompt = ORCHESTRATOR_INVESTIGATE_PROMPT;
        break;
      case 'plan':
        prompt = ORCHESTRATOR_PLAN_PROMPT;
        break;
      default:
        prompt = ORCHESTRATOR_SYSTEM_PROMPT;
        break;
    }
    prompt = prompt.replace('{project_context}', 'Project context will be provided in the goal message below.');

    if (this.autoCommit && !this.isReadOnly()) {
      prompt +=
        `\n\n# Checkpointing\n\n` +
        `Auto-commit is enabled. After completing each phase (architect, implement, test, review), ` +
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
