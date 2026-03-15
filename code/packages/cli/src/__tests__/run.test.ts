import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock core modules to avoid real DB/provider
vi.mock('@angycode/core', async () => {
  const actual = await vi.importActual<typeof import('@angycode/core')>('@angycode/core');

  // Minimal mock agent loop
  class MockAgentLoop {
    private listeners: ((event: unknown) => void)[] = [];
    private opts: unknown;

    constructor(opts: unknown) {
      this.opts = opts;
    }

    on(_event: string, listener: (event: unknown) => void) {
      this.listeners.push(listener);
    }

    async run(_goal: string) {
      // Emit a text event and a done event
      for (const l of this.listeners) {
        l({ type: 'text', text: 'Mock response' });
      }
      for (const l of this.listeners) {
        l({ type: 'done', stop_reason: 'end_turn', turns: 1, cost_usd: 0.01 });
      }
      return { id: 'mock-sess', status: 'done' };
    }
  }

  return {
    ...actual,
    AgentLoop: MockAgentLoop,
    DatabaseImpl: class {
      db = {};
      close() {}
    },
    createDefaultRegistry: () => ({ all: () => [], names: () => [], list: () => [] }),
    createProvider: () => ({}),
  };
});

vi.mock('../keys.js', () => ({
  resolveApiKey: () => 'mock-key',
}));

import { runCommand } from '../commands/run.js';

describe('runCommand', () => {
  let output: string;

  beforeEach(() => {
    output = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs and outputs human-formatted events', async () => {
    await runCommand('test goal', {});
    expect(output).toContain('Mock response');
    expect(output).toContain('Done');
  });

  it('runs with --json flag', async () => {
    await runCommand('test goal', { json: true });
    const lines = output.trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const first = JSON.parse(lines[0]!);
    expect(first.type).toBe('text');
  });
});
