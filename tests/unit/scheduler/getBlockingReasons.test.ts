import { Scheduler } from '@/engine/Scheduler';
import { makeMockDb } from '../../mocks/database';
import { makeMockEpicRepo } from '../../mocks/epicRepo';
import { makeMockProjectRepo } from '../../mocks/projectRepo';
import { makeEpic } from '../../helpers/epicFactory';

beforeEach(() => {
  Scheduler.resetInstance();
  vi.restoreAllMocks();
});

async function createScheduler(opts?: { maxConcurrentPerProject?: number; repos?: { id: string; projectId: string; path: string; name: string; defaultBranch: string }[] }) {
  const scheduler = Scheduler.getInstance();
  scheduler.setDatabase(makeMockDb());
  await scheduler.loadConfig();

  if (opts?.repos) {
    const projectRepo = makeMockProjectRepo(opts.repos);
    const epicRepo = makeMockEpicRepo();
    scheduler.setRepositories(epicRepo, projectRepo);
  }

  if (opts?.maxConcurrentPerProject !== undefined) {
    scheduler['config'].maxConcurrentPerProject = opts.maxConcurrentPerProject;
  }

  return scheduler;
}

describe('Scheduler.getBlockingReasons', () => {
  it('returns [] for a simple unblocked epic', async () => {
    const scheduler = await createScheduler();
    const epic = makeEpic({ id: 'e1', column: 'todo', dependsOn: [] });
    const allEpics = [epic];

    const reasons = scheduler.getBlockingReasons(epic, allEpics);

    expect(reasons).toEqual([]);
  });

  it('returns dependency reason when dependsOn dep is not done', async () => {
    const scheduler = await createScheduler();
    const dep = makeEpic({ id: 'dep1', title: 'Dependency Epic', column: 'in-progress' });
    const epic = makeEpic({ id: 'e1', column: 'todo', dependsOn: ['dep1'] });
    const allEpics = [epic, dep];

    const reasons = scheduler.getBlockingReasons(epic, allEpics);

    expect(reasons).toContainEqual(
      expect.objectContaining({ type: 'dependency', relatedEpicId: 'dep1' })
    );
  });

  it('returns runAfter reason when predecessor is not in review or done', async () => {
    const scheduler = await createScheduler();
    const predecessor = makeEpic({ id: 'pred1', title: 'Predecessor Epic', column: 'in-progress' });
    const epic = makeEpic({ id: 'e1', column: 'todo', runAfter: 'pred1', dependsOn: [] });
    const allEpics = [epic, predecessor];

    const reasons = scheduler.getBlockingReasons(epic, allEpics);

    expect(reasons).toContainEqual(
      expect.objectContaining({ type: 'runAfter', relatedEpicId: 'pred1' })
    );
  });

  it('returns concurrency reason when in-progress count >= maxConcurrentEpics', async () => {
    const scheduler = await createScheduler();
    const inProgress1 = makeEpic({ id: 'ip1', column: 'in-progress' });
    const inProgress2 = makeEpic({ id: 'ip2', column: 'in-progress' });
    const inProgress3 = makeEpic({ id: 'ip3', column: 'in-progress' });
    const epic = makeEpic({ id: 'e1', column: 'todo', dependsOn: [] });
    const allEpics = [epic, inProgress1, inProgress2, inProgress3];

    const reasons = scheduler.getBlockingReasons(epic, allEpics);

    expect(reasons).toContainEqual(
      expect.objectContaining({ type: 'concurrency' })
    );
  });

  it('returns projectConcurrency reason when maxConcurrentPerProject is set and reached', async () => {
    const scheduler = await createScheduler({ maxConcurrentPerProject: 1 });
    const inProgressSameProject = makeEpic({ id: 'ip1', column: 'in-progress', projectId: 'proj1' });
    const epic = makeEpic({ id: 'e1', column: 'todo', projectId: 'proj1', dependsOn: [] });
    const allEpics = [epic, inProgressSameProject];

    const reasons = scheduler.getBlockingReasons(epic, allEpics);

    expect(reasons).toContainEqual(
      expect.objectContaining({ type: 'projectConcurrency' })
    );
  });

  it('returns multiple blocking reasons together', async () => {
    const scheduler = await createScheduler();
    const dep = makeEpic({ id: 'dep1', title: 'Dep', column: 'in-progress' });
    const predecessor = makeEpic({ id: 'pred1', title: 'Pred', column: 'todo' });
    const epic = makeEpic({ id: 'e1', column: 'todo', dependsOn: ['dep1'], runAfter: 'pred1' });
    const allEpics = [epic, dep, predecessor];

    const reasons = scheduler.getBlockingReasons(epic, allEpics);

    expect(reasons).toContainEqual(expect.objectContaining({ type: 'dependency' }));
    expect(reasons).toContainEqual(expect.objectContaining({ type: 'runAfter' }));
    expect(reasons.length).toBeGreaterThanOrEqual(2);
  });

  it('returns repoLock reason when repo is locked by another epic', async () => {
    const repos = [
      { id: 'repo1', projectId: 'proj1', path: '/repo1', name: 'Repo 1', defaultBranch: 'main' },
    ];
    const scheduler = await createScheduler({ repos });
    const otherEpic = makeEpic({ id: 'other', column: 'in-progress', projectId: 'proj1', targetRepoIds: ['repo1'], useWorktree: false, dependsOn: [] });
    const epic = makeEpic({ id: 'e1', column: 'todo', projectId: 'proj1', targetRepoIds: ['repo1'], useWorktree: false, dependsOn: [] });

    scheduler.acquireRepos(otherEpic);
    const allEpics = [epic, otherEpic];

    const reasons = scheduler.getBlockingReasons(epic, allEpics);

    expect(reasons).toContainEqual(
      expect.objectContaining({ type: 'repoLock', relatedEpicId: 'other', relatedRepoId: 'repo1' })
    );
  });

  it('returns [] when all concurrency limits are within bounds', async () => {
    const scheduler = await createScheduler();
    const inProgress1 = makeEpic({ id: 'ip1', column: 'in-progress' });
    const inProgress2 = makeEpic({ id: 'ip2', column: 'in-progress' });
    const epic = makeEpic({ id: 'e1', column: 'todo', dependsOn: [] });
    const allEpics = [epic, inProgress1, inProgress2];

    const reasons = scheduler.getBlockingReasons(epic, allEpics);

    expect(reasons).toEqual([]);
  });

  it('does not include repoLock reason for useWorktree: true epic', async () => {
    const repos = [
      { id: 'repo1', projectId: 'proj1', path: '/repo1', name: 'Repo 1', defaultBranch: 'main' },
    ];
    const scheduler = await createScheduler({ repos });
    const otherEpic = makeEpic({ id: 'other', column: 'in-progress', projectId: 'proj1', targetRepoIds: ['repo1'], useWorktree: false, dependsOn: [] });
    const epic = makeEpic({ id: 'e1', column: 'todo', projectId: 'proj1', targetRepoIds: ['repo1'], useWorktree: true, dependsOn: [] });

    scheduler.acquireRepos(otherEpic);
    const allEpics = [epic, otherEpic];

    const reasons = scheduler.getBlockingReasons(epic, allEpics);

    const repoLockReasons = reasons.filter(r => r.type === 'repoLock');
    expect(repoLockReasons).toEqual([]);
  });
});
