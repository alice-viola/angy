import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Project, ProjectRepo } from '@/engine/KosTypes';
import { PROJECT_COLORS } from '@/engine/KosTypes';
import { getDatabase } from './sessions';
import { broadcastSync } from '@/engine/WindowSync';

export const useProjectsStore = defineStore('projects', () => {
  // ── State ──────────────────────────────────────────────────────────
  const projects = ref<Project[]>([]);
  const repos = ref<ProjectRepo[]>([]);
  const loading = ref(false);

  // ── Getters ────────────────────────────────────────────────────────
  const projectById = computed(() => {
    return (id: string) => projects.value.find((p) => p.id === id);
  });

  const projectCount = computed(() => projects.value.length);

  const reposByProjectId = computed(() => {
    return (projectId: string) => repos.value.filter((r) => r.projectId === projectId);
  });

  // ── Actions ────────────────────────────────────────────────────────

  async function loadAll() {
    loading.value = true;
    try {
      const db = getDatabase();
      // Ensure database is open before querying
      const isOpen = await db.open();
      if (!isOpen) {
        console.error('[ProjectsStore] Database not open, cannot load projects');
        return;
      }
      const loadedProjects = await db.loadProjects();
      console.log('[ProjectsStore] Loaded', loadedProjects.length, 'projects from DB');
      const loadedRepos = (await Promise.all(
        loadedProjects.map((p) => db.loadProjectRepos(p.id))
      )).flat();
      projects.value = loadedProjects;
      repos.value = loadedRepos;
    } catch (err) {
      console.error('[ProjectsStore] Failed to load projects:', err);
    } finally {
      loading.value = false;
    }
  }

  function nextColor(): string {
    const usedColors = new Set(projects.value.map(p => p.color));
    return PROJECT_COLORS.find(c => !usedColors.has(c)) ?? PROJECT_COLORS[projects.value.length % PROJECT_COLORS.length];
  }

  async function createProject(name: string, description?: string): Promise<Project> {
    const now = new Date().toISOString();
    const project: Project = {
      id: crypto.randomUUID(),
      name,
      description: description ?? '',
      color: nextColor(),
      createdAt: now,
      updatedAt: now,
    };

    const db = getDatabase();
    await db.saveProject(project);
    projects.value.push(project);
    broadcastSync('projects');
    return project;
  }

  async function updateProject(id: string, updates: Partial<Pick<Project, 'name' | 'description' | 'color'>>) {
    const project = projects.value.find((p) => p.id === id);
    if (!project) return;

    if (updates.name !== undefined) project.name = updates.name;
    if (updates.description !== undefined) project.description = updates.description;
    if (updates.color !== undefined) project.color = updates.color;
    project.updatedAt = new Date().toISOString();

    const db = getDatabase();
    await db.saveProject(project);
    broadcastSync('projects');
  }

  async function deleteProject(id: string) {
    const db = getDatabase();
    await db.deleteProject(id);

    // Remove associated repos from state
    repos.value = repos.value.filter((r) => r.projectId !== id);
    projects.value = projects.value.filter((p) => p.id !== id);
    broadcastSync('projects');
  }

  async function addRepo(projectId: string, repo: Omit<ProjectRepo, 'id'>): Promise<ProjectRepo> {
    const fullRepo: ProjectRepo = {
      ...repo,
      id: crypto.randomUUID(),
    };

    const db = getDatabase();
    await db.saveProjectRepo(fullRepo);
    repos.value.push(fullRepo);

    // Touch parent project timestamp
    const project = projects.value.find((p) => p.id === projectId);
    if (project) {
      project.updatedAt = new Date().toISOString();
      await db.saveProject(project);
    }

    broadcastSync('projects');
    return fullRepo;
  }

  async function removeRepo(projectId: string, repoId: string) {
    const db = getDatabase();
    await db.deleteProjectRepo(repoId);
    repos.value = repos.value.filter((r) => r.id !== repoId);

    // Touch parent project timestamp
    const project = projects.value.find((p) => p.id === projectId);
    if (project) {
      project.updatedAt = new Date().toISOString();
      await db.saveProject(project);
    }

    broadcastSync('projects');
  }

  async function initialize() {
    await loadAll();
    // Auto-assign colors to projects that don't have one
    for (const project of projects.value) {
      if (!project.color) {
        project.color = nextColor();
        const db = getDatabase();
        await db.saveProject(project);
      }
    }
  }

  return {
    // State
    projects,
    repos,
    loading,
    // Getters
    projectById,
    projectCount,
    reposByProjectId,
    // Actions
    loadAll,
    createProject,
    updateProject,
    deleteProject,
    addRepo,
    removeRepo,
    initialize,
  };
});
