import { Scheduler } from '@/engine/Scheduler';
import { engineBus } from '@/engine/EventBus';
import { makeMockDb } from '../../mocks/database';
import { makeMockEpicRepo } from '../../mocks/epicRepo';
import { makeMockProjectRepo } from '../../mocks/projectRepo';
import { makeEpic } from '../../helpers/epicFactory';

beforeEach(() => {
  Scheduler.resetInstance();
  vi.restoreAllMocks();
});

describe('rejectEpic', () => {
  function setup(epic: ReturnType<typeof makeEpic>) {
    const epicRepo = makeMockEpicRepo([epic]);
    const projectRepo = makeMockProjectRepo();
    const db = makeMockDb();
    const scheduler = Scheduler.getInstance();
    scheduler.setDatabase(db);
    scheduler.setRepositories(epicRepo, projectRepo);
    return { scheduler, epicRepo, db };
  }

  it('first rejection keeps epic in todo (rejectionCount 0 → 1)', async () => {
    const epic = makeEpic({ id: 'e1', rejectionCount: 0, column: 'todo' });
    const { scheduler, epicRepo } = setup(epic);
    await scheduler.loadConfig();

    await scheduler.rejectEpic('e1', 'needs improvement');

    const updated = epicRepo.getEpic('e1');
    expect(updated?.column).toBe('todo');
  });

  it('fourth rejection keeps epic in todo (rejectionCount 3 → 4)', async () => {
    const epic = makeEpic({ id: 'e2', rejectionCount: 3, column: 'todo' });
    const { scheduler, epicRepo } = setup(epic);
    await scheduler.loadConfig();

    await scheduler.rejectEpic('e2', 'still not right');

    const updated = epicRepo.getEpic('e2');
    expect(updated?.column).toBe('todo');
  });

  it('fifth rejection escalates epic to backlog (rejectionCount 4 → 5)', async () => {
    const epic = makeEpic({ id: 'e3', rejectionCount: 4, column: 'todo' });
    const { scheduler, epicRepo } = setup(epic);
    await scheduler.loadConfig();

    await scheduler.rejectEpic('e3', 'too many issues');

    const updated = epicRepo.getEpic('e3');
    expect(updated?.column).toBe('backlog');
  });

  it('emits scheduler:info event when escalating to backlog', async () => {
    const epic = makeEpic({ id: 'e4', rejectionCount: 4, column: 'todo' });
    const { scheduler } = setup(epic);
    await scheduler.loadConfig();
    const emitSpy = vi.spyOn(engineBus, 'emit');

    await scheduler.rejectEpic('e4', 'repeated failures');

    expect(emitSpy).toHaveBeenCalledWith('scheduler:info', expect.objectContaining({
      epicId: 'e4',
      title: 'Epic moved to backlog',
    }));
  });

  it('getEpic confirms column is backlog after escalation', async () => {
    const epic = makeEpic({ id: 'e5', rejectionCount: 4, column: 'todo' });
    const { scheduler, epicRepo } = setup(epic);
    await scheduler.loadConfig();

    await scheduler.rejectEpic('e5', 'final rejection');

    const result = epicRepo.getEpic('e5');
    expect(result).toBeDefined();
    expect(result!.column).toBe('backlog');
  });

  it('updates rejectionFeedback with the feedback string', async () => {
    const epic = makeEpic({ id: 'e6', rejectionCount: 0, column: 'todo' });
    const { scheduler, epicRepo } = setup(epic);
    await scheduler.loadConfig();

    await scheduler.rejectEpic('e6', 'please fix the tests');

    const updated = epicRepo.getEpic('e6');
    expect(updated?.rejectionFeedback).toBe('please fix the tests');
  });

  it('increments rejectionCount by exactly 1', async () => {
    const epic = makeEpic({ id: 'e7', rejectionCount: 2, column: 'todo' });
    const { scheduler, epicRepo } = setup(epic);
    await scheduler.loadConfig();

    await scheduler.rejectEpic('e7', 'one more try');

    const updated = epicRepo.getEpic('e7');
    expect(updated?.rejectionCount).toBe(3);
  });

  it('handles non-existent epic id gracefully without throwing', async () => {
    const epic = makeEpic({ id: 'e8', rejectionCount: 0, column: 'todo' });
    const { scheduler } = setup(epic);
    await scheduler.loadConfig();

    await expect(scheduler.rejectEpic('non-existent', 'feedback')).resolves.not.toThrow();
  });
});
