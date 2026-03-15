import { vi } from 'vitest';
import type { Project, ProjectRepo } from '@/engine/KosTypes';
import type { ProjectRepository } from '@/engine/repositories';

export function makeMockProjectRepo(repos: ProjectRepo[] = []): ProjectRepository {
  return {
    listProjects: vi.fn((): Project[] => []),
    getProject: vi.fn((_id: string): Project | null => null),
    listRepos: vi.fn((projectId: string) => repos.filter(r => r.projectId === projectId)),
    getRepo: vi.fn((id: string) => repos.find(r => r.id === id) ?? null),
    reposByProjectId: vi.fn((projectId: string) => repos.filter(r => r.projectId === projectId)),
    reload: vi.fn(async () => {}),
  };
}
