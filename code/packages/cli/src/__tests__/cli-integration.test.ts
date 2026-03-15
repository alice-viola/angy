import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

const CLI_PATH = path.join(__dirname, '..', 'index.ts');
const TSX = 'npx';

function run(args: string[]): string {
  try {
    return execFileSync(TSX, ['tsx', CLI_PATH, ...args], {
      encoding: 'utf-8',
      timeout: 10000,
      env: { ...process.env, NO_COLOR: '1' },
    });
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    return (e.stdout ?? '') + (e.stderr ?? '');
  }
}

describe('CLI integration', () => {
  it('shows help', () => {
    const output = run(['--help']);
    expect(output).toContain('angycode');
    expect(output).toContain('run');
    expect(output).toContain('resume');
    expect(output).toContain('sessions');
    expect(output).toContain('cost');
    expect(output).toContain('config');
  });

  it('shows version', () => {
    const output = run(['--version']);
    expect(output.trim()).toBe('0.1.0');
  });

  it('run subcommand shows help', () => {
    const output = run(['run', '--help']);
    expect(output).toContain('goal');
    expect(output).toContain('--provider');
    expect(output).toContain('--model');
    expect(output).toContain('--json');
  });

  it('config get works', () => {
    const output = run(['config', 'get', '--json']);
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty('provider');
    expect(parsed).toHaveProperty('model');
  });
});
