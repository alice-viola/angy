import { OrchestratorPool } from '@/engine/OrchestratorPool'
import type { BranchManager } from '@/engine/BranchManager'
import { makeMockDb } from '../../mocks/database'
import { makeEpic } from '../../helpers/epicFactory'
import type { OrchestratorOptions } from '@/engine/KosTypes'

let pool: OrchestratorPool

beforeEach(() => {
  OrchestratorPool.resetInstance()
  vi.restoreAllMocks()
  const mockDb = makeMockDb()
  const mockBranchManager = {
    createCheckpoint: vi.fn().mockResolvedValue(true),
    createWorktree: vi.fn().mockResolvedValue(true),
    createAndCheckoutEpicBranch: vi.fn().mockResolvedValue(true),
    getCurrentBranch: vi.fn().mockResolvedValue('main'),
    saveBranchRecord: vi.fn().mockResolvedValue(undefined),
  } as unknown as BranchManager
  pool = OrchestratorPool.getInstance(mockBranchManager, mockDb as any)
})

function makeOptions(epicId: string): OrchestratorOptions {
  return {
    epicId,
    projectId: 'proj-1',
    repoPaths: {},
    depth: 0,
    maxDepth: 3,
    parentSessionId: null,
    budgetRemaining: null,
  }
}

async function spawnAndGetSession(epicId: string): Promise<string> {
  pool.setOrchestratorFactory(vi.fn().mockResolvedValue(`session-${epicId}`))
  const epic = makeEpic({ id: epicId })
  return pool.spawnRoot(epicId, makeOptions(epicId), epic, [])
}

describe('OrchestratorPool depth limits', () => {
  it('default max depth is 3', () => {
    // canSpawnChild uses this.maxDepth as default
    // Without any spawn, no sessions exist, so canSpawnChild returns false
    // We verify by spawning at depth 0 and checking depths 0,1,2 are allowed
    expect(pool['maxDepth']).toBe(3)
  })

  it('setMaxDepth changes the enforced limit', () => {
    pool.setMaxDepth(5)
    expect(pool['maxDepth']).toBe(5)
  })

  it('spawnRoot always spawns at depth 0', async () => {
    const sessionId = await spawnAndGetSession('epic-1')
    expect(pool.getDepth(sessionId)).toBe(0)
  })

  it('registerSubOrchestrator increments depth by 1', async () => {
    const parentSession = await spawnAndGetSession('epic-1')

    pool.registerSubOrchestrator(parentSession, 'child-1')

    expect(pool.getDepth('child-1')).toBe(1)
  })

  it('spawning a child when depth < maxDepth is allowed', async () => {
    const parentSession = await spawnAndGetSession('epic-1')

    expect(() => {
      pool.registerSubOrchestrator(parentSession, 'child-1', 3)
    }).not.toThrow()
  })

  it('spawning a child when depth >= maxDepth throws', async () => {
    pool.setMaxDepth(1)
    const parentSession = await spawnAndGetSession('epic-1')

    // parent is at depth 0, register child at depth 1
    pool.registerSubOrchestrator(parentSession, 'child-1', 1)

    // child-1 is at depth 1, trying to register grandchild should fail (1 >= 1)
    expect(() => {
      pool.registerSubOrchestrator('child-1', 'grandchild-1', 1)
    }).toThrow(/depth/)
  })

  it('depth tracking resets when epic is removed', async () => {
    const parentSession = await spawnAndGetSession('epic-1')
    pool.registerSubOrchestrator(parentSession, 'child-1')

    await pool.removeEpic('epic-1')

    expect(pool.getDepth(parentSession)).toBe(0) // default for missing session
    expect(pool.getDepth('child-1')).toBe(0)
  })

  it('setMaxDepth(0) prevents any sub-orchestrators', async () => {
    pool.setMaxDepth(0)
    const parentSession = await spawnAndGetSession('epic-1')

    // Parent is depth 0, maxDepth is 0, so 0 >= 0 → throws
    expect(() => {
      pool.registerSubOrchestrator(parentSession, 'child-1', 0)
    }).toThrow(/depth/)
  })

  it('setMaxDepth(1) allows one level deep', async () => {
    pool.setMaxDepth(1)
    const parentSession = await spawnAndGetSession('epic-1')

    // depth 0 < 1 → allowed
    pool.registerSubOrchestrator(parentSession, 'child-1', 1)
    expect(pool.getDepth('child-1')).toBe(1)

    // depth 1 >= 1 → disallowed
    expect(() => {
      pool.registerSubOrchestrator('child-1', 'grandchild-1', 1)
    }).toThrow(/depth/)
  })

  it('canSpawnChild returns correct boolean based on depth vs maxDepth', async () => {
    pool.setMaxDepth(2)
    const parentSession = await spawnAndGetSession('epic-1')

    // depth 0 < 2 → can spawn
    expect(pool.canSpawnChild(parentSession)).toBe(true)

    pool.registerSubOrchestrator(parentSession, 'child-1')
    // depth 1 < 2 → can spawn
    expect(pool.canSpawnChild('child-1')).toBe(true)

    pool.registerSubOrchestrator('child-1', 'grandchild-1')
    // depth 2 >= 2 → cannot spawn
    expect(pool.canSpawnChild('grandchild-1')).toBe(false)
  })
})
