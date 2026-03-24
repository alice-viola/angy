import { mkdtempSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync, spawn } from 'node:child_process';

export function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function cloneDir(src: string, dest: string): void {
  cpSync(src, dest, { recursive: true });
}

export function getGitSha(dir: string): string {
  return execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf-8' }).trim();
}

export function withTimeout<T>(
  fn: () => Promise<T>,
  ms: number
): Promise<T & { timedOut?: boolean }> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(Object.assign(new Error('Timed out'), { timedOut: true }));
      }
    }, ms);

    fn().then(
      (result) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(result as T & { timedOut?: boolean });
        }
      },
      (err: unknown) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      }
    );
  });
}

export function runScript(
  scriptPath: string,
  args: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('bash', [scriptPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });

    child.on('error', (err) => {
      resolve({ exitCode: 1, stdout, stderr: stderr + '\n' + String(err) });
    });
  });
}
