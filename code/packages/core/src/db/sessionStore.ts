import { nanoid } from 'nanoid';
import type BetterSqlite3 from 'better-sqlite3';
import type { Session, ProviderName } from '../types.js';

interface SessionRow {
  id: string;
  goal: string;
  provider: string;
  model: string;
  status: string;
  working_dir: string;
  system_prompt: string | null;
  turn_count: number;
  created_at: number;
  updated_at: number;
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    goal: row.goal,
    provider: row.provider as ProviderName,
    model: row.model,
    status: row.status as Session['status'],
    workingDir: row.working_dir,
    systemPrompt: row.system_prompt ?? undefined,
    turnCount: row.turn_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface SessionStore {
  createSession(session: Omit<Session, 'createdAt' | 'updatedAt' | 'turnCount'> & { systemPrompt?: string }): Session;
  getSession(id: string): Session | null;
  updateSession(id: string, updates: Partial<Pick<Session, 'status' | 'updatedAt'>>): Session;
  listSessions(limit?: number): Session[];
  incrementTurnCount(id: string): void;
}

export function createSessionStore(db: BetterSqlite3.Database): SessionStore {
  const insertStmt = db.prepare(`
    INSERT INTO sessions (id, goal, provider, model, status, working_dir, system_prompt, turn_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `);

  const getStmt = db.prepare('SELECT * FROM sessions WHERE id = ?');

  const listStmt = db.prepare('SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?');

  const incrementTurnStmt = db.prepare('UPDATE sessions SET turn_count = turn_count + 1, updated_at = ? WHERE id = ?');

  return {
    createSession(session) {
      const now = Date.now();
      const id = session.id || nanoid();
      insertStmt.run(
        id,
        session.goal,
        session.provider,
        session.model,
        session.status,
        session.workingDir,
        session.systemPrompt ?? null,
        now,
        now,
      );
      return rowToSession(getStmt.get(id) as SessionRow);
    },

    getSession(id) {
      const row = getStmt.get(id) as SessionRow | undefined;
      return row ? rowToSession(row) : null;
    },

    updateSession(id, updates) {
      const existing = getStmt.get(id) as SessionRow | undefined;
      if (!existing) throw new Error(`Session not found: ${id}`);

      const updatedAt = updates.updatedAt ?? Date.now();
      const status = updates.status ?? existing.status;

      db.prepare('UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?').run(
        status,
        updatedAt,
        id,
      );
      return rowToSession(getStmt.get(id) as SessionRow);
    },

    listSessions(limit = 100) {
      const rows = listStmt.all(limit) as SessionRow[];
      return rows.map(rowToSession);
    },

    incrementTurnCount(id) {
      incrementTurnStmt.run(Date.now(), id);
    },
  };
}
