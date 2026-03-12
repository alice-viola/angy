import type { Epic, EpicBranch, OrchestratorOptions, ProjectRepo } from './KosTypes'
import type { OrchestratorChatPanelAPI } from './Orchestrator'
import { BranchManager } from './BranchManager'

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
  private chatPanel: OrchestratorChatPanelAPI | null = null
  private orchestratorFactory: OrchestratorFactory | null = null
  private resumeFactory: ResumeFactory | null = null
  private maxDepth = DEFAULT_MAX_DEPTH

  private constructor(branchManager: BranchManager) {
    this.branchManager = branchManager
  }

  static getInstance(branchManager?: BranchManager): OrchestratorPool {
    if (!OrchestratorPool.instance) {
      if (!branchManager) {
        throw new Error('BranchManager required for first OrchestratorPool initialization')
      }
      OrchestratorPool.instance = new OrchestratorPool(branchManager)
    }
    return OrchestratorPool.instance
  }

  /** Reset singleton (for testing). */
  static resetInstance(): void {
    OrchestratorPool.instance = null
  }

  setChatPanel(panel: OrchestratorChatPanelAPI): void {
    this.chatPanel = panel
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

    // Prepare repos: checkpoint dirty state, optionally create epic branch
    // Read-only pipelines (investigate, plan) skip repo preparation entirely
    const isReadOnly = epic.pipelineType === 'investigate' || epic.pipelineType === 'plan'
    if (repos.length > 0 && !isReadOnly) {
      for (const repo of repos) {
        await this.branchManager.createCheckpoint(repo.path, epic.title)

        if (epic.useGitBranch) {
          const slug = BranchManager.epicTitleToSlug(epic.title)
          const branchName = `epic/${slug}`
          const ok = await this.branchManager.createAndCheckoutEpicBranch(
            repo.path, branchName, repo.defaultBranch,
          )
          if (ok) {
            const branch: EpicBranch = {
              id: crypto.randomUUID(),
              epicId,
              repoId: repo.id,
              branchName,
              baseBranch: repo.defaultBranch,
              status: 'active',
            }
            await this.branchManager.saveBranchRecord(branch)
          }
        } else {
          const currentBranch = await this.branchManager.getCurrentBranch(repo.path)
          if (currentBranch) {
            const branch: EpicBranch = {
              id: crypto.randomUUID(),
              epicId,
              repoId: repo.id,
              branchName: currentBranch,
              baseBranch: currentBranch,
              status: 'tracking',
            }
            await this.branchManager.saveBranchRecord(branch)
          }
        }
      }
    }

    let sessionId: string

    // Preferred path: use the orchestrator factory to create a full Orchestrator
    // with MCP tool interception, delegation handling, etc.
    if (this.orchestratorFactory) {
      console.log(`[OrchestratorPool] Using orchestrator factory for epic: ${epicId}`)
      sessionId = await this.orchestratorFactory(epicId, options, epic, repos)
      if (!sessionId) {
        throw new Error(`Orchestrator factory returned empty sessionId for epic ${epicId}`)
      }
    } else if (this.chatPanel) {
      // TODO: Legacy code path - verify if still needed
      // Legacy path: create session directly (no MCP handling — limited functionality)
      console.warn(`[OrchestratorPool] Using legacy chatPanel path (no MCP handling) for epic: ${epicId}`)
      sessionId = await this.chatPanel.newChat()
      this.chatPanel.configureSession(sessionId, 'orchestrator', ['specialist-orchestrator'])

      const repoList = repos.map(r => r.name).join(', ')
      const goal =
        `# Epic: ${epic.title}\n\n` +
        `## Description\n${epic.description}\n\n` +
        `## Acceptance Criteria (Definition of Done)\n${epic.acceptanceCriteria}\n\n` +
        `## Target Repos\n${repoList || '(none)'}\n\n` +
        `Implement this epic end-to-end. Start by delegating to an architect to analyze the codebase and design the solution.`

      this.chatPanel.sendMessageToSession(sessionId, goal)
    } else {
      console.error(`[OrchestratorPool] No factory or chatPanel available — cannot spawn orchestrator for epic: ${epicId}`)
      throw new Error(`Cannot spawn orchestrator: no factory or chatPanel configured`)
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
