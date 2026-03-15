import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { DatabaseImpl } from '../database.js';
import { createSessionStore, type SessionStore } from '../sessionStore.js';

let db: DatabaseImpl;
let store: SessionStore;
let tmpPath: string;

beforeEach(() => {
  tmpPath = path.join(os.tmpdir(), `angycode-session-test-${Date.now()}.db`);
  db = new DatabaseImpl(tmpPath);
  store = createSessionStore(db.db);
});

afterEach(() => {
  db.close();
  if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
});

describe('SessionStore', () => {
  it('creates a session with timestamps', () => {
    const session = store.createSession({
      id: 'sess-1',
      goal: 'fix the bug',
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      status: 'running',
      workingDir: '/tmp/project',
    });
    expect(session.id).toBe('sess-1');
    expect(session.goal).toBe('fix the bug');
    expect(session.provider).toBe('anthropic');
    expect(session.status).toBe('running');
    expect(session.workingDir).toBe('/tmp/project');
    expect(session.createdAt).toBeGreaterThan(0);
    expect(session.updatedAt).toBeGreaterThan(0);
  });

  it('retrieves a session by id', () => {
    store.createSession({
      id: 'sess-2',
      goal: 'add feature',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      status: 'running',
      workingDir: '/tmp',
    });
    const session = store.getSession('sess-2');
    expect(session).not.toBeNull();
    expect(session!.goal).toBe('add feature');
    expect(session!.provider).toBe('gemini');
  });

  it('returns null for non-existent session', () => {
    expect(store.getSession('nope')).toBeNull();
  });

  it('updates session status', () => {
    store.createSession({
      id: 'sess-3',
      goal: 'test',
      provider: 'anthropic',
      model: 'test',
      status: 'running',
      workingDir: '/tmp',
    });
    const updated = store.updateSession('sess-3', { status: 'done' });
    expect(updated.status).toBe('done');
    expect(updated.updatedAt).toBeGreaterThanOrEqual(updated.createdAt);
  });

  it('throws when updating non-existent session', () => {
    expect(() => store.updateSession('nope', { status: 'done' })).toThrow('not found');
  });

  it('lists sessions ordered by created_at DESC', () => {
    // Insert with explicit timestamps via raw SQL to guarantee ordering
    const now = Date.now();
    db.db.prepare('INSERT INTO sessions (id, goal, provider, model, status, working_dir, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('s1', 'first', 'anthropic', 'm', 'done', '/tmp', now - 2000, now - 2000);
    db.db.prepare('INSERT INTO sessions (id, goal, provider, model, status, working_dir, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('s2', 'second', 'gemini', 'm', 'running', '/tmp', now - 1000, now - 1000);
    db.db.prepare('INSERT INTO sessions (id, goal, provider, model, status, working_dir, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('s3', 'third', 'anthropic', 'm', 'error', '/tmp', now, now);

    const sessions = store.listSessions();
    expect(sessions).toHaveLength(3);
    // Most recent first
    expect(sessions[0].id).toBe('s3');
    expect(sessions[2].id).toBe('s1');
  });

  it('respects limit parameter', () => {
    store.createSession({ id: 'a', goal: '1', provider: 'anthropic', model: 'm', status: 'done', workingDir: '/tmp' });
    store.createSession({ id: 'b', goal: '2', provider: 'anthropic', model: 'm', status: 'done', workingDir: '/tmp' });
    store.createSession({ id: 'c', goal: '3', provider: 'anthropic', model: 'm', status: 'done', workingDir: '/tmp' });

    const sessions = store.listSessions(2);
    expect(sessions).toHaveLength(2);
  });
});
