import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { readTool } from '../read.js';
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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'read-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('Read tool', () => {
  it('reads a file with line numbers', async () => {
    await fs.writeFile(path.join(tmpDir, 'hello.txt'), 'line1\nline2\nline3');
    const result = await readTool.execute({ file_path: 'hello.txt' }, makeCtx());
    expect(result.is_error).toBe(false);
    expect(result.content).toContain('     1\tline1');
    expect(result.content).toContain('     2\tline2');
    expect(result.content).toContain('     3\tline3');
  });

  it('adds file to filesRead', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.txt'), 'content');
    const ctx = makeCtx();
    await readTool.execute({ file_path: 'a.txt' }, ctx);
    expect(ctx.filesRead.has(path.resolve(tmpDir, 'a.txt'))).toBe(true);
  });

  it('returns error for missing file', async () => {
    const result = await readTool.execute({ file_path: 'nope.txt' }, makeCtx());
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('Error:');
  });

  it('handles absolute paths', async () => {
    const absPath = path.join(tmpDir, 'abs.txt');
    await fs.writeFile(absPath, 'absolute');
    const result = await readTool.execute({ file_path: absPath }, makeCtx());
    expect(result.is_error).toBe(false);
    expect(result.content).toContain('absolute');
  });
});
