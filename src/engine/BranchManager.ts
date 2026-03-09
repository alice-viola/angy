import { Command } from '@tauri-apps/plugin-shell'
import type { EpicBranch, ProjectRepo } from './KosTypes'
import type { Database } from './Database'

export class BranchManager {
  constructor(private db: Database) {}

  // ── Git command runner ────────────────────────────────────────────────

  private async runGit(
    repoPath: string,
    args: string[],
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    const cmd = Command.create('git', args, { cwd: repoPath })
    const output = await cmd.execute()
    return { stdout: output.stdout, stderr: output.stderr, code: output.code ?? 1 }
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  async isGitRepo(repoPath: string): Promise<boolean> {
    try {
      const result = await this.runGit(repoPath, ['rev-parse', '--is-inside-work-tree'])
      return result.code === 0 && result.stdout.trim() === 'true'
    } catch {
      return false
    }
  }

  async getCurrentBranch(repoPath: string): Promise<string | null> {
    try {
      const result = await this.runGit(repoPath, ['branch', '--show-current'])
      if (result.code !== 0) return null
      return result.stdout.trim() || null
    } catch {
      return null
    }
  }

  async branchExists(repoPath: string, branchName: string): Promise<boolean> {
    const result = await this.runGit(repoPath, [
      'rev-parse',
      '--verify',
      `refs/heads/${branchName}`,
    ])
    return result.code === 0
  }

  private async isDirty(repoPath: string): Promise<boolean> {
    const result = await this.runGit(repoPath, ['status', '--porcelain'])
    return result.code === 0 && result.stdout.trim().length > 0
  }

  async getRemoteUrl(repoPath: string, remoteName = 'origin'): Promise<string | null> {
    try {
      const result = await this.runGit(repoPath, ['remote', 'get-url', remoteName])
      if (result.code !== 0) return null
      return result.stdout.trim() || null
    } catch {
      return null
    }
  }

  async pushBranch(repoPath: string, branchName: string, remoteName = 'origin'): Promise<boolean> {
    try {
      const result = await this.runGit(repoPath, ['push', '-u', remoteName, branchName])
      if (result.code !== 0) {
        console.warn(`[BranchManager] Failed to push branch ${branchName}: ${result.stderr}`)
        return false
      }
      console.log(`[BranchManager] Pushed branch ${branchName} to ${remoteName}`)
      return true
    } catch (err) {
      console.warn(`[BranchManager] Error pushing branch:`, err)
      return false
    }
  }

  static parseGitHubUrl(remoteUrl: string): { owner: string; repo: string } | null {
    // SSH format: git@github.com:owner/repo.git
    const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/)
    if (sshMatch) {
      return { owner: sshMatch[1], repo: sshMatch[2] }
    }

    // HTTPS format: https://github.com/owner/repo.git
    const httpsMatch = remoteUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/)
    if (httpsMatch) {
      return { owner: httpsMatch[1], repo: httpsMatch[2] }
    }

    return null
  }

  static epicTitleToSlug(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40)
      || 'untitled'
  }

  // ── Safety checkpoint ───────────────────────────────────────────────

  async createCheckpoint(repoPath: string, epicTitle: string): Promise<boolean> {
    if (!(await this.isGitRepo(repoPath))) return false
    if (!(await this.isDirty(repoPath))) return false

    try {
      await this.runGit(repoPath, ['add', '-A'])
      const result = await this.runGit(repoPath, [
        'commit',
        '-m',
        `WIP: checkpoint before "${epicTitle}"`,
      ])
      if (result.code === 0) {
        console.log(`[BranchManager] Checkpoint created in ${repoPath}`)
        return true
      }
      console.warn(`[BranchManager] Checkpoint commit failed in ${repoPath}: ${result.stderr}`)
      return false
    } catch (err) {
      console.warn(`[BranchManager] Checkpoint error in ${repoPath}:`, err)
      return false
    }
  }

  // ── Branch ON operations ────────────────────────────────────────────

  async createAndCheckoutEpicBranch(
    repoPath: string,
    branchName: string,
    baseBranch: string,
  ): Promise<boolean> {
    if (!(await this.isGitRepo(repoPath))) return false

    try {
      const exists = await this.branchExists(repoPath, branchName)
      if (!exists) {
        const create = await this.runGit(repoPath, ['branch', branchName, baseBranch])
        if (create.code !== 0) {
          console.warn(`[BranchManager] Failed to create branch ${branchName}: ${create.stderr}`)
          return false
        }
        console.log(`[BranchManager] Created branch ${branchName} from ${baseBranch}`)
      } else {
        console.log(`[BranchManager] Branch ${branchName} already exists, reusing`)
      }

      const checkout = await this.runGit(repoPath, ['checkout', branchName])
      if (checkout.code !== 0) {
        console.warn(`[BranchManager] Failed to checkout ${branchName}: ${checkout.stderr}`)
        return false
      }
      return true
    } catch (err) {
      console.warn(`[BranchManager] Error in createAndCheckoutEpicBranch:`, err)
      return false
    }
  }

  // ── Branch restoration ──────────────────────────────────────────────

  async commitEpicWork(repoPath: string, epicTitle: string): Promise<boolean> {
    if (!(await this.isGitRepo(repoPath))) return false
    if (!(await this.isDirty(repoPath))) return false

    try {
      await this.runGit(repoPath, ['add', '-A'])
      const result = await this.runGit(repoPath, [
        'commit',
        '-m',
        `epic: ${epicTitle}`,
      ])
      if (result.code === 0) {
        console.log(`[BranchManager] Committed epic work in ${repoPath}`)
        return true
      }
      console.warn(`[BranchManager] Epic work commit failed: ${result.stderr}`)
      return false
    } catch (err) {
      console.warn(`[BranchManager] Error committing epic work:`, err)
      return false
    }
  }

  async restoreBranch(repoPath: string, branchName: string): Promise<boolean> {
    if (!(await this.isGitRepo(repoPath))) return false

    try {
      const result = await this.runGit(repoPath, ['checkout', branchName])
      if (result.code !== 0) {
        console.warn(`[BranchManager] Failed to restore branch ${branchName}: ${result.stderr}`)
        return false
      }
      console.log(`[BranchManager] Restored branch ${branchName} in ${repoPath}`)
      return true
    } catch (err) {
      console.warn(`[BranchManager] Error restoring branch:`, err)
      return false
    }
  }

  // ── DB record management ─────────────────────────────────────────────

  async saveBranchRecord(branch: EpicBranch): Promise<void> {
    await this.db.saveEpicBranch(branch)
  }

  // ── Cleanup ─────────────────────────────────────────────────────────

  async deleteEpicBranches(epicId: string): Promise<void> {
    const branches = await this.db.loadEpicBranches(epicId)

    for (const branch of branches) {
      if (branch.status === 'tracking') continue
      const repo = await this.resolveRepo(branch.repoId)
      if (!repo) continue

      if (await this.isGitRepo(repo.path)) {
        try {
          await this.runGit(repo.path, ['branch', '-D', branch.branchName])
        } catch (err) {
          console.warn(
            `[BranchManager] Error deleting branch in ${repo.name}:`,
            err,
          )
        }
      }
    }

    await this.db.deleteEpicBranches(epicId)
  }

  async getEpicBranches(epicId: string): Promise<EpicBranch[]> {
    return this.db.loadEpicBranches(epicId)
  }

  private async resolveRepo(repoId: string): Promise<ProjectRepo | null> {
    return this.db.loadProjectRepo(repoId)
  }
}
