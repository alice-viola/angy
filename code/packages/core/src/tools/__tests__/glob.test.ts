import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { globTool } from '../glob.js';
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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'glob-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('Glob tool', () => {
  it('matches files with pattern', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.ts'), '');
    await fs.writeFile(path.join(tmpDir, 'b.ts'), '');
    await fs.writeFile(path.join(tmpDir, 'c.js'), '');

    const result = await globTool.execute({ pattern: '*.ts' }, makeCtx());
    expect(result.is_error).toBe(false);
    expect(result.content).toContain('a.ts');
    expect(result.content).toContain('b.ts');
    expect(result.content).not.toContain('c.js');
  });

  it('returns "No files matched" when nothing matches', async () => {
    const result = await globTool.execute({ pattern: '*.xyz' }, makeCtx());
    expect(result.content).toBe('No files matched');
  });

  it('truncates at 500 results', async () => {
    // Create 510 files
    await Promise.all(
      Array.from({ length: 510 }, (_, i) =>
        fs.writeFile(path.join(tmpDir, `file${String(i).padStart(4, '0')}.txt`), ''),
      ),
    );

    const result = await globTool.execute({ pattern: '*.txt' }, makeCtx());
    expect(result.content).toContain('truncated');
    expect(result.content).toContain('500');
    // Count lines (excluding truncation message)
    const lines = result.content.split('\n').filter((l) => !l.startsWith('…'));
    expect(lines).toHaveLength(500);
  }, 15000);

  it('sorts by mtime (most recent first)', async () => {
    await fs.writeFile(path.join(tmpDir, 'old.txt'), 'old');
    // Ensure different mtime
    await new Promise((r) => setTimeout(r, 50));
    await fs.writeFile(path.join(tmpDir, 'new.txt'), 'new');

    const result = await globTool.execute({ pattern: '*.txt' }, makeCtx());
    const lines = result.content.split('\n');
    expect(lines[0]).toBe('new.txt');
    expect(lines[1]).toBe('old.txt');
  });

  it('supports path option', async () => {
    await fs.mkdir(path.join(tmpDir, 'sub'));
    await fs.writeFile(path.join(tmpDir, 'sub', 'inner.ts'), '');

    const result = await globTool.execute({ pattern: '*.ts', path: 'sub' }, makeCtx());
    expect(result.content).toContain('inner.ts');
  });
});
