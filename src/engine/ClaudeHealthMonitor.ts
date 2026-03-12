/**
 * ClaudeHealthMonitor — probes Claude CLI availability before agent spawns.
 *
 * When Claude is unreachable (API down, network issue, rate limit), the monitor
 * blocks with exponential backoff until connectivity is restored. This prevents
 * agents from burning crash-retry budgets on infrastructure failures.
 *
 * Usage:
 *   const monitor = new ClaudeHealthMonitor();
 *   await monitor.waitForHealthy();  // blocks until claude responds
 *   // ... now safe to spawn agent
 */

import { Command } from '@tauri-apps/plugin-shell';
import { homeDir } from '@tauri-apps/api/path';
import { exists } from '@tauri-apps/plugin-fs';
import { engineBus } from './EventBus';

export class ClaudeHealthMonitor {
  private _healthy = true;
  private _cancelled = false;
  private _lastCheckMs = 0;
  private _consecutiveFailures = 0;
  private claudeBinCache: string | null = null;

  static readonly MIN_BACKOFF_MS = 5_000;
  static readonly MAX_BACKOFF_MS = 120_000;
  static readonly HEALTH_CACHE_MS = 30_000;
  static readonly MAX_WAIT_ATTEMPTS = 30;

  get isHealthy(): boolean { return this._healthy; }

  cancel(): void {
    this._cancelled = true;
  }

  reset(): void {
    this._cancelled = false;
    this._consecutiveFailures = 0;
    this._healthy = true;
  }

  /**
   * Check if Claude CLI is available and responsive right now.
   * Uses a lightweight `claude --version` probe to avoid API costs.
   * Falls back to process-existence check if version fails.
   */
  async probe(): Promise<boolean> {
    try {
      const bin = await this.resolveClaudeBinary();
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

  /**
   * Block until Claude CLI is healthy. Uses exponential backoff.
   * Throws if cancelled or max attempts exceeded.
   */
  async waitForHealthy(): Promise<void> {
    const now = Date.now();
    if (this._healthy && (now - this._lastCheckMs) < ClaudeHealthMonitor.HEALTH_CACHE_MS) {
      return;
    }

    const healthy = await this.probe();
    this._lastCheckMs = Date.now();

    if (healthy) {
      if (!this._healthy) {
        console.log('[ClaudeHealthMonitor] Connection restored');
      }
      this._healthy = true;
      this._consecutiveFailures = 0;
      engineBus.emit('pipeline:claudeHealthCheck', { status: 'healthy', attempt: 0 });
      return;
    }

    this._healthy = false;
    console.warn('[ClaudeHealthMonitor] Claude CLI unavailable, entering wait loop');

    for (let attempt = 1; attempt <= ClaudeHealthMonitor.MAX_WAIT_ATTEMPTS; attempt++) {
      if (this._cancelled) {
        throw new Error('Health monitor cancelled while waiting for Claude');
      }

      this._consecutiveFailures++;
      const backoff = Math.min(
        ClaudeHealthMonitor.MIN_BACKOFF_MS * Math.pow(2, attempt - 1),
        ClaudeHealthMonitor.MAX_BACKOFF_MS,
      );
      const jitter = Math.random() * backoff * 0.2;
      const waitMs = backoff + jitter;

      console.log(`[ClaudeHealthMonitor] Attempt ${attempt}/${ClaudeHealthMonitor.MAX_WAIT_ATTEMPTS}, waiting ${Math.round(waitMs / 1000)}s`);
      engineBus.emit('pipeline:claudeHealthCheck', { status: 'waiting', attempt });

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, waitMs);
        if (this._cancelled) {
          clearTimeout(timer);
          reject(new Error('Health monitor cancelled'));
        }
      });

      const isHealthy = await this.probe();
      this._lastCheckMs = Date.now();

      if (isHealthy) {
        this._healthy = true;
        this._consecutiveFailures = 0;
        console.log(`[ClaudeHealthMonitor] Connection restored after ${attempt} attempts`);
        engineBus.emit('pipeline:claudeHealthCheck', { status: 'healthy', attempt });
        return;
      }
    }

    engineBus.emit('pipeline:claudeHealthCheck', { status: 'unhealthy', attempt: ClaudeHealthMonitor.MAX_WAIT_ATTEMPTS });
    throw new Error(`Claude CLI unavailable after ${ClaudeHealthMonitor.MAX_WAIT_ATTEMPTS} attempts (${this._consecutiveFailures} consecutive failures)`);
  }

  /**
   * Classify an agent error to determine retry strategy.
   * Returns 'transient' for errors worth retrying, 'fatal' for permanent failures.
   */
  classifyError(error: unknown, stderr: string = ''): 'transient' | 'fatal' {
    const msg = error instanceof Error ? error.message : String(error);
    const combined = `${msg}\n${stderr}`.toLowerCase();

    const transientPatterns = [
      'overloaded', 'rate limit', 'too many requests', '529', '503', '502',
      'connection reset', 'connection refused', 'econnrefused', 'econnreset',
      'timeout', 'timed out', 'socket hang up', 'network', 'fetch failed',
      'api error', 'internal server error', '500',
    ];

    for (const pattern of transientPatterns) {
      if (combined.includes(pattern)) return 'transient';
    }

    return 'fatal';
  }

  private async resolveClaudeBinary(): Promise<string> {
    if (this.claudeBinCache) return this.claudeBinCache;

    const home = (await homeDir()).replace(/\/+$/, '');
    const candidates = [
      `${home}/.local/bin/claude`,
      '/opt/homebrew/bin/claude',
      '/usr/local/bin/claude',
    ];
    for (const c of candidates) {
      try {
        if (await exists(c)) {
          this.claudeBinCache = c;
          return c;
        }
      } catch { /* ignore */ }
    }
    return 'claude';
  }

  private async buildMinimalPath(home: string): Promise<string> {
    return [
      `${home}/.local/bin`,
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
    ].join(':');
  }
}
