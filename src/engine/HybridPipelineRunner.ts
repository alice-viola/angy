/**
 * HybridPipelineRunner — todo-driven adaptive state machine for the hybrid pipeline.
 *
 * Replaces the LLM-driven Orchestrator for pipelineType='hybrid'.
 * Drives phase transitions programmatically in TypeScript:
 *   Phase 1: Multi-turn architect → decompose into Todo[] → counterpart reviews
 *   Phase 2: Execute todos sequentially (scope-specific builders + verify),
 *            with adaptive re-planning on failure
 *   Phase 3: Counterpart review → fix-todos → integration test → fix-todos
 *
 * Everything is a todo: initial work, re-plans, counterpart fixes, test fixes.
 * One execution loop handles all of them.
 */

import mitt from 'mitt';
import { Command } from '@tauri-apps/plugin-shell';
import { homeDir } from '@tauri-apps/api/path';
import { exists } from '@tauri-apps/plugin-fs';
import { SPECIALIST_PROMPTS, SPECIALIST_TOOLS } from './SpecialistConstants';
import type { OrchestratorEvents } from './SpecialistConstants';
import type { HeadlessHandle } from './HeadlessHandle';
import type { ProcessManager } from './ProcessManager';
import type { AngyCodeProcessManager } from './AngyCodeProcessManager';
import type { SessionService } from './SessionService';
import type { AgentNode, ComplexityEstimate, EpicPipelineType, PipelineConfig } from './KosTypes';
import type { TechProfile } from './TechDetector';
import type { PipelineSnapshot, PipelinePhase } from './types';
import type { PipelineStateStore } from './PipelineStateStore';
import type { ClaudeHealthMonitor } from './ClaudeHealthMonitor';
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

const TODO_SCHEMA = {
  type: 'object',
  properties: {
    todos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          scope: { type: 'string', enum: ['scaffold', 'backend', 'frontend'] },
          requirements: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          testCriteria: { type: 'string' },
          dependsOn: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'title', 'scope', 'requirements', 'files', 'testCriteria', 'dependsOn'],
      },
    },
  },
  required: ['todos'],
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

interface PipelineTodo {
  id: string;
  title: string;
  scope: 'scaffold' | 'backend' | 'frontend';
  requirements: string;
  files: string[];
  testCriteria: string;
  dependsOn: string[];
}

interface TodoList {
  todos: PipelineTodo[];
}

interface TodoState {
  todo: PipelineTodo;
  status: 'pending' | 'in_progress' | 'done' | 'failed';
  builderOutput?: string;
  attempts: number;
}

interface VerifyResult {
  passed: boolean;
  errors?: string[];
}

interface PipelineFeatures {
  architectTurns: number;
  useCounterpart: boolean;
  useTester: boolean;
}

interface TestResult {
  buildPassed: boolean;
  testsPassed: boolean;
  failures?: string[];
}

export interface RejectionContext {
  feedback: string;
  lastAttemptFiles?: string[];
  lastValidationResults?: Array<{ command: string; passed: boolean; output: string }>;
  lastArchitectPlan?: string;
}

export interface HybridPipelineOptions {
  handle: HeadlessHandle;
  processes: ProcessManager;
  acpm?: AngyCodeProcessManager;
  sessions: SessionService;
  workspace: string;
  model?: string;
  epicId: string;
  autoProfiles: TechProfile[];
  complexity: ComplexityEstimate;
  pipelineConfig?: PipelineConfig;
  stateStore?: PipelineStateStore;
  healthMonitor?: ClaudeHealthMonitor;
  pipelineType?: EpicPipelineType;
  rejectionContext?: RejectionContext;
}

// ── Runner ───────────────────────────────────────────────────────────────

export class HybridPipelineRunner {
  readonly events = mitt<OrchestratorEvents>();
  on = this.events.on.bind(this.events);
  off = this.events.off.bind(this.events);

  private handle: HeadlessHandle;
  private processes: ProcessManager;
  private acpm: AngyCodeProcessManager | null;
  private sessions: SessionService;
  private workspace: string;
  private model: string | undefined;
  private epicId: string;
  private autoProfiles: TechProfile[];
  private complexity: ComplexityEstimate;
  private pipelineConfig?: PipelineConfig;
  private stateStore: PipelineStateStore | null;
  private healthMonitor: ClaudeHealthMonitor | null;
  private pipelineType: EpicPipelineType;
  private rejectionContext: RejectionContext | null;

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
  private testerSessions = new Map<string, string>();
  private builderSessions = new Map<string, { sessionId: string; startedAt: number }>();
  private _goal = '';
  private _acceptanceCriteria = '';
  private todoQueue: TodoState[] = [];
  private architectContext = '';
  private designPlan = '';
  private finalizeCycle = 0;
  private replansRemaining = 3;
  private features: PipelineFeatures = { architectTurns: 2, useCounterpart: true, useTester: true };

  static readonly AGENT_TIMEOUT_MS = 120 * 60 * 1000;
  static readonly BUILDER_SESSION_MAX_MS = 25 * 60 * 1000;

  constructor(opts: HybridPipelineOptions) {
    this.handle = opts.handle;
    this.processes = opts.processes;
    this.acpm = opts.acpm ?? null;
    this.sessions = opts.sessions;
    this.workspace = opts.workspace;
    this.model = opts.model;
    this.epicId = opts.epicId;
    this.autoProfiles = opts.autoProfiles;
    this.complexity = opts.complexity;
    this.pipelineConfig = opts.pipelineConfig;
    this.stateStore = opts.stateStore ?? null;
    this.healthMonitor = opts.healthMonitor ?? null;
    this.pipelineType = opts.pipelineType ?? 'hybrid';
    this.rejectionContext = opts.rejectionContext ?? null;

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
    if (this.healthMonitor) {
      this.healthMonitor.cancel();
    }
    for (const sid of this.activeProcesses) {
      this.cancelChild(sid);
    }
    this.activeProcesses.clear();
    for (const resolver of this.pendingResolvers.values()) {
      resolver('CANCELLED');
    }
    this.pendingResolvers.clear();
    this.setPhase('cancelled');
    this.checkpointState('cancelled').catch(() => {});
    this.events.emit('failed', { reason: 'Pipeline cancelled' });
  }

  // ── Main state machine ──────────────────────────────────────────────

  async run(goal: string, acceptanceCriteria: string): Promise<void> {
    this._running = true;
    this._cancelled = false;
    this._goal = goal;
    this._acceptanceCriteria = acceptanceCriteria;
    this.todoQueue = [];
    this.architectContext = '';
    this.designPlan = '';
    this.finalizeCycle = 0;
    this.replansRemaining = 3;

    const effectiveType = this.pipelineType;

    try {
      switch (effectiveType) {
        case 'investigate':
          await this.executeInvestigateMode(goal);
          return;
        case 'plan':
          await this.executePlanMode(goal, acceptanceCriteria);
          return;
        case 'fix':
          await this.executeFixMode(goal, acceptanceCriteria);
          return;
        default:
          // hybrid — fall through to existing logic
          break;
      }

      await this.checkpointState('planning');

      this.features = this.getPipelineFeatures();
      const features = this.features;
      this.log(`Pipeline features for complexity "${this.complexity}": architectTurns=${features.architectTurns}, useCounterpart=${features.useCounterpart}, useTester=${features.useTester}`);

      // ── Trivial: skip architect, single builder + tester ─────────
      if (this.complexity === 'trivial') {
        this.setPhase('implementing');
        this.log('Trivial complexity: direct builder + tester');

        await this.healthCheckedDelegate('builder', `Implement the following:\n\n# Goal\n${goal}\n\n# Acceptance Criteria\n${acceptanceCriteria}\n\nThis is a trivial change. Make the minimal fix and verify it compiles.`);
        if (this._cancelled) return;

        this.setPhase('testing');
        const testerOutput = await this.healthCheckedDelegate('tester', this.testTask());
        if (this._cancelled) return;
        const testResult = await this.extractTestResult(testerOutput);

        if (!testResult.buildPassed || !testResult.testsPassed) {
          const failureText = (testResult.failures || []).join('\n');
          await this.healthCheckedDelegate('builder', this.fixTask(`Test failures:\n${failureText}\n\nFull tester output:\n${testerOutput}`));
          if (this._cancelled) return;
        }

        this._running = false;
        this.setPhase('completed');
        await this.onPipelineComplete();
        this.events.emit('artifactsCollected', { childOutputs: this.childOutputs });
        this.events.emit('completed', { summary: `Trivial pipeline completed for epic ${this.epicId}.` });
        return;
      }

      // ── Phase 1: Plan ──────────────────────────────────────────
      await this.executePhase1Plan(goal, acceptanceCriteria, features);
      if (this._cancelled) return;

      // ── Phase 2: Execute todos ──────────────────────────────────
      await this.executePhase2Implement();
      if (this._cancelled) return;

      // ── Phase 3: Finalize (counterpart review + integration test) ──
      await this.executePhase3Finalize(acceptanceCriteria);
      if (this._cancelled) return;

    } catch (err) {
      if (this._cancelled) return;
      this._running = false;
      this.setPhase('failed');
      await this.checkpointState('failed');
      const reason = err instanceof Error ? err.message : String(err);
      this.events.emit('failed', { reason });
      console.error('[HybridPipeline] Fatal error:', reason);
    }
  }

  /**
   * Resume a pipeline from a persisted snapshot.
   * Skips already-completed phases and todos, resuming from the exact
   * point of interruption.
   */
  async resume(snapshot: PipelineSnapshot): Promise<void> {
    this._running = true;
    this._cancelled = false;
    this._goal = snapshot.goal;
    this._acceptanceCriteria = snapshot.acceptanceCriteria;
    this.architectContext = snapshot.architectContext;
    this.designPlan = snapshot.designPlan;
    this.finalizeCycle = snapshot.finalizeCycle;
    this.replansRemaining = snapshot.replansRemaining;
    this.childOutputs = [...snapshot.childOutputs];

    // Restore todo queue, resetting in_progress → pending (interrupted work)
    this.todoQueue = snapshot.todoQueue.map(t => ({
      todo: t.todo,
      status: t.status === 'in_progress' ? 'pending' as const : t.status,
      builderOutput: t.builderOutput,
      attempts: t.attempts,
    }));

    const doneTodos = this.todoQueue.filter(e => e.status === 'done').length;
    const totalTodos = this.todoQueue.length;
    this.log(`Resuming pipeline: phase=${snapshot.phase}, todos=${doneTodos}/${totalTodos} done`);

    engineBus.emit('pipeline:resuming', {
      epicId: this.epicId,
      phase: snapshot.phase,
      todosDone: doneTodos,
      todosTotal: totalTodos,
    });

    this.features = this.getPipelineFeatures();

    try {
      // Determine resume point
      const hasPendingTodos = this.todoQueue.some(e => e.status === 'pending');
      const resumePhase = snapshot.phase;

      if (resumePhase === 'planning' || resumePhase === 'verifying plan' || resumePhase === 'designing UI' || resumePhase === 'extracting todos') {
        // Plan wasn't completed — if we have architect context, skip to implementing
        if (this.architectContext && this.todoQueue.length > 0) {
          this.log('Resuming: Plan exists, skipping to implementation');
          await this.executePhase2Implement();
          if (this._cancelled) return;
          await this.executePhase3Finalize(this._acceptanceCriteria);
        } else {
          // No plan saved — must restart planning from scratch
          this.log('Resuming: No plan saved, restarting planning phase');
          this.features = this.getPipelineFeatures();
          await this.executePhase1Plan(this._goal, this._acceptanceCriteria, this.features);
          if (this._cancelled) return;
          await this.executePhase2Implement();
          if (this._cancelled) return;
          await this.executePhase3Finalize(this._acceptanceCriteria);
        }
      } else if (resumePhase === 'implementing' && hasPendingTodos) {
        this.log(`Resuming: Continuing todo execution (${doneTodos} done, ${totalTodos - doneTodos} remaining)`);
        await this.executePhase2Implement();
        if (this._cancelled) return;
        await this.executePhase3Finalize(this._acceptanceCriteria);
      } else if (resumePhase === 'finalizing') {
        this.log(`Resuming: Continuing finalization (cycle ${this.finalizeCycle})`);
        await this.executePhase3Finalize(this._acceptanceCriteria);
      } else {
        this.log(`Resuming: Unknown/terminal phase "${resumePhase}", re-running from implementing`);
        if (hasPendingTodos) {
          await this.executePhase2Implement();
          if (this._cancelled) return;
        }
        await this.executePhase3Finalize(this._acceptanceCriteria);
      }

    } catch (err) {
      if (this._cancelled) return;
      this._running = false;
      this.setPhase('failed');
      await this.checkpointState('failed');
      const reason = err instanceof Error ? err.message : String(err);
      this.events.emit('failed', { reason });
      console.error('[HybridPipeline] Fatal error during resume:', reason);
    }
  }

  // ── Phase executors (extracted for resume support) ──────────────────

  private async executePhase1Plan(
    goal: string,
    acceptanceCriteria: string,
    features: PipelineFeatures,
  ): Promise<void> {
    this.setPhase('planning');
    await this.checkpointState('planning');

    let approvedPlan: string;

    if (features.architectTurns > 0) {
      // ── Architect planning ──────────────────────────────────────
      this.log('Phase 1: Architect planning');

      const structurePlan = await this.healthCheckedArchitect(this.architectStructureTask(goal, acceptanceCriteria));
      if (this._cancelled) return;

      // Counterpart reviews and corrects the plan in a single pass
      approvedPlan = structurePlan;
      if (features.useCounterpart) {
        this.setPhase('verifying plan');
        const counterpartOutput = await this.healthCheckedCounterpart(
          this.planReviewTask(structurePlan, acceptanceCriteria),
        );
        if (this._cancelled) return;

        if (this.isRejected(counterpartOutput)) {
          // Plan fundamentally flawed — architect must redo (max 1 retry)
          const reason = counterpartOutput.replace(/^REJECTED:?\s*/i, '').trim();
          this.log(`Plan rejected by counterpart: ${reason.substring(0, 100)}...`);
          this.setPhase('revising plan (rejected)');

          const revisedPlan = await this.healthCheckedArchitect(
            `Your plan was rejected by the counterpart as fundamentally flawed.\n\n# Rejection Reason\n${reason}\n\n# Instructions\nProduce a COMPLETE revised plan from scratch, addressing the rejection reason. Follow the same output format as your original plan.`,
          );
          if (this._cancelled) return;

          this.setPhase('re-verifying plan');
          const secondOutput = await this.healthCheckedCounterpart(
            this.planReviewTask(revisedPlan, acceptanceCriteria),
          );
          if (this._cancelled) return;

          if (this.isRejected(secondOutput)) {
            this.log('Plan rejected twice — proceeding with architect version');
            approvedPlan = revisedPlan;
          } else {
            approvedPlan = secondOutput;
          }
        } else {
          approvedPlan = counterpartOutput;
        }
      }

      if (features.architectTurns >= 3) {
        const hasFrontend = await this.detectFrontendScope(approvedPlan);
        if (hasFrontend) {
          this.setPhase('designing UI');
          this.log('Architect Turn 2: Design system');
          this.designPlan = await this.healthCheckedArchitect(this.architectDesignTask(approvedPlan));
          if (this._cancelled) return;
        }
      }
    } else {
      // ── Architect disabled — pass goal directly to todo extraction ──
      this.log('Phase 1: Architect disabled, skipping planning — extracting todos from goal');
      approvedPlan = `# Goal\n${goal}\n\n# Acceptance Criteria\n${acceptanceCriteria || 'None specified'}`;
    }

    this.architectContext = this.designPlan
      ? `${approvedPlan}\n\n---\n\n# DESIGN SYSTEM\n\n${this.designPlan}`
      : approvedPlan;

    this.setPhase('extracting todos');
    this.log('Extracting todos from approved plan');
    const todos = await this.extractTodos(this.architectContext);
    this.validateTodos(todos);
    this.log(`Extracted ${todos.length} todos: ${todos.map(t => `${t.id}[${t.scope}]`).join(', ')}`);

    this.todoQueue = todos.map(t => ({ todo: t, status: 'pending' as const, attempts: 0 }));
    this.architectSessionId = null;
    this.log(`Plan split into ${this.todoQueue.length} todos`);

    await this.checkpointState('implementing');
  }

  private async executePhase2Implement(): Promise<void> {
    this.setPhase('implementing');
    const pendingCount = this.todoQueue.filter(e => e.status === 'pending').length;
    this.log(`Phase 2: Executing todos (${pendingCount} pending)`);
    this.emitTodoProgress();
    await this.executeTodoLoop();
  }

  private async executePhase3Finalize(acceptanceCriteria: string): Promise<void> {
    this.setPhase('finalizing');
    this.log('Phase 3: Finalize');
    await this.checkpointState('finalizing');

    // If both counterpart and tester are disabled, skip the finalize loop entirely
    if (!this.features.useCounterpart && !this.features.useTester) {
      this.log('Both counterpart and tester disabled — skipping finalize cycle');
    } else {
      const MAX_FINALIZE_CYCLES = 5;
      let finalized = false;

      for (let cycle = this.finalizeCycle; cycle < MAX_FINALIZE_CYCLES; cycle++) {
        if (this._cancelled) return;
        this.finalizeCycle = cycle;

        // ── Counterpart code review (gated) ─────────────────────────
        if (this.features.useCounterpart) {
          this.setPhase('reviewing implementation');
          this.log(`Finalize cycle ${cycle + 1}: counterpart review`);
          const allOutput = this.getAllCompletedTodoOutput();
          const codeVerdict = await this.extractVerdict(
            await this.healthCheckedCounterpart(this.codeReviewTask(this.architectContext, allOutput, acceptanceCriteria)),
          );
          if (this._cancelled) return;

          if (this.hasChangesRequested(codeVerdict)) {
            this.setPhase('generating fix-todos (counterpart)');
            const fixTodos = await this.generateFixTodos(this.formatIssues(codeVerdict), 'counterpart');
            if (fixTodos.length > 0) {
              this.appendTodos(fixTodos);
              await this.checkpointState('finalizing');
              await this.executeTodoLoop();
              if (this._cancelled) return;
            }
            continue;
          }
        }

        // ── Integration tester (gated) ──────────────────────────────
        if (this.features.useTester) {
          this.setPhase('testing');
          this.log(`Finalize cycle ${cycle + 1}: integration test`);
          const testerOutput = await this.healthCheckedDelegate('tester', this.testTask());
          if (this._cancelled) return;
          const testResult = await this.extractTestResult(testerOutput);

          if (!testResult.buildPassed || !testResult.testsPassed) {
            const failureText = (testResult.failures || []).join('\n');
            this.setPhase('generating fix-todos (test)');
            const fixTodos = await this.generateFixTodos(
              `Test failures:\n${failureText}\n\nFull tester output:\n${testerOutput}`,
              'test',
            );
            if (fixTodos.length > 0) {
              this.appendTodos(fixTodos);
              await this.checkpointState('finalizing');
              await this.executeTodoLoop();
              if (this._cancelled) return;
            }
            continue;
          }
        }

        finalized = true;
        break;
      }

      if (!finalized) {
        this._running = false;
        this.setPhase('failed');
        await this.checkpointState('failed');
        this.events.emit('failed', { reason: `Finalization still failing after ${MAX_FINALIZE_CYCLES} cycles` });
        return;
      }
    }

    this._running = false;
    this.setPhase('completed');
    await this.onPipelineComplete();
    this.events.emit('artifactsCollected', { childOutputs: this.childOutputs });

    const doneTodos = this.todoQueue.filter(e => e.status === 'done').length;
    const summary = `Hybrid pipeline completed for epic ${this.epicId} (complexity: ${this.complexity}). ` +
      `${doneTodos} todos completed` +
      `${this.features.useCounterpart ? ', counterpart approved' : ''}` +
      `${this.features.useTester ? ', tests passed' : ''}.`;

    this.events.emit('completed', { summary });
    this.log(summary);
  }

  // ── Read-only modes: investigate & plan ─────────────────────────────

  /**
   * Investigate mode: single architect call (read-only), emit findings.
   * No implementation, no Phase 2/3.
   */
  private async executeInvestigateMode(goal: string): Promise<void> {
    this.log('Investigate mode: read-only architect analysis');
    this.setPhase('investigating');

    try {
      const findings = await this.healthCheckedDelegate('architect',
        `Investigate the following questions in the codebase. This is a READ-ONLY investigation — do NOT modify any code.\n\n` +
        `# Goal\n${goal}\n\n` +
        (this.rejectionContext
          ? `# Previous Attempt Feedback\nThis investigation was previously rejected with the following feedback:\n${this.rejectionContext.feedback}\n\nPlease address this feedback in your investigation.\n\n`
          : '') +
        `# Required Output\n` +
        `## FINDINGS\nKey discoveries and answers to the investigation questions.\n\n` +
        `## EVIDENCE\nSpecific file paths, code snippets, and data points that support the findings.\n\n` +
        `## CONCLUSIONS\nSynthesized conclusions and actionable recommendations.\n\n` +
        `## OPEN QUESTIONS\nAnything that could not be determined and would need further investigation.\n\n` +
        `Be thorough — read actual code, don't speculate.`,
        'investigate',
      );
      if (this._cancelled) return;

      this._running = false;
      this.setPhase('completed');
      await this.onPipelineComplete();
      this.events.emit('artifactsCollected', { childOutputs: this.childOutputs });
      this.events.emit('completed', { summary: findings });
      this.log('Investigate mode completed');
    } catch (err) {
      if (this._cancelled) return;
      this._running = false;
      this.setPhase('failed');
      const reason = err instanceof Error ? err.message : String(err);
      this.events.emit('failed', { reason });
      console.error('[HybridPipeline] Investigate mode error:', reason);
    }
  }

  /**
   * Plan mode: single architect call (read-only), emit architectural plan.
   * No implementation, no Phase 2/3.
   */
  private async executePlanMode(goal: string, acceptanceCriteria: string): Promise<void> {
    this.log('Plan mode: read-only architect planning');
    this.setPhase('planning');

    try {
      const plan = await this.healthCheckedDelegate('architect',
        `Analyze the codebase and produce a detailed architectural plan for the following. This is a READ-ONLY planning session — do NOT modify any code.\n\n` +
        `# Goal\n${goal}\n\n` +
        `# Acceptance Criteria\n${acceptanceCriteria}\n\n` +
        (this.rejectionContext
          ? `# Previous Attempt Feedback\nThis plan was previously rejected with the following feedback:\n${this.rejectionContext.feedback}\n\nPlease address this feedback and improve upon the previous plan.\n\n`
          : '') +
        `# Required Output\n` +
        `## ANALYSIS\nSummary of the current codebase state relevant to the planned changes.\n\n` +
        `## FILES TO MODIFY\nList each file path with a description of what changes are needed.\n\n` +
        `## FILES TO CREATE\nAny new files needed, with their purpose and contents outline.\n\n` +
        `## IMPLEMENTATION STEPS\nOrdered, specific steps to implement the plan. Group parallelizable steps. Note dependencies between steps.\n\n` +
        `## KEY DECISIONS\nArchitectural choices made and their rationale.\n\n` +
        `## RISKS\nPotential issues, edge cases, and migration concerns.\n\n` +
        `## ESTIMATED COMPLEXITY\nOverall assessment of the effort required.\n\n` +
        `Ground the plan in actual code — read files before recommending changes. Be specific enough that an implementer could follow the plan directly.`,
        'plan',
      );
      if (this._cancelled) return;

      this._running = false;
      this.setPhase('completed');
      await this.onPipelineComplete();
      this.events.emit('artifactsCollected', { childOutputs: this.childOutputs });
      this.events.emit('completed', { summary: plan });
      this.log('Plan mode completed');
    } catch (err) {
      if (this._cancelled) return;
      this._running = false;
      this.setPhase('failed');
      const reason = err instanceof Error ? err.message : String(err);
      this.events.emit('failed', { reason });
      console.error('[HybridPipeline] Plan mode error:', reason);
    }
  }

  // ── Fix mode ──────────────────────────────────────────────────────

  /**
   * Fix mode: skip planning, inject rejection context, run builder → tester loop.
   * Used when a hybrid epic has rejectionCount > 0 or pipelineType === 'fix'.
   */
  private async executeFixMode(goal: string, acceptanceCriteria: string): Promise<void> {
    this.log('Fix mode: skipping Phase 1 planning, running builder → tester loop');

    try {
      await this.checkpointState('implementing');

      // Build the fix task with rejection context
      const rc = this.rejectionContext;
      let fixPrompt = `Fix the following issues in the codebase.\n\n# Goal\n${goal}\n\n`;

      if (rc) {
        fixPrompt += `# Rejection Feedback\n${rc.feedback}\n\n`;
        if (rc.lastArchitectPlan) {
          fixPrompt += `# Previous Architect Plan (for context)\n${rc.lastArchitectPlan}\n\n`;
          this.architectContext = rc.lastArchitectPlan;
        }
        if (rc.lastAttemptFiles && rc.lastAttemptFiles.length > 0) {
          fixPrompt += `# Files from Last Attempt\n${rc.lastAttemptFiles.join('\n')}\n\n`;
        }
        if (rc.lastValidationResults && rc.lastValidationResults.length > 0) {
          fixPrompt += `# Validation Results from Last Attempt\n`;
          for (const v of rc.lastValidationResults) {
            fixPrompt += `- \`${v.command}\`: ${v.passed ? 'PASSED' : 'FAILED'}\n`;
            if (v.output) fixPrompt += `  Output: ${v.output.substring(0, 500)}\n`;
          }
          fixPrompt += '\n';
        }
      }

      if (acceptanceCriteria) {
        fixPrompt += `# Acceptance Criteria\n${acceptanceCriteria}\n\n`;
      }

      fixPrompt += `Read the codebase, diagnose the issue, and apply the fix. Verify your fix compiles cleanly.`;

      // Phase 2: Builder fixes the issues
      this.setPhase('fixing');
      await this.healthCheckedDelegate('builder', fixPrompt);
      if (this._cancelled) return;

      // Phase 3: Test the fix
      this.setPhase('testing');
      const testerOutput = await this.healthCheckedDelegate('tester', this.testTask());
      if (this._cancelled) return;
      const testResult = await this.extractTestResult(testerOutput);

      // One retry cycle if tests fail
      if (!testResult.buildPassed || !testResult.testsPassed) {
        const failureText = (testResult.failures || []).join('\n');
        this.setPhase('fixing (retry)');
        await this.healthCheckedDelegate('builder', this.fixTask(
          `Test failures after fix attempt:\n${failureText}\n\nFull tester output:\n${testerOutput}`,
        ));
        if (this._cancelled) return;

        this.setPhase('testing (retry)');
        const retryOutput = await this.healthCheckedDelegate('tester', this.testTask());
        if (this._cancelled) return;
        const retryResult = await this.extractTestResult(retryOutput);

        if (!retryResult.buildPassed || !retryResult.testsPassed) {
          this._running = false;
          this.setPhase('failed');
          await this.checkpointState('failed');
          const failures = (retryResult.failures || []).join('; ');
          this.events.emit('failed', { reason: `Fix mode: tests still failing after retry. Failures: ${failures}` });
          return;
        }
      }

      this._running = false;
      this.setPhase('completed');
      await this.onPipelineComplete();
      this.events.emit('artifactsCollected', { childOutputs: this.childOutputs });
      this.events.emit('completed', { summary: `Fix pipeline completed for epic ${this.epicId}. Tests passing.` });
      this.log('Fix mode completed');
    } catch (err) {
      if (this._cancelled) return;
      this._running = false;
      this.setPhase('failed');
      await this.checkpointState('failed');
      const reason = err instanceof Error ? err.message : String(err);
      this.events.emit('failed', { reason });
      console.error('[HybridPipeline] Fix mode error:', reason);
    }
  }

  // ── Todo execution loop ─────────────────────────────────────────────
  //
  // Batches consecutive same-scope todos and verifies them together.
  // Within a batch: build all → verify once → fix/re-verify cycle (reusing tester session).
  // This avoids spawning a tester after every single builder.

  private async executeTodoLoop(): Promise<void> {
    let scopeBatch: TodoState[] = [];
    let batchScope: string | null = null;

    while (true) {
      if (this._cancelled) return;

      const entry = this.nextReadyTodo();

      // If we have a batch and (no more todos OR next todo is a different scope), verify the batch
      if (scopeBatch.length > 0 && (!entry || entry.todo.scope !== batchScope)) {
        const passed = await this.verifyScopeBatch(scopeBatch, batchScope!);
        if (this._cancelled) return;

        if (!passed) {
          // Batch failed even after fix attempts — replan or accept failure
          await this.handleBatchFailure(scopeBatch);
          if (this._cancelled) return;
        }

        scopeBatch = [];
        batchScope = null;
        continue; // re-check: replan may have added new todos
      }

      if (!entry) break;

      entry.status = 'in_progress';
      const todo = entry.todo;
      batchScope = todo.scope;

      const done = this.todoQueue.filter(e => e.status === 'done').length;
      this.emitTodoProgress(todo.scope, todo.title);
      this.setPhase(`building ${done + 1}/${this.todoQueue.length}: ${todo.title} [${todo.scope}]`);
      this.log(`Building: ${todo.title} [${todo.scope}]`);
      await this.checkpointState('implementing');

      const builderOutput = await this.delegateBuilder(todo.scope, this.todoTask(todo));
      if (this._cancelled) return;

      // Mark as done (tentatively) so intra-scope dependencies resolve
      entry.status = 'done';
      entry.builderOutput = builderOutput;
      scopeBatch.push(entry);
      this.emitTodoProgress(todo.scope, todo.title);
      await this.checkpointState('implementing');
    }
  }

  /**
   * Verify a batch of todos from the same scope in a single tester session.
   * On failure, runs a fix → re-verify cycle up to 3 times, reusing the tester session.
   * Returns true if the batch passed verification.
   */
  private async verifyScopeBatch(batch: TodoState[], scope: string): Promise<boolean> {
    const MAX_FIX_ROUNDS = 3;

    const todoCriteria = batch.map(e =>
      `### ${e.todo.title}\n**Test criteria:** ${e.todo.testCriteria}\n**Files:** ${e.todo.files.join(', ')}`,
    ).join('\n\n');

    this.setPhase(`verifying ${batch.length} ${scope} todo(s)`);
    this.log(`Batch-verifying ${batch.length} ${scope} todos`);

    const verifyTask =
      `Verify that the following ${scope} todos all work correctly. Run the verification for each one — do not run the full test suite or do a comprehensive review.\n\n${todoCriteria}\n\nReport whether verification passed or failed, with specific errors if any.`;

    this.emitInternalCall('verifyBatch', 'started');
    const testerOutput = await this.delegateTester(scope, verifyTask);
    if (this._cancelled) return false;

    let verifyResult = await this.structuredCall<VerifyResult>(
      VERIFY_SCHEMA,
      `Extract whether this batch verification passed or failed:\n\n${testerOutput}`,
    );
    this.emitInternalCall('verifyBatch', 'completed');

    if (verifyResult.passed) {
      this.log(`Batch verification passed for ${batch.length} ${scope} todos`);
      return true;
    }

    // Fix cycle: fix with a builder, re-verify with the same tester session
    for (let round = 1; round <= MAX_FIX_ROUNDS; round++) {
      if (this._cancelled) return false;

      const fixIssues = (verifyResult.errors || []).join('\n') || 'Verification failed.';
      const batchFiles = [...new Set(batch.flatMap(e => e.todo.files))];

      this.log(`Batch verification failed for ${scope} (round ${round}/${MAX_FIX_ROUNDS}), fixing`);
      this.setPhase(`fixing ${scope} (round ${round}/${MAX_FIX_ROUNDS})`);

      await this.delegateBuilder(scope, this.fixTask(
        `Batch verification for ${scope} todos failed.\n\n## Errors\n${fixIssues}\n\n## Files involved\n${batchFiles.join('\n')}`,
      ));
      if (this._cancelled) return false;

      // Re-verify: reuse the same tester session (it has context of what failed)
      this.setPhase(`re-verifying ${scope} (round ${round}/${MAX_FIX_ROUNDS})`);
      this.emitInternalCall('verifyBatch', 'started');
      const reVerifyOutput = await this.delegateTester(scope,
        `The builder has attempted to fix the issues you found. Please re-verify the same ${scope} todos:\n\n${todoCriteria}\n\nReport whether verification now passes or still fails, with specific errors if any.`,
      );
      if (this._cancelled) return false;

      verifyResult = await this.structuredCall<VerifyResult>(
        VERIFY_SCHEMA,
        `Extract whether this re-verification passed or failed:\n\n${reVerifyOutput}`,
      );
      this.emitInternalCall('verifyBatch', 'completed');

      if (verifyResult.passed) {
        this.log(`Batch re-verification passed for ${scope} on round ${round}`);
        return true;
      }
    }

    // Exhausted fix rounds — discard this tester session so next verify starts fresh
    this.resetTesterSession(scope);
    this.log(`Batch verification failed for ${scope} after ${MAX_FIX_ROUNDS} fix rounds`);
    return false;
  }

  /**
   * Handle a failed scope batch: replan or mark as failed.
   */
  private async handleBatchFailure(batch: TodoState[]): Promise<void> {
    if (this.replansRemaining > 0) {
      this.replansRemaining--;
      for (const entry of batch) entry.status = 'failed';

      const failedTitles = batch.map(e => e.todo.title).join(', ');
      this.resetBuilderSession(batch[0].todo.scope);
      this.log(`Batch [${failedTitles}] failed, re-planning (${this.replansRemaining} replans left)`);

      let revisedTodos: PipelineTodo[];

      if (this.features.architectTurns > 0) {
        // Architect-assisted replan
        const remainingTodos = this.todoQueue.filter(e => e.status === 'pending').map(e => e.todo);
        const replanProse = await this.healthCheckedArchitect(
          this.replanTask(batch[0].todo, ['Batch verification failed for multiple todos'], remainingTodos),
        );
        if (this._cancelled) return;
        revisedTodos = await this.extractTodos(replanProse);
      } else {
        // Architect disabled — generate fix todos directly from the failures
        this.log('Architect disabled, generating fix todos without architect');
        const failedIssues = batch
          .map(e => `- ${e.todo.title} [${e.todo.scope}]: verification failed`)
          .join('\n');
        revisedTodos = await this.generateFixTodos(failedIssues, 'test');
      }

      this.validateTodos(revisedTodos);
      this.log(`Re-plan produced ${revisedTodos.length} revised todos`);

      this.todoQueue = this.todoQueue.filter(e => e.status !== 'pending');
      for (const t of revisedTodos) {
        this.todoQueue.push({ todo: t, status: 'pending', attempts: 0 });
      }
      await this.checkpointState('implementing');
    } else {
      for (const entry of batch) entry.status = 'failed';
      this.log(`Batch failed and max replans exhausted, continuing`);
      await this.checkpointState('implementing');
    }
  }

  private nextReadyTodo(): TodoState | null {
    const doneIds = new Set(this.todoQueue.filter(e => e.status === 'done').map(e => e.todo.id));
    return this.todoQueue.find(e =>
      e.status === 'pending' &&
      e.todo.dependsOn.every(dep => doneIds.has(dep)),
    ) || null;
  }

  private getAllCompletedTodoOutput(): string {
    return this.todoQueue
      .filter(e => e.status === 'done' && e.builderOutput)
      .map(e => `## Todo: ${e.todo.title} [${e.todo.scope}]\n\n${e.builderOutput}`)
      .join('\n\n---\n\n');
  }

  private appendTodos(todos: PipelineTodo[]): void {
    for (const t of todos) {
      this.todoQueue.push({ todo: t, status: 'pending', attempts: 0 });
    }
    this.log(`Appended ${todos.length} fix-todos: ${todos.map(t => t.id).join(', ')}`);
  }

  // ── Health-checked delegation wrappers ──────────────────────────────

  /**
   * Delegate to an agent with health check + enhanced retry.
   * Before spawning, ensures Claude CLI is available. On transient errors,
   * waits for recovery instead of burning retry budget.
   */
  private async healthCheckedDelegate(role: string, task: string, mode = 'agent'): Promise<string> {
    if (this.healthMonitor) {
      await this.healthMonitor.waitForHealthy();
    }
    return this.delegateAgent(role, task, mode);
  }

  private async healthCheckedArchitect(task: string): Promise<string> {
    if (this.healthMonitor) {
      await this.healthMonitor.waitForHealthy();
    }
    return this.delegateArchitect(task);
  }

  private async healthCheckedCounterpart(task: string): Promise<string> {
    if (this.healthMonitor) {
      await this.healthMonitor.waitForHealthy();
    }
    return this.delegateCounterpart(task);
  }

  // ── State checkpointing ────────────────────────────────────────────

  private buildSnapshot(phase: PipelinePhase): PipelineSnapshot {
    return {
      epicId: this.epicId,
      phase,
      subPhase: this._currentPhase,
      goal: this._goal,
      acceptanceCriteria: this._acceptanceCriteria,
      architectContext: this.architectContext,
      designPlan: this.designPlan,
      todoQueue: this.todoQueue.map(e => ({
        todo: e.todo,
        status: e.status,
        builderOutput: e.builderOutput,
        attempts: e.attempts,
      })),
      finalizeCycle: this.finalizeCycle,
      replansRemaining: this.replansRemaining,
      architectClaudeSessionId: this.getClaudeSessionId(this.architectSessionId),
      counterpartClaudeSessionId: this.getClaudeSessionId(this.counterpartSessionId),
      childOutputs: this.childOutputs.map(c => ({
        role: c.role,
        agentName: c.agentName,
        output: c.output.substring(0, 5000),
      })),
      complexity: this.complexity,
      model: this.model || '',
      workspace: this.workspace,
      autoProfiles: JSON.stringify(this.autoProfiles.map(p => p.id)),
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
  }

  private async checkpointState(phase: PipelinePhase): Promise<void> {
    if (!this.stateStore) return;
    try {
      const snapshot = this.buildSnapshot(phase);
      await this.stateStore.checkpoint(snapshot);
    } catch (err) {
      console.warn(`[HybridPipeline] Checkpoint failed (non-fatal):`, err);
    }
  }

  private async onPipelineComplete(): Promise<void> {
    if (this.stateStore) {
      try {
        await this.stateStore.remove(this.epicId);
      } catch (err) {
        console.warn(`[HybridPipeline] Failed to clean up pipeline state:`, err);
      }
    }
  }

  private getClaudeSessionId(internalSid: string | null): string | null {
    if (!internalSid) return null;
    try {
      return this.handle.getRealSessionId(internalSid) || null;
    } catch {
      return null;
    }
  }

  // ── Pipeline feature flags based on config / complexity ───────────────────────

  private getPipelineFeatures(): PipelineFeatures {
    if (this.pipelineConfig && this.pipelineConfig.nodes.length > 0) {
      const nodes = this.pipelineConfig.nodes;
      return {
        architectTurns: nodes.some(n => n.id === 'architect' && n.model !== 'disabled') ? 1 : 0,
        useCounterpart: nodes.some(n => n.id === 'counterpart' && n.model !== 'disabled'),
        useTester: nodes.some(n => n.id === 'tester' && n.model !== 'disabled'),
      };
    }

    // Fallback to legacy complexity
    const c = this.complexity;
    return {
      architectTurns: (c === 'trivial') ? 0 : (c === 'small' || c === 'medium') ? 1 : 3,
      useCounterpart: c !== 'trivial' && c !== 'small',
      useTester: c !== 'trivial',
    };
  }

  // ── AngyCode (Gemini/Anthropic) helpers ─────────────────────────────

  /** Fetch the API key for the current provider from the database. */
  private async getApiKey(provider: 'gemini' | 'anthropic'): Promise<string> {
    const key = provider === 'gemini' ? 'gemini_api_key' : 'anthropic_api_key';
    return (await this.sessions.db.getAppSetting(key)) ?? '';
  }

  /** Strip the 'angy-' prefix from model IDs (the server expects raw model names). */
  private get effectiveModel(): string | undefined {
    return this.model?.replace(/^angy-/, '');
  }

  /**
   * Resolve a pipeline config node for a given role string.
   *
   * Resolution order:
   *  1. Exact role match  (e.g. 'builder-frontend' → node role 'builder-frontend')
   *  2. Exact id match    (e.g. 'counterpart' → node id 'counterpart')
   *  3. Prefix match in either direction:
   *     - node role is prefix of requested role  (e.g. node 'tester' matches 'tester-frontend')
   *     - requested role is prefix of node role  (e.g. 'builder' matches node 'builder-frontend')
   */
  private findPipelineNode(role: string): AgentNode | undefined {
    if (!this.pipelineConfig || this.pipelineConfig.nodes.length === 0) return undefined;
    const nodes = this.pipelineConfig.nodes;
    let node = nodes.find(n => n.role === role);
    if (!node) node = nodes.find(n => n.id === role);
    if (!node) {
      node = nodes.find(n =>
        n.role.startsWith(role) || role.startsWith(n.role)
      );
    }
    return node;
  }

  private getNodeModel(role: string): string | undefined {
    const node = this.findPipelineNode(role);
    if (node && node.model !== 'disabled') {
      return node.model.replace(/^angy-/, '');
    }
    return this.effectiveModel;
  }

  /** Cancel a child process regardless of which process manager owns it. */
  private cancelChild(sessionId: string): void {
    if (this.acpm?.isRunning(sessionId)) {
      this.acpm.cancel(sessionId);
    } else {
      this.processes.cancelProcess(sessionId);
    }
  }

  // ── Agent delegation ────────────────────────────────────────────────

  static readonly CRASH_THRESHOLD_MS = 10_000;
  static readonly MAX_CRASH_RETRIES = 4;

  private async delegateAgent(role: string, task: string, mode = 'agent'): Promise<string> {
    const { result } = await this.delegateAgentReturningSid(role, task, mode);
    return result;
  }

  private async delegateAgentReturningSid(role: string, task: string, mode = 'agent'): Promise<{ sessionId: string; result: string }> {
    for (let attempt = 0; attempt <= HybridPipelineRunner.MAX_CRASH_RETRIES; attempt++) {
      if (this._cancelled) throw new Error('Pipeline cancelled');

      const startTime = Date.now();
      try {
        const { sessionId, result } = await this.spawnAgent(role, task, mode);
        const elapsed = Date.now() - startTime;

        if (elapsed < HybridPipelineRunner.CRASH_THRESHOLD_MS && attempt < HybridPipelineRunner.MAX_CRASH_RETRIES) {
          this.log(`Agent ${role} exited in ${elapsed}ms (< ${HybridPipelineRunner.CRASH_THRESHOLD_MS}ms) — likely crashed. Retrying (attempt ${attempt + 1}/${HybridPipelineRunner.MAX_CRASH_RETRIES})...`);

          // Before retrying, check if Claude is actually available
          if (this.healthMonitor) {
            await this.healthMonitor.waitForHealthy();
          } else {
            const backoff = Math.min(5000 * Math.pow(2, attempt), 60000);
            await new Promise(r => setTimeout(r, backoff));
          }
          continue;
        }

        return { sessionId, result };
      } catch (err) {
        const errorType = this.healthMonitor
          ? this.healthMonitor.classifyError(err)
          : 'transient';

        if (errorType === 'fatal' || attempt >= HybridPipelineRunner.MAX_CRASH_RETRIES) {
          throw err;
        }

        this.log(`Agent ${role} error (${errorType}), attempt ${attempt + 1}/${HybridPipelineRunner.MAX_CRASH_RETRIES}: ${err instanceof Error ? err.message : String(err)}`);

        // For transient errors, wait for Claude to recover
        if (this.healthMonitor) {
          await this.healthMonitor.waitForHealthy();
        } else {
          const backoff = Math.min(5000 * Math.pow(2, attempt), 60000);
          await new Promise(r => setTimeout(r, backoff));
        }
      }
    }
    throw new Error(`Agent ${role} failed after ${HybridPipelineRunner.MAX_CRASH_RETRIES + 1} attempts`);
  }

  private async spawnAgent(role: string, task: string, mode = 'agent'): Promise<{ sessionId: string; result: string }> {
    const agentName = this.generateAgentName(role);

    this.events.emit('delegationStarted', {
      role,
      task: task.substring(0, 200),
      parentSessionId: this.rootSessionId,
    });

    const childSid = this.sessions.manager.createChildSession(
      this.rootSessionId, this.workspace, mode, task,
    );
    const childInfo = this.sessions.getSession(childSid);
    if (childInfo) {
      childInfo.title = agentName.charAt(0).toUpperCase() + agentName.slice(1);
      childInfo.epicId = this.epicId;
    }
    await this.sessions.persistSession(childSid);
    engineBus.emit('session:created', { sessionId: childSid, parentSessionId: this.rootSessionId });

    const systemPrompt = this.buildSystemPrompt(role);

    // Determine if it's angy code based on node model
    const modelForRole = this.getNodeModel(role);
    const isAngyCode = !!this.acpm && !!modelForRole && (modelForRole.startsWith('gemini') || modelForRole.startsWith('angy-'));
    const provider = modelForRole?.includes('gemini') ? 'gemini' : 'anthropic';

    const result = await new Promise<string>((resolve, reject) => {
      this.activeProcesses.add(childSid);

      const timeout = setTimeout(() => {
        if (this.pendingResolvers.has(childSid)) {
          this.cancelChild(childSid);
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

      if (isAngyCode) {
        this.getApiKey(provider).then(apiKey => {
          this.acpm!.sendMessage({
            sessionId: childSid,
            workingDir: this.workspace,
            goal: task,
            provider,
            apiKey,
            model: modelForRole,
            systemPrompt,
          }, this.handle);
        }).catch(reject);
      } else {
        this.processes.sendMessage(childSid, task, this.handle, {
          workingDir: this.workspace,
          mode,
          model: modelForRole,
          systemPrompt,
          agentName,
          specialistRole: role,
        });
      }
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
          this.cancelChild(sid);
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

      const modelForRole = this.getNodeModel(role);
      const isAngyCode = !!this.acpm && !!modelForRole && (modelForRole.startsWith('gemini') || modelForRole.startsWith('angy-'));
      const provider = modelForRole?.includes('gemini') ? 'gemini' : 'anthropic';

      if (isAngyCode) {
        this.getApiKey(provider).then(apiKey => {
          this.acpm!.sendMessage({
            sessionId: sid,
            workingDir: this.workspace,
            goal: task,
            provider,
            apiKey,
            model: modelForRole,
          }, this.handle);
        }).catch(reject);
      } else {
        this.processes.sendMessage(sid, task, this.handle, {
          workingDir: this.workspace,
          mode: 'agent',
          model: modelForRole,
          resumeSessionId: this.handle.getRealSessionId(sid) || undefined,
        });
      }
    });
  }

  /**
   * Delegate to a tester by scope. First call per scope spawns a new session;
   * subsequent calls reuse the same session so the tester retains full context
   * of what it already verified and what failed.
   */
  private async delegateTester(scope: string, task: string): Promise<string> {
    const role = `tester-${scope}`;
    const existingSid = this.testerSessions.get(scope);

    if (!existingSid) {
      if (this.healthMonitor) await this.healthMonitor.waitForHealthy();
      const { sessionId, result } = await this.delegateAgentReturningSid(role, task);
      this.testerSessions.set(scope, sessionId);
      return result;
    }

    if (this.healthMonitor) await this.healthMonitor.waitForHealthy();

    const sid = existingSid;
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
          this.cancelChild(sid);
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

      const modelForRole = this.getNodeModel(role);
      const isAngyCode = !!this.acpm && !!modelForRole && (modelForRole.startsWith('gemini') || modelForRole.startsWith('angy-'));
      const provider = modelForRole?.includes('gemini') ? 'gemini' : 'anthropic';

      if (isAngyCode) {
        this.getApiKey(provider).then(apiKey => {
          this.acpm!.sendMessage({
            sessionId: sid,
            workingDir: this.workspace,
            goal: task,
            provider,
            apiKey,
            model: modelForRole,
          }, this.handle);
        }).catch(reject);
      } else {
        this.processes.sendMessage(sid, task, this.handle, {
          workingDir: this.workspace,
          mode: 'agent',
          model: modelForRole,
          resumeSessionId: this.handle.getRealSessionId(sid) || undefined,
        });
      }
    });
  }

  /** Discard a persistent tester session so the next verify spawns a fresh one. */
  private resetTesterSession(scope: string): void {
    this.testerSessions.delete(scope);
  }

  /**
   * Delegate to a builder by scope, reusing the session across todos of the same scope.
   * The session is reset if it was first used more than BUILDER_SESSION_MAX_MS ago,
   * preventing stale context and bloated history from slowing down later turns.
   */
  private async delegateBuilder(scope: string, task: string): Promise<string> {
    const role = `builder-${scope}`;
    const existing = this.builderSessions.get(scope);

    const isExpired = existing
      ? (Date.now() - existing.startedAt) > HybridPipelineRunner.BUILDER_SESSION_MAX_MS
      : false;

    if (isExpired) {
      this.log(`Builder-${scope} session expired (>${HybridPipelineRunner.BUILDER_SESSION_MAX_MS / 60000}min), starting fresh`);
      this.builderSessions.delete(scope);
    }

    if (!this.builderSessions.has(scope)) {
      if (this.healthMonitor) await this.healthMonitor.waitForHealthy();
      const { sessionId, result } = await this.delegateAgentReturningSid(role, task);
      this.builderSessions.set(scope, { sessionId, startedAt: Date.now() });
      return result;
    }

    if (this.healthMonitor) await this.healthMonitor.waitForHealthy();

    const { sessionId: sid } = this.builderSessions.get(scope)!;
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
          this.cancelChild(sid);
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

      const modelForRole = this.getNodeModel(role);
      const isAngyCode = !!this.acpm && !!modelForRole && (modelForRole.startsWith('gemini') || modelForRole.startsWith('angy-'));
      const provider = modelForRole?.includes('gemini') ? 'gemini' : 'anthropic';

      if (isAngyCode) {
        this.getApiKey(provider).then(apiKey => {
          this.acpm!.sendMessage({
            sessionId: sid,
            workingDir: this.workspace,
            goal: task,
            provider,
            apiKey,
            model: modelForRole,
          }, this.handle);
        }).catch(reject);
      } else {
        this.processes.sendMessage(sid, task, this.handle, {
          workingDir: this.workspace,
          mode: 'agent',
          model: modelForRole,
          resumeSessionId: this.handle.getRealSessionId(sid) || undefined,
        });
      }
    });
  }

  /** Discard a persistent builder session (e.g. after re-planning). */
  private resetBuilderSession(scope: string): void {
    this.builderSessions.delete(scope);
  }

  // ── Structured extraction calls ─────────────────────────────────────

  private emitInternalCall(callType: 'extractVerdict' | 'extractTodos' | 'extractTestResult' | 'verifyTodo' | 'verifyBatch' | 'generateFixTodos', status: 'started' | 'completed'): void {
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

  private async extractTodos(approvedPlan: string): Promise<PipelineTodo[]> {
    this.emitInternalCall('extractTodos', 'started');
    const result = await this.structuredCall<TodoList>(
      TODO_SCHEMA,
      `Split this approved architect plan into sequential build todos. Each todo is a deliverable step that builds on the previous ones. The runner will execute them in order, verifying each one before starting the next.

# Rules

1. Todos are ORDERED — each builds on the codebase state left by the previous todo.
2. Each todo MUST be independently verifiable: after building it, we run a check (compile, smoke test, curl, etc.) to confirm it works before moving on.
3. Scope must be exactly one of: scaffold, backend, frontend. Do NOT mix scopes within a single todo.
   - scaffold = infrastructure (containerization, configs, build files, DB init, docker-compose)
   - backend = server-side (routes, services, data layer, middleware)
   - frontend = client-side (views, components, state, routing, styles)
4. Order: scaffold first (if needed), then backend, then frontend.
5. Use 3-8 todos for typical projects. Start with scaffold/foundation, end with the frontend UI.
6. IDs must be short, lowercase, dash-separated (e.g. "scaffold-setup", "backend-api", "frontend-ui").
7. The "requirements" field must contain DETAILED builder instructions — copy relevant integration contracts, design system sections, conventions, and traps from the plan verbatim. A builder will only see this field, not the full plan.
8. The "files" field lists files this todo will CREATE or MODIFY.
9. The "testCriteria" field describes the specific check to run: "project compiles with no errors", "server starts and GET /health returns 200", "POST /api/users returns 201 with valid body", etc. Be concrete.
10. The "dependsOn" field lists IDs of prerequisite todos that must complete first.
11. CRITICAL: Do NOT omit, rename, or alter any detail from the plan. Field names, endpoint paths, response shapes, column names, library choices — use them EXACTLY as the architect specified.

# Plan to split

${approvedPlan}`,
    );
    this.emitInternalCall('extractTodos', 'completed');
    return result.todos;
  }

  private async extractTestResult(testerOutput: string): Promise<TestResult> {
    this.emitInternalCall('extractTestResult', 'started');
    const result = await this.structuredCall<TestResult>(
      TEST_RESULT_SCHEMA,
      `You are extracting a strict test verdict from a tester agent's output.

## Rules — READ CAREFULLY

\`testsPassed\` must be TRUE only if ALL of the following hold:
1. The project built without errors
2. All automated/unit tests passed
3. All integration and smoke tests passed — meaning the actual application or CLI was launched and its behaviour verified
4. No runtime crashes, unhandled exceptions, or broken commands were observed
5. Every acceptance criterion in the spec was verified end-to-end

\`testsPassed\` must be FALSE if ANY of the following occurred:
- Any command, endpoint, or feature crashed or threw a runtime error
- Integration or smoke tests were skipped, not run, or failed
- The tester reports uncertainty or partial success
- The application could not be started or exercised as a real user would

IMPORTANT: A high automated-test pass rate does NOT override integration failures. Unit tests and runtime/integration tests are independent gates — both must pass for \`testsPassed\` to be true.

List every failure, crash, unhandled error, and unverified requirement in \`failures\`, even if automated tests passed.

## Tester output

${testerOutput}`,
    );
    this.emitInternalCall('extractTestResult', 'completed');
    return result;
  }

  private async generateFixTodos(issues: string, source: 'counterpart' | 'test'): Promise<PipelineTodo[]> {
    this.emitInternalCall('generateFixTodos', 'started');
    const result = await this.structuredCall<TodoList>(
      TODO_SCHEMA,
      `Convert these ${source} issues into fix-todos, grouped by scope.

# Rules — READ CAREFULLY

1. Produce AT MOST ONE todo per scope. Allowed scopes: scaffold, backend, frontend.
2. ALL issues that belong to the same scope MUST be merged into a single todo — never split a scope into multiple todos.
3. You will produce 1, 2, or 3 todos maximum (one per affected scope). No more.
4. For each scope-level todo:
   - id: "fix-<scope>" (e.g. "fix-backend", "fix-frontend", "fix-scaffold")
   - title: one-line summary of ALL fixes in that scope
   - scope: the scope name
   - requirements: a COMPLETE, detailed list of every change needed in this scope — one sub-section per issue, with full file paths, what to change, and why. The builder will ONLY see this field; be exhaustive.
   - files: union of all files touched by issues in this scope
   - testCriteria: how to verify ALL fixes in this scope passed (compile + smoke check)
   - dependsOn: []

# Issues to fix

${issues}`,
    );
    this.emitInternalCall('generateFixTodos', 'completed');
    return result.todos;
  }

  private async structuredCall<T>(schema: object, prompt: string): Promise<T> {
    const claudeBin = await this.resolveClaudeBinary();
    const schemaJson = JSON.stringify(schema);
    const modelForRole = this.getNodeModel('architect');

    const { writeTextFile, remove } = await import('@tauri-apps/plugin-fs');
    const { join, tempDir } = await import('@tauri-apps/api/path');
    const tmpDir = await tempDir();
    const tmpFile = await join(tmpDir, `angy-structured-${Date.now()}.txt`);
    await writeTextFile(tmpFile, prompt);

    try {
      let modelArgStr = '--model sonnet';
      if (modelForRole && modelForRole.startsWith('claude-')) {
        let clean = modelForRole;
        if (clean.includes('3-5-sonnet')) clean = 'sonnet';
        else if (clean.includes('3-7-sonnet')) clean = 'claude-3-7-sonnet-20250219';
        else if (clean.includes('haiku')) clean = 'haiku';
        modelArgStr = `--model ${clean}`;
      }

      const escapedSchema = schemaJson.replace(/'/g, "'\\''");
      const escapedTmpFile = tmpFile.replace(/'/g, "'\\''");
      const shellCmd =
        `exec '${claudeBin.replace(/'/g, "'\\''")}' ` +
        `-p --output-format json ${modelArgStr} ` +
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

  private isRejected(output: string): boolean {
    return /^REJECTED/i.test(output.trim());
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

  private architectStructureTask(goal: string, acceptanceCriteria: string): string {
    return `Analyze the codebase and design a solution for this epic.

IMPORTANT: Assess the specification's completeness before planning. If the input already contains detailed schemas, API contracts, state machines, and component definitions, your plan should reorganize the spec into module-scoped builder tasks rather than redesign from scratch. Preserve the spec's terminology, field names, and structure — do not reinterpret or rename things. Minimize your interpretation layer. If the input is a vague goal, design the full solution as you normally would.

IMPORTANT: Assess whether this is a new project or an existing project. If existing, read the codebase first, respect existing conventions, and only include scopes that the task actually requires (do not force scaffold/backend/frontend if only one is needed).

The plan will be executed by three specialized builder types — scaffold (infrastructure), backend (server-side), and frontend (client-side). Structure file ownership so that each file is owned by exactly one scope.

Integration contracts MUST specify the EXACT response envelope structure including nesting depth so frontend and backend builders agree on the wire format without needing to read each other's code.

# Goal
${goal}

# Acceptance Criteria
${acceptanceCriteria}

# Required Output (produce ONLY these sections)

## EXECUTION PLAN
Ordered steps grouped by scope (scaffold, backend, frontend). Mark each step with its scope.

## FILE OWNERSHIP MATRIX
Which scope owns which files. No overlaps between scopes.
Small artifacts (README, docker-compose, config files) belong to the scaffold scope.

## CONVENTIONS DISCOVERED
Patterns that all builders must follow (naming, imports, error handling, etc.).

## TRAPS
Things builders must NOT do. Common mistakes to avoid.

## INTEGRATION CONTRACTS
For each API endpoint, specify:
- HTTP method, path, and purpose
- Request body schema with required/optional fields and types
- Validation rules (which fields are required, non-empty, constrained)
- Response shape for success and error cases — specify EXACT envelope structure including nesting depth, field names, and status codes
- WebSocket events emitted (event name + payload shape)

Be specific and actionable. A fresh builder with no prior context must be able to implement their scope from this plan alone.`;
  }

  private architectDesignTask(structurePlan: string): string {
    return `Now produce the DESIGN SYSTEM section for the structural plan below.

This section will be given to frontend builders to ensure a cohesive, visually rich product. The builder will follow it literally — vague or minimal guidance produces vague, minimal UIs. Be specific and opinionated.

If this is an existing project, read existing views/components and describe the existing design language rather than inventing a new one. If it IS a new project, design something that feels warm, crafted, and intentional — not a default template.

# Approved Structural Plan
${structurePlan}

# Design Philosophy

The goal is a UI that looks like a real product, not a code exercise. Think about how a user would FEEL using it. Avoid the "developer default" trap: unstyled containers, raw text, missing visual cues. Every screen should have visual warmth, hierarchy, and polish.

# Required Output (produce ONLY the DESIGN SYSTEM section)

## DESIGN SYSTEM

### Color Palette
Specify as exact CSS custom properties or framework utility classes. Include:
- Primary color + hover/active variants (for buttons, links, active states)
- Secondary/accent color (for highlights, badges, call-to-action elements)
- Neutral scale (background, surface, border, muted text, strong text — at least 5 shades)
- Semantic colors: success, warning, error, info — each with background and foreground variants
- Dark/light surface pairing (e.g. sidebar dark, content light — or vice versa)

### Typography
- Font family (specify a real font: Inter, Plus Jakarta Sans, DM Sans — not just "sans-serif")
- Heading scale: h1 through h4 with exact sizes, weights, and line-heights
- Body text: size, weight, line-height, color
- Small/caption text: size, weight, color
- Monospace font for code/data (if applicable)

### Iconography
- Icon library to use (e.g. Lucide, Heroicons, Phosphor, Material Symbols)
- Icon size conventions (inline text icons, button icons, feature icons, empty-state illustrations)
- Where to use icons: navigation items, action buttons, status indicators, list item prefixes, empty states, form field adornments, toast/alert leading icons
- Icons should appear EVERYWHERE there is an action or a status — never leave a button or nav item as plain text when an icon would add clarity

### Component Patterns
- **Cards**: Border radius, shadow depth, padding, hover effect (subtle lift or border glow)
- **Buttons**: Primary (filled), secondary (outlined), ghost (text-only), danger. Specify padding, radius, font-weight, and hover/focus states. Buttons should feel tactile.
- **Forms**: Input height, border style, focus ring color, label placement (above or floating), field spacing, inline validation style
- **Tables/Lists**: Row hover highlight, alternating row shading (or not), column alignment conventions, sort indicator style
- **Badges/Chips**: Size, border-radius (pill vs rounded-rect), color variants for status (active, pending, archived, error)
- **Modals/Dialogs**: Overlay opacity, dialog width, padding, header/body/footer structure
- **Tooltips**: Style, delay, max-width

### Layout Structure
- Overall layout: sidebar + content, topbar + content, or stacked
- Sidebar: width, background color, nav item style (icon + label, active indicator, section grouping)
- Content area: max-width, padding, responsive behavior
- Page structure: page title placement, breadcrumb style, action button placement (top-right)
- Responsive breakpoints: mobile, tablet, desktop thresholds and what changes at each

### Visual Warmth and Polish
- Border radius convention (e.g. 8px for cards, 6px for inputs, 12px for modals)
- Shadow system: sm (cards), md (dropdowns), lg (modals) — specify exact values
- Transition/animation: default duration, easing, what gets animated (hover, open/close, page transitions)
- Accent details: gradient usage (subtle header gradient, button gradient), decorative borders, colored left-border on cards for categorization
- White space rhythm: consistent spacing scale (4px, 8px, 12px, 16px, 24px, 32px, 48px)

### State Patterns
- **Loading**: Skeleton screens for content areas (not spinners), pulse animation, shimmer direction. Spinner only for action buttons (inline, replacing button text).
- **Empty states**: Centered layout with: large muted icon (from the icon library), heading text, descriptive subtext, primary action button. Never just "No data" in plain text.
- **Error states**: Inline field errors (red text below input with icon), toast notifications (position, auto-dismiss timing, icon + color per severity), full-page error (illustration + message + retry button), API error banners (top of content area, dismissible)
- **Success feedback**: Toast with check icon, or inline success message with green accent

### Data Visualization (if applicable)
- Chart color sequence (use palette-derived colors)
- Chart style: minimal grid lines, rounded line caps, tooltip style`;
  }

  private async detectFrontendScope(plan: string): Promise<boolean> {
    const frontendKeywords = /frontend|\.vue|\.tsx|\.jsx|\.svelte|component|view|UI|user interface|tailwind|CSS/i;
    return frontendKeywords.test(plan);
  }

  private planReviewTask(plan: string, acceptanceCriteria: string): string {
    return `You are reviewing and refining an architect's plan. Your job is to find issues AND fix them directly in the plan — not report them back.

# Acceptance Criteria
${acceptanceCriteria}

# Architect's Plan
${plan}

# Review Checklist

Check for these common issues:
1. Plan covers all acceptance criteria
2. No file ownership overlaps between scopes
3. Integration contracts specify exact request/response schemas (field names, types, status codes, envelope nesting)
4. Response shapes are unambiguous — a frontend builder must be able to destructure correctly WITHOUT reading backend code
5. Dockerfile commands are correct (npm ci vs npm install, --omit=dev implications, lockfile requirements)
6. Docker networking is correct (service names as hostnames, ports, healthchecks with depends_on conditions)
7. No internal contradictions (conventions vs steps, traps vs implementation guidance)
8. Missing files (.gitignore, .dockerignore, lockfiles, config files)
9. Plan is specific enough for a fresh builder to implement without ambiguity
10. Error handling and edge cases are addressed (validation, malformed input, 404s)

# Output

If the plan is structurally sound but has issues, FIX THEM directly and output the COMPLETE corrected plan. Do not list issues separately — apply your fixes inline. Your output replaces the architect's plan entirely, so it must be complete and self-contained with every section. Do not abbreviate or summarize sections.

If the plan is fundamentally broken (wrong technology choices for the requirements, missing entire architectural layers, incoherent structure that cannot be patched) and cannot be salvaged by editing, start your response with REJECTED: followed by the specific reason. This should be rare — most plans can be fixed by editing.

Otherwise, output ONLY the complete, corrected plan.`;
  }

  private todoTask(todo: PipelineTodo): string {
    let scopeGuidance = '';

    if (todo.scope === 'scaffold') {
      scopeGuidance = `\n## Scope: Infrastructure (scaffold)

You MUST produce an integration test script that starts all services from zero, waits for health checks, runs data setup, verifies connectivity, and tears down cleanly.

Self-check: verify services start from a clean state (no leftover containers, volumes, or data).`;
    } else if (todo.scope === 'backend') {
      scopeGuidance = `\n## Scope: Backend

Follow integration contracts EXACTLY — response envelope shapes, field names, and status codes must match the documented structure so frontend builders can depend on them without reading your code.

Self-check: compilation must be clean before finishing.`;
    } else if (todo.scope === 'frontend') {
      scopeGuidance = `\n## Scope: Frontend — UI Quality Requirements

- Apply the Design System section (if present) for a cohesive visual identity. For existing projects, match the existing visual style and component patterns.
- Every data view MUST have loading, empty, and error states.
- Use icons for visual richness. Create visual hierarchy (headings, spacing, color accents).
- Ensure the style pipeline is fully wired (CSS entry point exists and is imported).
- READ the actual backend code to verify response shapes before writing stores/API calls.
- "Minimal" does NOT mean "visually sparse" — minimal means clean and focused, not bare.

Self-check: start the dev server and confirm styled content renders (not raw unstyled markup).`;
    }

    return `## Todo: ${todo.title} [${todo.scope}]

${todo.requirements}

## Your Files
${todo.files.join('\n')}

## Verification Criteria
After implementing, this will be verified by: ${todo.testCriteria}
${scopeGuidance}

## Self-Check (REQUIRED before finishing)

After implementing all files, you MUST verify your work:
1. Build/compile the project (npm run build, tsc --noEmit, go build, cargo check, etc.)
2. Fix any compilation errors before finishing
3. If a Dockerfile exists, verify it builds: docker compose build <service>
4. Confirm the verification criteria above would pass

Do NOT finish until your code compiles cleanly.

## Architect Context
${this.architectContext}`;
  }

  private replanTask(failedTodo: PipelineTodo, errors: string[], remainingTodos: PipelineTodo[]): string {
    const remainingList = remainingTodos.map(t => `- ${t.id}: ${t.title} [${t.scope}]`).join('\n');
    const errorText = errors.length > 0 ? errors.join('\n') : 'No specific errors captured.';

    return `A todo failed execution after 3 fix attempts. You need to revise the remaining plan.

# Failed Todo
- ID: ${failedTodo.id}
- Title: ${failedTodo.title}
- Scope: ${failedTodo.scope}
- Requirements: ${failedTodo.requirements}
- Test criteria: ${failedTodo.testCriteria}

# Errors from last attempt
${errorText}

# Remaining Todos (not yet started)
${remainingList || 'None'}

# Instructions

Produce a REVISED list of execution steps to complete the remaining work.
You may:
- Split the failed todo into smaller, more targeted pieces
- Adjust remaining todos to account for what was partially built
- Add new todos if the failure revealed missing work
- Remove todos that are no longer needed

You have the full architectural context from your earlier turns. The codebase has been partially modified by earlier completed todos — read it to understand the current state.

Use the same format as your original decomposition: for each step, describe its ID, title, scope, requirements, files, test criteria, and dependencies.`;
  }

  private codeReviewTask(architectContext: string, builderOutputs: string, acceptanceCriteria: string): string {
    return `Review all implementations against the architect's plan and acceptance criteria.

# Acceptance Criteria
${acceptanceCriteria}

# Architect's Plan
${architectContext}

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

  private testTask(): string {
    const contextSection = this.architectContext
      ? `\n# Architect Plan (includes contracts and verification details)\n${this.architectContext}`
      : '';

    return `Verify this project works end-to-end at ${this.workspace}.

# Full Specification
${this._goal}
${contextSection}

# Procedure

1. START: Launch the application using its standard method (look for docker-compose.yml, Makefile, package.json scripts, etc.). Wait for all services to be healthy.
2. VERIFY REQUIREMENTS: Read the specification above and identify every testable requirement. For each one, verify it by actually interacting with the running application — hit endpoints, open URLs, send data, check responses.
3. BROWSER VERIFICATION: For smoke steps that involve UI, open the URL in a browser, verify styled content renders (not raw markup), attempt login with test credentials, navigate to listed pages.
4. ADVERSARIAL: Send malformed inputs, missing fields, boundary values to every endpoint and input surface. Check for crashes, unhandled errors, security issues.
5. REGRESSION: If this is an existing project, also verify previously working functionality has not regressed.
6. LOGS: Check all container/process logs for errors, warnings, stack traces.
7. CLEANUP: Stop the application when done.

# Critical Rules

- NEVER mock, stub, or intercept backend APIs in integration or E2E tests. If a test fails because the backend is unreachable, report that as the failure — do not work around it.
- NEVER modify existing tests to make them pass — report the failure instead.

For each requirement, report PASS or FAIL with evidence (actual HTTP responses, log output, screenshots of terminal output).

If no explicit acceptance criteria section exists, derive testable requirements from the specification — every schema, endpoint, component, and integration point described is an implicit requirement.`;
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

  private validateTodos(todos: PipelineTodo[]): void {
    if (todos.length === 0) {
      throw new Error('Todo extraction produced zero todos');
    }
    const ids = new Set<string>();
    for (const t of todos) {
      if (ids.has(t.id)) {
        throw new Error(`Duplicate todo id: "${t.id}"`);
      }
      ids.add(t.id);
    }
    for (const t of todos) {
      for (const dep of t.dependsOn) {
        if (!ids.has(dep)) {
          throw new Error(`Todo "${t.id}" depends on unknown id "${dep}"`);
        }
      }
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

  private emitTodoProgress(scope = '', title = ''): void {
    const done = this.todoQueue.filter(e => e.status === 'done').length;
    const total = this.todoQueue.length;
    engineBus.emit('pipeline:todoProgress', {
      epicId: this.epicId,
      current: done,
      total,
      scope,
      title,
    });
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
