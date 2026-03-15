import { vi } from 'vitest';
import type { Epic, EpicColumn } from '@/engine/KosTypes';
import type { EpicRepository } from '@/engine/repositories';

let epics: Epic[] = [];

export function getEpics(): Epic[] {
  return epics;
}

export function makeMockEpicRepo(initialEpics: Epic[] = []): EpicRepository {
  epics = [...initialEpics];

  return {
    listEpics: vi.fn((projectId?: string) =>
      projectId ? epics.filter(e => e.projectId === projectId) : [...epics],
    ),
    getEpic: vi.fn((id: string) => epics.find(e => e.id === id) ?? null),
    saveEpic: vi.fn(async (epic: Epic) => {
      const i = epics.findIndex(e => e.id === epic.id);
      if (i >= 0) epics[i] = epic;
      else epics.push(epic);
    }),
    moveEpic: vi.fn(async (id: string, column: EpicColumn) => {
      const e = epics.find(e => e.id === id);
      if (e) e.column = column;
    }),
    updateEpic: vi.fn(async (id: string, updates: Partial<Epic>) => {
      const e = epics.find(e => e.id === id);
      if (e) Object.assign(e, updates);
    }),
    deleteEpic: vi.fn(async (id: string) => {
      epics = epics.filter(e => e.id !== id);
    }),
    incrementRejection: vi.fn(async (id: string) => {
      const e = epics.find(e => e.id === id);
      if (e) e.rejectionCount = (e.rejectionCount ?? 0) + 1;
    }),
    reload: vi.fn(async () => {}),
  };
}
