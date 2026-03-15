import { Scheduler } from '@/engine/Scheduler';
import { makeEpic } from '../../helpers/epicFactory';

beforeEach(() => {
  Scheduler.resetInstance();
  vi.restoreAllMocks();
});

describe('Scheduler.isBlocked', () => {
  function createScheduler() {
    return Scheduler.getInstance();
  }

  it('epic with no dependencies and no runAfter is not blocked', () => {
    const scheduler = createScheduler();
    const epic = makeEpic({ dependsOn: [], runAfter: null });
    expect(scheduler.isBlocked(epic, [])).toBe(false);
  });

  it('epic depending on a done epic is not blocked', () => {
    const scheduler = createScheduler();
    const dep = makeEpic({ id: 'dep-1', column: 'done' });
    const epic = makeEpic({ dependsOn: ['dep-1'], runAfter: null });
    expect(scheduler.isBlocked(epic, [epic, dep])).toBe(false);
  });

  it('epic depending on a todo epic is blocked', () => {
    const scheduler = createScheduler();
    const dep = makeEpic({ id: 'dep-1', column: 'todo' });
    const epic = makeEpic({ dependsOn: ['dep-1'], runAfter: null });
    expect(scheduler.isBlocked(epic, [epic, dep])).toBe(true);
  });

  it('epic depending on an in-progress epic is blocked', () => {
    const scheduler = createScheduler();
    const dep = makeEpic({ id: 'dep-1', column: 'in-progress' });
    const epic = makeEpic({ dependsOn: ['dep-1'], runAfter: null });
    expect(scheduler.isBlocked(epic, [epic, dep])).toBe(true);
  });

  it('epic depending on a review epic is blocked', () => {
    const scheduler = createScheduler();
    const dep = makeEpic({ id: 'dep-1', column: 'review' });
    const epic = makeEpic({ dependsOn: ['dep-1'], runAfter: null });
    expect(scheduler.isBlocked(epic, [epic, dep])).toBe(true);
  });

  it('epic depending on a backlog epic is blocked', () => {
    const scheduler = createScheduler();
    const dep = makeEpic({ id: 'dep-1', column: 'backlog' });
    const epic = makeEpic({ dependsOn: ['dep-1'], runAfter: null });
    expect(scheduler.isBlocked(epic, [epic, dep])).toBe(true);
  });

  it('multiple dependencies all done means not blocked', () => {
    const scheduler = createScheduler();
    const dep1 = makeEpic({ id: 'dep-1', column: 'done' });
    const dep2 = makeEpic({ id: 'dep-2', column: 'done' });
    const dep3 = makeEpic({ id: 'dep-3', column: 'done' });
    const epic = makeEpic({ dependsOn: ['dep-1', 'dep-2', 'dep-3'], runAfter: null });
    expect(scheduler.isBlocked(epic, [epic, dep1, dep2, dep3])).toBe(false);
  });

  it('multiple dependencies with one not done means blocked', () => {
    const scheduler = createScheduler();
    const dep1 = makeEpic({ id: 'dep-1', column: 'done' });
    const dep2 = makeEpic({ id: 'dep-2', column: 'in-progress' });
    const epic = makeEpic({ dependsOn: ['dep-1', 'dep-2'], runAfter: null });
    expect(scheduler.isBlocked(epic, [epic, dep1, dep2])).toBe(true);
  });

  it('dependency ID not found in allEpics treats as blocked', () => {
    const scheduler = createScheduler();
    const epic = makeEpic({ dependsOn: ['nonexistent-id'], runAfter: null });
    expect(scheduler.isBlocked(epic, [epic])).toBe(true);
  });

  it('self-referential dependency is blocked (cycle detection)', () => {
    const scheduler = createScheduler();
    const epic = makeEpic({ id: 'self-ref', dependsOn: ['self-ref'], runAfter: null });
    // Suppress the console.error from cycle detection
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(scheduler.isBlocked(epic, [epic])).toBe(true);
  });

  it('runAfter pointing to epic in todo is blocked', () => {
    const scheduler = createScheduler();
    const predecessor = makeEpic({ id: 'pred-1', column: 'todo' });
    const epic = makeEpic({ dependsOn: [], runAfter: 'pred-1' });
    expect(scheduler.isBlocked(epic, [epic, predecessor])).toBe(true);
  });

  it('runAfter pointing to epic in done is not blocked', () => {
    const scheduler = createScheduler();
    const predecessor = makeEpic({ id: 'pred-1', column: 'done' });
    const epic = makeEpic({ dependsOn: [], runAfter: 'pred-1' });
    expect(scheduler.isBlocked(epic, [epic, predecessor])).toBe(false);
  });

  it('runAfter pointing to epic in review is not blocked', () => {
    const scheduler = createScheduler();
    const predecessor = makeEpic({ id: 'pred-1', column: 'review' });
    const epic = makeEpic({ dependsOn: [], runAfter: 'pred-1' });
    expect(scheduler.isBlocked(epic, [epic, predecessor])).toBe(false);
  });

  it('runAfter null means not blocked by runAfter', () => {
    const scheduler = createScheduler();
    const epic = makeEpic({ dependsOn: [], runAfter: null });
    expect(scheduler.isBlocked(epic, [epic])).toBe(false);
  });

  it('runAfter pointing to missing epic is not blocked', () => {
    const scheduler = createScheduler();
    const epic = makeEpic({ dependsOn: [], runAfter: 'deleted-epic-id' });
    // predecessor not found -> the runAfter check passes (not blocked)
    expect(scheduler.isBlocked(epic, [epic])).toBe(false);
  });
});
