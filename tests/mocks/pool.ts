import { vi } from 'vitest';
import type { OrchestratorPool } from '@/engine/OrchestratorPool';

export function makeMockPool(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    isEpicActive: vi.fn().mockReturnValue(false),
    spawnRoot: vi.fn().mockResolvedValue('session-abc'),
    resumeOrSpawnRoot: vi.fn().mockResolvedValue('session-abc'),
    removeEpic: vi.fn().mockResolvedValue(undefined),
    setMaxDepth: vi.fn(),
    activeByProject: vi.fn().mockReturnValue(0),
    totalActive: vi.fn().mockReturnValue(0),
    ...overrides,
  } as unknown as OrchestratorPool;
}
