import { vi } from 'vitest';
import type { SchedulerConfig } from '@/engine/KosTypes';
import type { Database } from '@/engine/Database';

export function defaultConfig(): SchedulerConfig {
  return {
    enabled: true,
    tickIntervalMs: 30000,
    maxConcurrentEpics: 3,
    dailyCostBudget: 50.0,
    weights: {
      manualHint: 0.4,
      dependencyDepth: 0.2,
      age: 0.15,
      complexity: 0.15,
      rejectionPenalty: 0.1,
    },
  };
}

export function makeMockDb() {
  return {
    loadSchedulerConfig: vi.fn().mockResolvedValue(defaultConfig()),
    saveSchedulerConfig: vi.fn().mockResolvedValue(undefined),
    appendSchedulerLog: vi.fn().mockResolvedValue(undefined),
    loadSchedulerLog: vi.fn().mockResolvedValue([]),
    totalCostSince: vi.fn().mockResolvedValue(0),
    loadEpicBranches: vi.fn().mockResolvedValue([]),
    saveEpicBranch: vi.fn().mockResolvedValue(undefined),
    loadEpics: vi.fn().mockResolvedValue([]),
    saveEpic: vi.fn().mockResolvedValue(undefined),
    deleteEpic: vi.fn().mockResolvedValue(undefined),
    deleteEpicBranches: vi.fn().mockResolvedValue(undefined),
    loadProjects: vi.fn().mockResolvedValue([]),
    loadProjectRepos: vi.fn().mockResolvedValue([]),
    loadProjectRepo: vi.fn().mockResolvedValue(null),
  } as unknown as Database;
}
