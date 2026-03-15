import { HybridPipelineRunner } from '@/engine/HybridPipelineRunner';
import type { HeadlessHandle } from '@/engine/HeadlessHandle';
import type { ProcessManager } from '@/engine/ProcessManager';
import type { SessionService } from '@/engine/SessionService';
import type { ComplexityEstimate } from '@/engine/KosTypes';

const makeRunner = (complexity: ComplexityEstimate = 'medium') =>
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
    complexity,
  });

describe('HybridPipelineRunner.getPipelineFeatures()', () => {
  it('trivial → architectTurns=0, no counterpart, no design system, no phase4 test', () => {
    const runner = makeRunner('trivial');
    const features = runner['getPipelineFeatures']();
    expect(features).toEqual({
      architectTurns: 0,
      useCounterpart: false,
      useDesignSystem: false,
      usePhase4Test: false,
    });
  });

  it('small → architectTurns=1, no counterpart, no design system, phase4 test', () => {
    const runner = makeRunner('small');
    const features = runner['getPipelineFeatures']();
    expect(features).toEqual({
      architectTurns: 1,
      useCounterpart: false,
      useDesignSystem: false,
      usePhase4Test: true,
    });
  });

  it('medium → architectTurns=1, counterpart, no design system, phase4 test', () => {
    const runner = makeRunner('medium');
    const features = runner['getPipelineFeatures']();
    expect(features).toEqual({
      architectTurns: 1,
      useCounterpart: true,
      useDesignSystem: false,
      usePhase4Test: true,
    });
  });

  it('large → architectTurns=3, counterpart, design system, phase4 test', () => {
    const runner = makeRunner('large');
    const features = runner['getPipelineFeatures']();
    expect(features).toEqual({
      architectTurns: 3,
      useCounterpart: true,
      useDesignSystem: true,
      usePhase4Test: true,
    });
  });

  it('epic → architectTurns=3, counterpart, design system, phase4 test', () => {
    const runner = makeRunner('epic');
    const features = runner['getPipelineFeatures']();
    expect(features).toEqual({
      architectTurns: 3,
      useCounterpart: true,
      useDesignSystem: true,
      usePhase4Test: true,
    });
  });
});
