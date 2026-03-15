import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { DatabaseImpl } from '../database.js';
import { createSessionStore } from '../sessionStore.js';
import { createUsageStore, type UsageStore } from '../usageStore.js';

let db: DatabaseImpl;
let store: UsageStore;
let tmpPath: string;

beforeEach(() => {
  tmpPath = path.join(os.tmpdir(), `angycode-usage-test-${Date.now()}.db`);
  db = new DatabaseImpl(tmpPath);
  const sessionStore = createSessionStore(db.db);
  sessionStore.createSession({ id: 's1', goal: 'a', provider: 'anthropic', model: 'claude-opus-4-6', status: 'running', workingDir: '/tmp' });
  sessionStore.createSession({ id: 's2', goal: 'b', provider: 'gemini', model: 'gemini-2.0-flash', status: 'running', workingDir: '/tmp' });
  store = createUsageStore(db.db);
});

afterEach(() => {
  db.close();
  if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
});

describe('UsageStore', () => {
  it('records and retrieves usage for a session', () => {
    store.recordUsage({
      sessionId: 's1',
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.05,
    });

    const usage = store.getSessionUsage('s1');
    expect(usage.totalInputTokens).toBe(1000);
    expect(usage.totalOutputTokens).toBe(500);
    expect(usage.totalCostUsd).toBe(0.05);
  });

  it('aggregates multiple usage records', () => {
    store.recordUsage({ sessionId: 's1', provider: 'anthropic', model: 'm', inputTokens: 100, outputTokens: 50, costUsd: 0.01 });
    store.recordUsage({ sessionId: 's1', provider: 'anthropic', model: 'm', inputTokens: 200, outputTokens: 100, costUsd: 0.02 });

    const usage = store.getSessionUsage('s1');
    expect(usage.totalInputTokens).toBe(300);
    expect(usage.totalOutputTokens).toBe(150);
    expect(usage.totalCostUsd).toBeCloseTo(0.03);
  });

  it('returns zeros for session with no usage', () => {
    const usage = store.getSessionUsage('s1');
    expect(usage.totalInputTokens).toBe(0);
    expect(usage.totalOutputTokens).toBe(0);
    expect(usage.totalCostUsd).toBe(0);
  });

  it('gets total usage across all sessions', () => {
    store.recordUsage({ sessionId: 's1', provider: 'anthropic', model: 'm', inputTokens: 100, outputTokens: 50, costUsd: 0.01 });
    store.recordUsage({ sessionId: 's2', provider: 'gemini', model: 'm', inputTokens: 200, outputTokens: 100, costUsd: 0.02 });

    const total = store.getTotalUsage();
    expect(total.totalInputTokens).toBe(300);
    expect(total.totalOutputTokens).toBe(150);
    expect(total.totalCostUsd).toBeCloseTo(0.03);
    expect(total.sessions).toBe(2);
  });

  it('filters total usage by since timestamp', () => {
    store.recordUsage({ sessionId: 's1', provider: 'anthropic', model: 'm', inputTokens: 100, outputTokens: 50, costUsd: 0.01 });

    // Future timestamp — should exclude everything
    const total = store.getTotalUsage(Date.now() + 100_000);
    expect(total.totalInputTokens).toBe(0);
    expect(total.sessions).toBe(0);

    // Past timestamp — should include everything
    const all = store.getTotalUsage(0);
    expect(all.totalInputTokens).toBe(100);
    expect(all.sessions).toBe(1);
  });

  it('handles null costUsd', () => {
    store.recordUsage({ sessionId: 's1', provider: 'anthropic', model: 'm', inputTokens: 100, outputTokens: 50 });

    const usage = store.getSessionUsage('s1');
    expect(usage.totalInputTokens).toBe(100);
    expect(usage.totalCostUsd).toBe(0); // COALESCE handles null
  });
});

describe('Tool Executions', () => {
  it('records and retrieves tool executions', () => {
    store.recordToolExecution({
      sessionId: 's1',
      toolName: 'Read',
      input: { file_path: '/a.ts' },
      output: 'file contents',
      isError: false,
      durationMs: 12,
    });

    const execs = store.getSessionToolExecutions('s1');
    expect(execs).toHaveLength(1);
    expect(execs[0].toolName).toBe('Read');
    expect(execs[0].input).toEqual({ file_path: '/a.ts' });
    expect(execs[0].output).toBe('file contents');
    expect(execs[0].isError).toBe(false);
    expect(execs[0].durationMs).toBe(12);
    expect(execs[0].createdAt).toBeGreaterThan(0);
  });

  it('records error tool executions', () => {
    store.recordToolExecution({
      sessionId: 's1',
      toolName: 'Bash',
      input: { command: 'exit 1' },
      output: 'Error: non-zero exit',
      isError: true,
      durationMs: 100,
    });

    const execs = store.getSessionToolExecutions('s1');
    expect(execs[0].isError).toBe(true);
  });

  it('handles missing output and durationMs', () => {
    store.recordToolExecution({
      sessionId: 's1',
      toolName: 'Think',
      input: { thought: 'hmm' },
      isError: false,
    });

    const execs = store.getSessionToolExecutions('s1');
    expect(execs[0].output).toBeNull();
    expect(execs[0].durationMs).toBeNull();
  });

  it('returns empty array for session with no executions', () => {
    expect(store.getSessionToolExecutions('s1')).toEqual([]);
  });

  it('preserves ordering by created_at ASC', () => {
    store.recordToolExecution({ sessionId: 's1', toolName: 'Read', input: { n: 1 }, isError: false });
    store.recordToolExecution({ sessionId: 's1', toolName: 'Write', input: { n: 2 }, isError: false });
    store.recordToolExecution({ sessionId: 's1', toolName: 'Bash', input: { n: 3 }, isError: false });

    const execs = store.getSessionToolExecutions('s1');
    expect(execs.map((e) => e.toolName)).toEqual(['Read', 'Write', 'Bash']);
  });
});
