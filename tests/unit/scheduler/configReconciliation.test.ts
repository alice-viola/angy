import { Scheduler } from '@/engine/Scheduler';
import { makeMockDb, defaultConfig } from '../../mocks/database';

beforeEach(() => {
  Scheduler.resetInstance();
  vi.restoreAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('config reconciliation', () => {
  function setup(dbConfigOverrides?: Partial<ReturnType<typeof defaultConfig>>) {
    const db = makeMockDb();
    if (dbConfigOverrides) {
      (db.loadSchedulerConfig as any).mockResolvedValue({ ...defaultConfig(), ...dbConfigOverrides });
    }
    const scheduler = Scheduler.getInstance();
    scheduler.setDatabase(db);
    return { scheduler, db };
  }

  it('loadConfig reads from db and populates internal config', async () => {
    const { scheduler } = setup({ maxConcurrentEpics: 7 });

    const config = await scheduler.loadConfig();

    expect(config.maxConcurrentEpics).toBe(7);
    expect(scheduler['config'].maxConcurrentEpics).toBe(7);
  });

  it('saveConfig calls db.saveSchedulerConfig with the config', async () => {
    const { scheduler, db } = setup();
    await scheduler.loadConfig();

    const newConfig = { ...defaultConfig(), maxConcurrentEpics: 10 };
    await scheduler.saveConfig(newConfig);

    expect(db.saveSchedulerConfig).toHaveBeenCalledWith(expect.objectContaining({ maxConcurrentEpics: 10 }));
  });

  it('starts scheduler when transitioning enabled from false to true', async () => {
    const { scheduler } = setup({ enabled: false });
    await scheduler.loadConfig();
    expect(scheduler.isRunning()).toBe(false);

    await scheduler.saveConfig({ ...defaultConfig(), enabled: true });

    expect(scheduler.isRunning()).toBe(true);
  });

  it('stops scheduler when transitioning enabled from true to false', async () => {
    const { scheduler } = setup({ enabled: true });
    await scheduler.loadConfig();
    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);

    await scheduler.saveConfig({ ...defaultConfig(), enabled: false });

    expect(scheduler.isRunning()).toBe(false);
  });

  it('restarts scheduler when tickIntervalMs changes while running', async () => {
    const { scheduler } = setup({ enabled: true, tickIntervalMs: 30000 });
    await scheduler.loadConfig();
    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);

    await scheduler.saveConfig({ ...defaultConfig(), enabled: true, tickIntervalMs: 60000 });

    expect(scheduler.isRunning()).toBe(true);
    expect(scheduler['config'].tickIntervalMs).toBe(60000);
  });

  it('uses structuredClone so mutating passed config does not affect internal state', async () => {
    const { scheduler } = setup();
    await scheduler.loadConfig();

    const configToSave = { ...defaultConfig(), maxConcurrentEpics: 5 };
    await scheduler.saveConfig(configToSave);

    configToSave.maxConcurrentEpics = 99;

    expect(scheduler['config'].maxConcurrentEpics).toBe(5);
  });
});
