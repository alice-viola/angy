import { Scheduler } from '@/engine/Scheduler';
import { makeMockDb } from '../../mocks/database';
import { makeEpic } from '../../helpers/epicFactory';

beforeEach(() => {
  Scheduler.resetInstance();
  vi.restoreAllMocks();
});

describe('Scheduler.computePriorityScore', () => {
  async function createScheduler() {
    const scheduler = Scheduler.getInstance();
    const db = makeMockDb();
    scheduler.setDatabase(db);
    await scheduler.loadConfig();
    return scheduler;
  }

  it('returns a number between 0 and 1', async () => {
    const scheduler = await createScheduler();
    const epic = makeEpic({ priorityHint: 'medium', complexity: 'medium' });
    const score = scheduler.computePriorityScore(epic);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('scores critical priority higher than low priority', async () => {
    const scheduler = await createScheduler();
    const critical = makeEpic({ priorityHint: 'critical' });
    const low = makeEpic({ priorityHint: 'low' });
    expect(scheduler.computePriorityScore(critical)).toBeGreaterThan(
      scheduler.computePriorityScore(low),
    );
  });

  it('scores trivial complexity higher than epic complexity', async () => {
    const scheduler = await createScheduler();
    const trivial = makeEpic({ complexity: 'trivial' });
    const epic = makeEpic({ complexity: 'epic' });
    expect(scheduler.computePriorityScore(trivial)).toBeGreaterThan(
      scheduler.computePriorityScore(epic),
    );
  });

  it('scores rejectionCount 0 higher than rejectionCount 5', async () => {
    const scheduler = await createScheduler();
    const noRejections = makeEpic({ rejectionCount: 0 });
    const manyRejections = makeEpic({ rejectionCount: 5 });
    expect(scheduler.computePriorityScore(noRejections)).toBeGreaterThan(
      scheduler.computePriorityScore(manyRejections),
    );
  });

  it('scores no dependencies higher than multiple dependencies', async () => {
    const scheduler = await createScheduler();
    const noDeps = makeEpic({ dependsOn: [] });
    const threeDeps = makeEpic({ dependsOn: ['a', 'b', 'c'] });
    expect(scheduler.computePriorityScore(noDeps)).toBeGreaterThan(
      scheduler.computePriorityScore(threeDeps),
    );
  });

  it('scores older epic higher on age contribution than a brand new epic', async () => {
    const scheduler = await createScheduler();
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const justNow = new Date().toISOString();
    const oldEpic = makeEpic({ createdAt: sixtyDaysAgo });
    const newEpic = makeEpic({ createdAt: justNow });
    expect(scheduler.computePriorityScore(oldEpic)).toBeGreaterThan(
      scheduler.computePriorityScore(newEpic),
    );
  });

  it('returns equal scores for two identical epics', async () => {
    const scheduler = await createScheduler();
    const createdAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const epicA = makeEpic({ priorityHint: 'high', complexity: 'small', createdAt });
    const epicB = makeEpic({ priorityHint: 'high', complexity: 'small', createdAt });
    expect(scheduler.computePriorityScore(epicA)).toBe(
      scheduler.computePriorityScore(epicB),
    );
  });

  it('always returns a finite number', async () => {
    const scheduler = await createScheduler();
    const cases = [
      makeEpic({ priorityHint: 'none', complexity: 'epic', rejectionCount: 100 }),
      makeEpic({ priorityHint: 'critical', complexity: 'trivial', rejectionCount: 0 }),
      makeEpic({ createdAt: new Date(0).toISOString() }),
      makeEpic({ dependsOn: ['a', 'b', 'c', 'd', 'e', 'f'] }),
    ];
    for (const epic of cases) {
      const score = scheduler.computePriorityScore(epic);
      expect(Number.isFinite(score)).toBe(true);
    }
  });

  it('highest possible score approaches sum of all weights (1.0)', async () => {
    const scheduler = await createScheduler();
    const optimal = makeEpic({
      priorityHint: 'critical',
      complexity: 'trivial',
      dependsOn: [],
      rejectionCount: 0,
      createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const score = scheduler.computePriorityScore(optimal);
    // Sum of weights is 1.0; with all optimal values each factor is 1.0
    // age is capped at min(ageDays/30, 1.0), 60 days -> 1.0
    expect(score).toBeCloseTo(1.0, 1);
  });

  it('config weights influence relative ordering', async () => {
    // With default weights, critical+epic-complexity beats low+trivial-complexity
    // because manualHint weight (0.4) dominates complexity weight (0.15)
    const scheduler = await createScheduler();
    const criticalEpicComplexity = makeEpic({ priorityHint: 'critical', complexity: 'epic' });
    const lowTrivialComplexity = makeEpic({ priorityHint: 'low', complexity: 'trivial' });
    const scoreCritical = scheduler.computePriorityScore(criticalEpicComplexity);
    const scoreLow = scheduler.computePriorityScore(lowTrivialComplexity);
    // critical * 0.4 = 0.4, epic-complexity * 0.15 = 0.03 -> priority dominates
    // low * 0.4 = 0.1, trivial * 0.15 = 0.15
    expect(scoreCritical).toBeGreaterThan(scoreLow);
  });

  it('rejection penalty floors at 0 for very high rejection counts', async () => {
    const scheduler = await createScheduler();
    const highRejections = makeEpic({ rejectionCount: 10 });
    const score = scheduler.computePriorityScore(highRejections);
    // Math.max(0, 1.0 - 10 * 0.2) = Math.max(0, -1.0) = 0
    // So rejectionScore = 0 * 0.1 = 0, score should still be >= 0
    expect(score).toBeGreaterThanOrEqual(0);

    // Verify that rejectionCount: 10 gives same rejection contribution as rejectionCount: 100
    const extremeRejections = makeEpic({ rejectionCount: 100 });
    expect(scheduler.computePriorityScore(highRejections)).toBe(
      scheduler.computePriorityScore(extremeRejections),
    );
  });
});
