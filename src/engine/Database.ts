import SqlDatabase from '@tauri-apps/plugin-sql';
import { mkdir } from '@tauri-apps/plugin-fs';
import { appDataDir } from '@tauri-apps/api/path';
import { DelegationStatus, type SessionInfo, type MessageRecord, type CheckpointRecord, type PipelineSnapshot } from './types';
import type { Project, ProjectRepo, Epic, EpicColumn, EpicBranch, SchedulerConfig, SchedulerAction, ActivityLogEntry, ActivityLogLevel } from './KosTypes';
import type { GlobalSummary, CostByDay, ModelUsage, SessionsByMode, EpicThroughput, ComplexityStats, ProjectCostSummary, EpicAnalyticsDetail } from './AnalyticsTypes';

export class Database {
  private db: SqlDatabase | null = null;
  private openPromise: Promise<boolean> | null = null;

  // ── Open / Close ──────────────────────────────────────────────────────

  async open(path?: string): Promise<boolean> {
    if (this.db) return true;
    if (this.openPromise) return this.openPromise;
    this.openPromise = this._doOpen(path);
    const result = await this.openPromise;
    this.openPromise = null;
    return result;
  }

  private async _doOpen(path?: string): Promise<boolean> {
    if (!path) {
      // Tauri SQL plugin resolves sqlite: paths relative to the app data directory.
      // Ensure the directory exists before opening.
      try { await mkdir(await appDataDir(), { recursive: true }); } catch { /* exists */ }
      path = 'sqlite:history.db';
    }
    try {
      this.db = await SqlDatabase.load(path);
      await this.createTables();
      return true;
    } catch (err) {
      console.error('[Database] Failed to open:', err);
      return false;
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }

  // ── Schema ────────────────────────────────────────────────────────────

  private async createTables(): Promise<void> {
    if (!this.db) return;

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        title TEXT,
        workspace TEXT,
        mode TEXT,
        created_at INTEGER,
        updated_at INTEGER
      )
    `);

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT REFERENCES sessions(session_id),
        role TEXT,
        content TEXT,
        tool_name TEXT,
        tool_input TEXT,
        tool_id TEXT,
        turn_id INTEGER,
        timestamp INTEGER
      )
    `);

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        session_id TEXT NOT NULL REFERENCES sessions(session_id),
        turn_id INTEGER NOT NULL,
        uuid TEXT NOT NULL,
        timestamp INTEGER,
        PRIMARY KEY (session_id, turn_id)
      )
    `);

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS file_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT REFERENCES sessions(session_id),
        file_path TEXT NOT NULL,
        change_type TEXT NOT NULL,
        lines_added INTEGER DEFAULT 0,
        lines_removed INTEGER DEFAULT 0,
        turn_id INTEGER NOT NULL,
        timestamp INTEGER
      )
    `);

    // Drop legacy snapshots table if it exists
    await this.db.execute('DROP TABLE IF EXISTS snapshots');

    // Migrations — add columns introduced after initial schema
    // SQLite ALTER TABLE ADD COLUMN is idempotent-safe (errors if exists, we catch)
    const migrations = [
      'ALTER TABLE sessions ADD COLUMN favorite INTEGER DEFAULT 0',
      'ALTER TABLE sessions ADD COLUMN parent_session_id TEXT DEFAULT \'\'',
      'ALTER TABLE sessions ADD COLUMN pipeline_id TEXT DEFAULT \'\'',
      'ALTER TABLE sessions ADD COLUMN pipeline_node_id TEXT DEFAULT \'\'',
      'ALTER TABLE sessions ADD COLUMN delegation_task TEXT DEFAULT \'\'',
      'ALTER TABLE sessions ADD COLUMN delegation_status INTEGER DEFAULT 0',
      'ALTER TABLE sessions ADD COLUMN delegation_result TEXT DEFAULT \'\'',
      'ALTER TABLE sessions ADD COLUMN epic_id TEXT DEFAULT \'\'',
      'ALTER TABLE sessions ADD COLUMN claude_session_id TEXT DEFAULT \'\'',
      'ALTER TABLE messages ADD COLUMN tool_id TEXT DEFAULT \'\'',
    ];

    for (const sql of migrations) {
      try {
        await this.db.execute(sql);
      } catch {
        // Column already exists — safe to ignore
      }
    }

    // ── Epic Tables ─────────────────────────────────────────────────────

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    // Migration: add color column to projects
    try {
      await this.db.execute(`ALTER TABLE projects ADD COLUMN color TEXT DEFAULT ''`);
    } catch { /* column already exists */ }

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS project_repos (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        path TEXT NOT NULL,
        name TEXT NOT NULL,
        default_branch TEXT DEFAULT 'main',
        is_primary INTEGER DEFAULT 0
      )
    `);

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS epics (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        acceptance_criteria TEXT DEFAULT '',
        "column" TEXT NOT NULL DEFAULT 'idea',
        priority_hint TEXT DEFAULT 'medium',
        complexity TEXT DEFAULT 'medium',
        model TEXT DEFAULT '',
        depends_on TEXT DEFAULT '[]',
        target_repos TEXT DEFAULT '[]',
        rejection_count INTEGER DEFAULT 0,
        rejection_feedback TEXT DEFAULT '',
        computed_score REAL DEFAULT 0,
        root_session_id TEXT DEFAULT NULL,
        cost_total REAL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT DEFAULT NULL,
        completed_at TEXT DEFAULT NULL
      )
    `);

    // Migration: add model column to existing databases
    try {
      await this.db.execute(`ALTER TABLE epics ADD COLUMN model TEXT DEFAULT ''`);
    } catch { /* column already exists */ }

    // Migration: add use_git_branch column to existing databases
    try {
      await this.db.execute(`ALTER TABLE epics ADD COLUMN use_git_branch INTEGER DEFAULT 1`);
    } catch { /* column already exists */ }

    // Migration: add attempt artifact columns
    try {
      await this.db.execute(`ALTER TABLE epics ADD COLUMN last_attempt_files TEXT DEFAULT '[]'`);
    } catch { /* column already exists */ }
    try {
      await this.db.execute(`ALTER TABLE epics ADD COLUMN last_validation_results TEXT DEFAULT '[]'`);
    } catch { /* column already exists */ }
    try {
      await this.db.execute(`ALTER TABLE epics ADD COLUMN last_architect_plan TEXT DEFAULT ''`);
    } catch { /* column already exists */ }
    try {
      await this.db.execute(`ALTER TABLE epics ADD COLUMN pipeline_type TEXT DEFAULT 'hybrid'`);
    } catch { /* column already exists */ }
    try {
      await this.db.execute(`ALTER TABLE epics ADD COLUMN suspended_at TEXT DEFAULT NULL`);
    } catch { /* column already exists */ }
    try {
      await this.db.execute(`ALTER TABLE epics ADD COLUMN run_after TEXT DEFAULT NULL`);
    } catch { /* column already exists */ }
    try {
      await this.db.execute(`ALTER TABLE epics ADD COLUMN use_worktree INTEGER DEFAULT 0`);
    } catch { /* column already exists */ }
    try {
      await this.db.execute(`ALTER TABLE epics ADD COLUMN base_branch TEXT DEFAULT NULL`);
    } catch { /* column already exists */ }
    try {
      await this.db.execute(`ALTER TABLE epics ADD COLUMN parallel_agent_count INTEGER DEFAULT 1`);
    } catch { /* column already exists */ }

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS epic_branches (
        id TEXT PRIMARY KEY,
        epic_id TEXT NOT NULL,
        repo_id TEXT NOT NULL,
        branch_name TEXT NOT NULL,
        base_branch TEXT DEFAULT 'main',
        status TEXT DEFAULT 'active',
        created_at TEXT NOT NULL
      )
    `);

    // Migration: add worktree_path to epic_branches
    try {
      await this.db.execute(`ALTER TABLE epic_branches ADD COLUMN worktree_path TEXT DEFAULT NULL`);
    } catch { /* column already exists */ }

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS scheduler_config (
        id TEXT PRIMARY KEY DEFAULT 'default',
        max_concurrent_epics INTEGER DEFAULT 3,
        max_concurrent_per_project INTEGER DEFAULT 0,
        tick_interval_ms INTEGER DEFAULT 30000,
        auto_schedule INTEGER DEFAULT 1,
        daily_cost_budget REAL DEFAULT 50.0,
        weight_manual REAL DEFAULT 0.4,
        weight_dependency_depth REAL DEFAULT 0.2,
        weight_age REAL DEFAULT 0.15,
        weight_complexity REAL DEFAULT 0.15,
        weight_rejection REAL DEFAULT 0.1
      )
    `);

    // Migration: add max_concurrent_per_project column
    try {
      await this.db.execute(`ALTER TABLE scheduler_config ADD COLUMN max_concurrent_per_project INTEGER DEFAULT 0`);
    } catch { /* column already exists */ }

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS scheduler_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        action TEXT NOT NULL,
        epic_id TEXT,
        details TEXT DEFAULT ''
      )
    `);

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS cost_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        epic_id TEXT DEFAULT '',
        cost_usd REAL NOT NULL,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        timestamp TEXT NOT NULL
      )
    `);

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        epic_id TEXT DEFAULT NULL,
        session_id TEXT DEFAULT NULL,
        level TEXT NOT NULL DEFAULT 'info',
        message TEXT NOT NULL,
        timestamp TEXT NOT NULL
      )
    `);

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS pipeline_state (
        epic_id TEXT PRIMARY KEY,
        phase TEXT NOT NULL,
        sub_phase TEXT DEFAULT '',
        goal TEXT NOT NULL,
        acceptance_criteria TEXT NOT NULL,
        architect_context TEXT DEFAULT '',
        design_plan TEXT DEFAULT '',
        todo_queue TEXT DEFAULT '[]',
        finalize_cycle INTEGER DEFAULT 0,
        replans_remaining INTEGER DEFAULT 3,
        architect_claude_session_id TEXT DEFAULT '',
        counterpart_claude_session_id TEXT DEFAULT '',
        child_outputs TEXT DEFAULT '[]',
        complexity TEXT NOT NULL,
        model TEXT DEFAULT '',
        workspace TEXT NOT NULL,
        auto_profiles TEXT DEFAULT '[]',
        updated_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    try {
      await this.db!.execute(`
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);
    } catch { /* table already exists */ }
  }

  // ── App Settings ───────────────────────────────────────────────────────

  async getAppSetting(key: string): Promise<string | null> {
    if (!this.db) return null;
    const rows = await this.db.select<{ value: string }[]>(
      'SELECT value FROM app_settings WHERE key = $1',
      [key]
    );
    return rows.length > 0 ? rows[0].value : null;
  }

  async setAppSetting(key: string, value: string): Promise<void> {
    if (!this.db) return;
    await this.db.execute(
      'INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value]
    );
  }

  // ── Sessions ──────────────────────────────────────────────────────────

  async saveSession(info: SessionInfo): Promise<void> {
    if (!this.db) return;

    await this.db.execute(
      `INSERT OR REPLACE INTO sessions
       (session_id, title, workspace, mode, created_at, updated_at, favorite,
        parent_session_id, pipeline_id, pipeline_node_id,
        delegation_task, delegation_status, delegation_result, epic_id,
        claude_session_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        info.sessionId,
        info.title,
        info.workspace,
        info.mode,
        info.createdAt,
        info.updatedAt,
        info.favorite ? 1 : 0,
        info.parentSessionId ?? '',
        info.pipelineId ?? '',
        info.pipelineNodeId ?? '',
        info.delegationTask ?? '',
        info.delegationStatus,
        info.delegationResult ?? '',
        info.epicId ?? '',
        info.claudeSessionId ?? '',
      ],
    );
  }

  async loadSessions(workspace?: string): Promise<SessionInfo[]> {
    if (!this.db) return [];

    const query = workspace
      ? `SELECT session_id, title, workspace, mode, created_at, updated_at, favorite,
                parent_session_id, pipeline_id, pipeline_node_id,
                delegation_task, delegation_status, delegation_result, epic_id,
                claude_session_id
         FROM sessions WHERE workspace = $1 ORDER BY updated_at DESC`
      : `SELECT session_id, title, workspace, mode, created_at, updated_at, favorite,
                parent_session_id, pipeline_id, pipeline_node_id,
                delegation_task, delegation_status, delegation_result, epic_id,
                claude_session_id
         FROM sessions ORDER BY updated_at DESC`;

    const rows = await this.db.select<any[]>(query, workspace ? [workspace] : []);

    return rows.map(this.rowToSessionInfo);
  }

  async loadSession(sessionId: string): Promise<SessionInfo | null> {
    if (!this.db) return null;

    const rows = await this.db.select<any[]>(
      `SELECT session_id, title, workspace, mode, created_at, updated_at, favorite,
              parent_session_id, pipeline_id, pipeline_node_id,
              delegation_task, delegation_status, delegation_result, epic_id,
              claude_session_id
       FROM sessions WHERE session_id = $1 LIMIT 1`,
      [sessionId],
    );

    return rows.length > 0 ? this.rowToSessionInfo(rows[0]) : null;
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (!this.db) return;

    await this.db.execute('DELETE FROM messages WHERE session_id = $1', [sessionId]);
    await this.db.execute('DELETE FROM checkpoints WHERE session_id = $1', [sessionId]);
    await this.db.execute('DELETE FROM file_changes WHERE session_id = $1', [sessionId]);
    await this.db.execute('DELETE FROM sessions WHERE session_id = $1', [sessionId]);
  }

  async deleteStalePendingSessions(): Promise<void> {
    if (!this.db) return;

    await this.db.execute("DELETE FROM messages WHERE session_id LIKE 'pending-%'");
    await this.db.execute("DELETE FROM checkpoints WHERE session_id LIKE 'pending-%'");
    await this.db.execute("DELETE FROM sessions WHERE session_id LIKE 'pending-%'");
  }

  // ── Messages ──────────────────────────────────────────────────────────

  async saveMessage(msg: MessageRecord): Promise<void> {
    if (!this.db) return;

    await this.db.execute(
      `INSERT INTO messages (session_id, role, content, tool_name, tool_input, tool_id, turn_id, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        msg.sessionId,
        msg.role,
        msg.content,
        msg.toolName ?? '',
        msg.toolInput ?? '',
        msg.toolId ?? '',
        msg.turnId,
        msg.timestamp,
      ],
    );
  }

  async upsertMessage(msg: MessageRecord): Promise<number> {
    if (!this.db) throw new Error('Database not open');

    if (msg.id == null) {
      const result = await this.db.execute(
        `INSERT INTO messages (session_id, role, content, tool_name, tool_input, tool_id, turn_id, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          msg.sessionId,
          msg.role,
          msg.content,
          msg.toolName ?? '',
          msg.toolInput ?? '',
          msg.toolId ?? '',
          msg.turnId,
          msg.timestamp,
        ],
      );
      return result.lastInsertId as number;
    }

    await this.db.execute(
      `UPDATE messages SET content = $1 WHERE id = $2`,
      [msg.content, msg.id],
    );
    return msg.id;
  }

  async loadMessages(sessionId: string): Promise<MessageRecord[]> {
    if (!this.db) return [];

    const rows = await this.db.select<any[]>(
      `SELECT id, session_id, role, content, tool_name, tool_input, tool_id, turn_id, timestamp
       FROM messages WHERE session_id = $1 ORDER BY id ASC`,
      [sessionId],
    );

    return rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      role: r.role,
      content: r.content,
      toolName: r.tool_name,
      toolInput: r.tool_input,
      ...(r.tool_id ? { toolId: r.tool_id } : {}),
      turnId: r.turn_id,
      timestamp: r.timestamp,
    }));
  }

  async turnCountForSession(sessionId: string): Promise<number> {
    if (!this.db) return 0;

    const rows = await this.db.select<any[]>(
      'SELECT COALESCE(MAX(turn_id), 0) as max_turn FROM messages WHERE session_id = $1',
      [sessionId],
    );

    return rows.length > 0 ? rows[0].max_turn : 0;
  }

  async turnCountsForSessions(sessionIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (!this.db || sessionIds.length === 0) return result;

    const placeholders = sessionIds.map((_, i) => `$${i + 1}`).join(',');
    const rows = await this.db.select<any[]>(
      `SELECT session_id, COALESCE(MAX(turn_id), 0) as max_turn
       FROM messages WHERE session_id IN (${placeholders}) GROUP BY session_id`,
      sessionIds,
    );

    for (const r of rows) {
      result.set(r.session_id, r.max_turn);
    }
    return result;
  }

  async deleteMessagesFromTurn(sessionId: string, fromTurnId: number): Promise<void> {
    if (!this.db) return;
    await this.db.execute(
      'DELETE FROM messages WHERE session_id = $1 AND turn_id >= $2',
      [sessionId, fromTurnId],
    );
    await this.db.execute(
      'DELETE FROM checkpoints WHERE session_id = $1 AND turn_id >= $2',
      [sessionId, fromTurnId],
    );
    await this.db.execute(
      'DELETE FROM file_changes WHERE session_id = $1 AND turn_id >= $2',
      [sessionId, fromTurnId],
    );
  }

  async updateMessageSessionId(oldSessionId: string, newSessionId: string): Promise<void> {
    if (!this.db) return;

    await this.db.execute(
      'UPDATE messages SET session_id = $1 WHERE session_id = $2',
      [newSessionId, oldSessionId],
    );
    await this.db.execute(
      'UPDATE checkpoints SET session_id = $1 WHERE session_id = $2',
      [newSessionId, oldSessionId],
    );
    await this.db.execute(
      'UPDATE sessions SET session_id = $1 WHERE session_id = $2',
      [newSessionId, oldSessionId],
    );
  }

  // ── Checkpoints ───────────────────────────────────────────────────────

  async saveCheckpoint(cp: CheckpointRecord): Promise<void> {
    if (!this.db) return;

    await this.db.execute(
      `INSERT OR REPLACE INTO checkpoints (session_id, turn_id, uuid, timestamp)
       VALUES ($1, $2, $3, $4)`,
      [cp.sessionId, cp.turnId, cp.uuid, cp.timestamp],
    );
  }

  async loadCheckpoints(sessionId: string): Promise<CheckpointRecord[]> {
    if (!this.db) return [];

    const rows = await this.db.select<any[]>(
      `SELECT session_id, turn_id, uuid, timestamp
       FROM checkpoints WHERE session_id = $1 ORDER BY turn_id ASC`,
      [sessionId],
    );

    return rows.map((r) => ({
      sessionId: r.session_id,
      turnId: r.turn_id,
      uuid: r.uuid,
      timestamp: r.timestamp,
    }));
  }

  async checkpointUuid(sessionId: string, turnId: number): Promise<string> {
    if (!this.db) return '';

    const rows = await this.db.select<any[]>(
      'SELECT uuid FROM checkpoints WHERE session_id = $1 AND turn_id = $2',
      [sessionId, turnId],
    );

    return rows.length > 0 ? rows[0].uuid : '';
  }

  async latestCheckpointBefore(sessionId: string, turnId: number): Promise<string> {
    if (!this.db) return '';

    const rows = await this.db.select<any[]>(
      'SELECT uuid FROM checkpoints WHERE session_id = $1 AND turn_id < $2 ORDER BY turn_id DESC LIMIT 1',
      [sessionId, turnId],
    );

    return rows.length > 0 ? rows[0].uuid : '';
  }

  // ── File Changes ──────────────────────────────────────────────────────

  async saveFileChange(sessionId: string, filePath: string, changeType: string, linesAdded: number, linesRemoved: number, turnId: number): Promise<void> {
    if (!this.db) return;

    await this.db.execute(
      `INSERT INTO file_changes (session_id, file_path, change_type, lines_added, lines_removed, turn_id, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [sessionId, filePath, changeType, linesAdded, linesRemoved, turnId, Math.floor(Date.now() / 1000)],
    );
  }

  async loadFileChanges(sessionId: string): Promise<Array<{ filePath: string; changeType: string; linesAdded: number; linesRemoved: number; turnId: number }>> {
    if (!this.db) return [];

    const rows = await this.db.select<any[]>(
      `SELECT file_path, change_type, lines_added, lines_removed, turn_id
       FROM file_changes WHERE session_id = $1 ORDER BY id ASC`,
      [sessionId],
    );

    return rows.map((r) => ({
      filePath: r.file_path,
      changeType: r.change_type,
      linesAdded: r.lines_added,
      linesRemoved: r.lines_removed,
      turnId: r.turn_id,
    }));
  }

  // ── Workspaces ──────────────────────────────────────────────────────

  async getDistinctWorkspaces(): Promise<string[]> {
    if (!this.db) return [];

    const rows = await this.db.select<any[]>(
      `SELECT workspace, MAX(updated_at) as last_used
       FROM sessions
       WHERE workspace IS NOT NULL AND workspace != ''
       GROUP BY workspace
       ORDER BY last_used DESC`,
    );

    return rows.map(r => r.workspace);
  }

  // ── Projects ─────────────────────────────────────────────────────────

  async saveProject(project: Project): Promise<void> {
    if (!this.db) return;

    await this.db.execute(
      `INSERT OR REPLACE INTO projects (id, name, description, color, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [project.id, project.name, project.description, project.color || '', project.createdAt, project.updatedAt],
    );
  }

  async loadProjects(): Promise<Project[]> {
    if (!this.db) return [];

    const rows = await this.db.select<any[]>(
      'SELECT id, name, description, color, created_at, updated_at FROM projects ORDER BY updated_at DESC',
    );

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      color: r.color || '',
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async loadProject(id: string): Promise<Project | null> {
    if (!this.db) return null;

    const rows = await this.db.select<any[]>(
      'SELECT id, name, description, color, created_at, updated_at FROM projects WHERE id = $1 LIMIT 1',
      [id],
    );

    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      color: r.color || '',
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async deleteProject(id: string): Promise<void> {
    if (!this.db) return;

    await this.db.execute(
      'DELETE FROM epic_branches WHERE epic_id IN (SELECT id FROM epics WHERE project_id = $1)',
      [id],
    );
    await this.db.execute('DELETE FROM epics WHERE project_id = $1', [id]);
    await this.db.execute('DELETE FROM project_repos WHERE project_id = $1', [id]);
    await this.db.execute('DELETE FROM projects WHERE id = $1', [id]);
  }

  // ── Project Repos ───────────────────────────────────────────────────

  async saveProjectRepo(repo: ProjectRepo & { projectId: string }): Promise<void> {
    if (!this.db) return;

    await this.db.execute(
      `INSERT OR REPLACE INTO project_repos (id, project_id, path, name, default_branch)
       VALUES ($1, $2, $3, $4, $5)`,
      [repo.id, repo.projectId, repo.path, repo.name, repo.defaultBranch],
    );
  }

  async loadProjectRepos(projectId: string): Promise<ProjectRepo[]> {
    if (!this.db) return [];

    const rows = await this.db.select<any[]>(
      'SELECT id, project_id, path, name, default_branch FROM project_repos WHERE project_id = $1',
      [projectId],
    );

    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      path: r.path,
      name: r.name,
      defaultBranch: r.default_branch,
    }));
  }

  async loadProjectRepo(repoId: string): Promise<ProjectRepo | null> {
    if (!this.db) return null;

    const rows = await this.db.select<any[]>(
      'SELECT id, project_id, path, name, default_branch FROM project_repos WHERE id = $1 LIMIT 1',
      [repoId],
    );

    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      projectId: r.project_id,
      path: r.path,
      name: r.name,
      defaultBranch: r.default_branch,
    };
  }

  async deleteProjectRepo(repoId: string): Promise<void> {
    if (!this.db) return;

    await this.db.execute('DELETE FROM project_repos WHERE id = $1', [repoId]);
  }

  // ── Epics ───────────────────────────────────────────────────────────

  async saveEpic(epic: Epic): Promise<void> {
    if (!this.db) return;

    await this.db.execute(
      `INSERT OR REPLACE INTO epics
       (id, project_id, title, description, acceptance_criteria, "column", priority_hint,
        complexity, model, depends_on, target_repos, pipeline_type, use_git_branch, use_worktree, base_branch,
        rejection_count, rejection_feedback,
        last_attempt_files, last_validation_results, last_architect_plan,
        computed_score, root_session_id, cost_total, created_at, updated_at, started_at, completed_at, suspended_at, run_after,
        parallel_agent_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30)`,
      [
        epic.id,
        epic.projectId,
        epic.title,
        epic.description,
        epic.acceptanceCriteria,
        epic.column,
        epic.priorityHint,
        epic.complexity,
        epic.model || '',
        JSON.stringify(epic.dependsOn),
        JSON.stringify(epic.targetRepoIds),
        epic.pipelineType || 'hybrid',
        epic.useGitBranch ? 1 : 0,
        epic.useWorktree ? 1 : 0,
        epic.baseBranch ?? null,
        epic.rejectionCount,
        epic.rejectionFeedback,
        JSON.stringify(epic.lastAttemptFiles ?? []),
        JSON.stringify(epic.lastValidationResults ?? []),
        epic.lastArchitectPlan ?? '',
        epic.computedScore,
        epic.rootSessionId,
        epic.costTotal ?? 0,
        epic.createdAt,
        epic.updatedAt,
        epic.startedAt,
        epic.completedAt,
        epic.suspendedAt,
        epic.runAfter ?? null,
        epic.parallelAgentCount ?? 1,
      ],
    );
  }

  async loadEpics(projectId?: string): Promise<Epic[]> {
    if (!this.db) return [];

    let sql = 'SELECT * FROM epics';
    const params: any[] = [];
    if (projectId) {
      sql += ' WHERE project_id = $1';
      params.push(projectId);
    }
    sql += ' ORDER BY updated_at DESC';

    const rows = await this.db.select<any[]>(sql, params);
    return rows.map(this.rowToEpic);
  }

  async loadEpic(id: string): Promise<Epic | null> {
    if (!this.db) return null;

    const rows = await this.db.select<any[]>(
      'SELECT * FROM epics WHERE id = $1 LIMIT 1',
      [id],
    );

    return rows.length > 0 ? this.rowToEpic(rows[0]) : null;
  }

  async updateEpicColumn(id: string, column: EpicColumn): Promise<void> {
    if (!this.db) return;

    await this.db.execute(
      'UPDATE epics SET "column" = $1, updated_at = $2 WHERE id = $3',
      [column, new Date().toISOString(), id],
    );
  }

  async deleteEpic(id: string): Promise<void> {
    if (!this.db) return;

    await this.db.execute('DELETE FROM epic_branches WHERE epic_id = $1', [id]);
    await this.db.execute('DELETE FROM epics WHERE id = $1', [id]);
  }

  // ── Epic Branches ───────────────────────────────────────────────────

  async saveEpicBranch(branch: EpicBranch): Promise<void> {
    if (!this.db) return;

    await this.db.execute(
      `INSERT OR REPLACE INTO epic_branches (id, epic_id, repo_id, branch_name, base_branch, status, created_at, worktree_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [branch.id, branch.epicId, branch.repoId, branch.branchName, branch.baseBranch, branch.status, new Date().toISOString(), branch.worktreePath ?? null],
    );
  }

  async loadEpicBranches(epicId: string): Promise<EpicBranch[]> {
    if (!this.db) return [];

    const rows = await this.db.select<any[]>(
      'SELECT id, epic_id, repo_id, branch_name, base_branch, status, worktree_path FROM epic_branches WHERE epic_id = $1',
      [epicId],
    );

    return rows.map((r) => ({
      id: r.id,
      epicId: r.epic_id,
      repoId: r.repo_id,
      branchName: r.branch_name,
      baseBranch: r.base_branch,
      status: r.status,
      worktreePath: r.worktree_path || null,
    }));
  }

  async loadAllEpicBranches(): Promise<EpicBranch[]> {
    if (!this.db) return [];

    const rows = await this.db.select<any[]>(
      'SELECT id, epic_id, repo_id, branch_name, base_branch, status, worktree_path FROM epic_branches',
    );

    return rows.map((r) => ({
      id: r.id,
      epicId: r.epic_id,
      repoId: r.repo_id,
      branchName: r.branch_name,
      baseBranch: r.base_branch,
      status: r.status,
      worktreePath: r.worktree_path || null,
    }));
  }

  async deleteEpicBranches(epicId: string): Promise<void> {
    if (!this.db) return;

    await this.db.execute('DELETE FROM epic_branches WHERE epic_id = $1', [epicId]);
  }

  // ── Scheduler ───────────────────────────────────────────────────────

  async loadSchedulerConfig(): Promise<SchedulerConfig> {
    const defaults: SchedulerConfig = {
      enabled: true,
      tickIntervalMs: 30000,
      maxConcurrentEpics: 3,
      dailyCostBudget: 50.0,
      weights: {
        manualHint: 0.4,
        dependencyDepth: 0.2,
        age: 0.15,
        complexity: 0.15,
        rejectionPenalty: 0.1,
      },
    };
    if (!this.db) return defaults;

    const rows = await this.db.select<any[]>(
      'SELECT * FROM scheduler_config WHERE id = $1 LIMIT 1',
      ['default'],
    );
    if (rows.length === 0) return defaults;

    const r = rows[0];
    return {
      enabled: r.auto_schedule !== 0,
      tickIntervalMs: r.tick_interval_ms,
      maxConcurrentEpics: r.max_concurrent_epics,
      maxConcurrentPerProject: r.max_concurrent_per_project || undefined,
      dailyCostBudget: r.daily_cost_budget,
      weights: {
        manualHint: r.weight_manual,
        dependencyDepth: r.weight_dependency_depth,
        age: r.weight_age,
        complexity: r.weight_complexity,
        rejectionPenalty: r.weight_rejection,
      },
    };
  }

  async saveSchedulerConfig(config: SchedulerConfig): Promise<void> {
    if (!this.db) return;

    await this.db.execute(
      `INSERT OR REPLACE INTO scheduler_config
       (id, max_concurrent_epics, max_concurrent_per_project, tick_interval_ms, auto_schedule, daily_cost_budget,
        weight_manual, weight_dependency_depth, weight_age, weight_complexity, weight_rejection)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        'default',
        config.maxConcurrentEpics,
        config.maxConcurrentPerProject ?? 0,
        config.tickIntervalMs,
        config.enabled ? 1 : 0,
        config.dailyCostBudget,
        config.weights.manualHint,
        config.weights.dependencyDepth,
        config.weights.age,
        config.weights.complexity,
        config.weights.rejectionPenalty,
      ],
    );
  }

  async appendSchedulerLog(action: SchedulerAction): Promise<void> {
    if (!this.db) return;

    await this.db.execute(
      `INSERT INTO scheduler_log (timestamp, action, epic_id, details)
       VALUES ($1, $2, $3, $4)`,
      [action.timestamp, action.type, action.epicId, action.details],
    );
  }

  async loadSchedulerLog(limit: number = 100): Promise<SchedulerAction[]> {
    if (!this.db) return [];

    const rows = await this.db.select<any[]>(
      'SELECT timestamp, action, epic_id, details FROM scheduler_log ORDER BY id DESC LIMIT $1',
      [limit],
    );

    return rows.map((r) => ({
      type: r.action,
      epicId: r.epic_id,
      timestamp: r.timestamp,
      details: r.details,
    }));
  }

  // ── Cost Log ────────────────────────────────────────────────────────

  async saveCostEntry(entry: { sessionId: string; epicId: string; costUsd: number; inputTokens: number; outputTokens: number; timestamp: string }): Promise<void> {
    if (!this.db) return;

    await this.db.execute(
      `INSERT INTO cost_log (session_id, epic_id, cost_usd, input_tokens, output_tokens, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [entry.sessionId, entry.epicId, entry.costUsd, entry.inputTokens, entry.outputTokens, entry.timestamp],
    );
  }

  async totalCostSince(since: string): Promise<number> {
    if (!this.db) return 0;

    const rows = await this.db.select<[{ total: number | null }]>(
      'SELECT SUM(cost_usd) as total FROM cost_log WHERE timestamp >= $1',
      [since],
    );

    return rows[0]?.total ?? 0;
  }

  // ── Pipeline State (crash recovery) ─────────────────────────────────

  async savePipelineState(state: PipelineSnapshot): Promise<void> {
    if (!this.db) return;

    await this.db.execute(
      `INSERT OR REPLACE INTO pipeline_state
       (epic_id, phase, sub_phase, goal, acceptance_criteria, architect_context,
        design_plan, todo_queue, finalize_cycle, replans_remaining,
        architect_claude_session_id, counterpart_claude_session_id,
        child_outputs, complexity, model, workspace, auto_profiles,
        updated_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
      [
        state.epicId,
        state.phase,
        state.subPhase,
        state.goal,
        state.acceptanceCriteria,
        state.architectContext,
        state.designPlan,
        JSON.stringify(state.todoQueue),
        state.finalizeCycle,
        state.replansRemaining,
        state.architectClaudeSessionId ?? '',
        state.counterpartClaudeSessionId ?? '',
        JSON.stringify(state.childOutputs),
        state.complexity,
        state.model,
        state.workspace,
        state.autoProfiles,
        state.updatedAt,
        state.createdAt,
      ],
    );
  }

  async loadPipelineState(epicId: string): Promise<PipelineSnapshot | null> {
    if (!this.db) return null;

    const rows = await this.db.select<any[]>(
      'SELECT * FROM pipeline_state WHERE epic_id = $1 LIMIT 1',
      [epicId],
    );

    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      epicId: r.epic_id,
      phase: r.phase,
      subPhase: r.sub_phase || '',
      goal: r.goal,
      acceptanceCriteria: r.acceptance_criteria,
      architectContext: r.architect_context || '',
      designPlan: r.design_plan || '',
      todoQueue: JSON.parse(r.todo_queue || '[]'),
      finalizeCycle: r.finalize_cycle ?? 0,
      replansRemaining: r.replans_remaining ?? 3,
      architectClaudeSessionId: r.architect_claude_session_id || null,
      counterpartClaudeSessionId: r.counterpart_claude_session_id || null,
      childOutputs: JSON.parse(r.child_outputs || '[]'),
      complexity: r.complexity,
      model: r.model || '',
      workspace: r.workspace,
      autoProfiles: r.auto_profiles || '[]',
      updatedAt: r.updated_at,
      createdAt: r.created_at,
    };
  }

  async deletePipelineState(epicId: string): Promise<void> {
    if (!this.db) return;
    await this.db.execute('DELETE FROM pipeline_state WHERE epic_id = $1', [epicId]);
  }

  async listRecoverablePipelines(): Promise<PipelineSnapshot[]> {
    if (!this.db) return [];

    const rows = await this.db.select<any[]>(
      `SELECT * FROM pipeline_state WHERE phase NOT IN ('completed', 'failed', 'cancelled') ORDER BY updated_at DESC`,
    );

    return rows.map((r) => ({
      epicId: r.epic_id,
      phase: r.phase,
      subPhase: r.sub_phase || '',
      goal: r.goal,
      acceptanceCriteria: r.acceptance_criteria,
      architectContext: r.architect_context || '',
      designPlan: r.design_plan || '',
      todoQueue: JSON.parse(r.todo_queue || '[]'),
      finalizeCycle: r.finalize_cycle ?? 0,
      replansRemaining: r.replans_remaining ?? 3,
      architectClaudeSessionId: r.architect_claude_session_id || null,
      counterpartClaudeSessionId: r.counterpart_claude_session_id || null,
      childOutputs: JSON.parse(r.child_outputs || '[]'),
      complexity: r.complexity,
      model: r.model || '',
      workspace: r.workspace,
      autoProfiles: r.auto_profiles || '[]',
      updatedAt: r.updated_at,
      createdAt: r.created_at,
    }));
  }

  // ── Activity Log ────────────────────────────────────────────────────

  async appendActivityLog(entry: Omit<ActivityLogEntry, 'id'>): Promise<void> {
    if (!this.db) return;

    await this.db.execute(
      `INSERT INTO activity_log (project_id, epic_id, session_id, level, message, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [entry.projectId, entry.epicId ?? null, entry.sessionId ?? null, entry.level, entry.message, entry.timestamp],
    );
  }

  async loadActivityLog(limit: number = 200): Promise<ActivityLogEntry[]> {
    if (!this.db) return [];

    const rows = await this.db.select<any[]>(
      'SELECT id, project_id, epic_id, session_id, level, message, timestamp FROM activity_log ORDER BY id DESC LIMIT $1',
      [limit],
    );

    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      epicId: r.epic_id || null,
      sessionId: r.session_id || null,
      level: r.level as ActivityLogLevel,
      message: r.message,
      timestamp: r.timestamp,
    }));
  }

  // ── Analytics ──────────────────────────────────────────────────────────

  async getAnalyticsGlobalSummary(days: number, projectId: string | null): Promise<GlobalSummary> {
    const empty: GlobalSummary = { total_cost_usd: 0, total_input_tokens: 0, total_output_tokens: 0, total_sessions: 0, total_epics: 0, total_projects: 0, completed_epics: 0, active_epics: 0 }
    if (!this.db) return empty
    const params: (string | number)[] = [days]
    // cost_log.session_id stores Claude session IDs; join via sessions.claude_session_id
    const costProjJoin = projectId
      ? `JOIN sessions _s ON _s.claude_session_id = c.session_id JOIN epics _e ON _e.id = _s.epic_id AND _e.project_id = $2`
      : ''
    const epicProjWhere = projectId ? `AND project_id = $2` : ''
    if (projectId) params.push(projectId)
    const rows = await this.db.select<GlobalSummary[]>(`
      SELECT
        COALESCE((SELECT SUM(c.cost_usd) FROM cost_log c ${costProjJoin} WHERE c.timestamp >= DATE('now', '-' || $1 || ' days')), 0) AS total_cost_usd,
        COALESCE((SELECT SUM(c.input_tokens) FROM cost_log c ${costProjJoin} WHERE c.timestamp >= DATE('now', '-' || $1 || ' days')), 0) AS total_input_tokens,
        COALESCE((SELECT SUM(c.output_tokens) FROM cost_log c ${costProjJoin} WHERE c.timestamp >= DATE('now', '-' || $1 || ' days')), 0) AS total_output_tokens,
        COALESCE((SELECT COUNT(*) FROM sessions WHERE created_at >= CAST(strftime('%s','now') AS INTEGER) - $1 * 86400), 0) AS total_sessions,
        COALESCE((SELECT COUNT(*) FROM epics WHERE created_at >= DATE('now', '-' || $1 || ' days') ${epicProjWhere}), 0) AS total_epics,
        COALESCE((SELECT COUNT(DISTINCT project_id) FROM epics WHERE created_at >= DATE('now', '-' || $1 || ' days') ${epicProjWhere}), 0) AS total_projects,
        COALESCE((SELECT COUNT(*) FROM epics WHERE "column" = 'done' AND created_at >= DATE('now', '-' || $1 || ' days') ${epicProjWhere}), 0) AS completed_epics,
        COALESCE((SELECT COUNT(*) FROM epics WHERE "column" NOT IN ('done','discarded') AND created_at >= DATE('now', '-' || $1 || ' days') ${epicProjWhere}), 0) AS active_epics
    `, params)
    return rows[0] ?? empty
  }

  async getAnalyticsCostByDay(days: number, projectId: string | null): Promise<CostByDay[]> {
    if (!this.db) return []
    const params: (string | number)[] = [days]
    // Join through sessions.claude_session_id for project filtering
    let fromClause = 'FROM cost_log c'
    let projWhere = ''
    if (projectId) {
      fromClause = 'FROM cost_log c JOIN sessions s ON s.claude_session_id = c.session_id JOIN epics e ON e.id = s.epic_id'
      projWhere = `AND e.project_id = $2`
      params.push(projectId)
    }
    return this.db.select<CostByDay[]>(`
      SELECT
        DATE(c.timestamp) AS day,
        SUM(c.cost_usd) AS cost_usd,
        SUM(c.input_tokens) AS input_tokens,
        SUM(c.output_tokens) AS output_tokens
      ${fromClause}
      WHERE c.timestamp >= DATE('now', '-' || $1 || ' days') ${projWhere}
      GROUP BY day
      ORDER BY day ASC
    `, params)
  }

  async getAnalyticsModelUsage(days: number, projectId: string | null): Promise<ModelUsage[]> {
    if (!this.db) return []
    const params: (string | number)[] = [days]
    const projWhere = projectId ? `AND e.project_id = $2` : ''
    if (projectId) params.push(projectId)
    // Join cost through sessions.claude_session_id -> sessions.epic_id
    return this.db.select<ModelUsage[]>(`
      SELECT
        e.model,
        COUNT(DISTINCT e.id) AS epic_count,
        COALESCE(SUM(costs.cost_usd), 0) AS cost_usd,
        COALESCE(SUM(costs.total_tokens), 0) AS total_tokens
      FROM epics e
      LEFT JOIN (
        SELECT s.epic_id, SUM(c.cost_usd) AS cost_usd, SUM(c.input_tokens + c.output_tokens) AS total_tokens
        FROM cost_log c
        JOIN sessions s ON s.claude_session_id = c.session_id
        WHERE c.timestamp >= DATE('now', '-' || $1 || ' days')
        GROUP BY s.epic_id
      ) costs ON costs.epic_id = e.id
      WHERE e.model IS NOT NULL AND e.model != ''
        AND e.created_at >= DATE('now', '-' || $1 || ' days')
        ${projWhere}
      GROUP BY e.model
      ORDER BY cost_usd DESC
    `, params)
  }

  async getAnalyticsSessionsByMode(days: number): Promise<SessionsByMode[]> {
    if (!this.db) return []
    // Join cost via sessions.claude_session_id
    return this.db.select<SessionsByMode[]>(`
      SELECT
        s.mode,
        COUNT(*) AS session_count,
        COALESCE(SUM(c.cost_usd), 0) AS total_cost_usd
      FROM sessions s
      LEFT JOIN (
        SELECT session_id, SUM(cost_usd) AS cost_usd
        FROM cost_log
        WHERE timestamp >= DATE('now', '-' || $1 || ' days')
        GROUP BY session_id
      ) c ON c.session_id = s.claude_session_id
      WHERE s.created_at >= CAST(strftime('%s','now') AS INTEGER) - $1 * 86400
      GROUP BY s.mode
      ORDER BY session_count DESC
    `, [days])
  }

  async getAnalyticsEpicThroughput(days: number, projectId: string | null): Promise<EpicThroughput[]> {
    if (!this.db) return []
    const params: (string | number)[] = [days]
    const projWhere = projectId ? `AND project_id = $2` : ''
    if (projectId) params.push(projectId)
    return this.db.select<EpicThroughput[]>(`
      SELECT
        strftime('%Y-%W', created_at) AS week,
        COUNT(*) AS started,
        SUM(CASE WHEN "column" = 'done' THEN 1 ELSE 0 END) AS completed
      FROM epics
      WHERE created_at >= DATE('now', '-' || $1 || ' days') ${projWhere}
      GROUP BY week
      ORDER BY week ASC
    `, params)
  }

  async getAnalyticsComplexityStats(days: number, projectId: string | null): Promise<ComplexityStats[]> {
    if (!this.db) return []
    const params: (string | number)[] = [days]
    const projWhere = projectId ? `AND e.project_id = $2` : ''
    if (projectId) params.push(projectId)
    // Join cost through sessions.claude_session_id -> sessions.epic_id
    return this.db.select<ComplexityStats[]>(`
      SELECT
        complexity,
        COUNT(*) AS epic_count,
        AVG(COALESCE(costs.total_cost, 0)) AS avg_cost_usd,
        AVG(
          CASE WHEN "column" = 'done' AND completed_at IS NOT NULL
          THEN (julianday(completed_at) - julianday(created_at)) * 24
          ELSE NULL END
        ) AS avg_duration_hours,
        CAST(SUM(CASE WHEN "column" = 'done' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) AS completion_rate
      FROM epics e
      LEFT JOIN (
        SELECT s.epic_id, SUM(c.cost_usd) AS total_cost
        FROM cost_log c
        JOIN sessions s ON s.claude_session_id = c.session_id
        WHERE c.timestamp >= DATE('now', '-' || $1 || ' days')
        GROUP BY s.epic_id
      ) costs ON costs.epic_id = e.id
      WHERE complexity IS NOT NULL AND complexity != ''
        AND e.created_at >= DATE('now', '-' || $1 || ' days')
        ${projWhere}
      GROUP BY complexity
      ORDER BY epic_count DESC
    `, params)
  }

  async getAnalyticsProjectSummaries(days: number): Promise<ProjectCostSummary[]> {
    if (!this.db) return []
    // Join cost through sessions.claude_session_id -> sessions.epic_id
    return this.db.select<ProjectCostSummary[]>(`
      SELECT
        p.id AS project_id,
        p.name AS project_name,
        p.color AS project_color,
        COALESCE(SUM(costs.cost_usd), 0) AS total_cost_usd,
        COUNT(DISTINCT e.id) AS epic_count,
        SUM(CASE WHEN e."column" = 'done' THEN 1 ELSE 0 END) AS completed_epics
      FROM projects p
      LEFT JOIN epics e ON e.project_id = p.id
      LEFT JOIN (
        SELECT s.epic_id, SUM(c.cost_usd) AS cost_usd
        FROM cost_log c
        JOIN sessions s ON s.claude_session_id = c.session_id
        WHERE c.timestamp >= DATE('now', '-' || $1 || ' days')
        GROUP BY s.epic_id
      ) costs ON costs.epic_id = e.id
      GROUP BY p.id
      ORDER BY total_cost_usd DESC
    `, [days])
  }

  async getAnalyticsEpicsDetail(projectId: string | null, limit: number, offset: number, days: number): Promise<EpicAnalyticsDetail[]> {
    if (!this.db) return []
    const params: (string | number)[] = [days, limit, offset]
    const projWhere = projectId ? `AND e.project_id = $4` : ''
    if (projectId) params.push(projectId)
    // Join cost through sessions.claude_session_id -> sessions.epic_id
    return this.db.select<EpicAnalyticsDetail[]>(`
      SELECT
        e.id,
        e.title,
        e.project_id,
        p.name AS project_name,
        e."column" AS status,
        e.complexity,
        COALESCE(costs.total_cost_usd, 0) AS total_cost_usd,
        COALESCE(costs.input_tokens, 0) AS input_tokens,
        COALESCE(costs.output_tokens, 0) AS output_tokens,
        e.created_at,
        e.completed_at,
        CASE WHEN e.completed_at IS NOT NULL
          THEN (julianday(e.completed_at) - julianday(e.created_at)) * 24
          ELSE NULL
        END AS duration_hours
      FROM epics e
      LEFT JOIN projects p ON p.id = e.project_id
      LEFT JOIN (
        SELECT s.epic_id,
          SUM(c.cost_usd) AS total_cost_usd,
          SUM(c.input_tokens) AS input_tokens,
          SUM(c.output_tokens) AS output_tokens
        FROM cost_log c
        JOIN sessions s ON s.claude_session_id = c.session_id
        WHERE c.timestamp >= DATE('now', '-' || $1 || ' days')
        GROUP BY s.epic_id
      ) costs ON costs.epic_id = e.id
      WHERE e.created_at >= DATE('now', '-' || $1 || ' days') ${projWhere}
      ORDER BY e.created_at DESC
      LIMIT $2 OFFSET $3
    `, params)
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private rowToEpic(r: any): Epic {
    return {
      id: r.id,
      projectId: r.project_id,
      title: r.title,
      description: r.description,
      acceptanceCriteria: r.acceptance_criteria,
      column: r.column as EpicColumn,
      priorityHint: r.priority_hint,
      complexity: r.complexity,
      model: r.model || '',
      dependsOn: JSON.parse(r.depends_on || '[]'),
      targetRepoIds: JSON.parse(r.target_repos || '[]'),
      pipelineType: r.pipeline_type || 'hybrid',
      useGitBranch: Boolean(r.use_git_branch ?? 1),
      useWorktree: Boolean(r.use_worktree ?? 0),
      baseBranch: r.base_branch || null,
      rejectionCount: r.rejection_count,
      rejectionFeedback: r.rejection_feedback ?? '',
      lastAttemptFiles: JSON.parse(r.last_attempt_files || '[]'),
      lastValidationResults: JSON.parse(r.last_validation_results || '[]'),
      lastArchitectPlan: r.last_architect_plan || '',
      computedScore: r.computed_score ?? 0,
      rootSessionId: r.root_session_id || null,
      costTotal: r.cost_total ?? 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      startedAt: r.started_at || null,
      completedAt: r.completed_at || null,
      suspendedAt: r.suspended_at || null,
      runAfter: r.run_after || null,
      parallelAgentCount: r.parallel_agent_count ?? 1,
    };
  }

  private rowToSessionInfo(r: any): SessionInfo {
    return {
      sessionId: r.session_id,
      title: r.title,
      workspace: r.workspace,
      mode: r.mode,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      favorite: r.favorite !== 0,
      parentSessionId: r.parent_session_id || undefined,
      epicId: r.epic_id || undefined,
      pipelineId: r.pipeline_id || undefined,
      pipelineNodeId: r.pipeline_node_id || undefined,
      delegationTask: r.delegation_task || undefined,
      delegationStatus: r.delegation_status as DelegationStatus,
      delegationResult: r.delegation_result || undefined,
      claudeSessionId: r.claude_session_id || undefined,
    };
  }
}
