import { Scheduler } from '@/engine/Scheduler';
import { makeMockDb } from '../../mocks/database';
import { makeMockEpicRepo } from '../../mocks/epicRepo';
import { makeMockProjectRepo } from '../../mocks/projectRepo';
import { makeEpic } from '../../helpers/epicFactory';

beforeEach(() => {
  Scheduler.resetInstance();
  vi.restoreAllMocks();
});

const defaultRepos = [
  { id: 'repo1', projectId: 'proj1', path: '/repo1', name: 'Repo 1', defaultBranch: 'main' },
  { id: 'repo2', projectId: 'proj1', path: '/repo2', name: 'Repo 2', defaultBranch: 'main' },
];

function createScheduler(repos = defaultRepos) {
  const scheduler = Scheduler.getInstance();
  scheduler.setDatabase(makeMockDb());
  scheduler.loadConfig();
  const projectRepo = makeMockProjectRepo(repos);
  const epicRepo = makeMockEpicRepo();
  scheduler.setRepositories(epicRepo, projectRepo);
  return scheduler;
}

describe('Scheduler repo locking', () => {
  it('canAcquireRepos returns true when no locks exist', () => {
    const scheduler = createScheduler();
    const epic = makeEpic({ id: 'e1', projectId: 'proj1', targetRepoIds: ['repo1'], useWorktree: false, dependsOn: [] });

    expect(scheduler.canAcquireRepos(epic)).toBe(true);
  });

  it('canAcquireRepos returns false for epicB after acquireRepos(epicA) on same repos', () => {
    const scheduler = createScheduler();
    const epicA = makeEpic({ id: 'a', projectId: 'proj1', targetRepoIds: ['repo1'], useWorktree: false, dependsOn: [] });
    const epicB = makeEpic({ id: 'b', projectId: 'proj1', targetRepoIds: ['repo1'], useWorktree: false, dependsOn: [] });

    scheduler.acquireRepos(epicA);

    expect(scheduler.canAcquireRepos(epicB)).toBe(false);
  });

  it('canAcquireRepos returns true for useWorktree: true epic regardless of locks', () => {
    const scheduler = createScheduler();
    const epicA = makeEpic({ id: 'a', projectId: 'proj1', targetRepoIds: ['repo1'], useWorktree: false, dependsOn: [] });
    const epicB = makeEpic({ id: 'b', projectId: 'proj1', targetRepoIds: ['repo1'], useWorktree: true, dependsOn: [] });

    scheduler.acquireRepos(epicA);

    expect(scheduler.canAcquireRepos(epicB)).toBe(true);
  });

  it('acquireRepos does nothing for useWorktree: true epic', () => {
    const scheduler = createScheduler();
    const epicA = makeEpic({ id: 'a', projectId: 'proj1', targetRepoIds: ['repo1'], useWorktree: true, dependsOn: [] });
    const epicB = makeEpic({ id: 'b', projectId: 'proj1', targetRepoIds: ['repo1'], useWorktree: false, dependsOn: [] });

    scheduler.acquireRepos(epicA);

    // If acquireRepos was a no-op, epicB should still be able to acquire
    expect(scheduler.canAcquireRepos(epicB)).toBe(true);
  });

  it('two epics with non-overlapping targetRepoIds do not block each other', () => {
    const scheduler = createScheduler();
    const epicA = makeEpic({ id: 'a', projectId: 'proj1', targetRepoIds: ['repo1'], useWorktree: false, dependsOn: [] });
    const epicB = makeEpic({ id: 'b', projectId: 'proj1', targetRepoIds: ['repo2'], useWorktree: false, dependsOn: [] });

    scheduler.acquireRepos(epicA);

    expect(scheduler.canAcquireRepos(epicB)).toBe(true);
  });

  it('canAcquireRepos returns true after releaseRepos', () => {
    const scheduler = createScheduler();
    const epicA = makeEpic({ id: 'a', projectId: 'proj1', targetRepoIds: ['repo1'], useWorktree: false, dependsOn: [] });
    const epicB = makeEpic({ id: 'b', projectId: 'proj1', targetRepoIds: ['repo1'], useWorktree: false, dependsOn: [] });

    scheduler.acquireRepos(epicA);
    expect(scheduler.canAcquireRepos(epicB)).toBe(false);

    scheduler.releaseRepos(epicA.id);
    expect(scheduler.canAcquireRepos(epicB)).toBe(true);
  });

  it('epic with empty targetRepoIds resolves to all project repos via projectRepo', () => {
    const scheduler = createScheduler();
    const epicA = makeEpic({ id: 'a', projectId: 'proj1', targetRepoIds: [], useWorktree: false, dependsOn: [] });

    scheduler.acquireRepos(epicA);

    // Both repo1 and repo2 belong to proj1, so both should now be locked
    const epicB = makeEpic({ id: 'b', projectId: 'proj1', targetRepoIds: ['repo1'], useWorktree: false, dependsOn: [] });
    const epicC = makeEpic({ id: 'c', projectId: 'proj1', targetRepoIds: ['repo2'], useWorktree: false, dependsOn: [] });

    expect(scheduler.canAcquireRepos(epicB)).toBe(false);
    expect(scheduler.canAcquireRepos(epicC)).toBe(false);
  });

  it('canAcquireRepos returns false for the same epic that holds the lock', () => {
    const scheduler = createScheduler();
    const epic = makeEpic({ id: 'a', projectId: 'proj1', targetRepoIds: ['repo1'], useWorktree: false, dependsOn: [] });

    scheduler.acquireRepos(epic);

    // The code checks repoLocks.has(repoId) without excluding self
    expect(scheduler.canAcquireRepos(epic)).toBe(false);
  });
});
