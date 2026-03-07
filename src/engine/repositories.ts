/**
 * Repository interfaces — decouple Scheduler and engine from Pinia stores.
 *
 * The engine uses these interfaces to access epic/project data.
 * Two implementations:
 *   1. DatabaseEpicRepository / DatabaseProjectRepository — for headless mode
 *   2. Pinia stores can implement these interfaces for the UI layer
 */

import type { Epic, EpicColumn, Project, ProjectRepo } from './KosTypes';
import type { Database } from './Database';

// ── Interfaces ───────────────────────────────────────────────────────────

export interface EpicRepository {
  listEpics(projectId?: string): Epic[];
  getEpic(id: string): Epic | null;
  saveEpic(epic: Epic): Promise<void>;
  moveEpic(id: string, column: EpicColumn): Promise<void>;
  updateEpic(id: string, updates: Partial<Epic>): Promise<void>;
  deleteEpic(id: string): Promise<void>;
  incrementRejection(id: string): Promise<void>;
  /** Reload all epics from the database. */
  reload(projectId?: string): Promise<void>;
}

export interface ProjectRepository {
  listProjects(): Project[];
  getProject(id: string): Project | null;
  listRepos(projectId: string): ProjectRepo[];
  getRepo(id: string): ProjectRepo | null;
  reposByProjectId(projectId: string): ProjectRepo[];
  /** Reload all projects/repos from the database. */
  reload(): Promise<void>;
}

// ── Database-backed implementations (for headless / engine-only mode) ────

export class DatabaseEpicRepository implements EpicRepository {
  private epics: Epic[] = [];
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async reload(projectId?: string): Promise<void> {
    this.epics = await this.db.loadEpics(projectId);
  }

  listEpics(projectId?: string): Epic[] {
    if (projectId) {
      return this.epics.filter(e => e.projectId === projectId);
    }
    return this.epics;
  }

  getEpic(id: string): Epic | null {
    return this.epics.find(e => e.id === id) ?? null;
  }

  async saveEpic(epic: Epic): Promise<void> {
    await this.db.saveEpic(epic);
    // Update in-memory cache
    const idx = this.epics.findIndex(e => e.id === epic.id);
    if (idx >= 0) {
      this.epics[idx] = epic;
    } else {
      this.epics.push(epic);
    }
  }

  async moveEpic(id: string, column: EpicColumn): Promise<void> {
    const epic = this.getEpic(id);
    if (!epic) return;

    if (column === 'todo' && epic.column === 'backlog') {
      epic.rejectionCount = 0;
    }
    epic.column = column;
    epic.updatedAt = new Date().toISOString();
    if (column === 'in-progress' && !epic.startedAt) {
      epic.startedAt = new Date().toISOString();
    }
    if (column === 'done' && !epic.completedAt) {
      epic.completedAt = new Date().toISOString();
    }

    await this.db.saveEpic(epic);
  }

  async updateEpic(id: string, updates: Partial<Epic>): Promise<void> {
    const epic = this.getEpic(id);
    if (!epic) return;

    Object.assign(epic, updates, { updatedAt: new Date().toISOString() });
    await this.db.saveEpic(epic);
  }

  async deleteEpic(id: string): Promise<void> {
    await this.db.deleteEpic(id);
    this.epics = this.epics.filter(e => e.id !== id);
  }

  async incrementRejection(id: string): Promise<void> {
    const epic = this.getEpic(id);
    if (!epic) return;

    epic.rejectionCount++;
    epic.updatedAt = new Date().toISOString();
    await this.db.saveEpic(epic);
  }
}

export class DatabaseProjectRepository implements ProjectRepository {
  private projects: Project[] = [];
  private repos: ProjectRepo[] = [];
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async reload(): Promise<void> {
    this.projects = await this.db.loadProjects();
    // Load repos for all projects
    this.repos = [];
    for (const p of this.projects) {
      const pRepos = await this.db.loadProjectRepos(p.id);
      this.repos.push(...pRepos);
    }
  }

  listProjects(): Project[] {
    return this.projects;
  }

  getProject(id: string): Project | null {
    return this.projects.find(p => p.id === id) ?? null;
  }

  listRepos(projectId: string): ProjectRepo[] {
    return this.repos.filter(r => r.projectId === projectId);
  }

  getRepo(id: string): ProjectRepo | null {
    return this.repos.find(r => r.id === id) ?? null;
  }

  reposByProjectId(projectId: string): ProjectRepo[] {
    return this.repos.filter(r => r.projectId === projectId);
  }
}
