/**
 * SpawnConcurrencyTest — reproduces the parallel builder bug by running
 * the EXACT same sequence as a real HybridPipelineRunner:
 *
 *   Phase 1: architect (sequential)  → counterpart review (sequential)
 *   Phase 2: parallel builders via Promise.all
 *
 * Same shared HeadlessHandle, ProcessManager, SessionManager, pendingResolvers.
 * Prior phases leave state in finalizedChildren, sessions Map, etc.
 *
 * Run from the app's dev console:
 *   import('/src/engine/SpawnConcurrencyTest').then(m => m.runProductionTest(3))
 */

import { ProcessManager } from './ProcessManager';
import { HeadlessHandle } from './HeadlessHandle';
import { SessionManager } from './SessionManager';
import { SPECIALIST_PROMPTS, SPECIALIST_TOOLS } from './Orchestrator';
import { engineBus } from './EventBus';
import type { Database } from './Database';

// ── Stub Database ──────────────────────────────────────────────────────────

function createStubDb(): Database {
  const noop = async () => {};
  return {
    open: async () => true,
    close: noop,
    saveSession: noop,
    saveMessage: noop,
    loadMessages: async () => [],
    saveCheckpoint: noop,
    loadCheckpoints: async () => [],
    saveFileChange: noop,
    loadFileChanges: async () => [],
    deleteSession: noop,
    updateMessageSessionId: noop,
    turnCountForSession: async () => 0,
    deleteMessagesFromTurn: noop,
    deleteStalePendingSessions: noop,
    checkpointUuid: async () => '',
    latestCheckpointBefore: async () => '',
    loadSessions: async () => [],
    getDistinctWorkspaces: async () => [],
  } as unknown as Database;
}

// ── Build system prompt — copied from HybridPipelineRunner.buildSystemPrompt() ──

function buildSystemPrompt(role: string): string {
  const parts: string[] = [];
  const specialistPrompt = SPECIALIST_PROMPTS[role];
  if (specialistPrompt) parts.push(specialistPrompt);
  const toolList = SPECIALIST_TOOLS[role];
  if (toolList) {
    parts.push(`\nYou have access to these tools: ${toolList}. Use only these tools.`);
  }
  return parts.join('\n\n');
}

// ── Result type ────────────────────────────────────────────────────────────

interface AgentResult {
  id: number;
  role: string;
  sessionId: string;
  result: string;
  elapsedMs: number;
  error: string | null;
}

/**
 * Replicates the full HybridPipelineRunner lifecycle, then spawns parallel builders.
 *
 * Flow (mirrors run() exactly):
 *   1. Create root session
 *   2. Spawn architect agent (sequential) — leaves state in HeadlessHandle
 *   3. Spawn counterpart agent (sequential) — leaves more state
 *   4. Spawn N builder agents IN PARALLEL via Promise.all
 *
 * This ensures the shared HeadlessHandle/ProcessManager/pendingResolvers
 * carry the same accumulated state as a real pipeline when builders start.
 *
 * @param builderCount  Number of parallel builders (default 3)
 * @param rounds        Repetitions (default 1)
 */
export async function runProductionTest(
  builderCount = 3,
  rounds = 1,
  workspace?: string,
): Promise<void> {
  const ws = workspace || '/tmp';

  console.log(`\n${'='.repeat(70)}`);
  console.log(`Full-Pipeline Concurrency Test`);
  console.log(`  Phase 1: architect → counterpart (sequential, like production)`);
  console.log(`  Phase 2: ${builderCount} builders (PARALLEL via Promise.all)`);
  console.log(`  Rounds: ${rounds}`);
  console.log(`${'='.repeat(70)}\n`);

  let totalBuilderPasses = 0;
  let totalBuilderFails = 0;

  for (let round = 1; round <= rounds; round++) {
    console.log(`\n--- Round ${round}/${rounds} ---`);

    // ── Same instances shared across all phases (like production) ──
    const db = createStubDb();
    const mgr = new SessionManager();
    const handle = new HeadlessHandle(db, mgr);
    const processes = new ProcessManager();
    const pendingResolvers = new Map<string, (result: string) => void>();
    const activeProcesses = new Set<string>();
    let agentCounter = 0;
    const rootSessionId = mgr.createSession(ws, 'agent');

    // Wire onDelegateFinished — exact copy of HybridPipelineRunner constructor
    handle.onDelegateFinished = (childSid: string, result: string) => {
      activeProcesses.delete(childSid);
      const resolver = pendingResolvers.get(childSid);
      if (resolver) {
        pendingResolvers.delete(childSid);
        resolver(result);
      }
    };
    handle.onPersistSession = () => {};

    // ── spawnAgent — line-for-line copy of HybridPipelineRunner.spawnAgent() ──
    const spawnAgent = async (role: string, task: string): Promise<AgentResult> => {
      const t0 = Date.now();
      agentCounter++;
      const agentName = `${role}-${agentCounter}`;

      const childSid = mgr.createChildSession(rootSessionId, ws, 'agent', task);
      const childInfo = mgr.sessionInfo(childSid);
      if (childInfo) {
        childInfo.title = agentName.charAt(0).toUpperCase() + agentName.slice(1);
        childInfo.epicId = 'test-epic';
      }
      await db.saveSession(childInfo as any);
      engineBus.emit('session:created', { sessionId: childSid, parentSessionId: rootSessionId });

      const systemPrompt = buildSystemPrompt(role);

      const result = await new Promise<string>((resolve, reject) => {
        activeProcesses.add(childSid);

        const timeout = setTimeout(() => {
          if (pendingResolvers.has(childSid)) {
            processes.cancelProcess(childSid);
            pendingResolvers.delete(childSid);
            activeProcesses.delete(childSid);
            reject(new Error(`Agent ${agentName} timed out after 120s`));
          }
        }, 120_000);

        pendingResolvers.set(childSid, (r: string) => {
          clearTimeout(timeout);
          resolve(r);
        });

        processes.sendMessage(childSid, task, handle, {
          workingDir: ws,
          mode: 'agent',
          model: undefined,
          systemPrompt,
          agentName,
          specialistRole: role,
        });
      });

      return {
        id: agentCounter,
        role,
        sessionId: childSid,
        result: result.substring(0, 200),
        elapsedMs: Date.now() - t0,
        error: null,
      };
    };

    // ── delegatePersistentRole — mirrors HybridPipelineRunner.delegatePersistentRole() ──
    let architectSessionId: string | null = null;
    let counterpartSessionId: string | null = null;

    const delegatePersistentRole = async (
      role: string,
      task: string,
      field: 'architect' | 'counterpart',
    ): Promise<AgentResult> => {
      const currentSid = field === 'architect' ? architectSessionId : counterpartSessionId;

      if (!currentSid) {
        const res = await spawnAgent(role, task);
        if (field === 'architect') architectSessionId = res.sessionId;
        else counterpartSessionId = res.sessionId;
        return res;
      }

      // Reuse existing session (same as production lines 507-542)
      const sid = currentSid;
      const t0 = Date.now();

      handle.resetForReuse(sid);
      await handle.prepareForSend(sid, task);

      const result = await new Promise<string>((resolve, reject) => {
        activeProcesses.add(sid);

        const timeout = setTimeout(() => {
          if (pendingResolvers.has(sid)) {
            processes.cancelProcess(sid);
            pendingResolvers.delete(sid);
            activeProcesses.delete(sid);
            reject(new Error(`${role} timed out`));
          }
        }, 120_000);

        pendingResolvers.set(sid, (r: string) => {
          clearTimeout(timeout);
          resolve(r);
        });

        processes.sendMessage(sid, task, handle, {
          workingDir: ws,
          mode: 'agent',
          model: undefined,
          resumeSessionId: handle.getRealSessionId(sid) || undefined,
        });
      });

      return {
        id: -1,
        role,
        sessionId: sid,
        result: result.substring(0, 200),
        elapsedMs: Date.now() - t0,
        error: null,
      };
    };

    try {
      // ── Phase 1: Architect (sequential, same as production) ──
      console.log(`  [Phase 1] Spawning architect...`);
      const archResult = await spawnAgent(
        'architect',
        'Analyze the /tmp directory and describe what you find. Be brief, one paragraph.',
      );
      console.log(`  [Phase 1] Architect done: ${archResult.elapsedMs}ms, sid=${archResult.sessionId.substring(0, 8)}`);

      // ── Phase 1b: Counterpart review (sequential, same as production) ──
      console.log(`  [Phase 1] Spawning counterpart...`);
      const counterResult = await delegatePersistentRole(
        'counterpart',
        `Review this architect output and say VERDICT: APPROVED if reasonable:\n\n${archResult.result}`,
        'counterpart',
      );
      console.log(`  [Phase 1] Counterpart done: ${counterResult.elapsedMs}ms, sid=${counterResult.sessionId.substring(0, 8)}`);

      // ── State check before parallel builders ──
      console.log(`  [State] finalizedChildren: ${(handle as any).finalizedChildren?.size ?? '?'}`);
      console.log(`  [State] sessions in handle: ${(handle as any).sessions?.size ?? '?'}`);
      console.log(`  [State] activeProcesses: ${activeProcesses.size}`);
      console.log(`  [State] pendingResolvers: ${pendingResolvers.size}`);

      // ── Phase 2: Parallel builders (THIS is what triggers the bug) ──
      console.log(`  [Phase 2] Spawning ${builderCount} parallel builders...`);
      const builderT0 = Date.now();

      const builderTasks = [
        [
          `You are builder 0 implementing the "backend" module.`,
          `Explore the codebase at ${ws}:`,
          `1. Use Glob to find all TypeScript files in the src/ directory`,
          `2. Read the package.json to understand project structure`,
          `3. Use Grep to search for "export class" across the codebase`,
          `4. Read 3 source files that look important`,
          `5. Say "BUILDER 0 COMPLETE" when done.`,
        ].join('\n'),
        [
          `You are builder 1 implementing the "frontend" module.`,
          `Explore the codebase at ${ws}:`,
          `1. Use Glob to find all .vue files`,
          `2. Use Grep to search for "defineComponent\\|defineProps" in .vue files`,
          `3. Read the main App component`,
          `4. List the directory structure with Bash: find ${ws}/src -type f | head -30`,
          `5. Say "BUILDER 1 COMPLETE" when done.`,
        ].join('\n'),
        [
          `You are builder 2 implementing the "infrastructure" module.`,
          `Explore the project at ${ws}:`,
          `1. Use Bash to check: ls -la ${ws}/src-tauri/`,
          `2. Read the Cargo.toml if it exists`,
          `3. Use Grep to search for "tauri" in TypeScript files`,
          `4. Read the tauri config or capabilities file`,
          `5. Say "BUILDER 2 COMPLETE" when done.`,
        ].join('\n'),
      ];

      const builderPromises = Array.from({ length: builderCount }, (_, i) =>
        spawnAgent(
          'builder',
          builderTasks[i % builderTasks.length],
        ).catch((err) => ({
          id: i,
          role: 'builder',
          sessionId: '',
          result: '',
          elapsedMs: Date.now() - builderT0,
          error: err.message ?? String(err),
        } as AgentResult)),
      );

      const builderResults = await Promise.all(builderPromises);
      const builderElapsed = Date.now() - builderT0;

      // ── Report builders ──
      let roundFails = 0;
      for (const r of builderResults) {
        const ok = !r.error && r.result.length > 0;
        console.log(
          `  builder #${r.id} sid=${r.sessionId.substring(0, 8)} ` +
          `elapsed=${r.elapsedMs}ms ` +
          `result=${JSON.stringify(r.result.substring(0, 80))} ` +
          `${ok ? 'PASS' : 'FAIL'}` +
          (r.error ? ` err="${r.error}"` : ''),
        );
        if (!ok) roundFails++;
      }

      console.log(
        `  Round ${round}: builders ${builderElapsed}ms, ` +
        `${roundFails > 0 ? roundFails + ' FAILED' : 'all OK'}`,
      );
      totalBuilderFails += roundFails;
      totalBuilderPasses += builderCount - roundFails;

    } catch (err) {
      console.error(`  Round ${round} FATAL:`, err);
      totalBuilderFails += builderCount;
    }
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(`RESULT: ${totalBuilderPasses} passed, ${totalBuilderFails} failed / ${builderCount * rounds} builders`);
  if (totalBuilderFails > 0) console.log('BUG REPRODUCED through full-pipeline code path');
  else console.log('All builders completed through full-pipeline code path');
  console.log(`${'='.repeat(70)}\n`);
}
