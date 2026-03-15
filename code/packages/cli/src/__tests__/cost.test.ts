import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';

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

import { costCommand } from '../commands/cost.js';
import { DatabaseImpl, createUsageStore, createSessionStore } from '@angycode/core';

describe('costCommand', () => {
  let output: string;
  let setupDb: DatabaseImpl;

  beforeEach(() => {
    tmpPath = path.join(os.tmpdir(), `angy-cost-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
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

  it('shows total usage with zero data', () => {
    setupDb.close();
    costCommand({});
    expect(output).toContain('Total usage');
    expect(output).toContain('Sessions:      0');
  });

  it('shows session-specific usage', () => {
    const sessStore = createSessionStore(setupDb.db);
    sessStore.createSession({
      id: 'cost-sess-1',
      goal: 'test',
      provider: 'anthropic',
      model: 'test',
      status: 'done',
      workingDir: '/tmp',
    });

    const usageStore = createUsageStore(setupDb.db);
    usageStore.recordUsage({
      sessionId: 'cost-sess-1',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.0525,
    });
    setupDb.close();

    costCommand({ session: 'cost-sess-1' });
    expect(output).toContain('cost-sess-1');
    expect(output).toContain('1000');
    expect(output).toContain('500');
  });

  it('outputs JSON when --json', () => {
    setupDb.close();
    costCommand({ json: true });
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty('totalInputTokens');
    expect(parsed).toHaveProperty('sessions');
  });
});
