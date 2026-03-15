import { OrchestratorPool } from '@/engine/OrchestratorPool'
import type { BranchManager } from '@/engine/BranchManager'
import { makeMockDb } from '../../mocks/database'
import { makeEpic } from '../../helpers/epicFactory'
import type { OrchestratorOptions, ProjectRepo } from '@/engine/KosTypes'

let pool: OrchestratorPool
let mockBranchManager: Record<string, ReturnType<typeof vi.fn>>

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
  }
  pool = OrchestratorPool.getInstance(mockBranchManager as unknown as BranchManager, mockDb as any)
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

const testRepos: ProjectRepo[] = [
  { id: 'repo-1', projectId: 'proj-1', path: '/repos/my-app', name: 'my-app', defaultBranch: 'main' },
]

describe('OrchestratorPool resumeOrSpawnRoot', () => {
  it('hybrid pipeline attempts resume factory first', async () => {
    const resumeFactory = vi.fn().mockResolvedValue('session-resumed')
    const orchestratorFactory = vi.fn().mockResolvedValue('session-new')
    pool.setResumeFactory(resumeFactory)
    pool.setOrchestratorFactory(orchestratorFactory)

    const epic = makeEpic({ id: 'epic-1', pipelineType: 'hybrid' })
    const result = await pool.resumeOrSpawnRoot('epic-1', makeOptions('epic-1'), epic, [])

    expect(result).toBe('session-resumed')
    expect(resumeFactory).toHaveBeenCalledWith('epic-1', epic, [])
    expect(orchestratorFactory).not.toHaveBeenCalled()
  })

  it('investigate pipeline skips resume factory', async () => {
    const resumeFactory = vi.fn().mockResolvedValue('session-resumed')
    const orchestratorFactory = vi.fn().mockResolvedValue('session-new')
    pool.setResumeFactory(resumeFactory)
    pool.setOrchestratorFactory(orchestratorFactory)

    const epic = makeEpic({ id: 'epic-1', pipelineType: 'investigate' })
    const result = await pool.resumeOrSpawnRoot('epic-1', makeOptions('epic-1'), epic, [])

    expect(result).toBe('session-new')
    expect(resumeFactory).not.toHaveBeenCalled()
  })

  it('plan pipeline skips resume factory', async () => {
    const resumeFactory = vi.fn().mockResolvedValue('session-resumed')
    const orchestratorFactory = vi.fn().mockResolvedValue('session-new')
    pool.setResumeFactory(resumeFactory)
    pool.setOrchestratorFactory(orchestratorFactory)

    const epic = makeEpic({ id: 'epic-1', pipelineType: 'plan' })
    const result = await pool.resumeOrSpawnRoot('epic-1', makeOptions('epic-1'), epic, [])

    expect(result).toBe('session-new')
    expect(resumeFactory).not.toHaveBeenCalled()
  })

  it('resume factory returns session → that session is returned', async () => {
    const resumeFactory = vi.fn().mockResolvedValue('session-42')
    pool.setResumeFactory(resumeFactory)
    pool.setOrchestratorFactory(vi.fn().mockResolvedValue('session-new'))

    const epic = makeEpic({ id: 'epic-1', pipelineType: 'hybrid' })
    const result = await pool.resumeOrSpawnRoot('epic-1', makeOptions('epic-1'), epic, [])

    expect(result).toBe('session-42')
  })

  it('resume factory returns null → falls back to orchestrator factory', async () => {
    const resumeFactory = vi.fn().mockResolvedValue(null)
    const orchestratorFactory = vi.fn().mockResolvedValue('session-new')
    pool.setResumeFactory(resumeFactory)
    pool.setOrchestratorFactory(orchestratorFactory)

    const epic = makeEpic({ id: 'epic-1', pipelineType: 'hybrid' })
    const result = await pool.resumeOrSpawnRoot('epic-1', makeOptions('epic-1'), epic, [])

    expect(result).toBe('session-new')
    expect(resumeFactory).toHaveBeenCalled()
    expect(orchestratorFactory).toHaveBeenCalled()
  })

  it('resume factory throws → falls back to orchestrator factory', async () => {
    const resumeFactory = vi.fn().mockRejectedValue(new Error('snapshot corrupted'))
    const orchestratorFactory = vi.fn().mockResolvedValue('session-new')
    pool.setResumeFactory(resumeFactory)
    pool.setOrchestratorFactory(orchestratorFactory)

    const epic = makeEpic({ id: 'epic-1', pipelineType: 'hybrid' })
    const result = await pool.resumeOrSpawnRoot('epic-1', makeOptions('epic-1'), epic, [])

    expect(result).toBe('session-new')
    expect(orchestratorFactory).toHaveBeenCalled()
  })

  it('no resume factory set → goes directly to orchestrator factory', async () => {
    const orchestratorFactory = vi.fn().mockResolvedValue('session-new')
    pool.setOrchestratorFactory(orchestratorFactory)

    const epic = makeEpic({ id: 'epic-1', pipelineType: 'hybrid' })
    const result = await pool.resumeOrSpawnRoot('epic-1', makeOptions('epic-1'), epic, [])

    expect(result).toBe('session-new')
    expect(orchestratorFactory).toHaveBeenCalled()
  })

  it('after resumeOrSpawnRoot, isEpicActive returns true', async () => {
    pool.setOrchestratorFactory(vi.fn().mockResolvedValue('session-new'))

    const epic = makeEpic({ id: 'epic-1', pipelineType: 'hybrid' })
    await pool.resumeOrSpawnRoot('epic-1', makeOptions('epic-1'), epic, [])

    expect(pool.isEpicActive('epic-1')).toBe(true)
  })

  it('verified which factory was called via mock.calls', async () => {
    const resumeFactory = vi.fn().mockResolvedValue('session-resumed')
    const orchestratorFactory = vi.fn().mockResolvedValue('session-new')
    pool.setResumeFactory(resumeFactory)
    pool.setOrchestratorFactory(orchestratorFactory)

    const epic = makeEpic({ id: 'epic-1', pipelineType: 'hybrid' })
    await pool.resumeOrSpawnRoot('epic-1', makeOptions('epic-1'), epic, [])

    expect(resumeFactory.mock.calls).toHaveLength(1)
    expect(orchestratorFactory.mock.calls).toHaveLength(0)
  })

  it('useWorktree: true calls branchManager.createWorktree', async () => {
    pool.setOrchestratorFactory(vi.fn().mockResolvedValue('session-new'))
    const epic = makeEpic({ id: 'epic-1', pipelineType: 'hybrid', useWorktree: true })
    const opts = makeOptions('epic-1')
    opts.repoPaths = { 'repo-1': '/repos/my-app' }

    await pool.spawnRoot('epic-1', opts, epic, testRepos)

    expect(mockBranchManager.createWorktree).toHaveBeenCalled()
  })

  it('useGitBranch: true calls branchManager.createAndCheckoutEpicBranch', async () => {
    pool.setOrchestratorFactory(vi.fn().mockResolvedValue('session-new'))
    const epic = makeEpic({ id: 'epic-1', pipelineType: 'hybrid', useGitBranch: true, useWorktree: false })
    const opts = makeOptions('epic-1')
    opts.repoPaths = { 'repo-1': '/repos/my-app' }

    await pool.spawnRoot('epic-1', opts, epic, testRepos)

    expect(mockBranchManager.createAndCheckoutEpicBranch).toHaveBeenCalled()
  })

  it('useWorktree: false and useGitBranch: false → neither branch method called, tracking branch recorded', async () => {
    pool.setOrchestratorFactory(vi.fn().mockResolvedValue('session-new'))
    const epic = makeEpic({ id: 'epic-1', pipelineType: 'hybrid', useWorktree: false, useGitBranch: false })
    const opts = makeOptions('epic-1')
    opts.repoPaths = { 'repo-1': '/repos/my-app' }

    await pool.spawnRoot('epic-1', opts, epic, testRepos)

    expect(mockBranchManager.createWorktree).not.toHaveBeenCalled()
    expect(mockBranchManager.createAndCheckoutEpicBranch).not.toHaveBeenCalled()
    // getCurrentBranch is called for tracking record
    expect(mockBranchManager.getCurrentBranch).toHaveBeenCalled()
    expect(mockBranchManager.saveBranchRecord).toHaveBeenCalled()
  })

  it('read-only pipeline (investigate) skips all repo preparation', async () => {
    pool.setOrchestratorFactory(vi.fn().mockResolvedValue('session-new'))
    const epic = makeEpic({ id: 'epic-1', pipelineType: 'investigate', useWorktree: true })
    const opts = makeOptions('epic-1')
    opts.repoPaths = { 'repo-1': '/repos/my-app' }

    await pool.spawnRoot('epic-1', opts, epic, testRepos)

    expect(mockBranchManager.createCheckpoint).not.toHaveBeenCalled()
    expect(mockBranchManager.createWorktree).not.toHaveBeenCalled()
    expect(mockBranchManager.createAndCheckoutEpicBranch).not.toHaveBeenCalled()
  })
})
