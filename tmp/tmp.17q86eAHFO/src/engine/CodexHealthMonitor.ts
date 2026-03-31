import { Command } from '@tauri-apps/plugin-shell';
import { homeDir } from '@tauri-apps/api/path';
import { exists } from '@tauri-apps/plugin-fs';
import { getPlatformInfo } from './platform';

export class CodexHealthMonitor {
  private _healthy = true;
  private _cancelled = false;
  private _lastCheckMs = 0;
  private codexBinCache: string | null = null;

  static readonly MIN_BACKOFF_MS = 5_000;
  static readonly MAX_BACKOFF_MS = 120_000;
  static readonly HEALTH_CACHE_MS = 30_000;
  static readonly MAX_WAIT_ATTEMPTS = 30;

  cancel(): void {
    this._cancelled = true;
  }

  reset(): void {
    this._cancelled = false;
    this._healthy = true;
  }

  async probe(): Promise<boolean> {
    try {
      const bin = await this.resolveCodexBinary();
      const home = (await homeDir()).replace(/\/+$/, '');
      const command = Command.create('exec-sh', ['-c', `'${bin.replace(/'/g, "'\\''")}' --version`], {
        env: {
          HOME: home,
          PATH: await this.buildMinimalPath(home),
        },
      });
      const output = await command.execute();
      return output.code === 0;
    } catch {
      return false;
    }
  }

  async waitForHealthy(): Promise<void> {
    const now = Date.now();
    if (this._healthy && (now - this._lastCheckMs) < CodexHealthMonitor.HEALTH_CACHE_MS) {
      return;
    }

    const healthy = await this.probe();
    this._lastCheckMs = Date.now();
    if (healthy) {
      this._healthy = true;
      return;
    }

    this._healthy = false;
    for (let attempt = 1; attempt <= CodexHealthMonitor.MAX_WAIT_ATTEMPTS; attempt++) {
      if (this._cancelled) {
        throw new Error('Health monitor cancelled while waiting for Codex');
      }

      const backoff = Math.min(
        CodexHealthMonitor.MIN_BACKOFF_MS * Math.pow(2, attempt - 1),
        CodexHealthMonitor.MAX_BACKOFF_MS,
      );
      await new Promise(resolve => setTimeout(resolve, backoff));

      const isHealthy = await this.probe();
      this._lastCheckMs = Date.now();
      if (isHealthy) {
        this._healthy = true;
        return;
      }
    }

    throw new Error(`Codex CLI unavailable after ${CodexHealthMonitor.MAX_WAIT_ATTEMPTS} attempts`);
  }

  classifyError(error: unknown, stderr = ''): 'transient' | 'fatal' {
    const msg = error instanceof Error ? error.message : String(error);
    const combined = `${msg}\n${stderr}`.toLowerCase();
    const transientPatterns = [
      'overloaded', 'rate limit', 'too many requests', '429', '500', '502', '503',
      'connection reset', 'connection refused', 'econnrefused', 'econnreset',
      'timeout', 'timed out', 'socket hang up', 'network', 'fetch failed',
      'temporary', 'try again',
    ];

    for (const pattern of transientPatterns) {
      if (combined.includes(pattern)) return 'transient';
    }
    return 'fatal';
  }

  private async resolveCodexBinary(): Promise<string> {
    if (this.codexBinCache) return this.codexBinCache;

    const home = (await homeDir()).replace(/\/+$/, '');
    const { os } = await getPlatformInfo();
    const candidates = [
      `${home}/.local/bin/codex`,
      `${home}/.linuxbrew/bin/codex`,
      `${home}/.nix-profile/bin/codex`,
      '/home/linuxbrew/.linuxbrew/bin/codex',
      '/usr/local/bin/codex',
      '/usr/bin/codex',
      ...(os === 'macos' ? ['/opt/homebrew/bin/codex'] : []),
    ];
    for (const candidate of candidates) {
      try {
        if (await exists(candidate)) {
          this.codexBinCache = candidate;
          return candidate;
        }
      } catch {
        // Ignore bad candidates.
      }
    }
    return 'codex';
  }

  private async buildMinimalPath(home: string): Promise<string> {
    const { os } = await getPlatformInfo();
    const paths = [
      `${home}/.local/bin`,
      `${home}/.linuxbrew/bin`,
      `${home}/.nix-profile/bin`,
      '/home/linuxbrew/.linuxbrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
    ];
    if (os === 'macos') paths.unshift('/opt/homebrew/bin');
    return paths.join(':');
  }
}
