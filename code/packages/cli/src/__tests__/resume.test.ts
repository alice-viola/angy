import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSession = {
  id: 'resume-sess-1',
  goal: 'previous task',
  provider: 'anthropic' as const,
  model: 'claude-sonnet-4-6',
  status: 'paused' as const,
  workingDir: '/tmp',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

vi.mock('@angycode/core', async () => {
  const actual = await vi.importActual<typeof import('@angycode/core')>('@angycode/core');

  class MockAgentLoop {
    private listeners: ((event: unknown) => void)[] = [];

    on(_event: string, listener: (event: unknown) => void) {
      this.listeners.push(listener);
    }

    async resume(_id: string) {
      for (const l of this.listeners) {
        l({ type: 'text', text: 'Resumed!' });
      }
      for (const l of this.listeners) {
        l({ type: 'done', stop_reason: 'end_turn', turns: 1, cost_usd: undefined });
      }
      return { ...mockSession, status: 'done' };
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
    createSessionStore: () => ({
      getSession: (id: string) => (id === mockSession.id ? mockSession : null),
    }),
  };
});

vi.mock('../keys.js', () => ({
  resolveApiKey: () => 'mock-key',
}));

import { resumeCommand } from '../commands/resume.js';

describe('resumeCommand', () => {
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

  it('resumes a session', async () => {
    await resumeCommand('resume-sess-1', {});
    expect(output).toContain('Resumed!');
  });

  it('throws for unknown session', async () => {
    await expect(resumeCommand('nonexistent', {})).rejects.toThrow('Session not found');
  });
});
