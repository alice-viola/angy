import { HybridPipelineRunner } from '@/engine/HybridPipelineRunner';
import type { HeadlessHandle } from '@/engine/HeadlessHandle';
import type { ProcessManager } from '@/engine/ProcessManager';
import type { SessionService } from '@/engine/SessionService';
import type { PipelineConfig } from '@/engine/KosTypes';

/**
 * Creates a runner with a given pipelineConfig and optional epic-level model.
 */
const makeRunner = (pipelineConfig?: PipelineConfig, model?: string) =>
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
    complexity: 'medium',
    pipelineConfig,
    model,
  });

const FULL_CONFIG: PipelineConfig = {
  nodes: [
    { id: 'architect', role: 'architect', model: 'model-architect', promptOverride: '', dependsOn: [] },
    { id: 'counterpart', role: 'custom', model: 'model-counterpart', promptOverride: '', dependsOn: [] },
    { id: 'scaffold', role: 'builder-scaffold', model: 'model-scaffold', promptOverride: '', dependsOn: [] },
    { id: 'builder-fe', role: 'builder-frontend', model: 'model-fe', promptOverride: '', dependsOn: [] },
    { id: 'builder-be', role: 'builder-backend', model: 'model-be', promptOverride: '', dependsOn: [] },
    { id: 'tester', role: 'tester', model: 'model-tester', promptOverride: '', dependsOn: [] },
  ],
};

describe('HybridPipelineRunner.getNodeModel()', () => {
  describe('exact role match', () => {
    it('architect → node model', () => {
      const runner = makeRunner(FULL_CONFIG);
      expect(runner['getNodeModel']('architect')).toBe('model-architect');
    });

    it('builder-frontend → node model', () => {
      const runner = makeRunner(FULL_CONFIG);
      expect(runner['getNodeModel']('builder-frontend')).toBe('model-fe');
    });

    it('builder-backend → node model', () => {
      const runner = makeRunner(FULL_CONFIG);
      expect(runner['getNodeModel']('builder-backend')).toBe('model-be');
    });

    it('builder-scaffold → node model', () => {
      const runner = makeRunner(FULL_CONFIG);
      expect(runner['getNodeModel']('builder-scaffold')).toBe('model-scaffold');
    });

    it('tester → node model', () => {
      const runner = makeRunner(FULL_CONFIG);
      expect(runner['getNodeModel']('tester')).toBe('model-tester');
    });
  });

  describe('id fallback', () => {
    it('counterpart (role=custom, id=counterpart) → node model', () => {
      const runner = makeRunner(FULL_CONFIG);
      expect(runner['getNodeModel']('counterpart')).toBe('model-counterpart');
    });
  });

  describe('prefix matching — scoped roles resolve to parent node', () => {
    it('tester-frontend → tester node model', () => {
      const runner = makeRunner(FULL_CONFIG);
      expect(runner['getNodeModel']('tester-frontend')).toBe('model-tester');
    });

    it('tester-backend → tester node model', () => {
      const runner = makeRunner(FULL_CONFIG);
      expect(runner['getNodeModel']('tester-backend')).toBe('model-tester');
    });

    it('tester-scaffold → tester node model', () => {
      const runner = makeRunner(FULL_CONFIG);
      expect(runner['getNodeModel']('tester-scaffold')).toBe('model-tester');
    });
  });

  describe('generic role resolves to first specific node', () => {
    it('builder → first builder-* node model (builder-scaffold)', () => {
      const runner = makeRunner(FULL_CONFIG);
      // 'builder' is a prefix of 'builder-scaffold', 'builder-frontend', 'builder-backend'
      // find() returns the first match in node order
      expect(runner['getNodeModel']('builder')).toBe('model-scaffold');
    });
  });

  describe('disabled nodes', () => {
    it('disabled node falls back to epic-level model', () => {
      const runner = makeRunner(
        {
          nodes: [
            { id: 'architect', role: 'architect', model: 'disabled', promptOverride: '', dependsOn: [] },
            { id: 'builder-fe', role: 'builder-frontend', model: 'model-fe', promptOverride: '', dependsOn: [] },
          ],
        },
        'epic-level-model',
      );
      expect(runner['getNodeModel']('architect')).toBe('epic-level-model');
      expect(runner['getNodeModel']('builder-frontend')).toBe('model-fe');
    });
  });

  describe('no pipelineConfig → falls back to epic model', () => {
    it('returns epic-level model when no config', () => {
      const runner = makeRunner(undefined, 'fallback-model');
      expect(runner['getNodeModel']('architect')).toBe('fallback-model');
    });

    it('returns undefined when no config and no epic model', () => {
      const runner = makeRunner(undefined);
      expect(runner['getNodeModel']('architect')).toBeUndefined();
    });
  });

  describe('angy- prefix is stripped from model names', () => {
    it('strips angy- prefix', () => {
      const runner = makeRunner({
        nodes: [
          { id: 'architect', role: 'architect', model: 'angy-claude-sonnet', promptOverride: '', dependsOn: [] },
        ],
      });
      expect(runner['getNodeModel']('architect')).toBe('claude-sonnet');
    });
  });
});

describe('HybridPipelineRunner.findPipelineNode()', () => {
  it('returns undefined when no pipelineConfig', () => {
    const runner = makeRunner(undefined);
    expect(runner['findPipelineNode']('architect')).toBeUndefined();
  });

  it('returns undefined when config has empty nodes', () => {
    const runner = makeRunner({ nodes: [] });
    expect(runner['findPipelineNode']('architect')).toBeUndefined();
  });

  it('returns correct node for scoped tester (prefix match)', () => {
    const runner = makeRunner(FULL_CONFIG);
    const node = runner['findPipelineNode']('tester-frontend');
    expect(node).toBeDefined();
    expect(node!.id).toBe('tester');
  });

  it('legacy scaffold node (role=custom) does NOT match builder-scaffold', () => {
    const legacyConfig: PipelineConfig = {
      nodes: [
        { id: 'scaffold', role: 'custom', model: 'model-scaffold', promptOverride: '', dependsOn: [] },
      ],
    };
    const runner = makeRunner(legacyConfig);
    // 'custom' is not a prefix of 'builder-scaffold' and vice versa
    expect(runner['findPipelineNode']('builder-scaffold')).toBeUndefined();
  });
});
