import { HybridPipelineRunner } from '@/engine/HybridPipelineRunner';
import type { HeadlessHandle } from '@/engine/HeadlessHandle';
import type { ProcessManager } from '@/engine/ProcessManager';
import type { SessionService } from '@/engine/SessionService';
import type { ComplexityEstimate, PipelineConfig } from '@/engine/KosTypes';

const makeRunner = (complexity: ComplexityEstimate = 'medium', pipelineConfig?: PipelineConfig) =>
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
    pipelineConfig,
  });

describe('HybridPipelineRunner.getPipelineFeatures()', () => {
  it('trivial → architectTurns=0, no counterpart, no tester', () => {
    const runner = makeRunner('trivial');
    const features = runner['getPipelineFeatures']();
    expect(features).toEqual({
      architectTurns: 0,
      useCounterpart: false,
      useTester: false,
    });
  });

  it('small → architectTurns=1, no counterpart, tester', () => {
    const runner = makeRunner('small');
    const features = runner['getPipelineFeatures']();
    expect(features).toEqual({
      architectTurns: 1,
      useCounterpart: false,
      useTester: true,
    });
  });

  it('medium → architectTurns=1, counterpart, tester', () => {
    const runner = makeRunner('medium');
    const features = runner['getPipelineFeatures']();
    expect(features).toEqual({
      architectTurns: 1,
      useCounterpart: true,
      useTester: true,
    });
  });

  it('large → architectTurns=3, counterpart, tester', () => {
    const runner = makeRunner('large');
    const features = runner['getPipelineFeatures']();
    expect(features).toEqual({
      architectTurns: 3,
      useCounterpart: true,
      useTester: true,
    });
  });

  it('epic → architectTurns=3, counterpart, tester', () => {
    const runner = makeRunner('epic');
    const features = runner['getPipelineFeatures']();
    expect(features).toEqual({
      architectTurns: 3,
      useCounterpart: true,
      useTester: true,
    });
  });

  describe('pipelineConfig overrides', () => {
    it('disabled architect → architectTurns=0', () => {
      const runner = makeRunner('large', {
        nodes: [
          { id: 'architect', role: 'architect', model: 'disabled', promptOverride: '', dependsOn: [] },
          { id: 'counterpart', role: 'custom', model: 'claude-sonnet', promptOverride: '', dependsOn: [] },
          { id: 'tester', role: 'tester', model: 'claude-sonnet', promptOverride: '', dependsOn: [] },
        ],
      });
      const features = runner['getPipelineFeatures']();
      expect(features.architectTurns).toBe(0);
      expect(features.useCounterpart).toBe(true);
      expect(features.useTester).toBe(true);
    });

    it('disabled counterpart → useCounterpart=false', () => {
      const runner = makeRunner('large', {
        nodes: [
          { id: 'architect', role: 'architect', model: 'claude-sonnet', promptOverride: '', dependsOn: [] },
          { id: 'counterpart', role: 'custom', model: 'disabled', promptOverride: '', dependsOn: [] },
          { id: 'tester', role: 'tester', model: 'claude-sonnet', promptOverride: '', dependsOn: [] },
        ],
      });
      const features = runner['getPipelineFeatures']();
      expect(features.architectTurns).toBe(1);
      expect(features.useCounterpart).toBe(false);
      expect(features.useTester).toBe(true);
    });

    it('disabled tester → useTester=false', () => {
      const runner = makeRunner('large', {
        nodes: [
          { id: 'architect', role: 'architect', model: 'claude-sonnet', promptOverride: '', dependsOn: [] },
          { id: 'counterpart', role: 'custom', model: 'claude-sonnet', promptOverride: '', dependsOn: [] },
          { id: 'tester', role: 'tester', model: 'disabled', promptOverride: '', dependsOn: [] },
        ],
      });
      const features = runner['getPipelineFeatures']();
      expect(features.architectTurns).toBe(1);
      expect(features.useCounterpart).toBe(true);
      expect(features.useTester).toBe(false);
    });

    it('all disabled → all features off', () => {
      const runner = makeRunner('epic', {
        nodes: [
          { id: 'architect', role: 'architect', model: 'disabled', promptOverride: '', dependsOn: [] },
          { id: 'counterpart', role: 'custom', model: 'disabled', promptOverride: '', dependsOn: [] },
          { id: 'tester', role: 'tester', model: 'disabled', promptOverride: '', dependsOn: [] },
        ],
      });
      const features = runner['getPipelineFeatures']();
      expect(features).toEqual({
        architectTurns: 0,
        useCounterpart: false,
        useTester: false,
      });
    });
  });
});
