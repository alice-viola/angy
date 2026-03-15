import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { grepTool } from '../grep.js';
import type { ToolContext, AgentEvent } from '../../types.js';

let tmpDir: string;

function makeCtx(): ToolContext {
  return {
    workingDir: tmpDir,
    sessionId: 'test',
    filesRead: new Set(),
    emit: (_e: AgentEvent) => {},
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'grep-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('Grep tool', () => {
  it('finds pattern in files', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.txt'), 'hello world\ngoodbye world\nhello again');
    const result = await grepTool.execute({ pattern: 'hello' }, makeCtx());
    expect(result.is_error).toBe(false);
    expect(result.content).toContain('hello');
    // Should show line numbers
    expect(result.content).toMatch(/:\d+:/);
  });

  it('returns "No matches found" when nothing matches', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.txt'), 'nothing here');
    const result = await grepTool.execute({ pattern: 'zzzzz' }, makeCtx());
    expect(result.content).toBe('No matches found');
  });

  it('searches specific file', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.txt'), 'match me');
    await fs.writeFile(path.join(tmpDir, 'b.txt'), 'match me too');
    const result = await grepTool.execute({ pattern: 'match', path: 'a.txt' }, makeCtx());
    expect(result.content).toContain('a.txt');
    expect(result.content).not.toContain('b.txt');
  });

  it('handles regex patterns', async () => {
    await fs.writeFile(path.join(tmpDir, 'regex.txt'), 'foo123bar\nfoo456bar\nhello');
    const result = await grepTool.execute({ pattern: 'foo\\d+bar' }, makeCtx());
    expect(result.content).toContain('foo123bar');
    expect(result.content).toContain('foo456bar');
    expect(result.content).not.toContain('hello');
  });

  it('searches recursively in subdirectories', async () => {
    await fs.mkdir(path.join(tmpDir, 'sub'));
    await fs.writeFile(path.join(tmpDir, 'sub', 'deep.txt'), 'deep match');
    const result = await grepTool.execute({ pattern: 'deep' }, makeCtx());
    expect(result.content).toContain('deep match');
  });
});
