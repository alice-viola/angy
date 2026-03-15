import { describe, it, expect } from 'vitest';
import { thinkTool } from '../think.js';
import type { ToolContext, AgentEvent } from '../../types.js';

const ctx: ToolContext = {
  workingDir: '/tmp',
  sessionId: 'test',
  filesRead: new Set(),
  emit: (_e: AgentEvent) => {},
};

describe('Think tool', () => {
  it('returns the thought as content', async () => {
    const result = await thinkTool.execute(
      { thought: 'I should read the file first' },
      ctx,
    );
    expect(result.content).toBe('I should read the file first');
    expect(result.is_error).toBe(false);
  });

  it('is a no-op passthrough', async () => {
    const result = await thinkTool.execute({ thought: '' }, ctx);
    expect(result.content).toBe('');
    expect(result.is_error).toBe(false);
  });

  it('has correct definition', () => {
    expect(thinkTool.definition.name).toBe('Think');
  });
});
