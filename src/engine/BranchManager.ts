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

  // ── Branch operations ─────────────────────────────────────────────────

  async createEpicBranches(
    epicId: string,
    repos: ProjectRepo[],
  ): Promise<EpicBranch[]> {
    const branches: EpicBranch[] = []
    const branchName = `epic/${epicId}`

    for (const repo of repos) {
      if (!(await this.isGitRepo(repo.path))) {
        console.warn(`[BranchManager] Skipping non-git repo: ${repo.path}`)
        continue
      }

      try {
        const result = await this.runGit(repo.path, [
          'branch',
          branchName,
          repo.defaultBranch,
        ])
        if (result.code !== 0) {
          console.warn(
            `[BranchManager] Failed to create branch ${branchName} in ${repo.name}: ${result.stderr}`,
          )
          continue
        }

        const branch: EpicBranch = {
          id: crypto.randomUUID(),
          epicId,
          repoId: repo.id,
          branchName,
          baseBranch: repo.defaultBranch,
          status: 'active',
        }

        await this.db.saveEpicBranch(branch)
        branches.push(branch)
      } catch (err) {
        console.warn(
          `[BranchManager] Error creating branch in ${repo.name}:`,
          err,
        )
      }
    }

    return branches
  }

  async checkoutEpicBranches(epicId: string): Promise<void> {
    const branches = await this.db.loadEpicBranches(epicId)

    for (const branch of branches) {
      const repo = await this.resolveRepo(branch.repoId)
      if (!repo) continue

      if (!(await this.isGitRepo(repo.path))) {
        console.warn(`[BranchManager] Skipping checkout for non-git repo: ${repo.path}`)
        continue
      }

      try {
        const result = await this.runGit(repo.path, [
          'checkout',
          branch.branchName,
        ])
        if (result.code !== 0) {
          console.warn(
            `[BranchManager] Failed to checkout ${branch.branchName} in ${repo.name}: ${result.stderr}`,
          )
        }
      } catch (err) {
        console.warn(
          `[BranchManager] Error checking out branch in ${repo.name}:`,
          err,
        )
      }
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

  async mergeEpicBranches(
    epicId: string,
  ): Promise<{ success: boolean; conflicts: string[] }> {
    const branches = await this.db.loadEpicBranches(epicId)
    const conflicts: string[] = []

    for (const branch of branches) {
      const repo = await this.resolveRepo(branch.repoId)
      if (!repo) continue

      if (!(await this.isGitRepo(repo.path))) {
        console.warn(`[BranchManager] Skipping merge for non-git repo: ${repo.path}`)
        continue
      }

      // Checkout default branch
      let result = await this.runGit(repo.path, [
        'checkout',
        branch.baseBranch,
      ])
      if (result.code !== 0) {
        conflicts.push(`${repo.name}: failed to checkout ${branch.baseBranch}`)
        continue
      }

      // Squash merge the epic branch
      result = await this.runGit(repo.path, [
        'merge',
        '--squash',
        branch.branchName,
      ])
      if (result.code !== 0) {
        conflicts.push(`${repo.name}: merge conflict on ${branch.branchName}`)
        // Abort the failed merge
        await this.runGit(repo.path, ['merge', '--abort'])
        continue
      }

      // Commit the squash merge
      result = await this.runGit(repo.path, [
        'commit',
        '-m',
        `merge epic ${epicId} from ${branch.branchName}`,
      ])
      if (result.code !== 0) {
        conflicts.push(`${repo.name}: commit failed after merge`)
        continue
      }

      // Update branch status
      branch.status = 'merged'
      await this.db.saveEpicBranch(branch)
    }

    return { success: conflicts.length === 0, conflicts }
  }

  async deleteEpicBranches(epicId: string): Promise<void> {
    const branches = await this.db.loadEpicBranches(epicId)

    for (const branch of branches) {
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
      } else {
        console.warn(`[BranchManager] Skipping git branch delete for non-git repo: ${repo.path}`)
      }
    }

    // Always delete DB records regardless of git status
    await this.db.deleteEpicBranches(epicId)
  }

  async getEpicBranches(epicId: string): Promise<EpicBranch[]> {
    return this.db.loadEpicBranches(epicId)
  }

  private async resolveRepo(repoId: string): Promise<ProjectRepo | null> {
    return this.db.loadProjectRepo(repoId)
  }
}
