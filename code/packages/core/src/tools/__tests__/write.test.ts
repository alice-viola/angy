import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { writeTool } from '../write.js';
import type { ToolContext, AgentEvent } from '../../types.js';

let tmpDir: string;

function makeCtx(filesRead?: Set<string>): ToolContext {
  return {
    workingDir: tmpDir,
    sessionId: 'test',
    filesRead: filesRead ?? new Set(),
    emit: (_e: AgentEvent) => {},
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'write-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('Write tool', () => {
  it('creates a new file', async () => {
    const result = await writeTool.execute(
      { file_path: 'new.txt', content: 'hello world' },
      makeCtx(),
    );
    expect(result.is_error).toBe(false);
    const content = await fs.readFile(path.join(tmpDir, 'new.txt'), 'utf-8');
    expect(content).toBe('hello world');
  });

  it('creates parent directories', async () => {
    const result = await writeTool.execute(
      { file_path: 'a/b/c/deep.txt', content: 'deep' },
      makeCtx(),
    );
    expect(result.is_error).toBe(false);
    const content = await fs.readFile(path.join(tmpDir, 'a/b/c/deep.txt'), 'utf-8');
    expect(content).toBe('deep');
  });

  it('rejects writing to existing file without reading first', async () => {
    const filePath = path.join(tmpDir, 'existing.txt');
    await fs.writeFile(filePath, 'old');
    const result = await writeTool.execute(
      { file_path: 'existing.txt', content: 'new' },
      makeCtx(),
    );
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('Must read file before writing');
  });

  it('allows writing to existing file after reading', async () => {
    const filePath = path.resolve(tmpDir, 'existing.txt');
    await fs.writeFile(filePath, 'old');
    const filesRead = new Set([filePath]);
    const result = await writeTool.execute(
      { file_path: 'existing.txt', content: 'new' },
      makeCtx(filesRead),
    );
    expect(result.is_error).toBe(false);
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toBe('new');
  });

  it('adds file to filesRead after writing', async () => {
    const ctx = makeCtx();
    await writeTool.execute({ file_path: 'track.txt', content: 'data' }, ctx);
    expect(ctx.filesRead.has(path.resolve(tmpDir, 'track.txt'))).toBe(true);
  });

  it('uses atomic write (no .tmp file left behind)', async () => {
    await writeTool.execute({ file_path: 'atomic.txt', content: 'safe' }, makeCtx());
    const files = await fs.readdir(tmpDir);
    expect(files).not.toContain('atomic.txt.tmp');
    expect(files).toContain('atomic.txt');
  });
});
