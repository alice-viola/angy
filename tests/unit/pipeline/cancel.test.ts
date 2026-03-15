import { HybridPipelineRunner } from '@/engine/HybridPipelineRunner';
import type { HeadlessHandle } from '@/engine/HeadlessHandle';
import type { ProcessManager } from '@/engine/ProcessManager';
import type { SessionService } from '@/engine/SessionService';

function makeRunner(overrides: { processes?: Partial<ProcessManager> } = {}) {
  const processes = {
    cancelProcess: vi.fn(),
    ...overrides.processes,
  } as unknown as ProcessManager;

  const runner = new HybridPipelineRunner({
    handle: {
      onDelegateFinished: null,
      onPersistSession: null,
      getRealSessionId: vi.fn().mockReturnValue(null),
    } as unknown as HeadlessHandle,
    processes,
    sessions: {
      persistSession: vi.fn(),
    } as unknown as SessionService,
    workspace: '/tmp/test',
    epicId: 'epic-1',
    autoProfiles: [],
    complexity: 'medium',
  });

  return { runner, processes };
}

describe('HybridPipelineRunner.cancel()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sets cancelled state and stops running', () => {
    const { runner } = makeRunner();
    // Simulate running state
    runner['_running'] = true;

    runner.cancel();

    expect(runner['_cancelled']).toBe(true);
    expect(runner.isRunning()).toBe(false);
  });

  it('calls cancelProcess for each active process', () => {
    const { runner, processes } = makeRunner();
    runner['_running'] = true;
    runner['activeProcesses'].add('proc-1');
    runner['activeProcesses'].add('proc-2');

    runner.cancel();

    expect(processes.cancelProcess).toHaveBeenCalledWith('proc-1');
    expect(processes.cancelProcess).toHaveBeenCalledWith('proc-2');
    expect(runner['activeProcesses'].size).toBe(0);
  });

  it('resolves pending resolvers with CANCELLED', () => {
    const { runner } = makeRunner();
    runner['_running'] = true;
    const resolver = vi.fn();
    runner['pendingResolvers'].set('session-1', resolver);

    runner.cancel();

    expect(resolver).toHaveBeenCalledWith('CANCELLED');
    expect(runner['pendingResolvers'].size).toBe(0);
  });

  it('sets phase to cancelled', () => {
    const { runner } = makeRunner();
    runner['_running'] = true;

    runner.cancel();

    expect(runner.currentPhase()).toBe('cancelled');
  });

  it('emits failed event with cancellation reason', () => {
    const { runner } = makeRunner();
    runner['_running'] = true;
    const failedHandler = vi.fn();
    runner.on('failed', failedHandler);

    runner.cancel();

    expect(failedHandler).toHaveBeenCalledWith({ reason: 'Pipeline cancelled' });
  });

  it('is idempotent — double cancel does not error or double-cancel processes', () => {
    const { runner, processes } = makeRunner();
    runner['_running'] = true;
    runner['activeProcesses'].add('proc-1');

    runner.cancel();
    runner.cancel();

    // cancelProcess called only once for proc-1 (cleared after first cancel)
    expect(processes.cancelProcess).toHaveBeenCalledTimes(1);
  });

  it('handles cancel before pipeline starts gracefully', () => {
    const { runner } = makeRunner();
    // Not running, no active processes, no pending resolvers

    expect(() => runner.cancel()).not.toThrow();
    expect(runner['_cancelled']).toBe(true);
    expect(runner.currentPhase()).toBe('cancelled');
  });
});
