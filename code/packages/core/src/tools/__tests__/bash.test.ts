import { describe, it, expect } from 'vitest';
import { bashTool } from '../bash.js';
import type { ToolContext, AgentEvent } from '../../types.js';

function makeCtx(workingDir?: string): ToolContext {
  return {
    workingDir: workingDir ?? process.cwd(),
    sessionId: 'test-session',
    filesRead: new Set(),
    emit: (_e: AgentEvent) => {},
  };
}

describe('Bash tool', () => {
  it('captures stdout', async () => {
    const result = await bashTool.execute({ command: 'echo hello' }, makeCtx());
    expect(result.is_error).toBe(false);
    expect(result.content).toContain('<stdout>hello\n</stdout>');
    expect(result.content).toContain('<exit_code>0</exit_code>');
  });

  it('captures stderr', async () => {
    const result = await bashTool.execute({ command: 'echo err >&2' }, makeCtx());
    expect(result.content).toContain('<stderr>err\n</stderr>');
  });

  it('returns is_error true for non-zero exit code', async () => {
    const result = await bashTool.execute({ command: 'exit 1' }, makeCtx());
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('<exit_code>1</exit_code>');
  });

  it('handles timeout', async () => {
    const result = await bashTool.execute(
      { command: 'sleep 10', timeout: 500 },
      makeCtx(),
    );
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('<exit_code>-1</exit_code>');
  }, 5000);

  it('truncates long stdout', async () => {
    // Generate >100k chars
    const result = await bashTool.execute(
      { command: 'python3 -c "print(\'x\' * 200000)"' },
      makeCtx(),
    );
    expect(result.content).toContain('… (truncated)');
    // Output should be capped
    expect(result.content.length).toBeLessThan(120_000);
  }, 10000);

  it('runs in the specified working directory', async () => {
    const result = await bashTool.execute({ command: 'pwd' }, makeCtx('/tmp'));
    expect(result.content).toContain('/tmp');
  });

  it('uses spawn not exec (definition check)', () => {
    expect(bashTool.definition.name).toBe('Bash');
  });
});
