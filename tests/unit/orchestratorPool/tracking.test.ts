import { OrchestratorPool } from '@/engine/OrchestratorPool'
import type { BranchManager } from '@/engine/BranchManager'
import { makeMockDb } from '../../mocks/database'
import { makeEpic } from '../../helpers/epicFactory'
import type { OrchestratorOptions } from '@/engine/KosTypes'

let pool: OrchestratorPool
let mockBranchManager: BranchManager

beforeEach(() => {
  OrchestratorPool.resetInstance()
  vi.restoreAllMocks()
  const mockDb = makeMockDb()
  mockBranchManager = {
    createCheckpoint: vi.fn().mockResolvedValue(true),
    createWorktree: vi.fn().mockResolvedValue(true),
    createAndCheckoutEpicBranch: vi.fn().mockResolvedValue(true),
    getCurrentBranch: vi.fn().mockResolvedValue('main'),
    saveBranchRecord: vi.fn().mockResolvedValue(undefined),
  } as unknown as BranchManager
  pool = OrchestratorPool.getInstance(mockBranchManager, mockDb as any)
})

function makeOptions(epicId: string, projectId = 'proj-1'): OrchestratorOptions {
  return {
    epicId,
    projectId,
    repoPaths: {},
    depth: 0,
    maxDepth: 3,
    parentSessionId: null,
    budgetRemaining: null,
  }
}

describe('OrchestratorPool tracking', () => {
  it('new pool has no active orchestrators', () => {
    expect(pool.totalActive()).toBe(0)
  })

  it('isEpicActive returns true after spawnRoot', async () => {
    pool.setOrchestratorFactory(vi.fn().mockResolvedValue('session-123'))
    const epic = makeEpic({ id: 'epic-1' })

    await pool.spawnRoot('epic-1', makeOptions('epic-1'), epic, [])

    expect(pool.isEpicActive('epic-1')).toBe(true)
  })

  it('totalActive increments after spawn', async () => {
    pool.setOrchestratorFactory(vi.fn().mockResolvedValue('session-123'))
    const epic = makeEpic({ id: 'epic-1' })

    await pool.spawnRoot('epic-1', makeOptions('epic-1'), epic, [])

    expect(pool.totalActive()).toBe(1)
  })

  it('activeByProject returns count of active epics in that project', async () => {
    pool.setOrchestratorFactory(vi.fn().mockResolvedValue('session-123'))
    const epic1 = makeEpic({ id: 'epic-1', projectId: 'proj-a' })
    const epic2 = makeEpic({ id: 'epic-2', projectId: 'proj-a' })
    const epic3 = makeEpic({ id: 'epic-3', projectId: 'proj-b' })

    await pool.spawnRoot('epic-1', makeOptions('epic-1', 'proj-a'), epic1, [])
    await pool.spawnRoot('epic-2', makeOptions('epic-2', 'proj-a'), epic2, [])
    await pool.spawnRoot('epic-3', makeOptions('epic-3', 'proj-b'), epic3, [])

    expect(pool.activeByProject('proj-a')).toBe(2)
    expect(pool.activeByProject('proj-b')).toBe(1)
  })

  it('removeEpic makes isEpicActive return false', async () => {
    pool.setOrchestratorFactory(vi.fn().mockResolvedValue('session-123'))
    const epic = makeEpic({ id: 'epic-1' })
    await pool.spawnRoot('epic-1', makeOptions('epic-1'), epic, [])

    await pool.removeEpic('epic-1')

    expect(pool.isEpicActive('epic-1')).toBe(false)
    expect(pool.totalActive()).toBe(0)
  })

  it('removeEpic on non-existent id does not throw', async () => {
    await expect(pool.removeEpic('nonexistent')).resolves.not.toThrow()
  })

  it('spawning multiple epics increments totalActive for each', async () => {
    pool.setOrchestratorFactory(vi.fn().mockResolvedValue('session-123'))
    const epic1 = makeEpic({ id: 'epic-1' })
    const epic2 = makeEpic({ id: 'epic-2' })
    const epic3 = makeEpic({ id: 'epic-3' })

    await pool.spawnRoot('epic-1', makeOptions('epic-1'), epic1, [])
    await pool.spawnRoot('epic-2', makeOptions('epic-2'), epic2, [])
    await pool.spawnRoot('epic-3', makeOptions('epic-3'), epic3, [])

    expect(pool.totalActive()).toBe(3)
  })

  it('activeByProject only counts epics for the given project', async () => {
    pool.setOrchestratorFactory(vi.fn().mockResolvedValue('session-123'))
    const epic1 = makeEpic({ id: 'epic-1', projectId: 'proj-a' })
    const epic2 = makeEpic({ id: 'epic-2', projectId: 'proj-b' })

    await pool.spawnRoot('epic-1', makeOptions('epic-1', 'proj-a'), epic1, [])
    await pool.spawnRoot('epic-2', makeOptions('epic-2', 'proj-b'), epic2, [])

    expect(pool.activeByProject('proj-a')).toBe(1)
    expect(pool.activeByProject('proj-c')).toBe(0)
  })
})
