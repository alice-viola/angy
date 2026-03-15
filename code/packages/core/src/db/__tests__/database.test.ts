import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { DatabaseImpl } from '../database.js';

let db: DatabaseImpl | null = null;
let tmpPath: string | null = null;

afterEach(() => {
  db?.close();
  db = null;
  if (tmpPath && fs.existsSync(tmpPath)) {
    fs.unlinkSync(tmpPath);
  }
  tmpPath = null;
});

function createTmpDb(): DatabaseImpl {
  tmpPath = path.join(os.tmpdir(), `angycode-test-${Date.now()}.db`);
  db = new DatabaseImpl(tmpPath);
  return db;
}

describe('DatabaseImpl', () => {
  it('creates and opens a database', () => {
    const d = createTmpDb();
    expect(d.db).toBeDefined();
  });

  it('enables WAL mode', () => {
    const d = createTmpDb();
    const mode = d.db.pragma('journal_mode', { simple: true });
    expect(mode).toBe('wal');
  });

  it('creates all required tables', () => {
    const d = createTmpDb();
    const tables = d.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('sessions');
    expect(names).toContain('messages');
    expect(names).toContain('tool_executions');
    expect(names).toContain('usage');
  });

  it('sessions table has correct columns', () => {
    const d = createTmpDb();
    const cols = d.db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[];
    const colNames = cols.map((c) => c.name);
    expect(colNames).toEqual(
      expect.arrayContaining([
        'id', 'goal', 'provider', 'model', 'status', 'working_dir', 'created_at', 'updated_at',
      ]),
    );
  });

  it('messages table has correct columns', () => {
    const d = createTmpDb();
    const cols = d.db.prepare('PRAGMA table_info(messages)').all() as { name: string }[];
    const colNames = cols.map((c) => c.name);
    expect(colNames).toEqual(
      expect.arrayContaining(['id', 'session_id', 'role', 'content', 'created_at']),
    );
  });

  it('closes cleanly', () => {
    const d = createTmpDb();
    d.close();
    // After close, attempting to query should throw
    expect(() => d.db.prepare('SELECT 1')).toThrow();
    db = null; // prevent double close in afterEach
  });
});
