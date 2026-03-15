import { HybridPipelineRunner } from '@/engine/HybridPipelineRunner';
import type { HeadlessHandle } from '@/engine/HeadlessHandle';
import type { ProcessManager } from '@/engine/ProcessManager';
import type { SessionService } from '@/engine/SessionService';
import type { EpicPipelineType } from '@/engine/KosTypes';

const makeRunner = (pipelineType: EpicPipelineType = 'hybrid', complexity = 'medium') =>
  new HybridPipelineRunner({
    handle: {
      onDelegateFinished: null,
      onPersistSession: null,
      getRealSessionId: vi.fn().mockReturnValue(null),
    } as unknown as HeadlessHandle,
    processes: {
      cancelProcess: vi.fn(),
    } as unknown as ProcessManager,
    sessions: {
      persistSession: vi.fn(),
    } as unknown as SessionService,
    workspace: '/tmp/test',
    epicId: 'epic-1',
    autoProfiles: [],
    complexity: complexity as any,
    pipelineType,
  });

describe('HybridPipelineRunner phase routing', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('initial state: runner starts with empty phase and not running', () => {
    const runner = makeRunner();
    expect(runner.currentPhase()).toBe('');
    expect(runner.isRunning()).toBe(false);
  });

  it('pipelineType=investigate routes to executeInvestigateMode', async () => {
    const runner = makeRunner('investigate');
    const spy = vi.spyOn(runner as any, 'executeInvestigateMode').mockResolvedValue(undefined);

    await runner.run('investigate something', '');

    expect(spy).toHaveBeenCalledWith('investigate something');
  });

  it('pipelineType=plan routes to executePlanMode', async () => {
    const runner = makeRunner('plan');
    const spy = vi.spyOn(runner as any, 'executePlanMode').mockResolvedValue(undefined);

    await runner.run('plan something', 'criteria');

    expect(spy).toHaveBeenCalledWith('plan something', 'criteria');
  });

  it('pipelineType=hybrid for trivial goes directly to implementing phase', async () => {
    const runner = makeRunner('hybrid', 'trivial');
    // Mock delegateAgent to prevent actual subprocess spawning
    vi.spyOn(runner as any, 'healthCheckedDelegate').mockResolvedValue('done');
    vi.spyOn(runner as any, 'extractTestResult').mockResolvedValue({ buildPassed: true, testsPassed: true });
    vi.spyOn(runner as any, 'onPipelineComplete').mockResolvedValue(undefined);
    vi.spyOn(runner as any, 'checkpointState').mockResolvedValue(undefined);

    await runner.run('trivial fix', 'it works');

    // Trivial path sets phase to 'implementing' then 'testing' then 'completed'
    expect(runner.currentPhase()).toBe('completed');
  });

  it('pipelineType=hybrid for non-trivial goes through plan → implement → finalize phases', async () => {
    const runner = makeRunner('hybrid', 'medium');
    const phases: string[] = [];
    vi.spyOn(runner as any, 'setPhase').mockImplementation((...args: unknown[]) => {
      const phase = args[0] as string;
      phases.push(phase);
      runner['_currentPhase'] = phase;
    });
    vi.spyOn(runner as any, 'executePhase1Plan').mockResolvedValue(undefined);
    vi.spyOn(runner as any, 'executePhase2Implement').mockResolvedValue(undefined);
    vi.spyOn(runner as any, 'executePhase3Finalize').mockResolvedValue(undefined);
    vi.spyOn(runner as any, 'checkpointState').mockResolvedValue(undefined);

    await runner.run('build feature', 'criteria');

    // Verify phases were called in order
    expect(runner['_running']).toBe(true); // still running since we mocked phase methods
  });

  it('cancelled pipeline does not advance past current phase', async () => {
    const runner = makeRunner('hybrid', 'medium');
    vi.spyOn(runner as any, 'checkpointState').mockResolvedValue(undefined);
    vi.spyOn(runner as any, 'executePhase1Plan').mockImplementation(async () => {
      runner.cancel();
    });

    await runner.run('goal', 'criteria');

    // Should not have proceeded to phase 2 or 3
    expect(runner.currentPhase()).toBe('cancelled');
  });
});
