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

describe('Scheduler.executeStart()', () => {
  it('returns true and moves epic to in-progress on happy path', async () => {
    const epic = makeEpic({ column: 'todo' });
    const { scheduler, pool, epicRepo } = createScheduler([epic]);
    await scheduler.loadConfig();

    const result = await scheduler.executeStart(epic);

    expect(result).toBe(true);
    expect(pool.spawnRoot).toHaveBeenCalled();
    const updated = epicRepo.listEpics().find(e => e.id === epic.id);
    expect(updated?.column).toBe('in-progress');
  });

  it('spawns single agent when parallelAgentCount is 1', async () => {
    const epic = makeEpic({ column: 'todo', parallelAgentCount: 1 });
    const { scheduler, pool, epicRepo } = createScheduler([epic]);
    await scheduler.loadConfig();

    const result = await scheduler.executeStart(epic);

    expect(result).toBe(true);
    expect(pool.spawnRoot).toHaveBeenCalledTimes(1);
    expect(epicRepo.saveEpic).not.toHaveBeenCalled();
  });

  it('creates clones and discards original when parallelAgentCount is 3', async () => {
    const epic = makeEpic({ column: 'todo', parallelAgentCount: 3 });
    const { scheduler, epicRepo } = createScheduler([epic]);
    await scheduler.loadConfig();

    const result = await scheduler.executeStart(epic);

    expect(result).toBe(false);
    expect(epicRepo.saveEpic).toHaveBeenCalledTimes(3);
    const updated = epicRepo.listEpics().find(e => e.id === epic.id);
    expect(updated?.column).toBe('discarded');
  });

  it('creates clones with unique IDs when parallelAgentCount > 1', async () => {
    const epic = makeEpic({ column: 'todo', parallelAgentCount: 3 });
    const { scheduler, epicRepo } = createScheduler([epic]);
    await scheduler.loadConfig();

    await scheduler.executeStart(epic);

    const saveArgs = (epicRepo.saveEpic as any).mock.calls.map((c: any) => c[0]);
    const ids = saveArgs.map((e: any) => e.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(3);
    // None should match the original
    for (const id of ids) {
      expect(id).not.toBe(epic.id);
    }
  });

  it('returns false when epic column changed since scheduling (column guard)', async () => {
    const epic = makeEpic({ column: 'todo' });
    const { scheduler, epicRepo } = createScheduler([epic]);
    await scheduler.loadConfig();

    // Simulate column change between scheduling and executeStart
    const internalEpic = epicRepo.listEpics().find(e => e.id === epic.id)!;
    internalEpic.column = 'in-progress';

    // Pass a snapshot of the epic with the original column so the guard detects the mismatch
    const result = await scheduler.executeStart({ ...epic, column: 'todo' });

    expect(result).toBe(false);
  });

  it('calls pool.spawnRoot with correct epicId', async () => {
    const epic = makeEpic({ column: 'todo' });
    const { scheduler, pool } = createScheduler([epic]);
    await scheduler.loadConfig();

    await scheduler.executeStart(epic);

    expect(pool.spawnRoot).toHaveBeenCalledWith(
      epic.id,
      expect.objectContaining({ epicId: epic.id }),
      expect.anything(),
      expect.anything()
    );
  });

  it('returns false and emits error when pool.spawnRoot rejects', async () => {
    const epic = makeEpic({ column: 'todo' });
    const pool = makeMockPool({
      spawnRoot: vi.fn().mockRejectedValue(new Error('spawn failed')),
    });
    const { scheduler } = createScheduler([epic]);
    scheduler.setPool(pool);
    await scheduler.loadConfig();

    const spy = vi.fn();
    engineBus.on('scheduler:error', spy);

    const result = await scheduler.executeStart(epic);

    expect(result).toBe(false);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Failed to start epic' })
    );

    engineBus.off('scheduler:error', spy);
  });

  it('returns false and emits error when no pool is set', async () => {
    const epic = makeEpic({ column: 'todo' });
    const { scheduler } = createScheduler([epic]);
    scheduler.setPool(null as any);
    await scheduler.loadConfig();

    // Clear the pool
    scheduler['pool'] = null;

    const spy = vi.fn();
    engineBus.on('scheduler:error', spy);

    const result = await scheduler.executeStart(epic);

    expect(result).toBe(false);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'No orchestrator pool' })
    );

    engineBus.off('scheduler:error', spy);
  });

  it('sets rootSessionId on epic after successful start', async () => {
    const epic = makeEpic({ column: 'todo' });
    const { scheduler, epicRepo } = createScheduler([epic]);
    await scheduler.loadConfig();

    await scheduler.executeStart(epic);

    const updated = epicRepo.listEpics().find(e => e.id === epic.id);
    expect(updated?.rootSessionId).toBe('session-abc');
  });

  it('calls pool.resumeOrSpawnRoot when tryResume is true', async () => {
    const epic = makeEpic({ column: 'todo' });
    const pool = makeMockPool({
      resumeOrSpawnRoot: vi.fn().mockResolvedValue('session-resumed'),
    });
    const { scheduler } = createScheduler([epic]);
    scheduler.setPool(pool);
    await scheduler.loadConfig();

    const result = await scheduler.executeStart(epic, null, true);

    expect(result).toBe(true);
    expect(pool.resumeOrSpawnRoot).toHaveBeenCalled();
  });

  it('clears suspendedAt when epic has suspendedAt set', async () => {
    const epic = makeEpic({ column: 'todo', suspendedAt: '2025-01-01T00:00:00Z' });
    const { scheduler, epicRepo } = createScheduler([epic]);
    await scheduler.loadConfig();

    await scheduler.executeStart(epic);

    const updated = epicRepo.listEpics().find(e => e.id === epic.id);
    expect(updated?.suspendedAt).toBeNull();
  });

  it('emits scheduler:info with title "Epic started" on success', async () => {
    const epic = makeEpic({ column: 'todo' });
    const { scheduler } = createScheduler([epic]);
    await scheduler.loadConfig();

    const spy = vi.fn();
    engineBus.on('scheduler:info', spy);

    await scheduler.executeStart(epic);

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Epic started' })
    );

    engineBus.off('scheduler:info', spy);
  });

  it('calls moveEpic with in-progress on successful start', async () => {
    const epic = makeEpic({ column: 'todo' });
    const { scheduler, epicRepo } = createScheduler([epic]);
    await scheduler.loadConfig();

    await scheduler.executeStart(epic);

    expect(epicRepo.moveEpic).toHaveBeenCalledWith(epic.id, 'in-progress');
  });
});
