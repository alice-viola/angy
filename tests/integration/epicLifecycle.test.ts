import { Scheduler } from '@/engine/Scheduler'
import { OrchestratorPool } from '@/engine/OrchestratorPool'
import type { BranchManager } from '@/engine/BranchManager'
import { makeMockDb } from '../mocks/database'
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

describe('Epic lifecycle (Scheduler + Pool)', () => {
  it('happy path: todo → in-progress → review → done', async () => {
    const epic = makeEpic({ id: 'e1', column: 'todo' })
    await wireScheduler([epic])

    // tick starts the epic
    await scheduler.tick()
    expect(getEpics().find(e => e.id === 'e1')?.column).toBe('in-progress')
    expect(pool.isEpicActive('e1')).toBe(true)

    // move to review
    await scheduler.moveToReview('e1')
    expect(getEpics().find(e => e.id === 'e1')?.column).toBe('review')
    expect(pool.isEpicActive('e1')).toBe(false)

    // approve
    await scheduler.approveEpic('e1')
    expect(getEpics().find(e => e.id === 'e1')?.column).toBe('done')
  })

  it('review → approve moves to done and removes from pool', async () => {
    const epic = makeEpic({ id: 'e1', column: 'todo' })
    await wireScheduler([epic])

    await scheduler.tick()
    await scheduler.moveToReview('e1')
    await scheduler.approveEpic('e1')

    expect(getEpics().find(e => e.id === 'e1')?.column).toBe('done')
    expect(pool.isEpicActive('e1')).toBe(false)
  })

  it('rejection with count < 5 moves back to todo', async () => {
    const epic = makeEpic({ id: 'e1', column: 'todo', rejectionCount: 0 })
    await wireScheduler([epic])

    await scheduler.tick()
    await scheduler.rejectEpic('e1', 'needs work')

    const found = getEpics().find(e => e.id === 'e1')
    expect(found?.column).toBe('todo')
    expect(found?.rejectionCount).toBe(1)
  })

  it('rejection with count >= 5 moves to backlog', async () => {
    const epic = makeEpic({ id: 'e1', column: 'todo', rejectionCount: 4 })
    await wireScheduler([epic])

    await scheduler.tick()
    await scheduler.rejectEpic('e1', 'too many failures')

    const found = getEpics().find(e => e.id === 'e1')
    expect(found?.column).toBe('backlog')
    expect(found?.rejectionCount).toBe(5)
  })

  it('initialize recovers stale in-progress epics when pool has no active session', async () => {
    const staleEpic = makeEpic({ id: 'e1', column: 'in-progress', startedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString() })
    const epicRepo = makeMockEpicRepo([staleEpic])
    const projectRepo = makeMockProjectRepo([])
    scheduler.setRepositories(epicRepo, projectRepo)

    await scheduler.initialize()

    // After initialize, stale epic should have been moved to 'todo'
    const found = getEpics().find(e => e.id === 'e1')
    expect(found?.column).toBe('todo')
  })

  it('health check grace period: in-progress epic within 5 min not recovered', async () => {
    const recentEpic = makeEpic({
      id: 'e1',
      column: 'in-progress',
      startedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(), // 2 min ago
    })
    await wireScheduler([recentEpic])

    const actions = await scheduler.tick()

    // Should NOT be recovered because within grace period
    const recoveredActions = actions.filter(a => a.type === 'recovered')
    expect(recoveredActions).toHaveLength(0)
    expect(getEpics().find(e => e.id === 'e1')?.column).toBe('in-progress')
  })

  it('in-progress epic active in pool is not recovered by health check', async () => {
    const epic = makeEpic({ id: 'e1', column: 'todo' })
    await wireScheduler([epic])

    // Start the epic so it's active in the pool
    await scheduler.tick()
    expect(pool.isEpicActive('e1')).toBe(true)

    // Another tick should NOT recover it
    const actions = await scheduler.tick()
    const recoveredActions = actions.filter(a => a.type === 'recovered')
    expect(recoveredActions).toHaveLength(0)
    expect(getEpics().find(e => e.id === 'e1')?.column).toBe('in-progress')
  })

  it('parallelAgentCount=3 creates 3 clones and discards original', async () => {
    const epic = makeEpic({ id: 'e1', column: 'todo', title: 'Build Feature', parallelAgentCount: 3 })
    await wireScheduler([epic])

    await scheduler.tick()

    const epics = getEpics()
    const original = epics.find(e => e.id === 'e1')
    expect(original?.column).toBe('discarded')

    const clones = epics.filter(e => e.title.startsWith('Build Feature X'))
    expect(clones).toHaveLength(3)
  })

  it('cloned epics have parallelAgentCount=1 and column=todo', async () => {
    const epic = makeEpic({ id: 'e1', column: 'todo', title: 'Build Feature', parallelAgentCount: 2 })
    await wireScheduler([epic])

    await scheduler.tick()

    const clones = getEpics().filter(e => e.title.startsWith('Build Feature X'))
    for (const clone of clones) {
      expect(clone.parallelAgentCount).toBe(1)
      expect(clone.column).toBe('todo')
      expect(clone.id).not.toBe('e1')
    }
  })

  it('backlog epics are ignored by tick', async () => {
    const backlogEpic = makeEpic({ id: 'e1', column: 'backlog' })
    await wireScheduler([backlogEpic])

    const actions = await scheduler.tick()

    const startActions = actions.filter(a => a.type === 'start')
    expect(startActions).toHaveLength(0)
    expect(getEpics().find(e => e.id === 'e1')?.column).toBe('backlog')
  })

  it('done epics are ignored by tick', async () => {
    const doneEpic = makeEpic({ id: 'e1', column: 'done' })
    await wireScheduler([doneEpic])

    const actions = await scheduler.tick()

    const startActions = actions.filter(a => a.type === 'start')
    expect(startActions).toHaveLength(0)
    expect(getEpics().find(e => e.id === 'e1')?.column).toBe('done')
  })
})
