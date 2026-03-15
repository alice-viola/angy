import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import BetterSqlite3 from 'better-sqlite3';

// Shared temp DB path so we can pre-populate and the command reads the same DB
let tmpPath: string;

vi.mock('@angycode/core', async () => {
  const actual = await vi.importActual<typeof import('@angycode/core')>('@angycode/core');
  return {
    ...actual,
    DatabaseImpl: class extends actual.DatabaseImpl {
      constructor() {
        super(tmpPath);
      }
    },
  };
});

import { sessionsCommand } from '../commands/sessions.js';
import { DatabaseImpl, createSessionStore } from '@angycode/core';

describe('sessionsCommand', () => {
  let output: string;
  let setupDb: DatabaseImpl;

  beforeEach(() => {
    tmpPath = path.join(os.tmpdir(), `angy-sess-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    // Pre-create the DB so it has tables
    setupDb = new DatabaseImpl(tmpPath) as unknown as DatabaseImpl;
    output = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try { setupDb.close(); } catch {}
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  });

  it('shows "No sessions" when empty', () => {
    setupDb.close(); // close so command can open it
    sessionsCommand({});
    expect(output).toContain('No sessions');
  });

  it('lists sessions', () => {
    const store = createSessionStore(setupDb.db);
    store.createSession({
      id: 'sess-abc-123',
      goal: 'test goal',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      status: 'done',
      workingDir: '/tmp',
    });
    setupDb.close(); // close so command can open it

    sessionsCommand({});
    expect(output).toContain('sess-abc');
    expect(output).toContain('test goal');
    expect(output).toContain('done');
  });

  it('outputs JSON when --json', () => {
    const store = createSessionStore(setupDb.db);
    store.createSession({
      id: 'sess-json-1',
      goal: 'json test',
      provider: 'anthropic',
      model: 'test',
      status: 'running',
      workingDir: '/tmp',
    });
    setupDb.close();

    sessionsCommand({ json: true });
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].id).toBe('sess-json-1');
  });
});
