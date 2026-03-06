import { ref, computed } from 'vue';
import { Orchestrator } from '../engine/Orchestrator';
import { PipelineEngine } from '../engine/PipelineEngine';
import { engineBus } from '../engine/EventBus';

// ── Singleton instances ──────────────────────────────────────────────────────

const orchestrator = new Orchestrator();
const pipeline = new PipelineEngine();

// ── Reactive state ───────────────────────────────────────────────────────────

const phase = ref('');
const running = ref(false);
const delegations = ref(0);
const lastEvent = ref('');

// ── Wire up orchestrator events to reactive state ────────────────────────────

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

orchestrator.on('validationStarted', (e) => {
  lastEvent.value = `Validating: ${e.command.substring(0, 60)}`;
});

orchestrator.on('validationResult', (e) => {
  lastEvent.value = e.passed ? 'Validation passed' : 'Validation failed';
});

orchestrator.on('checkpointCreated', (e) => {
  lastEvent.value = `Checkpoint: ${e.hash}`;
  engineBus.emit('orchestrator:checkpointCreated', { hash: e.hash, message: e.message });
});

// ── Composable ───────────────────────────────────────────────────────────────

export function useOrchestrator() {
  const isRunning = computed(() => running.value);
  const totalDelegations = computed(() => delegations.value);

  function startOrchestration(goal: string, profileIds: string[] = []) {
    return orchestrator.start(goal, profileIds);
  }

  function cancelOrchestration() {
    orchestrator.cancel();
  }

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
    // Reactive state
    phase,
    isRunning,
    totalDelegations,
    lastEvent,
    // Actions
    startOrchestration,
    cancelOrchestration,
    startPipeline,
    cancelPipeline,
  };
}
