import { ref, computed } from 'vue';
import { Orchestrator } from '../engine/Orchestrator';
import { OrchestratorPool } from '../engine/OrchestratorPool';
import { PipelineEngine } from '../engine/PipelineEngine';
import { engineBus } from '../engine/EventBus';
import type { AngyEngine } from '../engine/AngyEngine';
import type { BranchManager } from '../engine/BranchManager';
import type { OrchestratorOptions } from '../engine/KosTypes';
import { getTechProfileById, type TechProfile } from '../engine/TechDetector';

// ── Singleton instances ──────────────────────────────────────────────────────

const orchestrator = new Orchestrator();
const pipeline = new PipelineEngine();

// ── Pool & epic orchestrators ────────────────────────────────────────────────

let pool: OrchestratorPool | null = null;
let engine: AngyEngine | null = null;
const epicOrchestrators = new Map<string, Orchestrator>();

// ── Reactive state ───────────────────────────────────────────────────────────

const phase = ref('');
const running = ref(false);
const delegations = ref(0);
const lastEvent = ref('');
const activeEpicCount = ref(0);
const autoProfiles = ref<TechProfile[]>([]);

// ── Wire up standalone orchestrator events to reactive state ─────────────────

orchestrator.on('phaseChanged', (e) => {
  phase.value = e.phase;
  running.value = orchestrator.isRunning();
});

orchestrator.on('delegationStarted', (e) => {
  delegations.value = orchestrator.totalDelegations();
  lastEvent.value = `Delegating to ${e.role}`;
  engineBus.emit('orchestrator:delegationStarted', { role: e.role, task: e.task, parentSessionId: e.parentSessionId });
});

orchestrator.on('completed', (e) => {
  running.value = false;
  lastEvent.value = `Completed: ${e.summary.substring(0, 80)}`;
});

orchestrator.on('failed', (e) => {
  running.value = false;
  lastEvent.value = `Failed: ${e.reason.substring(0, 80)}`;
});

orchestrator.on('checkpointCreated', (e) => {
  lastEvent.value = `Checkpoint: ${e.hash}`;
  engineBus.emit('orchestrator:checkpointCreated', { hash: e.hash, message: e.message });
});

orchestrator.on('autoProfilesDetected', (e) => {
  autoProfiles.value = e.profiles;
});

engineBus.on('orchestrator:autoProfilesDetected', (data) => {
  autoProfiles.value = data.profileIds
    .map(id => getTechProfileById(id))
    .filter((p): p is TechProfile => p !== undefined);
});

// ── Wire epic orchestrator events ────────────────────────────────────────────

function wireEpicOrchestratorEvents(orch: Orchestrator, epicId: string) {
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
    epicOrchestrators.delete(epicId);
    activeEpicCount.value = epicOrchestrators.size;
    engineBus.emit('epic:completed', { epicId, summary: e.summary });
  });
  orch.on('failed', (e) => {
    epicOrchestrators.delete(epicId);
    activeEpicCount.value = epicOrchestrators.size;
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
}

// ── Composable ───────────────────────────────────────────────────────────────

export function useOrchestrator() {
  const isRunning = computed(() => running.value);
  const totalDelegations = computed(() => delegations.value);

  // ── Pool management ──────────────────────────────────────────────────

  function initPool(branchManager: BranchManager): OrchestratorPool {
    pool = OrchestratorPool.getInstance(branchManager);
    return pool;
  }

  function getPool(): OrchestratorPool | null {
    return pool;
  }

  /** Set the AngyEngine reference for engine-based orchestrator lookup. */
  function setEngine(e: AngyEngine): void {
    engine = e;
  }

  // ── Epic orchestration ───────────────────────────────────────────────

  /**
   * Create a new Orchestrator instance for an epic.
   * Sets epic options and wires events. The caller must set chatPanel
   * and start the orchestrator (or use pool.spawnRoot for full lifecycle).
   */
  function createEpicOrchestrator(
    epicId: string,
    options: OrchestratorOptions,
  ): Orchestrator {
    console.log(`[useOrchestrator] Creating epic orchestrator: epicId=${epicId}, depth=${options.depth}`);
    const orch = new Orchestrator();
    orch.setEpicOptions(options);
    wireEpicOrchestratorEvents(orch, epicId);

    epicOrchestrators.set(epicId, orch);
    activeEpicCount.value = epicOrchestrators.size;
    console.log(`[useOrchestrator] Active epic orchestrators: ${epicOrchestrators.size}`);

    return orch;
  }

  /**
   * Cancel an epic's orchestration and clean up pool state.
   */
  async function cancelEpicOrchestration(epicId: string): Promise<void> {
    const orch = epicOrchestrators.get(epicId);
    if (orch) {
      orch.cancel();
      epicOrchestrators.delete(epicId);
      activeEpicCount.value = epicOrchestrators.size;
    }
    if (pool) {
      await pool.removeEpic(epicId);
    }
  }

  // ── Session → Orchestrator lookup (used by useEngine for routing) ────

  /**
   * Find the Orchestrator instance responsible for a given session ID.
   * Checks the standalone orchestrator first, then epic orchestrators via the pool.
   */
  function getOrchestratorForSession(sessionId: string): Orchestrator | null {
    // Check standalone orchestrator
    if (orchestrator.isRunning() && orchestrator.sessionId() === sessionId) {
      return orchestrator;
    }
    // Check epic orchestrators in the composable's own map
    if (pool) {
      const epicId = pool.getEpicForSession(sessionId);
      if (epicId) {
        const orch = epicOrchestrators.get(epicId) ?? null;
        if (orch) {
          console.log(`[useOrchestrator] Routed session ${sessionId} to epic orchestrator: ${epicId}`);
          return orch;
        }
      }
    }
    // Check engine-managed epic orchestrators (headless)
    if (engine) {
      const orch = engine.getOrchestratorForSession(sessionId);
      if (orch) return orch;
    }
    return null;
  }

  // ── Standalone orchestration (backward compat) ───────────────────────

  function startOrchestration(goal: string, profileIds: string[] = []) {
    return orchestrator.start(goal, profileIds);
  }

  function cancelOrchestration() {
    orchestrator.cancel();
  }

  // ── Pipeline (unchanged) ─────────────────────────────────────────────

  function startPipeline(
    pipelineId: string,
    parentSessionId: string,
    userInput: string,
  ) {
    return pipeline.startPipeline(pipelineId, parentSessionId, userInput);
  }

  function cancelPipeline(executionId: string) {
    pipeline.cancelPipeline(executionId);
  }

  return {
    // Engine instances (for direct wiring in MainWindow/App)
    orchestrator,
    pipeline,
    // Pool & Engine
    pool: computed(() => pool),
    activeEpicCount: computed(() => activeEpicCount.value),
    initPool,
    getPool,
    setEngine,
    // Epic orchestration
    createEpicOrchestrator,
    cancelEpicOrchestration,
    getOrchestratorForSession,
    // Reactive state (standalone)
    phase,
    isRunning,
    totalDelegations,
    lastEvent,
    autoProfiles,
    // Actions
    startOrchestration,
    cancelOrchestration,
    startPipeline,
    cancelPipeline,
  };
}
