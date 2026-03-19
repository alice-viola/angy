import type { Epic, EpicBranch, OrchestratorOptions, ProjectRepo } from './KosTypes'
import { BranchManager } from './BranchManager'
import type { Database } from './Database'
import { engineBus } from './EventBus'

// ── OrchestratorPool — Multi-Orchestrator Manager (singleton) ─────────────

const DEFAULT_MAX_DEPTH = 3


/**
 * Factory function that creates and starts a real Orchestrator instance
 * for an epic. Returns the root session ID.
 */
export type OrchestratorFactory = (
  epicId: string,
  options: OrchestratorOptions,
  epic: Epic,
  repos: ProjectRepo[],
) => Promise<string>

/**
 * Resume factory: tries to resume a pipeline from persisted state.
 * Returns the root session ID if resume succeeded, null if no snapshot found.
 */
export type ResumeFactory = (
  epicId: string,
  epic: Epic,
  repos: ProjectRepo[],
) => Promise<string | null>

export class OrchestratorPool {
  private epicOrchestrators = new Map<string, string>()          // epicId → root sessionId
  private sessionOrchestrators = new Map<string, {               // sessionId → metadata
    epicId: string
    depth: number
    parentSessionId?: string
  }>()
  private epicProjects = new Map<string, string>()               // epicId → projectId
  private static instance: OrchestratorPool | null = null
  private branchManager: BranchManager
  private db: Database
  private orchestratorFactory: OrchestratorFactory | null = null
  private resumeFactory: ResumeFactory | null = null
  private maxDepth = DEFAULT_MAX_DEPTH

  private constructor(branchManager: BranchManager, db: Database) {
    this.branchManager = branchManager
    this.db = db
  }

  static getInstance(branchManager?: BranchManager, db?: Database): OrchestratorPool {
    if (!OrchestratorPool.instance) {
      if (!branchManager || !db) {
        throw new Error('BranchManager and Database required for first OrchestratorPool initialization')
      }
      OrchestratorPool.instance = new OrchestratorPool(branchManager, db)
    }
    return OrchestratorPool.instance
  }

  /** Reset singleton (for testing). */
  static resetInstance(): void {
    OrchestratorPool.instance = null
  }

  setOrchestratorFactory(factory: OrchestratorFactory): void {
    this.orchestratorFactory = factory
    console.log('[OrchestratorPool] Orchestrator factory set')
  }

  setResumeFactory(factory: ResumeFactory): void {
    this.resumeFactory = factory
    console.log('[OrchestratorPool] Resume factory set')
  }

  setMaxDepth(depth: number): void {
    this.maxDepth = depth
  }

  // ── inheritFromPredecessor ────────────────────────────────────────────

  async inheritFromPredecessor(
    epic: Epic,
    repos: ProjectRepo[],
    options: OrchestratorOptions,
  ): Promise<boolean> {
    if (!epic.runAfter) return false

    const predecessorBranches = await this.db.loadEpicBranches(epic.runAfter)
    if (predecessorBranches.length === 0) return false

    for (const predBranch of predecessorBranches) {
      const repo = repos.find(r => r.id === predBranch.repoId)
      if (!repo) continue

      const branch: EpicBranch = {
        id: crypto.randomUUID(),
        epicId: epic.id,
        repoId: predBranch.repoId,
        branchName: predBranch.branchName,
        baseBranch: predBranch.baseBranch,
        status: 'active',
        worktreePath: predBranch.worktreePath,
      }
      await this.db.saveEpicBranch(branch)

      if (predBranch.worktreePath) {
        options.repoPaths[repo.id] = predBranch.worktreePath
      }
    }

    console.log(`[OrchestratorPool] Inherited ${predecessorBranches.length} branch(es) from predecessor ${epic.runAfter}`)
    return true
  }

  // ── spawnRoot ─────────────────────────────────────────────────────────

  async spawnRoot(
    epicId: string,
    options: OrchestratorOptions,
    epic: Epic,
    repos: ProjectRepo[],
  ): Promise<string> {
    console.log(`[OrchestratorPool] spawnRoot called for epic: ${epicId} ("${epic.title}")`)

    if (this.epicOrchestrators.has(epicId)) {
      throw new Error(`Epic ${epicId} already has an active orchestrator`)
    }

    // Prepare repos: checkpoint dirty state, optionally create epic branch or worktree
    // Read-only pipelines (investigate, plan) skip repo preparation entirely
    const isReadOnly = epic.pipelineType === 'investigate' || epic.pipelineType === 'plan'
    if (repos.length > 0 && !isReadOnly) {
      // Try to inherit from predecessor first (runAfter chain)
      const inherited = await this.inheritFromPredecessor(epic, repos, options)

      if (!inherited) {
        for (const repo of repos) {
          await this.branchManager.createCheckpoint(repo.path, epic.title)
          const slug = BranchManager.epicTitleToSlug(epic.title)
          const branchName = `epic/${slug}`

          if (epic.useWorktree) {
            // Case 1: Worktree mode
            const base = epic.baseBranch || repo.defaultBranch
            const worktreePath = BranchManager.computeWorktreePath(repo.path, slug)
            const ok = await this.branchManager.createWorktree(
              repo.path, worktreePath, branchName, base,
            )
            if (ok) {
              const branch: EpicBranch = {
                id: crypto.randomUUID(),
                epicId,
                repoId: repo.id,
                branchName,
                baseBranch: base,
                status: 'active',
                worktreePath,
              }
              await this.branchManager.saveBranchRecord(branch)
              options.repoPaths[repo.id] = worktreePath
            }
          } else if (epic.useGitBranch) {
            // Case 2: Checkout-based branch
            const base = epic.baseBranch || repo.defaultBranch
            const ok = await this.branchManager.createAndCheckoutEpicBranch(
              repo.path, branchName, base,
            )
            if (ok) {
              const branch: EpicBranch = {
                id: crypto.randomUUID(),
                epicId,
                repoId: repo.id,
                branchName,
                baseBranch: base,
                status: 'active',
                worktreePath: null,
              }
              await this.branchManager.saveBranchRecord(branch)
            }
          } else {
            // Case 3: Tracking (no branch management)
            const currentBranch = await this.branchManager.getCurrentBranch(repo.path)
            if (currentBranch) {
              const branch: EpicBranch = {
                id: crypto.randomUUID(),
                epicId,
                repoId: repo.id,
                branchName: currentBranch,
                baseBranch: currentBranch,
                status: 'tracking',
                worktreePath: null,
              }
              await this.branchManager.saveBranchRecord(branch)
            }
          }
        }
      }

      // Notify store to reload branches so UI updates
      engineBus.emit('epic:storeSyncNeeded')
    }

    let sessionId: string

    if (!this.orchestratorFactory) {
      throw new Error(`Cannot spawn orchestrator: no factory configured`)
    }

    console.log(`[OrchestratorPool] Using orchestrator factory for epic: ${epicId}`)
    sessionId = await this.orchestratorFactory(epicId, options, epic, repos)
    if (!sessionId) {
      throw new Error(`Orchestrator factory returned empty sessionId for epic ${epicId}`)
    }

    // Register in both maps
    this.epicOrchestrators.set(epicId, sessionId)
    this.sessionOrchestrators.set(sessionId, { epicId, depth: 0 })
    this.epicProjects.set(epicId, options.projectId)

    console.log(`[OrchestratorPool] Epic ${epicId} registered with session: ${sessionId}`)
    return sessionId
  }

  // ── resumeRoot ───────────────────────────────────────────────────────

  /**
   * Attempt to resume a pipeline for an epic from persisted state.
   * Falls back to spawnRoot if no snapshot is available.
   */
  async resumeOrSpawnRoot(
    epicId: string,
    options: OrchestratorOptions,
    epic: Epic,
    repos: ProjectRepo[],
  ): Promise<string> {
    if (this.epicOrchestrators.has(epicId)) {
      throw new Error(`Epic ${epicId} already has an active orchestrator`)
    }

    // Try resume first (only for hybrid pipelines, not read-only)
    const isReadOnly = epic.pipelineType === 'investigate' || epic.pipelineType === 'plan'
    if (this.resumeFactory && epic.pipelineType === 'hybrid' && !isReadOnly) {
      try {
        const sessionId = await this.resumeFactory(epicId, epic, repos)
        if (sessionId) {
          this.epicOrchestrators.set(epicId, sessionId)
          this.sessionOrchestrators.set(sessionId, { epicId, depth: 0 })
          this.epicProjects.set(epicId, options.projectId)
          console.log(`[OrchestratorPool] Epic ${epicId} RESUMED with session: ${sessionId}`)
          return sessionId
        }
      } catch (err) {
        console.warn(`[OrchestratorPool] Resume failed for ${epicId}, falling back to fresh start:`, err)
      }
    }

    return this.spawnRoot(epicId, options, epic, repos)
  }

  // ── registerSubOrchestrator ───────────────────────────────────────────

  registerSubOrchestrator(
    parentSessionId: string,
    childSessionId: string,
    maxDepth: number = DEFAULT_MAX_DEPTH,
  ): void {
    const parent = this.sessionOrchestrators.get(parentSessionId)
    if (!parent) {
      throw new Error(`Parent session ${parentSessionId} not found in pool`)
    }

    if (parent.depth >= maxDepth) {
      throw new Error(
        `Cannot spawn child: parent depth ${parent.depth} >= maxDepth ${maxDepth}`,
      )
    }

    this.sessionOrchestrators.set(childSessionId, {
      epicId: parent.epicId,
      depth: parent.depth + 1,
      parentSessionId,
    })
  }

  // ── Lookups ───────────────────────────────────────────────────────────

  getEpicForSession(sessionId: string): string | null {
    return this.sessionOrchestrators.get(sessionId)?.epicId ?? null
  }

  getSessionsForEpic(epicId: string): string[] {
    const sessions: string[] = []
    for (const [sessionId, meta] of this.sessionOrchestrators) {
      if (meta.epicId === epicId) {
        sessions.push(sessionId)
      }
    }
    return sessions
  }

  // ── removeEpic ────────────────────────────────────────────────────────

  async removeEpic(epicId: string): Promise<void> {
    // Clean up all sessions for this epic
    for (const [sessionId, meta] of this.sessionOrchestrators) {
      if (meta.epicId === epicId) {
        this.sessionOrchestrators.delete(sessionId)
      }
    }
    this.epicOrchestrators.delete(epicId)
    this.epicProjects.delete(epicId)
  }

  // ── Counting & status ─────────────────────────────────────────────────

  activeByProject(projectId: string): number {
    let count = 0
    for (const [epicId] of this.epicOrchestrators) {
      if (this.epicProjects.get(epicId) === projectId) {
        count++
      }
    }
    return count
  }

  totalActive(): number {
    return this.epicOrchestrators.size
  }

  isEpicActive(epicId: string): boolean {
    return this.epicOrchestrators.has(epicId)
  }

  getDepth(sessionId: string): number {
    return this.sessionOrchestrators.get(sessionId)?.depth ?? 0
  }

  canSpawnChild(parentSessionId: string, maxDepth?: number): boolean {
    const parent = this.sessionOrchestrators.get(parentSessionId)
    if (!parent) return false
    return parent.depth < (maxDepth ?? this.maxDepth)
  }

  getChildSessions(parentSessionId: string): string[] {
    const children: string[] = []
    for (const [sessionId, meta] of this.sessionOrchestrators) {
      if (meta.parentSessionId === parentSessionId) {
        children.push(sessionId)
      }
    }
    return children
  }
}
