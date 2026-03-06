import SqlDatabase from '@tauri-apps/plugin-sql';
import { mkdir } from '@tauri-apps/plugin-fs';
import { appDataDir } from '@tauri-apps/api/path';
import { DelegationStatus, type SessionInfo, type MessageRecord, type CheckpointRecord } from './types';

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
    ];

    for (const sql of migrations) {
      try {
        await this.db.execute(sql);
      } catch {
        // Column already exists — safe to ignore
      }
    }
  }

  // ── Sessions ──────────────────────────────────────────────────────────

  async saveSession(info: SessionInfo): Promise<void> {
    if (!this.db) return;

    await this.db.execute(
      `INSERT OR REPLACE INTO sessions
       (session_id, title, workspace, mode, created_at, updated_at, favorite,
        parent_session_id, pipeline_id, pipeline_node_id,
        delegation_task, delegation_status, delegation_result)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
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
      ],
    );
  }

  async loadSessions(): Promise<SessionInfo[]> {
    if (!this.db) return [];

    const rows = await this.db.select<any[]>(
      `SELECT session_id, title, workspace, mode, created_at, updated_at, favorite,
              parent_session_id, pipeline_id, pipeline_node_id,
              delegation_task, delegation_status, delegation_result
       FROM sessions ORDER BY updated_at DESC`,
    );

    return rows.map(this.rowToSessionInfo);
  }

  async loadSession(sessionId: string): Promise<SessionInfo | null> {
    if (!this.db) return null;

    const rows = await this.db.select<any[]>(
      `SELECT session_id, title, workspace, mode, created_at, updated_at, favorite,
              parent_session_id, pipeline_id, pipeline_node_id,
              delegation_task, delegation_status, delegation_result
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
      `INSERT INTO messages (session_id, role, content, tool_name, tool_input, turn_id, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        msg.sessionId,
        msg.role,
        msg.content,
        msg.toolName ?? '',
        msg.toolInput ?? '',
        msg.turnId,
        msg.timestamp,
      ],
    );
  }

  async loadMessages(sessionId: string): Promise<MessageRecord[]> {
    if (!this.db) return [];

    const rows = await this.db.select<any[]>(
      `SELECT id, session_id, role, content, tool_name, tool_input, turn_id, timestamp
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

  // ── Helpers ───────────────────────────────────────────────────────────

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
      pipelineId: r.pipeline_id || undefined,
      pipelineNodeId: r.pipeline_node_id || undefined,
      delegationTask: r.delegation_task || undefined,
      delegationStatus: r.delegation_status as DelegationStatus,
      delegationResult: r.delegation_result || undefined,
    };
  }
}
