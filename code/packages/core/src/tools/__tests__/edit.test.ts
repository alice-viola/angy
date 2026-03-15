import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { editTool } from '../edit.js';
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

async function writeAndTrack(name: string, content: string): Promise<Set<string>> {
  const filePath = path.resolve(tmpDir, name);
  await fs.writeFile(filePath, content);
  return new Set([filePath]);
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'edit-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('Edit tool', () => {
  it('replaces a single occurrence', async () => {
    const filesRead = await writeAndTrack('a.txt', 'hello world');
    const result = await editTool.execute(
      { file_path: 'a.txt', old_string: 'hello', new_string: 'goodbye' },
      makeCtx(filesRead),
    );
    expect(result.is_error).toBe(false);
    const content = await fs.readFile(path.join(tmpDir, 'a.txt'), 'utf-8');
    expect(content).toBe('goodbye world');
  });

  it('rejects edit without reading first (filesRead guard)', async () => {
    await fs.writeFile(path.join(tmpDir, 'b.txt'), 'content');
    const result = await editTool.execute(
      { file_path: 'b.txt', old_string: 'content', new_string: 'new' },
      makeCtx(),
    );
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('Must read file before editing');
  });

  it('returns error when old_string not found', async () => {
    const filesRead = await writeAndTrack('c.txt', 'hello');
    const result = await editTool.execute(
      { file_path: 'c.txt', old_string: 'missing', new_string: 'x' },
      makeCtx(filesRead),
    );
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('not found');
  });

  it('rejects ambiguous single replace (uniqueness check)', async () => {
    const filesRead = await writeAndTrack('d.txt', 'aaa bbb aaa');
    const result = await editTool.execute(
      { file_path: 'd.txt', old_string: 'aaa', new_string: 'ccc' },
      makeCtx(filesRead),
    );
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('appears 2 times');
  });

  it('replace_all replaces all occurrences', async () => {
    const filesRead = await writeAndTrack('e.txt', 'aaa bbb aaa');
    const result = await editTool.execute(
      { file_path: 'e.txt', old_string: 'aaa', new_string: 'ccc', replace_all: true },
      makeCtx(filesRead),
    );
    expect(result.is_error).toBe(false);
    const content = await fs.readFile(path.join(tmpDir, 'e.txt'), 'utf-8');
    expect(content).toBe('ccc bbb ccc');
    expect(result.content).toContain('2 occurrences');
  });

  it('handles $ in replacement string (CRITICAL — no corruption)', async () => {
    const filesRead = await writeAndTrack('dollar.txt', 'price is PLACEHOLDER');
    const result = await editTool.execute(
      { file_path: 'dollar.txt', old_string: 'PLACEHOLDER', new_string: '$100 ($&, $$, $1)' },
      makeCtx(filesRead),
    );
    expect(result.is_error).toBe(false);
    const content = await fs.readFile(path.join(tmpDir, 'dollar.txt'), 'utf-8');
    // Must be exactly this — not corrupted by $ pattern interpretation
    expect(content).toBe('price is $100 ($&, $$, $1)');
  });

  it('handles $ in replacement string with replace_all', async () => {
    const filesRead = await writeAndTrack('dollar2.txt', 'X and X');
    const result = await editTool.execute(
      { file_path: 'dollar2.txt', old_string: 'X', new_string: '$0', replace_all: true },
      makeCtx(filesRead),
    );
    expect(result.is_error).toBe(false);
    const content = await fs.readFile(path.join(tmpDir, 'dollar2.txt'), 'utf-8');
    expect(content).toBe('$0 and $0');
  });

  it('uses atomic write (no .tmp left behind)', async () => {
    const filesRead = await writeAndTrack('atomic.txt', 'old');
    await editTool.execute(
      { file_path: 'atomic.txt', old_string: 'old', new_string: 'new' },
      makeCtx(filesRead),
    );
    const files = await fs.readdir(tmpDir);
    expect(files).not.toContain('atomic.txt.tmp');
  });

  it('handles empty old_string edge case', async () => {
    const filesRead = await writeAndTrack('empty.txt', 'content');
    // empty string matches everywhere — split('') returns each char
    const result = await editTool.execute(
      { file_path: 'empty.txt', old_string: '', new_string: 'x', replace_all: true },
      makeCtx(filesRead),
    );
    // split('') produces length+1 parts, so occurrences = content.length which is > 1
    // For single replace this would fail uniqueness, but replace_all should work
    expect(result.is_error).toBe(false);
  });
});
