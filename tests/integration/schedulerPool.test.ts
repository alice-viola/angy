import { Scheduler } from '@/engine/Scheduler'
import { OrchestratorPool } from '@/engine/OrchestratorPool'
import type { BranchManager } from '@/engine/BranchManager'
import { makeMockDb, defaultConfig } from '../mocks/database'
import { makeMockEpicRepo, getEpics } from '../mocks/epicRepo'
import { makeMockProjectRepo } from '../mocks/projectRepo'
import { makeEpic } from '../helpers/epicFactory'

let scheduler: Scheduler
let pool: OrchestratorPool
let mockDb: ReturnType<typeof makeMockDb>

const mockBranchManager = {
  createCheckpoint: vi.fn().mockResolvedValue(true),
  createWorktree: vi.fn().mockResolvedValue(true),
  createAndCheckoutEpicBranch: vi.fn().mockResolvedValue(true),
  getCurrentBranch: vi.fn().mockResolvedValue('main'),
  saveBranchRecord: vi.fn().mockResolvedValue(undefined),
} as unknown as BranchManager

beforeEach(() => {
  Scheduler.resetInstance()
  OrchestratorPool.resetInstance()
  vi.restoreAllMocks()

  mockDb = makeMockDb()
  pool = OrchestratorPool.getInstance(mockBranchManager, mockDb as any)
  pool.setOrchestratorFactory(vi.fn().mockResolvedValue('session-abc'))

  scheduler = Scheduler.getInstance()
  scheduler.setDatabase(mockDb)
  scheduler.setPool(pool)
})

async function wireScheduler(epics: ReturnType<typeof makeEpic>[]) {
  const epicRepo = makeMockEpicRepo(epics)
  const projectRepo = makeMockProjectRepo([])
  scheduler.setRepositories(epicRepo, projectRepo)
  await scheduler.loadConfig()
  return { epicRepo, projectRepo }
}

describe('Scheduler + OrchestratorPool integration', () => {
  it('tick picks up a todo epic and moves it to in-progress', async () => {
    const epic = makeEpic({ id: 'e1', column: 'todo' })
    await wireScheduler([epic])

    const actions = await scheduler.tick()

    expect(actions).toContainEqual(expect.objectContaining({ type: 'start', epicId: 'e1' }))
    expect(pool.isEpicActive('e1')).toBe(true)
    const epics = getEpics()
    expect(epics.find(e => e.id === 'e1')?.column).toBe('in-progress')
  })

  it('respects maxConcurrentEpics — does not start more than the limit', async () => {
    const ip1 = makeEpic({ id: 'ip1', column: 'in-progress' })
    const ip2 = makeEpic({ id: 'ip2', column: 'in-progress' })
    const ip3 = makeEpic({ id: 'ip3', column: 'in-progress' })
    const todo = makeEpic({ id: 'e1', column: 'todo' })
    await wireScheduler([ip1, ip2, ip3, todo])

    const actions = await scheduler.tick()

    const startActions = actions.filter(a => a.type === 'start')
    expect(startActions).toHaveLength(0)
    expect(pool.isEpicActive('e1')).toBe(false)
  })

  it('respects daily cost budget — skips scheduling when budget exhausted', async () => {
    const epic = makeEpic({ id: 'e1', column: 'todo' });
    (mockDb.totalCostSince as any).mockResolvedValue(999)
    await wireScheduler([epic])

    const actions = await scheduler.tick()

    const startActions = actions.filter(a => a.type === 'start')
    expect(startActions).toHaveLength(0)
    expect(pool.isEpicActive('e1')).toBe(false)
  })

  it('starts higher-priority epic first when only one slot available', async () => {
    const ip1 = makeEpic({ id: 'ip1', column: 'in-progress' })
    const ip2 = makeEpic({ id: 'ip2', column: 'in-progress' })
    const lowPri = makeEpic({ id: 'low', column: 'todo', priorityHint: 'low' })
    const highPri = makeEpic({ id: 'high', column: 'todo', priorityHint: 'critical' })
    await wireScheduler([ip1, ip2, lowPri, highPri])

    const actions = await scheduler.tick()

    const startActions = actions.filter(a => a.type === 'start')
    expect(startActions).toHaveLength(1)
    expect(startActions[0].epicId).toBe('high')
    expect(pool.isEpicActive('high')).toBe(true)
    expect(pool.isEpicActive('low')).toBe(false)
  })

  it('skips blocked epic and starts unblocked one', async () => {
    const dep = makeEpic({ id: 'dep1', column: 'in-progress' })
    const blocked = makeEpic({ id: 'blocked', column: 'todo', dependsOn: ['dep1'], priorityHint: 'critical' })
    const unblocked = makeEpic({ id: 'unblocked', column: 'todo', priorityHint: 'low' })
    await wireScheduler([dep, blocked, unblocked])

    const actions = await scheduler.tick()

    const startActions = actions.filter(a => a.type === 'start')
    expect(startActions).toHaveLength(1)
    expect(startActions[0].epicId).toBe('unblocked')
  })

  it('pool.spawnRoot failure does not crash tick — epic stays in-progress but no session', async () => {
    pool.setOrchestratorFactory(vi.fn().mockRejectedValue(new Error('spawn failed')))
    const epic = makeEpic({ id: 'e1', column: 'todo' })
    await wireScheduler([epic])

    const actions = await scheduler.tick()

    // executeStart returns false on pool error, so no 'start' action
    const startActions = actions.filter(a => a.type === 'start')
    expect(startActions).toHaveLength(0)
  })

  it('config.enabled=false → scheduler does not auto-start on initialize', async () => {
    const config = { ...defaultConfig(), enabled: false };
    (mockDb.loadSchedulerConfig as any).mockResolvedValue(config)
    const epic = makeEpic({ id: 'e1', column: 'todo' })
    const epicRepo = makeMockEpicRepo([epic])
    const projectRepo = makeMockProjectRepo([])
    scheduler.setRepositories(epicRepo, projectRepo)

    await scheduler.initialize()

    expect(scheduler.isRunning()).toBe(false)
  })
})
