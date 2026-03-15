import mitt from 'mitt';
import { Command } from '@tauri-apps/plugin-shell';

// ── Git Types ──────────────────────────────────────────────────────────────

export interface GitFileEntry {
  path: string;
  indexStatus: string;     // First char of porcelain v1
  workTreeStatus: string;  // Second char
  oldPath?: string;        // For renames
  staged: boolean;
}

export interface GitBranchEntry {
  name: string;
  isLocal: boolean;
  isCurrent: boolean;
  remoteName?: string;
}

export interface GitUnifiedDiff {
  filePath: string;
  oldContent: string;
  newContent: string;
  isBinary: boolean;
}

export interface GitCommitEntry {
  hash: string;
  shortHash: string;
  parents: string[];
  refs: string[];
  subject: string;
  author: string;
  relativeDate: string;
  authorDate: string;
}

// ── Events ─────────────────────────────────────────────────────────────────

type GitEvents = {
  'statusChanged': { entries: GitFileEntry[] };
  'branchChanged': { branch: string };
  'fileDiffReady': { filePath: string; staged: boolean; diff: GitUnifiedDiff };
  'commitSucceeded': { hash: string; message: string };
  'commitFailed': { error: string };
  'pushSucceeded': undefined;
  'pushFailed': { error: string };
  'fetchSucceeded': undefined;
  'fetchFailed': { error: string };
  'branchesListed': { branches: GitBranchEntry[] };
  'checkoutSucceeded': { branch: string };
  'checkoutFailed': { error: string };
  'pullSucceeded': { stdout: string };
  'pullFailed': { error: string };
  'branchCreated': { name: string };
  'branchCreateFailed': { name: string; error: string };
  'mergeSucceeded': { branch: string; output: string };
  'mergeFailed': { branch: string; error: string; conflicted: boolean };
  'mergeAborted': Record<string, never>;
  'logReady': { commits: GitCommitEntry[] };
  'errorOccurred': { operation: string; message: string };
};

// ── GitManager ─────────────────────────────────────────────────────────────

export class GitManager {
  private events = mitt<GitEvents>();
  private workDir = '';
  private currentBranch = '';
  private entries: GitFileEntry[] = [];
  private opQueue: (() => Promise<void>)[] = [];
  private running = false;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  on = this.events.on.bind(this.events);
  off = this.events.off.bind(this.events);

  setWorkingDirectory(dir: string) {
    this.workDir = dir;
    this.refreshStatus();
  }

  // ── Git command runner ────────────────────────────────────────────────

  private async git(...args: string[]): Promise<string> {
    const cmd = Command.create('git', args, { cwd: this.workDir });
    const output = await cmd.execute();
    if (output.code !== 0) {
      throw new Error(output.stderr || `git ${args[0]} failed with code ${output.code}`);
    }
    return output.stdout;
  }

  // ── Serial operation queue ────────────────────────────────────────────

  private enqueue(op: () => Promise<void>) {
    this.opQueue.push(op);
    this.drain();
  }

  private async drain() {
    if (this.running) return;
    this.running = true;
    while (this.opQueue.length > 0) {
      const op = this.opQueue.shift()!;
      try { await op(); } catch (e) { console.error('Git op failed:', e); }
    }
    this.running = false;
  }

  // ── Debounced refresh ─────────────────────────────────────────────────

  scheduleRefresh() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refreshStatus(), 500);
  }

  // ── Status ────────────────────────────────────────────────────────────

  async refreshStatus() {
    this.enqueue(async () => {
      try {
        const output = await this.git('status', '--porcelain=v1', '--branch');
        const lines = output.split('\n').filter(l => l.length > 0);

        this.entries = [];
        for (const line of lines) {
          if (line.startsWith('## ')) {
            const branchPart = line.substring(3);
            const dotIdx = branchPart.indexOf('...');
            this.currentBranch = dotIdx >= 0 ? branchPart.substring(0, dotIdx) : branchPart;
            this.events.emit('branchChanged', { branch: this.currentBranch });
            continue;
          }

          if (line.length < 4) continue;
          const indexStatus = line[0];
          const workTreeStatus = line[1];
          let path = line.substring(3);
          let oldPath: string | undefined;

          // Rename: "R  old -> new"
          const arrowIdx = path.indexOf(' -> ');
          if (arrowIdx >= 0) {
            oldPath = path.substring(0, arrowIdx);
            path = path.substring(arrowIdx + 4);
          }

          const staged = indexStatus !== ' ' && indexStatus !== '?';
          this.entries.push({ path, indexStatus, workTreeStatus, oldPath, staged });
        }

        this.events.emit('statusChanged', { entries: this.entries });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.events.emit('errorOccurred', { operation: 'status', message: msg });
      }
    });
  }

  // ── Diff ──────────────────────────────────────────────────────────────

  async requestFileDiff(filePath: string, staged: boolean) {
    this.enqueue(async () => {
      try {
        const numstatArgs = staged
          ? ['diff', '--cached', '--numstat', '--', filePath]
          : ['diff', '--numstat', '--', filePath];
        const numstat = await this.git(...numstatArgs);
        const isBinary = numstat.includes('-\t-\t');

        if (isBinary) {
          this.events.emit('fileDiffReady', {
            filePath, staged,
            diff: { filePath, oldContent: '', newContent: '', isBinary: true },
          });
          return;
        }

        let oldContent = '';
        try { oldContent = await this.git('show', `HEAD:${filePath}`); } catch { /* new file */ }

        let newContent = '';
        if (staged) {
          try { newContent = await this.git('show', `:${filePath}`); } catch { /* deleted */ }
        } else {
          const { readTextFile } = await import('@tauri-apps/plugin-fs');
          try { newContent = await readTextFile(`${this.workDir}/${filePath}`); } catch { /* deleted */ }
        }

        this.events.emit('fileDiffReady', {
          filePath, staged,
          diff: { filePath, oldContent, newContent, isBinary: false },
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.events.emit('errorOccurred', { operation: 'diff', message: msg });
      }
    });
  }

  // ── Staging ───────────────────────────────────────────────────────────

  async stageFile(filePath: string) {
    this.enqueue(async () => {
      await this.git('add', '--', filePath);
      await this._doRefresh();
    });
  }

  async stageAll() {
    this.enqueue(async () => {
      await this.git('add', '-A');
      await this._doRefresh();
    });
  }

  async unstageFile(filePath: string) {
    this.enqueue(async () => {
      await this.git('reset', 'HEAD', '--', filePath);
      await this._doRefresh();
    });
  }

  async unstageAll() {
    this.enqueue(async () => {
      await this.git('reset', 'HEAD');
      await this._doRefresh();
    });
  }

  // ── Discard ───────────────────────────────────────────────────────────

  async discardFile(filePath: string) {
    this.enqueue(async () => {
      const entry = this.entries.find(e => e.path === filePath);
      if (entry?.indexStatus === '?' && entry?.workTreeStatus === '?') {
        const { remove } = await import('@tauri-apps/plugin-fs');
        await remove(`${this.workDir}/${filePath}`);
      } else {
        await this.git('checkout', '--', filePath);
      }
      await this._doRefresh();
    });
  }

  // ── Commit ────────────────────────────────────────────────────────────

  async commit(message: string) {
    this.enqueue(async () => {
      try {
        const output = await this.git('commit', '-m', message);
        const match = output.match(/\[[\w/.-]+ ([a-f0-9]+)\]/);
        const hash = match?.[1] || '';
        this.events.emit('commitSucceeded', { hash, message });
        await this._doRefresh();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.events.emit('commitFailed', { error: msg });
      }
    });
  }

  // ── Remote ops ────────────────────────────────────────────────────────

  async push() {
    this.enqueue(async () => {
      try {
        await this.git('push');
        this.events.emit('pushSucceeded', undefined);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.events.emit('pushFailed', { error: msg });
      }
    });
  }

  async fetch() {
    this.enqueue(async () => {
      try {
        await this.git('fetch', '--all');
        this.events.emit('fetchSucceeded', undefined);
        await this._doRefresh();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.events.emit('fetchFailed', { error: msg });
      }
    });
  }

  async pull(remote = 'origin', branch?: string) {
    this.enqueue(async () => {
      try {
        const args = ['pull', remote];
        if (branch) args.push(branch);
        const stdout = await this.git(...args);
        this.events.emit('pullSucceeded', { stdout });
        await this._doRefresh();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.events.emit('pullFailed', { error: msg });
      }
    });
  }

  // ── Branches ──────────────────────────────────────────────────────────

  async listBranches() {
    this.enqueue(async () => {
      try {
        const output = await this.git('branch', '-a', '--no-color');
        const branches: GitBranchEntry[] = [];
        for (const line of output.split('\n').filter(l => l.trim())) {
          const isCurrent = line.startsWith('*');
          const name = line.replace(/^\*?\s+/, '').trim();
          if (name.includes('HEAD detached') || name.includes('->')) continue;

          const isLocal = !name.startsWith('remotes/');
          const remoteName = !isLocal ? name.split('/')[1] : undefined;
          const cleanName = isLocal ? name : name.replace(/^remotes\/[^/]+\//, '');

          branches.push({ name: cleanName, isLocal, isCurrent, remoteName });
        }
        this.events.emit('branchesListed', { branches });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.events.emit('errorOccurred', { operation: 'branches', message: msg });
      }
    });
  }

  async checkoutBranch(name: string) {
    this.enqueue(async () => {
      try {
        await this.git('checkout', name);
        this.events.emit('checkoutSucceeded', { branch: name });
        await this._doRefresh();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.events.emit('checkoutFailed', { error: msg });
      }
    });
  }

  async createBranch(name: string, checkout = true, baseBranch?: string) {
    this.enqueue(async () => {
      try {
        const args = checkout ? ['checkout', '-b', name] : ['branch', name];
        if (baseBranch) args.push(baseBranch);
        await this.git(...args);
        this.events.emit('branchCreated', { name });
        if (checkout) await this._doRefresh();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.events.emit('branchCreateFailed', { name, error: msg });
      }
    });
  }

  async merge(branchName: string, noFf = false) {
    this.enqueue(async () => {
      const args = ['merge', branchName];
      if (noFf) args.push('--no-ff');
      const cmd = Command.create('git', args, { cwd: this.workDir });
      const result = await cmd.execute();
      if (result.code === 0) {
        this.events.emit('mergeSucceeded', { branch: branchName, output: result.stdout });
        await this._doRefresh();
      } else {
        const conflicted = result.stdout.includes('CONFLICT') || result.stderr.includes('CONFLICT');
        this.events.emit('mergeFailed', { branch: branchName, error: result.stderr || result.stdout, conflicted });
      }
    });
  }

  async abortMerge() {
    this.enqueue(async () => {
      try {
        await this.git('merge', '--abort');
        this.events.emit('mergeAborted', {});
        await this._doRefresh();
      } catch {
        // If abort fails (e.g. no merge in progress), silently ignore
      }
    });
  }

  async getCurrentBranch(): Promise<string> {
    const result = await Command.create('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: this.workDir }).execute();
    return result.code === 0 ? result.stdout.trim() : '';
  }

  // ── Log ─────────────────────────────────────────────────────────────

  async fetchLog(workDir: string, maxCount: number = 200) {
    this.enqueue(async () => {
      try {
        const cmd = Command.create('git', [
          '-C', workDir,
          'log', '--all',
          '--format=%H\x1e%h\x1e%P\x1e%D\x1e%s\x1e%an\x1e%ar\x1e%aI',
          '--topo-order',
          `--max-count=${maxCount}`,
        ]);
        const output = await cmd.execute();
        if (output.code !== 0) {
          throw new Error(output.stderr || `git log failed with code ${output.code}`);
        }
        const commits: GitCommitEntry[] = [];
        for (const line of output.stdout.split('\n').filter(l => l.length > 0)) {
          const fields = line.split('\x1e');
          if (fields.length < 8) continue;
          commits.push({
            hash: fields[0],
            shortHash: fields[1],
            parents: fields[2].split(' ').filter(s => s.length > 0),
            refs: fields[3].split(', ').map(s => s.trim()).filter(s => s.length > 0),
            subject: fields[4],
            author: fields[5],
            relativeDate: fields[6],
            authorDate: fields[7],
          });
        }
        this.events.emit('logReady', { commits });
      } catch (e: unknown) {
        this.events.emit('logReady', { commits: [] });
        const msg = e instanceof Error ? e.message : String(e);
        this.events.emit('errorOccurred', { operation: 'log', message: msg });
      }
    });
  }

  // ── Getters ───────────────────────────────────────────────────────────

  getBranch() { return this.currentBranch; }
  getEntries() { return this.entries; }

  // ── Internal refresh (no enqueue, called within queued ops) ───────────

  private async _doRefresh() {
    try {
      const output = await this.git('status', '--porcelain=v1', '--branch');
      const lines = output.split('\n').filter(l => l.length > 0);

      this.entries = [];
      for (const line of lines) {
        if (line.startsWith('## ')) {
          const branchPart = line.substring(3);
          const dotIdx = branchPart.indexOf('...');
          this.currentBranch = dotIdx >= 0 ? branchPart.substring(0, dotIdx) : branchPart;
          this.events.emit('branchChanged', { branch: this.currentBranch });
          continue;
        }

        if (line.length < 4) continue;
        const indexStatus = line[0];
        const workTreeStatus = line[1];
        let path = line.substring(3);
        let oldPath: string | undefined;

        const arrowIdx = path.indexOf(' -> ');
        if (arrowIdx >= 0) {
          oldPath = path.substring(0, arrowIdx);
          path = path.substring(arrowIdx + 4);
        }

        const staged = indexStatus !== ' ' && indexStatus !== '?';
        this.entries.push({ path, indexStatus, workTreeStatus, oldPath, staged });
      }

      this.events.emit('statusChanged', { entries: this.entries });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.events.emit('errorOccurred', { operation: 'status', message: msg });
    }
  }
}
