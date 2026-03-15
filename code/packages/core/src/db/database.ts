import BetterSqlite3 from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import type { Database as IDatabase } from '../types.js';

const DEFAULT_DB_DIR = path.join(os.homedir(), '.angycode');
const DEFAULT_DB_PATH = path.join(DEFAULT_DB_DIR, 'angycode.db');

const MIGRATIONS = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  goal TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  working_dir TEXT NOT NULL,
  system_prompt TEXT,
  turn_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  turn_index INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, turn_index);

CREATE TABLE IF NOT EXISTS tool_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  tool_name TEXT NOT NULL,
  input TEXT NOT NULL,
  output TEXT,
  is_error INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd REAL,
  created_at INTEGER NOT NULL
);
`;

export class DatabaseImpl implements IDatabase {
  readonly db: BetterSqlite3.Database;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath ?? DEFAULT_DB_PATH;

    // Create directory if using default path and it doesn't exist
    if (!dbPath) {
      fs.mkdirSync(DEFAULT_DB_DIR, { recursive: true });
    }

    this.db = new BetterSqlite3(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(MIGRATIONS);
  }

  close(): void {
    this.db.close();
  }
}
