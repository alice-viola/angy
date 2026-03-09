import { ref } from 'vue'
import { open } from '@tauri-apps/plugin-shell'
import { useEpicStore } from '@/stores/epics'
import { useProjectsStore } from '@/stores/projects'
import { AngyEngine } from '@/engine/AngyEngine'
import { BranchManager } from '@/engine/BranchManager'

export function useCreatePR() {
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function createPR(epicId: string, projectId: string): Promise<void> {
    loading.value = true
    error.value = null

    try {
      const epicStore = useEpicStore()
      const projectsStore = useProjectsStore()
      const engine = AngyEngine.getInstance()
      const branchManager = engine.branchManager

      // Get epic info
      const epic = epicStore.epicById(epicId)
      if (!epic) {
        throw new Error('Epic not found')
      }

      // Get branches for this epic from DB
      const branches = await branchManager.getEpicBranches(epicId)
      if (branches.length === 0) {
        throw new Error('No branches found for this epic')
      }

      // Get repos for the project
      const repos = projectsStore.reposByProjectId(projectId)

      const activeBranches = branches.filter(b => b.status === 'active')
      if (activeBranches.length === 0) {
        throw new Error('No active branches found for this epic')
      }

      // For each active branch, push and open PR
      for (const branch of activeBranches) {
        const repo = repos.find(r => r.id === branch.repoId)
        if (!repo) {
          console.warn(`[useCreatePR] Repo not found for branch ${branch.branchName} (repoId: ${branch.repoId})`)
          continue
        }

        // Get remote URL
        const remoteUrl = await branchManager.getRemoteUrl(repo.path)
        if (!remoteUrl) {
          throw new Error(`No remote URL found for repo "${repo.name}"`)
        }

        // Parse GitHub URL
        const github = BranchManager.parseGitHubUrl(remoteUrl)
        if (!github) {
          throw new Error(`Remote is not a GitHub repository: ${remoteUrl}`)
        }

        // Push the branch
        const pushed = await branchManager.pushBranch(repo.path, branch.branchName)
        if (!pushed) {
          throw new Error(`Failed to push branch "${branch.branchName}" to remote`)
        }

        // Construct PR URL and open in browser
        const title = encodeURIComponent(epic.title)
        const body = encodeURIComponent(epic.description || '')
        const prUrl = `https://github.com/${github.owner}/${github.repo}/compare/${branch.baseBranch}...${branch.branchName}?expand=1&title=${title}&body=${body}`

        await open(prUrl)
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to create PR'
    } finally {
      loading.value = false
    }
  }

  return { loading, error, createPR }
}
