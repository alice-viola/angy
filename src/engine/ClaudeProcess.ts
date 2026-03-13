import { Command, type Child } from '@tauri-apps/plugin-shell';
import { homeDir } from '@tauri-apps/api/path';
import { getPlatformInfo } from '@/engine/platform';
import { exists, writeTextFile, mkdir } from '@tauri-apps/plugin-fs';
import { join, appDataDir } from '@tauri-apps/api/path';
import mitt from 'mitt';
import { StreamParser } from './StreamParser';
import { SPECIALIST_TOOLS } from './Orchestrator';

// ── File-based diagnostic logging ────────────────────────────────────────

let _logPath: string | null = null;
let _logBuffer: string[] = [];
let _flushScheduled = false;

async function initLogPath(): Promise<string> {
  if (_logPath) return _logPath;
  const dataDir = await appDataDir();
  const logsDir = await join(dataDir, 'logs');
  try { await mkdir(logsDir, { recursive: true }); } catch { /* exists */ }
  _logPath = await join(logsDir, 'claude-process.log');
  return _logPath;
}

function diagLog(msg: string): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  _logBuffer.push(line);
  if (!_flushScheduled) {
    _flushScheduled = true;
    setTimeout(flushLog, 500);
  }
}

async function flushLog(): Promise<void> {
  _flushScheduled = false;
  if (_logBuffer.length === 0) return;
  const lines = _logBuffer.splice(0);
  try {
    const path = await initLogPath();
    await writeTextFile(path, lines.join('\n') + '\n', { append: true });
  } catch {
    // best-effort — don't crash the app if logging fails
  }
}

// ── ClaudeProcess Events ──────────────────────────────────────────────────

export type ClaudeProcessEvents = {
  started: void;
  finished: number; // exitCode
  errorOccurred: string;
  rewindCompleted: boolean;
};

// ── ClaudeProcess ─────────────────────────────────────────────────────────

export class ClaudeProcess {
  private static instanceCounter = 0;

  readonly events = mitt<ClaudeProcessEvents>();
  readonly streamParser = new StreamParser();

  private child: Child | null = null;
  private childPid: number | null = null;
  private stdoutBuffer = '';
  private stderrBuffer = '';

  private workingDir = '';
  private _sessionId = '';
  private mode = 'agent';
  private model = '';
  private systemPrompt = '';
  private agentName = '';
  private teamId = '';
  private _completedNormally = false;
  private autoCommit = false;
  private epicEnabled = false;
  private _specialistRole = '';
  private readonly _instanceId = ++ClaudeProcess.instanceCounter;

  get sessionId(): string { return this._sessionId; }

  setWorkingDirectory(dir: string): void { this.workingDir = dir; }
  setSessionId(id: string): void { this._sessionId = id; }
  setMode(m: string): void { this.mode = m; }
  setModel(m: string): void { this.model = m; }
  setSystemPrompt(prompt: string): void { this.systemPrompt = prompt; }
  setAgentName(name: string): void { this.agentName = name; }
  setTeamId(id: string): void { this.teamId = id; }
  setAutoCommit(enabled: boolean): void { this.autoCommit = enabled; }
  setEpicEnabled(enabled: boolean): void { this.epicEnabled = enabled; }
  setSpecialistRole(role: string): void { this._specialistRole = role; }

  isRunning(): boolean { return this.child !== null; }

  // ── Build CLI arguments ───────────────────────────────────────────────

  private buildArguments(): string[] {
    const args: string[] = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--replay-user-messages',
    ];

    if (this.model) {
      args.push('--model', this.model);
    }

    if (this._sessionId) {
      args.push('--resume', this._sessionId);
    } else {
      args.push('--session-id', crypto.randomUUID());
    }

    if (this.systemPrompt) {
      args.push('--append-system-prompt', this.systemPrompt);
    }

    if (this.workingDir) {
      args.push('--add-dir', this.workingDir);
    }

    if (this.mode === 'orchestrator') {
      let orchestratorTools =
        'mcp__c3p2-orchestrator__delegate,' +
        'mcp__c3p2-orchestrator__diagnose,' +
        'mcp__c3p2-orchestrator__done,' +
        'mcp__c3p2-orchestrator__fail';
      if (this.autoCommit) {
        orchestratorTools += ',mcp__c3p2-orchestrator__checkpoint';
      }
      if (this.epicEnabled) {
        orchestratorTools += ',mcp__c3p2-orchestrator__spawn_orchestrator';
      }
      args.push(
        '--permission-mode', 'bypassPermissions',
        '--tools', orchestratorTools,
        '--max-turns', '1',
      );
    } else if (this.mode === 'ask') {
      args.push(
        '--permission-mode', 'bypassPermissions',
        '--tools', 'Read,Glob,Grep',
      );
    } else if (this.mode === 'plan') {
      args.push('--permission-mode', 'plan');
    } else {
      let allowedTools: string;
      if (this._specialistRole && SPECIALIST_TOOLS[this._specialistRole]) {
        allowedTools = SPECIALIST_TOOLS[this._specialistRole];
      } else {
        allowedTools = 'Bash,Read,Edit,Write,Glob,Grep,Task,AskUserQuestion';
      }
      if (this.teamId) {
        allowedTools += ',mcp__c3p2-orchestrator__send_message' +
                        ',mcp__c3p2-orchestrator__check_inbox';
      }
      args.push(
        '--permission-mode', 'bypassPermissions',
        '--tools', allowedTools,
      );
    }

    return args;
  }

  // ── Resolve claude binary (mirrors C++ resolveClaudeBinary) ──────────

  private async resolveClaudeBinary(): Promise<string> {
    const home = (await homeDir()).replace(/\/+$/, '');
    const { os } = await getPlatformInfo();
    const candidates = [
      `${home}/.local/bin/claude`,
      `${home}/.nix-profile/bin/claude`,
      '/snap/bin/claude',
      '/usr/local/bin/claude',
      ...(os === 'macos' ? ['/opt/homebrew/bin/claude'] : []),
    ];
    for (const candidate of candidates) {
      try {
        if (await exists(candidate)) return candidate;
      } catch { /* ignore */ }
    }
    return 'claude'; // fallback to bare name
  }

  // ── Build enhanced PATH (mirrors C++ buildProcessEnvironment) ────────

  private async buildEnhancedPath(): Promise<string> {
    const home = (await homeDir()).replace(/\/+$/, '');
    const { os } = await getPlatformInfo();
    const extraPaths: string[] = [];

    // Check for NVM node versions (like the C++ version)
    const nvmBase = `${home}/.nvm/versions/node`;
    try {
      // Try to find latest node version via a quick shell command
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

    return extraPaths.join(':');
  }

  // ── Build environment variables ───────────────────────────────────────

  private async buildEnvironment(): Promise<Record<string, string>> {
    const env: Record<string, string> = {
      CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: '1',
      HOME: (await homeDir()).replace(/\/+$/, ''),
      PATH: await this.buildEnhancedPath(),
    };

    if (this.agentName) env.ANGY_AGENT_NAME = this.agentName;
    if (this.teamId) env.ANGY_TEAM_ID = this.teamId;
    if (this.workingDir) env.ANGY_WORKSPACE = this.workingDir;

    return env;
  }

  // ── Build shell command (PATH resolution for macOS Finder launch) ────

  private async buildShellCommand(args: string[]): Promise<[string, string[]]> {
    const claudeBin = await this.resolveClaudeBinary();
    const escapedArgs = args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
    const shellCmd = `exec '${claudeBin.replace(/'/g, "'\\''")}' ${escapedArgs}`;
    return ['exec-sh', ['-c', shellCmd]];
  }

  // ── Send message ──────────────────────────────────────────────────────

  async sendMessage(
    message: string,
    images: Array<{ data: string; mediaType: string }> = [],
  ): Promise<void> {
    if (this.child) {
      this.events.emit('errorOccurred', 'Process already running');
      return;
    }

    this.streamParser.reset();
    this.stdoutBuffer = '';
    this.stderrBuffer = '';
    this._completedNormally = false;

    const args = this.buildArguments();
    const env = await this.buildEnvironment();

    const [cmdName, shellArgs] = await this.buildShellCommand(args);
    const command = Command.create(cmdName, shellArgs, {
      cwd: this.workingDir || undefined,
      env,
    });

    // Wire up stdout line-by-line processing
    command.stdout.on('data', (data: string) => {
      this.stdoutBuffer += data;
      this.processStdoutBuffer();
    });

    command.stderr.on('data', (data: string) => {
      console.log('[Claude stderr]', data);
      this.stderrBuffer += data;
    });

    command.on('close', (payload) => {
      if (this.stdoutBuffer.trim()) {
        this.streamParser.feed(this.stdoutBuffer);
        this.stdoutBuffer = '';
      }

      const exitCode = this._completedNormally ? 0 : (payload.code ?? 1);
      diagLog(`[Claude #${this._instanceId}] PID=${this.childPid} exited code=${exitCode} completedNormally=${this._completedNormally} signal=${(payload as any).signal ?? 'none'}`);
      if (exitCode !== 0 && this.stderrBuffer.trim()) {
        this.events.emit('errorOccurred', this.stderrBuffer.trim());
      }
      this.stderrBuffer = '';
      this.child = null;
      this.childPid = null;
      this.events.emit('finished', exitCode);
    });

    command.on('error', (error: string) => {
      this.events.emit('errorOccurred', error);
    });

    this.streamParser.events.on('resultReady', (payload) => {
      if (payload.result?.type === 'result' && this.child) {
        this._completedNormally = true;
        diagLog(`[Claude #${this._instanceId}] resultReady → killing PID ${this.childPid}`);
        this.child.kill().catch(() => {});
      }
    });

    const contentArray: any[] = [];
    for (const img of images) {
      contentArray.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mediaType,
          data: img.data,
        },
      });
    }
    contentArray.push({
      type: 'text',
      text: message,
    });

    const envelope = {
      type: 'user',
      message: {
        role: 'user',
        content: contentArray,
      },
    };

    try {
      this.child = await command.spawn();
      this.childPid = (this.child as any).pid ?? null;
      diagLog(`[Claude #${this._instanceId}] Spawned PID=${this.childPid} session=${this._sessionId}`);
      this.events.emit('started', undefined);

      const json = JSON.stringify(envelope);
      console.log('[Claude →]', json);
      await this.child.write(json + '\n');
    } catch (err: any) {
      this.child = null;
      this.childPid = null;
      this.events.emit('errorOccurred',
        `Failed to start 'claude'. Is it installed and in your PATH? ${err?.message ?? err}`);
    }
  }

  // ── Send tool result ──────────────────────────────────────────────────

  async sendToolResult(toolUseId: string, content: string): Promise<void> {
    if (this.child) {
      this.events.emit('errorOccurred', 'Process already running');
      return;
    }

    this.streamParser.reset();
    this.stdoutBuffer = '';
    this.stderrBuffer = '';
    this._completedNormally = false;

    const args = this.buildArguments();
    const env = await this.buildEnvironment();

    const [cmdName, shellArgs] = await this.buildShellCommand(args);
    const command = Command.create(cmdName, shellArgs, {
      cwd: this.workingDir || undefined,
      env,
    });

    command.stdout.on('data', (data: string) => {
      this.stdoutBuffer += data;
      this.processStdoutBuffer();
    });

    command.stderr.on('data', (data: string) => {
      console.log('[Claude stderr]', data);
      this.stderrBuffer += data;
    });

    command.on('close', (payload) => {
      if (this.stdoutBuffer.trim()) {
        this.streamParser.feed(this.stdoutBuffer);
        this.stdoutBuffer = '';
      }
      const exitCode = this._completedNormally ? 0 : (payload.code ?? 1);
      diagLog(`[Claude #${this._instanceId}] PID=${this.childPid} exited code=${exitCode} completedNormally=${this._completedNormally} signal=${(payload as any).signal ?? 'none'}`);
      if (exitCode !== 0 && this.stderrBuffer.trim()) {
        this.events.emit('errorOccurred', this.stderrBuffer.trim());
      }
      this.stderrBuffer = '';
      this.child = null;
      this.childPid = null;
      this.events.emit('finished', exitCode);
    });

    command.on('error', (error: string) => {
      this.events.emit('errorOccurred', error);
    });

    this.streamParser.events.on('resultReady', (payload) => {
      if (payload.result?.type === 'result' && this.child) {
        this._completedNormally = true;
        diagLog(`[Claude #${this._instanceId}] resultReady → killing PID ${this.childPid}`);
        this.child.kill().catch(() => {});
      }
    });

    const envelope = {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUseId,
            content,
          },
        ],
      },
    };

    try {
      this.child = await command.spawn();
      this.childPid = (this.child as any).pid ?? null;
      diagLog(`[Claude #${this._instanceId}] Spawned PID=${this.childPid} session=${this._sessionId}`);
      this.events.emit('started', undefined);
      const json = JSON.stringify(envelope);
      console.log('[Claude →]', json);
      await this.child.write(json + '\n');
    } catch (err: any) {
      this.child = null;
      this.childPid = null;
      this.events.emit('errorOccurred',
        `Failed to start 'claude': ${err?.message ?? err}`);
    }
  }

  // ── Rewind files ──────────────────────────────────────────────────────

  async rewindFiles(checkpointUuid: string): Promise<void> {
    if (!this._sessionId || !checkpointUuid) {
      this.events.emit('rewindCompleted', false);
      return;
    }

    const args = ['--resume', this._sessionId, '--rewind-files', checkpointUuid];
    const [cmdName, shellArgs] = await this.buildShellCommand(args);
    const command = Command.create(cmdName, shellArgs, {
      cwd: this.workingDir || undefined,
      env: await this.buildEnvironment(),
    });

    try {
      const output = await command.execute();
      const ok = output.code === 0;
      this.events.emit('rewindCompleted', ok);
    } catch {
      this.events.emit('rewindCompleted', false);
    }
  }

  // ── Cancel ────────────────────────────────────────────────────────────

  async cancel(): Promise<void> {
    if (!this.child) return;

    diagLog(`[Claude #${this._instanceId}] cancel() → killing PID ${this.childPid}`);
    try {
      await this.child.kill();
    } catch {
      // Process may already be dead
    }

    this.child = null;
    this.childPid = null;
    this.events.emit('finished', -1);
  }

  // ── Stdout line processing ────────────────────────────────────────────

  private processStdoutBuffer(): void {
    while (true) {
      const idx = this.stdoutBuffer.indexOf('\n');
      if (idx < 0) break;
      const line = this.stdoutBuffer.substring(0, idx);
      this.stdoutBuffer = this.stdoutBuffer.substring(idx + 1);
      if (line.trim()) {
        console.log('[Claude ←]', line);
        this.streamParser.feed(line);
      }
    }
  }
}
