/**
 * HybridPipelineRunner — coded state machine for the hybrid pipeline.
 *
 * Replaces the LLM-driven Orchestrator for pipelineType='hybrid'.
 * Drives phase transitions programmatically in TypeScript:
 *   Phase 1: Architect plans → Counterpart verifies (challenge loop)
 *   Phase 2: Sequential incremental build — each increment is built
 *            and verified (compile/smoke test) before starting the next
 *   Phase 3: Persistent counterpart reviews → fix loop
 *   Phase 4: Tester + persistent counterpart final review
 *
 * Uses existing delegation infrastructure (ProcessManager, HeadlessHandle)
 * for specialist agents, and Claude CLI --json-schema for structured
 * extraction of verdicts, increment plans, and test results.
 */

import mitt from 'mitt';
import { Command } from '@tauri-apps/plugin-shell';
import { homeDir } from '@tauri-apps/api/path';
import { exists } from '@tauri-apps/plugin-fs';
import { SPECIALIST_PROMPTS, SPECIALIST_TOOLS } from './Orchestrator';
import type { OrchestratorEvents } from './Orchestrator';
import type { HeadlessHandle } from './HeadlessHandle';
import type { ProcessManager } from './ProcessManager';
import type { SessionService } from './SessionService';
import type { TechProfile } from './TechDetector';
import { buildTechPromptPrefix } from './TechDetector';
import { engineBus } from './EventBus';

// ── JSON Schemas for structured extraction ────────────────────────────────

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['approved', 'challenged', 'approve', 'request_changes'] },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['critical', 'major', 'nit'] },
          description: { type: 'string' },
        },
        required: ['severity', 'description'],
      },
    },
  },
  required: ['verdict'],
};

const INCREMENT_SCHEMA = {
  type: 'object',
  properties: {
    increments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          task: { type: 'string' },
          verification: { type: 'string' },
        },
        required: ['name', 'description', 'files', 'task', 'verification'],
      },
    },
  },
  required: ['increments'],
};

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    passed: { type: 'boolean' },
    errors: { type: 'array', items: { type: 'string' } },
  },
  required: ['passed'],
};

const TEST_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    buildPassed: { type: 'boolean' },
    testsPassed: { type: 'boolean' },
    failures: { type: 'array', items: { type: 'string' } },
  },
  required: ['buildPassed', 'testsPassed'],
};

// ── Types ────────────────────────────────────────────────────────────────

interface Verdict {
  verdict: 'approved' | 'challenged' | 'approve' | 'request_changes';
  issues?: Array<{ severity: string; description: string }>;
}

interface IncrementPlan {
  increments: Array<{
    name: string;
    description: string;
    files: string[];
    task: string;
    verification: string;
  }>;
}

interface VerifyResult {
  passed: boolean;
  errors?: string[];
}

interface TestResult {
  buildPassed: boolean;
  testsPassed: boolean;
  failures?: string[];
}

export interface HybridPipelineOptions {
  handle: HeadlessHandle;
  processes: ProcessManager;
  sessions: SessionService;
  workspace: string;
  model?: string;
  epicId: string;
  autoProfiles: TechProfile[];
}

// ── Runner ───────────────────────────────────────────────────────────────

export class HybridPipelineRunner {
  readonly events = mitt<OrchestratorEvents>();
  on = this.events.on.bind(this.events);
  off = this.events.off.bind(this.events);

  private handle: HeadlessHandle;
  private processes: ProcessManager;
  private sessions: SessionService;
  private workspace: string;
  private model: string | undefined;
  private epicId: string;
  private autoProfiles: TechProfile[];

  private _running = false;
  private _cancelled = false;
  private _currentPhase = '';
  private rootSessionId = '';
  private agentCounter = 0;
  private childOutputs: Array<{ role: string; agentName: string; output: string }> = [];
  private pendingResolvers = new Map<string, (result: string) => void>();
  private activeProcesses = new Set<string>();
  private counterpartSessionId: string | null = null;
  private architectSessionId: string | null = null;
  private _goal = '';

  static readonly AGENT_TIMEOUT_MS = 120 * 60 * 1000;

  constructor(opts: HybridPipelineOptions) {
    this.handle = opts.handle;
    this.processes = opts.processes;
    this.sessions = opts.sessions;
    this.workspace = opts.workspace;
    this.model = opts.model;
    this.epicId = opts.epicId;
    this.autoProfiles = opts.autoProfiles;

    this.handle.onDelegateFinished = (childSid, result) => {
      this.sessions.persistSession(childSid);
      this.activeProcesses.delete(childSid);
      const resolver = this.pendingResolvers.get(childSid);
      if (resolver) {
        this.pendingResolvers.delete(childSid);
        resolver(result);
      }
    };
    this.handle.onPersistSession = (sid) => {
      this.sessions.persistSession(sid);
    };
  }

  isRunning(): boolean { return this._running; }
  currentPhase(): string { return this._currentPhase; }

  cancel(): void {
    this._cancelled = true;
    this._running = false;
    for (const sid of this.activeProcesses) {
      this.processes.cancelProcess(sid);
    }
    this.activeProcesses.clear();
    for (const resolver of this.pendingResolvers.values()) {
      resolver('CANCELLED');
    }
    this.pendingResolvers.clear();
    this.setPhase('cancelled');
    this.events.emit('failed', { reason: 'Pipeline cancelled' });
  }

  // ── Main state machine ──────────────────────────────────────────────

  async run(goal: string, acceptanceCriteria: string): Promise<void> {
    this._running = true;
    this._cancelled = false;
    this._goal = goal;

    try {
      // ── Phase 1: Plan ──────────────────────────────────────────
      this.setPhase('planning');
      this.log('Phase 1: Architect planning');

      let plan = await this.delegateArchitect(this.architectTask(goal, acceptanceCriteria));
      if (this._cancelled) return;

      this.setPhase('verifying plan');
      let planVerdict = await this.extractVerdict(
        await this.delegateCounterpart(this.planReviewTask(plan, acceptanceCriteria)),
      );
      if (this._cancelled) return;

      let revisionCycles = 0;
      while (this.isChallenged(planVerdict) && revisionCycles < 5) {
        revisionCycles++;
        this.log(`Plan challenged (cycle ${revisionCycles}/2), revising`);
        this.setPhase(`revising plan (cycle ${revisionCycles})`);

        const issueText = this.formatIssues(planVerdict);
        const rewrittenPlan = await this.delegateArchitect(this.revisionTask(plan, issueText));
        if (this._cancelled) return;

        // Full rewrite replaces the plan — no additive layering.
        // The architect's persistent session has full context; its output
        // is a complete, self-contained plan that supersedes the previous one.
        plan = rewrittenPlan;

        this.setPhase('re-verifying plan');
        planVerdict = await this.extractVerdict(
          await this.delegateCounterpart(this.planReviewTask(plan, acceptanceCriteria)),
        );
        if (this._cancelled) return;
      }

      const approvedPlan = plan;
      this.architectSessionId = null;
      this.log('Plan approved, splitting into increments');

      // ── Split plan into sequential increments ──────────────────
      this.setPhase('splitting plan');
      const incrementPlan = await this.splitIntoIncrements(approvedPlan);
      this.validateIncrements(incrementPlan.increments);
      const increments = incrementPlan.increments;
      this.log(`Plan split into ${increments.length} increments: ${increments.map(inc => inc.name).join(', ')}`);

      // ── Phase 2: Incremental Build ─────────────────────────────
      this.setPhase('implementing');
      this.log(`Phase 2: Incremental build (${increments.length} increments)`);

      const incrementResults: string[] = [];

      for (let i = 0; i < increments.length; i++) {
        const inc = increments[i];
        this.setPhase(`building increment ${i + 1}/${increments.length}: ${inc.name}`);
        this.log(`Increment ${i + 1}/${increments.length}: ${inc.name}`);
        if (this._cancelled) return;

        // 2a. Builder implements this increment
        let builderOutput = await this.delegateAgent('builder', this.incrementTask(inc, i, increments.length));
        if (this._cancelled) return;

        // 2b. Verify (compile check / smoke test)
        this.setPhase(`verifying increment ${i + 1}/${increments.length}: ${inc.name}`);
        let verifyResult = await this.verifyIncrement(inc);
        if (this._cancelled) return;

        // 2c. Fix loop if verification fails (max 3 cycles per increment)
        let incrementFixCycles = 0;
        while (!verifyResult.passed && incrementFixCycles < 3) {
          incrementFixCycles++;
          this.log(`Increment "${inc.name}" verification failed (cycle ${incrementFixCycles}/3), fixing`);
          this.setPhase(`fixing increment ${i + 1}: ${inc.name} (cycle ${incrementFixCycles})`);

          const fixIssues = (verifyResult.errors || []).join('\n') || 'Verification failed — see above.';
          builderOutput = await this.delegateAgent('builder', this.fixTask(
            `Increment "${inc.name}" failed verification.\n\n## Errors\n${fixIssues}\n\n## Verification criteria\n${inc.verification}\n\n## Files involved\n${inc.files.join('\n')}`,
          ));
          if (this._cancelled) return;

          this.setPhase(`re-verifying increment ${i + 1}: ${inc.name} (cycle ${incrementFixCycles})`);
          verifyResult = await this.verifyIncrement(inc);
          if (this._cancelled) return;
        }

        if (!verifyResult.passed) {
          this.log(`Increment "${inc.name}" still failing after ${incrementFixCycles} fix cycles — continuing to next increment`);
        }

        incrementResults.push(`## Increment ${i + 1}: ${inc.name}\n\n${builderOutput}`);
      }

      const allBuilderOutput = incrementResults.join('\n\n---\n\n');

      // ── Phase 3: Verify and Fix Loop ───────────────────────────
      this.setPhase('reviewing implementation');
      this.log('Phase 3: Counterpart review');

      let codeVerdict = await this.extractVerdict(
        await this.delegateCounterpart(this.codeReviewTask(approvedPlan, allBuilderOutput, acceptanceCriteria)),
      );
      if (this._cancelled) return;

      let fixCycles = 0;
      while (this.hasChangesRequested(codeVerdict) && fixCycles < 20) {
        fixCycles++;
        this.log(`Changes requested (cycle ${fixCycles}/3), fixing`);
        this.setPhase(`fixing (cycle ${fixCycles})`);

        const fixIssues = this.formatIssues(codeVerdict);
        const fixResult = await this.delegateAgent('builder', this.fixTask(fixIssues));
        if (this._cancelled) return;

        this.setPhase(`re-reviewing (cycle ${fixCycles})`);
        codeVerdict = await this.extractVerdict(
          await this.delegateCounterpart(this.recheckTask(fixIssues, fixResult)),
        );
        if (this._cancelled) return;
      }

      // ── Phase 4: Final Verification (test → review → fix loop) ──
      this.setPhase('testing');
      this.log('Phase 4: Testing');

      let phase4Cycles = 0;
      const MAX_PHASE4_CYCLES = 20;

      // Step 1: Initial test
      let lastTesterOutput = await this.delegateAgent('tester', this.testTask());
      if (this._cancelled) return;
      let lastTestResult = await this.extractTestResult(lastTesterOutput);

      // Fix test failures if needed
      while ((!lastTestResult.buildPassed || !lastTestResult.testsPassed) && phase4Cycles < MAX_PHASE4_CYCLES) {
        phase4Cycles++;
        this.log(`Tests failed (cycle ${phase4Cycles}/${MAX_PHASE4_CYCLES}), fixing`);
        this.setPhase(`fixing test failures (cycle ${phase4Cycles})`);

        const failureText = (lastTestResult.failures || []).join('\n');
        await this.delegateAgent('builder', this.fixTask(`Test failures:\n${failureText}\n\nFull tester output:\n${lastTesterOutput}`));
        if (this._cancelled) return;

        lastTesterOutput = await this.delegateAgent('tester', this.testTask());
        if (this._cancelled) return;
        lastTestResult = await this.extractTestResult(lastTesterOutput);
      }

      if (!lastTestResult.buildPassed || !lastTestResult.testsPassed) {
        this._running = false;
        this.setPhase('failed');
        this.events.emit('failed', { reason: `Tests still failing after ${phase4Cycles} fix cycles` });
        return;
      }

      // Step 2: Counterpart final review + fix loop (same pattern as Phase 3)
      this.setPhase('final review');
      this.log('Phase 4: Final counterpart review');

      let finalVerdict = await this.extractVerdict(
        await this.delegateCounterpart(this.finalReviewTask(goal, acceptanceCriteria)),
      );
      if (this._cancelled) return;

      while (this.hasChangesRequested(finalVerdict) && phase4Cycles < MAX_PHASE4_CYCLES) {
        phase4Cycles++;
        this.log(`Final review requested changes (cycle ${phase4Cycles}/${MAX_PHASE4_CYCLES}), fixing`);
        this.setPhase(`final fixes (cycle ${phase4Cycles})`);

        const finalIssues = this.formatIssues(finalVerdict);
        const fixResult = await this.delegateAgent('builder', this.fixTask(finalIssues));
        if (this._cancelled) return;

        // Re-test after fix
        this.setPhase(`re-testing (cycle ${phase4Cycles})`);
        const retestOutput = await this.delegateAgent('tester', this.testTask());
        if (this._cancelled) return;
        const retestResult = await this.extractTestResult(retestOutput);

        if (!retestResult.buildPassed || !retestResult.testsPassed) {
          this.log(`Tests failed after fix cycle ${phase4Cycles}, fixing tests`);
          const failureText = (retestResult.failures || []).join('\n');
          await this.delegateAgent('builder', this.fixTask(`Test failures after review fix:\n${failureText}\n\nFull tester output:\n${retestOutput}`));
          if (this._cancelled) return;

          const reRetestOutput = await this.delegateAgent('tester', this.testTask());
          if (this._cancelled) return;
          const reRetestResult = await this.extractTestResult(reRetestOutput);
          if (!reRetestResult.buildPassed || !reRetestResult.testsPassed) {
            this._running = false;
            this.setPhase('failed');
            this.events.emit('failed', { reason: `Tests failing after final review fix cycle ${phase4Cycles}` });
            return;
          }
        }

        // Counterpart re-verifies the fixes
        this.setPhase(`counterpart re-verifying (cycle ${phase4Cycles})`);
        finalVerdict = await this.extractVerdict(
          await this.delegateCounterpart(this.recheckTask(finalIssues, fixResult)),
        );
        if (this._cancelled) return;
      }

      if (this.hasChangesRequested(finalVerdict)) {
        this._running = false;
        this.setPhase('failed');
        this.events.emit('failed', { reason: `Counterpart still requesting changes after ${phase4Cycles} Phase 4 cycles` });
        return;
      }

      // ── Done ───────────────────────────────────────────────────
      this._running = false;
      this.setPhase('completed');
      this.events.emit('artifactsCollected', { childOutputs: this.childOutputs });

      const summary = `Hybrid pipeline completed for epic ${this.epicId}. ` +
        `${increments.length} increments built, ` +
        `${fixCycles} fix cycle(s), tests passed, counterpart approved.`;

      this.events.emit('completed', { summary });
      this.log(summary);

    } catch (err) {
      if (this._cancelled) return;
      this._running = false;
      this.setPhase('failed');
      const reason = err instanceof Error ? err.message : String(err);
      this.events.emit('failed', { reason });
      console.error('[HybridPipeline] Fatal error:', reason);
    }
  }

  // ── Agent delegation ────────────────────────────────────────────────

  static readonly CRASH_THRESHOLD_MS = 10_000;
  static readonly MAX_CRASH_RETRIES = 2;

  private async delegateAgent(role: string, task: string): Promise<string> {
    const { result } = await this.delegateAgentReturningSid(role, task);
    return result;
  }

  private async delegateAgentReturningSid(role: string, task: string): Promise<{ sessionId: string; result: string }> {
    for (let attempt = 0; attempt <= HybridPipelineRunner.MAX_CRASH_RETRIES; attempt++) {
      const startTime = Date.now();
      const { sessionId, result } = await this.spawnAgent(role, task);
      const elapsed = Date.now() - startTime;

      if (elapsed < HybridPipelineRunner.CRASH_THRESHOLD_MS && attempt < HybridPipelineRunner.MAX_CRASH_RETRIES) {
        this.log(`Agent ${role} exited in ${elapsed}ms (< ${HybridPipelineRunner.CRASH_THRESHOLD_MS}ms) — likely crashed. Retrying (attempt ${attempt + 1}/${HybridPipelineRunner.MAX_CRASH_RETRIES})...`);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      return { sessionId, result };
    }
    throw new Error(`Agent ${role} crashed ${HybridPipelineRunner.MAX_CRASH_RETRIES + 1} times`);
  }

  private async spawnAgent(role: string, task: string): Promise<{ sessionId: string; result: string }> {
    const agentName = this.generateAgentName(role);

    this.events.emit('delegationStarted', {
      role,
      task: task.substring(0, 200),
      parentSessionId: this.rootSessionId,
    });

    const childSid = this.sessions.manager.createChildSession(
      this.rootSessionId, this.workspace, 'agent', task,
    );
    const childInfo = this.sessions.getSession(childSid);
    if (childInfo) {
      childInfo.title = agentName.charAt(0).toUpperCase() + agentName.slice(1);
      childInfo.epicId = this.epicId;
    }
    await this.sessions.persistSession(childSid);
    engineBus.emit('session:created', { sessionId: childSid, parentSessionId: this.rootSessionId });

    const systemPrompt = this.buildSystemPrompt(role);

    const result = await new Promise<string>((resolve, reject) => {
      this.activeProcesses.add(childSid);

      const timeout = setTimeout(() => {
        if (this.pendingResolvers.has(childSid)) {
          this.processes.cancelProcess(childSid);
          this.pendingResolvers.delete(childSid);
          this.activeProcesses.delete(childSid);
          reject(new Error(`Agent ${agentName} timed out after ${HybridPipelineRunner.AGENT_TIMEOUT_MS / 1000}s`));
        }
      }, HybridPipelineRunner.AGENT_TIMEOUT_MS);

      this.pendingResolvers.set(childSid, (r) => {
        clearTimeout(timeout);
        this.childOutputs.push({ role, agentName, output: r });
        resolve(r);
      });

      this.processes.sendMessage(childSid, task, this.handle, {
        workingDir: this.workspace,
        mode: 'agent',
        model: this.model,
        systemPrompt,
        agentName,
        specialistRole: role,
      });
    });

    return { sessionId: childSid, result };
  }

  private async delegateArchitect(task: string): Promise<string> {
    return this.delegatePersistentRole('architect', task, 'architectSessionId');
  }

  private async delegateCounterpart(task: string): Promise<string> {
    return this.delegatePersistentRole('counterpart', task, 'counterpartSessionId');
  }

  /**
   * Delegate to a persistent role. First call creates a new session;
   * subsequent calls reuse the same session (full context preserved).
   */
  private async delegatePersistentRole(
    role: string,
    task: string,
    sessionIdField: 'counterpartSessionId' | 'architectSessionId',
  ): Promise<string> {
    if (!this[sessionIdField]) {
      const { sessionId, result } = await this.delegateAgentReturningSid(role, task);
      this[sessionIdField] = sessionId;
      return result;
    }

    const sid = this[sessionIdField]!;
    const agentName = `${role} (persistent)`;
    this.events.emit('delegationStarted', {
      role,
      task: task.substring(0, 200),
      parentSessionId: this.rootSessionId,
    });

    this.handle.resetForReuse(sid);
    await this.handle.prepareForSend(sid, task);

    return new Promise<string>((resolve, reject) => {
      this.activeProcesses.add(sid);

      const timeout = setTimeout(() => {
        if (this.pendingResolvers.has(sid)) {
          this.processes.cancelProcess(sid);
          this.pendingResolvers.delete(sid);
          this.activeProcesses.delete(sid);
          reject(new Error(`${role} timed out after ${HybridPipelineRunner.AGENT_TIMEOUT_MS / 1000}s`));
        }
      }, HybridPipelineRunner.AGENT_TIMEOUT_MS);

      this.pendingResolvers.set(sid, (result) => {
        clearTimeout(timeout);
        this.childOutputs.push({ role, agentName, output: result });
        resolve(result);
      });

      this.processes.sendMessage(sid, task, this.handle, {
        workingDir: this.workspace,
        mode: 'agent',
        model: this.model,
        resumeSessionId: this.handle.getRealSessionId(sid) || undefined,
      });
    });
  }

  // ── Structured extraction calls ─────────────────────────────────────

  private emitInternalCall(callType: 'extractVerdict' | 'splitPlan' | 'splitIncrements' | 'extractTestResult' | 'verifyIncrement', status: 'started' | 'completed'): void {
    engineBus.emit('pipeline:internalCall', { epicId: this.epicId, callType, status });
  }

  private async extractVerdict(agentOutput: string): Promise<Verdict> {
    this.emitInternalCall('extractVerdict', 'started');
    const result = await this.structuredCall<Verdict>(
      VERDICT_SCHEMA,
      `Extract the verdict and issues from this agent review output:\n\n${agentOutput}`,
    );
    this.emitInternalCall('extractVerdict', 'completed');
    return result;
  }

  private async splitIntoIncrements(plan: string): Promise<IncrementPlan> {
    this.emitInternalCall('splitIncrements', 'started');
    const result = await this.structuredCall<IncrementPlan>(
      INCREMENT_SCHEMA,
      `Split this architect plan into SEQUENTIAL build increments. Each increment is a deliverable step that builds on the previous ones. The runner will execute them in order, verifying each one before starting the next.

# Rules

1. Increments are ORDERED — each builds on the codebase state left by the previous increment.
2. Each increment MUST be independently verifiable: after building it, we run a check (compile, smoke test, curl, etc.) to confirm it works before moving on.
3. Increments CAN mix backend and frontend. Group by feature slice, not tech layer. E.g. "Add user auth" = backend JWT middleware + frontend login page.
4. Use 4-8 increments for typical projects. Start with scaffold/foundation, end with polish/integration.
5. Increment names must be short, lowercase, dash-separated identifiers (e.g. "scaffold", "data-layer", "core-api", "auth", "frontend-shell", "dashboard").
6. The "verification" field describes the specific check to run: "project compiles with no errors", "server starts and GET /health returns 200", "POST /api/users returns 201 with valid body", etc. Be concrete.
7. The "files" field lists files this increment will CREATE or MODIFY. Later increments may modify files from earlier ones — that is expected.
8. Small artifacts (README, docker-compose, config) belong in the earliest increment that needs them (usually "scaffold").

# Example

Increment 1: "scaffold" — project structure, configs, Dockerfile, docker-compose
  verification: "docker compose build succeeds with no errors"
Increment 2: "data-layer" — database schema, models, migrations
  verification: "migrations run clean, server starts without errors"
Increment 3: "core-api" — CRUD endpoints for main entities
  verification: "POST /api/items returns 201, GET /api/items returns list"
Increment 4: "auth" — JWT middleware, login/register endpoints, protected routes
  verification: "POST /api/auth/register returns 201, POST /api/auth/login returns token"
Increment 5: "frontend-shell" — app skeleton, routing, layout, auth pages
  verification: "npm run build succeeds, app serves without errors"
Increment 6: "frontend-features" — dashboard, data views, forms wired to API
  verification: "full build succeeds, app renders main views"

# Plan to split

${plan}`,
    );
    this.emitInternalCall('splitIncrements', 'completed');
    return result;
  }

  private async extractTestResult(testerOutput: string): Promise<TestResult> {
    this.emitInternalCall('extractTestResult', 'started');
    const result = await this.structuredCall<TestResult>(
      TEST_RESULT_SCHEMA,
      `Extract the test results from this tester output:\n\n${testerOutput}`,
    );
    this.emitInternalCall('extractTestResult', 'completed');
    return result;
  }

  private async verifyIncrement(
    increment: IncrementPlan['increments'][0],
  ): Promise<VerifyResult> {
    this.emitInternalCall('verifyIncrement', 'started');

    const testerOutput = await this.delegateAgent('tester',
      `Verify this increment works. Run ONLY the verification described below — do not run the full test suite or do a comprehensive review. This is a quick smoke test.

## Increment: ${increment.name}
${increment.description}

## Verification to perform
${increment.verification}

## Files changed
${increment.files.join('\n')}

Report whether verification passed or failed, with specific errors if any.`,
    );

    const result = await this.structuredCall<VerifyResult>(
      VERIFY_SCHEMA,
      `Extract whether this verification passed or failed:\n\n${testerOutput}`,
    );

    this.emitInternalCall('verifyIncrement', 'completed');
    return result;
  }

  private async structuredCall<T>(schema: object, prompt: string): Promise<T> {
    const claudeBin = await this.resolveClaudeBinary();
    const schemaJson = JSON.stringify(schema);

    // Write the prompt to a temp file to avoid shell escaping issues with large agent outputs.
    // Agent outputs contain markdown, quotes, pipes, backticks — all shell-hostile.
    const { writeTextFile, remove } = await import('@tauri-apps/plugin-fs');
    const { join, tempDir } = await import('@tauri-apps/api/path');
    const tmpDir = await tempDir();
    const tmpFile = await join(tmpDir, `angy-structured-${Date.now()}.txt`);
    await writeTextFile(tmpFile, prompt);

    try {
      const escapedSchema = schemaJson.replace(/'/g, "'\\''");
      const escapedTmpFile = tmpFile.replace(/'/g, "'\\''");
      const shellCmd =
        `exec '${claudeBin.replace(/'/g, "'\\''")}' ` +
        `-p --output-format json --model sonnet ` +
        `--json-schema '${escapedSchema}' ` +
        `--tools '' ` +
        `< '${escapedTmpFile}'`;

      const home = (await homeDir()).replace(/\/+$/, '');
      const command = Command.create('exec-sh', ['-c', shellCmd], {
        cwd: this.workspace || undefined,
        env: {
          HOME: home,
          PATH: await this.buildPath(home),
        },
      });

      const output = await command.execute();
      if (output.code !== 0) {
        throw new Error(`Structured call failed (exit ${output.code}): ${output.stderr.substring(0, 500)}`);
      }

      const parsed = JSON.parse(output.stdout);
      if (parsed.structured_output) {
        return parsed.structured_output as T;
      }
      throw new Error(`No structured_output in response: ${output.stdout.substring(0, 300)}`);
    } finally {
      try { await remove(tmpFile); } catch { /* cleanup best-effort */ }
    }
  }

  // ── Verdict helpers ─────────────────────────────────────────────────

  private isChallenged(v: Verdict): boolean {
    return v.verdict === 'challenged' || v.verdict === 'request_changes';
  }

  private hasChangesRequested(v: Verdict): boolean {
    return v.verdict === 'request_changes' || v.verdict === 'challenged';
  }

  private formatIssues(v: Verdict): string {
    if (!v.issues || v.issues.length === 0) return 'No specific issues listed.';
    return v.issues
      .map((issue, i) => `${i + 1}. **${issue.severity.toUpperCase()}** — ${issue.description}`)
      .join('\n');
  }

  // ── Task templates ──────────────────────────────────────────────────

  private architectTask(goal: string, acceptanceCriteria: string): string {
    return `Analyze the codebase and design a solution for this epic.

IMPORTANT: Assess the specification's completeness before planning. If the input already contains detailed schemas, API contracts, state machines, and component definitions, your plan should reorganize the spec into module-scoped builder tasks rather than redesign from scratch. Preserve the spec's terminology, field names, and structure — do not reinterpret or rename things. Minimize your interpretation layer. If the input is a vague goal, design the full solution as you normally would.

# Goal
${goal}

# Acceptance Criteria
${acceptanceCriteria}

# Required Plan Structure

Produce a structured plan with ALL of these sections:

## EXECUTION PLAN
Ordered steps grouped by parallelizable modules.

## FILE OWNERSHIP MATRIX
Which module owns which files. No overlaps between modules.
Small artifacts (README, docker-compose, config files) belong to the nearest substantial module.

## CONVENTIONS DISCOVERED
Patterns that all builders must follow (naming, imports, error handling, etc.).

## TRAPS
Things builders must NOT do. Common mistakes to avoid.

## INTEGRATION CONTRACTS
For each API endpoint, specify:
- HTTP method, path, and purpose
- Request body schema with required/optional fields and types
- Validation rules (which fields are required, non-empty, constrained)
- Response shape for success and error cases (status codes + body)
- WebSocket events emitted (event name + payload shape)

Be specific and actionable. A fresh builder with no prior context must be able to implement their module from this plan alone.`;
  }

  private planReviewTask(plan: string, acceptanceCriteria: string): string {
    return `You are reviewing an architect's plan for adversarial verification.

# Acceptance Criteria
${acceptanceCriteria}

# Architect's Plan
${plan}

# Verification Checklist

Verify ALL of the following:
1. Plan covers ALL acceptance criteria listed above
2. No spec deviations — the plan implements exactly what is required
3. Module boundaries have no file ownership overlaps
4. Integration contracts specify request/response schemas with validation rules
5. Plan is specific enough for a fresh builder to follow without ambiguity
6. No missing modules or endpoints
7. Error handling and edge cases are addressed

End with:
- VERDICT: APPROVED — if the plan passes all checks
- VERDICT: CHALLENGED — followed by numbered issues with severity (CRITICAL/MAJOR/NIT)`;
  }

  private revisionTask(_originalPlan: string, issues: string): string {
    return `The counterpart challenged your plan. Address each issue below.

# Counterpart Issues
${issues}

# Instructions

You already have the full plan in context from your previous turn.
Produce the COMPLETE, FINAL plan from scratch — every section, every detail.
Do NOT produce a partial patch or "only the changed sections."
The output must be a single self-contained document that a fresh builder
could follow without seeing any prior version. Supersede everything.

Keep everything the counterpart did NOT challenge, but emit it again in full.
Fix everything the counterpart DID challenge.
The result must have zero internal contradictions.`;
  }

  private incrementTask(
    increment: IncrementPlan['increments'][0],
    index: number,
    total: number,
  ): string {
    return `## Increment ${index + 1} of ${total}: ${increment.name}

${increment.task}

## Your Files
${increment.files.join('\n')}

## Verification Criteria
After implementing, this will be verified by: ${increment.verification}

## Self-Check (REQUIRED before finishing)

After implementing all files, you MUST verify your work:
1. Build/compile the project (npm run build, tsc --noEmit, go build, cargo check, etc.)
2. Fix any compilation errors before finishing
3. If a Dockerfile exists, verify it builds: docker compose build <service>
4. Confirm the verification criteria above would pass

Do NOT finish until your increment compiles cleanly.`;
  }

  private codeReviewTask(plan: string, builderOutputs: string, acceptanceCriteria: string): string {
    return `Review all implementations against the approved plan and acceptance criteria.

# Acceptance Criteria
${acceptanceCriteria}

# Approved Plan
You verified this plan in a previous turn. Here it is for reference:
${plan}

# Builder Outputs
${builderOutputs}

Read the actual code files to verify. Do NOT trust the builder summaries.
Build and run the code to verify it works — do not rely solely on reading files.

End with:
- VERDICT: APPROVE — if all acceptance criteria are met
- VERDICT: REQUEST_CHANGES — followed by numbered issues with severity (CRITICAL/MAJOR/NIT)`;
  }

  private fixTask(issues: string): string {
    return `Fix the following issues in the codebase. Read each file first, then apply the fix.

${issues}`;
  }

  private recheckTask(previousIssues: string, fixOutput: string): string {
    return `Re-review: verify that these previously reported issues have been fixed.

# Previous Issues
${previousIssues}

# Fix Builder Output
${fixOutput}

Read the actual files to verify the fixes were applied correctly.
Build and run the code to confirm the fixes work at runtime.

End with:
- VERDICT: APPROVE — if all issues are resolved
- VERDICT: REQUEST_CHANGES — if issues remain (list them)`;
  }

  private testTask(): string {
    return `Verify this project works end-to-end at ${this.workspace}.

# Full Specification
${this._goal}

# Procedure

1. START: Launch the application using its standard method (look for docker-compose.yml, Makefile, package.json scripts, etc.). Wait for all services to be healthy.
2. VERIFY REQUIREMENTS: Read the specification above and identify every testable requirement. For each one, verify it by actually interacting with the running application — hit endpoints, open URLs, send data, check responses.
3. ADVERSARIAL: Send malformed inputs, missing fields, boundary values to every endpoint and input surface. Check for crashes, unhandled errors, security issues.
4. LOGS: Check all container/process logs for errors, warnings, stack traces.
5. CLEANUP: Stop the application when done.

For each requirement, report PASS or FAIL with evidence (actual HTTP responses, log output, screenshots of terminal output).

If no explicit acceptance criteria section exists, derive testable requirements from the specification — every schema, endpoint, component, and integration point described is an implicit requirement.`;
  }

  private finalReviewTask(goal: string, acceptanceCriteria: string): string {
    return `Final review of the complete implementation.

# Original Goal
${goal}

# Acceptance Criteria
${acceptanceCriteria}

Read ALL source files and verify every acceptance criterion is met.
Check for common issues: missing validation, broken imports, inconsistent naming, missing error handling.

End with:
- VERDICT: APPROVE — if ready for delivery
- VERDICT: REQUEST_CHANGES — if issues remain (list them with severity)`;
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private buildSystemPrompt(role: string): string {
    const parts: string[] = [];

    const specialistPrompt = SPECIALIST_PROMPTS[role];
    if (specialistPrompt) parts.push(specialistPrompt);

    if (this.autoProfiles.length > 0) {
      parts.unshift(buildTechPromptPrefix(this.autoProfiles));
    }

    const toolList = SPECIALIST_TOOLS[role];
    if (toolList) {
      parts.push(`\nYou have access to these tools: ${toolList}. Use only these tools.`);
    }

    return parts.join('\n\n');
  }

  private validateIncrements(increments: IncrementPlan['increments']): void {
    for (const inc of increments) {
      const seen = new Set<string>();
      for (const f of inc.files) {
        if (seen.has(f)) {
          throw new Error(`File "${f}" listed twice in increment "${inc.name}"`);
        }
        seen.add(f);
      }
    }
    if (increments.length === 0) {
      throw new Error('Increment plan produced zero increments');
    }
  }

  private generateAgentName(role: string): string {
    this.agentCounter++;
    return `${role}-${this.agentCounter}`;
  }

  private setPhase(phase: string): void {
    this._currentPhase = phase;
    this.events.emit('phaseChanged', { phase });
  }

  private log(message: string): void {
    console.log(`[HybridPipeline:${this.epicId}] ${message}`);
  }

  setRootSessionId(sid: string): void {
    this.rootSessionId = sid;
  }

  private async resolveClaudeBinary(): Promise<string> {
    const home = (await homeDir()).replace(/\/+$/, '');
    const candidates = [
      `${home}/.local/bin/claude`,
      '/opt/homebrew/bin/claude',
      '/usr/local/bin/claude',
    ];
    for (const c of candidates) {
      try {
        if (await exists(c)) return c;
      } catch { /* ignore */ }
    }
    return 'claude';
  }

  private async buildPath(home: string): Promise<string> {
    const extraPaths: string[] = [];
    const nvmBase = `${home}/.nvm/versions/node`;
    try {
      const probe = Command.create('exec-sh', ['-c', `ls -1 "${nvmBase}" 2>/dev/null | sort -V | tail -1`]);
      const out = await probe.execute();
      const latestNode = out.stdout.trim();
      if (latestNode) extraPaths.push(`${nvmBase}/${latestNode}/bin`);
    } catch { /* nvm not installed */ }

    extraPaths.push(
      `${home}/.local/bin`,
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
    );
    return extraPaths.join(':');
  }
}
