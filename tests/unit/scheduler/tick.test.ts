import { Scheduler } from '@/engine/Scheduler';
import { makeMockDb } from '../../mocks/database';
import { makeMockEpicRepo } from '../../mocks/epicRepo';
import { makeMockProjectRepo } from '../../mocks/projectRepo';
import { makeMockPool } from '../../mocks/pool';
import { makeEpic } from '../../helpers/epicFactory';
import { engineBus } from '@/engine/EventBus';

beforeEach(() => {
  Scheduler.resetInstance();
  vi.restoreAllMocks();
});

function createScheduler(epics: ReturnType<typeof makeEpic>[] = [], poolOverrides = {}) {
  const db = makeMockDb();
  const epicRepo = makeMockEpicRepo(epics);
  const projectRepo = makeMockProjectRepo([]);
  const pool = makeMockPool(poolOverrides);

  const scheduler = Scheduler.getInstance();
  scheduler.setDatabase(db);
  scheduler.setRepositories(epicRepo, projectRepo);
  scheduler.setPool(pool);

  return { scheduler, db, epicRepo, projectRepo, pool };
}

describe('Scheduler.tick()', () => {
  it('returns empty actions array with no epics', async () => {
    const { scheduler } = createScheduler();
    await scheduler.loadConfig();

    const spy = vi.fn();
    engineBus.on('scheduler:blockingReasons', spy);

    const actions = await scheduler.tick();

    expect(actions).toEqual([]);
    expect(spy).toHaveBeenCalled();

    engineBus.off('scheduler:blockingReasons', spy);
  });

  it('picks up highest-priority unblocked todo epic and spawns it', async () => {
    const epic = makeEpic({ column: 'todo', priorityHint: 'high' });
    const { scheduler, pool } = createScheduler([epic]);
    await scheduler.loadConfig();

    const actions = await scheduler.tick();

    expect(actions.length).toBe(1);
    expect(actions[0].type).toBe('start');
    expect(actions[0].epicId).toBe(epic.id);
    expect(pool.spawnRoot).toHaveBeenCalled();
  });

  it('does not spawn when in-progress count >= maxConcurrentEpics', async () => {
    const inProgressEpic = makeEpic({ column: 'in-progress', startedAt: new Date().toISOString() });
    const todoEpic = makeEpic({ column: 'todo' });
    const pool = makeMockPool({ isEpicActive: vi.fn().mockReturnValue(true) });
    const { scheduler } = createScheduler([inProgressEpic, todoEpic], {});
    scheduler.setPool(pool);
    await scheduler.loadConfig();
    scheduler['config'].maxConcurrentEpics = 1;

    const actions = await scheduler.tick();

    const startActions = actions.filter(a => a.type === 'start');
    expect(startActions).toHaveLength(0);
  });

  it('returns early with no spawns when budget is exhausted', async () => {
    const epic = makeEpic({ column: 'todo' });
    const { scheduler, db, pool } = createScheduler([epic]);
    await scheduler.loadConfig();
    scheduler['config'].dailyCostBudget = 100;
    (db.totalCostSince as any).mockResolvedValue(100);

    const actions = await scheduler.tick();

    const startActions = actions.filter(a => a.type === 'start');
    expect(startActions).toHaveLength(0);
    expect(pool.spawnRoot).not.toHaveBeenCalled();
  });

  it('recovers orphaned in-progress epic older than 5 minutes', async () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const epic = makeEpic({ column: 'in-progress', startedAt: tenMinutesAgo });
    const { scheduler } = createScheduler([epic]);
    await scheduler.loadConfig();

    const actions = await scheduler.tick();

    const recovered = actions.filter(a => a.type === 'recovered');
    expect(recovered.length).toBeGreaterThanOrEqual(1);
    expect(recovered[0].epicId).toBe(epic.id);
  });

  it('does not recover in-progress epic within grace period', async () => {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const epic = makeEpic({ column: 'in-progress', startedAt: twoMinutesAgo });
    const { scheduler } = createScheduler([epic]);
    await scheduler.loadConfig();

    const actions = await scheduler.tick();

    const recovered = actions.filter(a => a.type === 'recovered');
    expect(recovered).toHaveLength(0);
  });

  it('skips blocked epic with unfinished dependency', async () => {
    const dependency = makeEpic({ column: 'todo', id: 'dep-1' });
    const blocked = makeEpic({ column: 'todo', dependsOn: ['dep-1'] });
    const { scheduler } = createScheduler([dependency, blocked]);
    await scheduler.loadConfig();

    const actions = await scheduler.tick();

    // The blocked epic should not be started; only the dependency (if eligible) would be
    const startedIds = actions.filter(a => a.type === 'start').map(a => a.epicId);
    expect(startedIds).not.toContain(blocked.id);
  });

  it('spawns highest-priority epic first when multiple todo epics exist', async () => {
    const lowPriority = makeEpic({ column: 'todo', priorityHint: 'low', title: 'Low' });
    const highPriority = makeEpic({ column: 'todo', priorityHint: 'critical', title: 'High' });
    const { scheduler, pool } = createScheduler([lowPriority, highPriority]);
    await scheduler.loadConfig();
    scheduler['config'].maxConcurrentEpics = 2;

    await scheduler.tick();

    const calls = (pool.spawnRoot as any).mock.calls;
    expect(calls.length).toBe(2);
    // First call should be for the higher-priority epic
    expect(calls[0][0]).toBe(highPriority.id);
  });

  it('does not recover epic when pool.isEpicActive returns true', async () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const epic = makeEpic({ column: 'in-progress', startedAt: tenMinutesAgo });
    const pool = makeMockPool({ isEpicActive: vi.fn().mockReturnValue(true) });
    const { scheduler } = createScheduler([epic]);
    scheduler.setPool(pool);
    await scheduler.loadConfig();

    const actions = await scheduler.tick();

    const recovered = actions.filter(a => a.type === 'recovered');
    expect(recovered).toHaveLength(0);
  });

  it('emits scheduler:blockingReasons event at the end', async () => {
    const { scheduler } = createScheduler();
    await scheduler.loadConfig();

    const spy = vi.fn();
    engineBus.on('scheduler:blockingReasons', spy);

    await scheduler.tick();

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ reasons: expect.any(Object) })
    );

    engineBus.off('scheduler:blockingReasons', spy);
  });

  it('moves epic to in-progress after spawning', async () => {
    const epic = makeEpic({ column: 'todo' });
    const { scheduler, epicRepo } = createScheduler([epic]);
    await scheduler.loadConfig();

    await scheduler.tick();

    // After tick, the epic should have been moved to in-progress
    const epics = epicRepo.listEpics();
    const updated = epics.find(e => e.id === epic.id);
    expect(updated?.column).toBe('in-progress');
  });

  it('skips epics from a project that reached maxConcurrentPerProject', async () => {
    const projectId = 'proj-1';
    const inProgress = makeEpic({ column: 'in-progress', projectId, startedAt: new Date().toISOString() });
    const todo = makeEpic({ column: 'todo', projectId });
    const pool = makeMockPool({ isEpicActive: vi.fn().mockReturnValue(true) });
    const { scheduler } = createScheduler([inProgress, todo]);
    scheduler.setPool(pool);
    await scheduler.loadConfig();
    scheduler['config'].maxConcurrentPerProject = 1;
    scheduler['config'].maxConcurrentEpics = 10;

    const actions = await scheduler.tick();

    const startActions = actions.filter(a => a.type === 'start');
    expect(startActions).toHaveLength(0);
  });
});
