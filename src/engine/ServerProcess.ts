import { Command, type Child } from '@tauri-apps/plugin-shell';
import { homeDir } from '@tauri-apps/api/path';
import { getPlatformInfo } from './platform';

const READY_REGEX = /^ANGYCODE_SERVER_READY port=(\d+)$/;
const START_TIMEOUT_MS = 15_000;

export class ServerProcess {
  private child: Child | null = null;
  private baseUrl_ = '';
  private running = false;

  async start(): Promise<void> {
    if (this.running) return;

    const serverPath = await this.resolveServerPath();
    const env = await this.buildEnvironment();

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.kill();
          reject(new Error('angycode-server did not become ready within 15 seconds'));
        }
      }, START_TIMEOUT_MS);

      const command = Command.create('exec-sh', ['-c', `node '${serverPath}' --port 0`], {
        env,
      });

      command.stdout.on('data', (line: string) => {
        if (settled) return;
        const match = line.trim().match(READY_REGEX);
        if (match) {
          this.baseUrl_ = `http://127.0.0.1:${match[1]}`;
          this.running = true;
          settled = true;
          clearTimeout(timeout);
          resolve();
        }
      });

      command.stderr.on('data', (line: string) => {
        console.warn('[ServerProcess] stderr:', line);
      });

      command.on('close', (data: { code: number | null; signal: number | null }) => {
        this.running = false;
        this.child = null;
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error(`angycode-server exited with code ${data.code} before becoming ready`));
        }
      });

      command.on('error', (err: string) => {
        this.running = false;
        this.child = null;
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error(`angycode-server spawn error: ${err}`));
        }
      });

      command.spawn().then((child: Child) => {
        this.child = child;
      }).catch((err: unknown) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error(`Failed to spawn angycode-server: ${err}`));
        }
      });
    });
  }

  async stop(): Promise<void> {
    await this.kill();
  }

  getBaseUrl(): string {
    return this.baseUrl_;
  }

  isRunning(): boolean {
    return this.running;
  }

  // ── Private ─────────────────────────────────────────────────────────

  private serverPath_ = '';

  private async resolveServerPath(): Promise<string> {
    if (this.serverPath_) return this.serverPath_;

    // In a Tauri WebKit renderer, import.meta.url is an http:// URL, not file://,
    // so we cannot derive filesystem paths from it. Instead, use a shell probe to
    // find the server entry point relative to the Tauri app's working directory
    // (which is the repo root in both dev and production).
    try {
      const probe = Command.create('exec-sh', ['-c',
        'cd "$(dirname "$(ps -o comm= -p $(ps -o ppid= -p $$))")/.." 2>/dev/null && pwd || pwd',
      ]);
      const out = await probe.execute();
      const root = out.stdout.trim();
      if (root) {
        const candidate = `${root}/code/packages/server/dist/index.js`;
        // Verify the file exists
        const check = Command.create('exec-sh', ['-c', `test -f '${candidate}' && echo ok`]);
        const checkOut = await check.execute();
        if (checkOut.stdout.trim() === 'ok') {
          this.serverPath_ = candidate;
          return candidate;
        }
      }
    } catch { /* fallback below */ }

    // Fallback: try well-known home-relative paths
    const home = (await homeDir()).replace(/\/+$/, '');
    const candidates = [
      `${home}/Work/angy/code/packages/server/dist/index.js`,
      `${home}/angy/code/packages/server/dist/index.js`,
    ];
    for (const c of candidates) {
      try {
        const check = Command.create('exec-sh', ['-c', `test -f '${c}' && echo ok`]);
        const out = await check.execute();
        if (out.stdout.trim() === 'ok') {
          this.serverPath_ = c;
          return c;
        }
      } catch { /* continue */ }
    }

    throw new Error(
      'Could not locate code/packages/server/dist/index.js. ' +
      'Run "cd code && npm install && npm run build" first.',
    );
  }

  private async buildEnvironment(): Promise<Record<string, string>> {
    const home = (await homeDir()).replace(/\/+$/, '');
    const { os } = await getPlatformInfo();
    const extraPaths: string[] = [];

    // Check for NVM node versions
    const nvmBase = `${home}/.nvm/versions/node`;
    try {
      const probe = Command.create('exec-sh', ['-c',
        `ls -1 "${nvmBase}" 2>/dev/null | sort -V | tail -1`]);
      const out = await probe.execute();
      const latestNode = out.stdout.trim();
      if (latestNode) {
        extraPaths.push(`${nvmBase}/${latestNode}/bin`);
      }
    } catch { /* nvm not installed */ }

    extraPaths.push(`${home}/.local/bin`);
    extraPaths.push(`${home}/.nix-profile/bin`);
    if (os === 'macos') {
      extraPaths.push('/opt/homebrew/bin', '/opt/homebrew/sbin');
    }
    extraPaths.push(
      '/snap/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
    );

    return {
      HOME: home,
      PATH: extraPaths.join(':'),
    };
  }

  private async kill(): Promise<void> {
    if (this.child) {
      try {
        await this.child.kill();
      } catch { /* already dead */ }
      this.child = null;
    }
    this.running = false;
  }
}
