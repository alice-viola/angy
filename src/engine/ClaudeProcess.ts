import { Command, type Child } from '@tauri-apps/plugin-shell';
import { homeDir } from '@tauri-apps/api/path';
import { exists } from '@tauri-apps/plugin-fs';
import mitt from 'mitt';
import { StreamParser } from './StreamParser';

// ── ClaudeProcess Events ──────────────────────────────────────────────────

export type ClaudeProcessEvents = {
  started: void;
  finished: number; // exitCode
  errorOccurred: string;
  rewindCompleted: boolean;
};

// ── ClaudeProcess ─────────────────────────────────────────────────────────

export class ClaudeProcess {
  readonly events = mitt<ClaudeProcessEvents>();
  readonly streamParser = new StreamParser();

  private child: Child | null = null;
  private stdoutBuffer = '';
  private stderrBuffer = '';

  private workingDir = '';
  private _sessionId = '';
  private mode = 'agent';
  private model = '';
  private systemPrompt = '';
  private _profileIds: string[] = [];
  private agentName = '';
  private teamId = '';
  private _completedNormally = false;
  private autoCommit = false;

  get sessionId(): string { return this._sessionId; }

  setWorkingDirectory(dir: string): void { this.workingDir = dir; }
  setSessionId(id: string): void { this._sessionId = id; }
  setMode(m: string): void { this.mode = m; }
  setModel(m: string): void { this.model = m; }
  setSystemPrompt(prompt: string): void { this.systemPrompt = prompt; }
  setProfileIds(ids: string[]): void { this._profileIds = ids; }
  setAgentName(name: string): void { this.agentName = name; }
  setTeamId(id: string): void { this.teamId = id; }
  setAutoCommit(enabled: boolean): void { this.autoCommit = enabled; }

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

    for (const profileId of this._profileIds) {
      args.push('--profile', profileId);
    }

    if (this.mode === 'orchestrator') {
      let orchestratorTools =
        'mcp__c3p2-orchestrator__delegate,' +
        'mcp__c3p2-orchestrator__validate,' +
        'mcp__c3p2-orchestrator__done,' +
        'mcp__c3p2-orchestrator__fail';
      if (this.autoCommit) {
        orchestratorTools += ',mcp__c3p2-orchestrator__checkpoint';
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
      let allowedTools = 'Bash,Read,Edit,Write,Glob,Grep,Task,AskUserQuestion';
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
    const candidates = [
      `${home}/.local/bin/claude`,
      '/opt/homebrew/bin/claude',
      '/usr/local/bin/claude',
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

    extraPaths.push(
      `${home}/.local/bin`,
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
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
      // Process any remaining buffered data
      if (this.stdoutBuffer.trim()) {
        this.streamParser.feed(this.stdoutBuffer);
        this.stdoutBuffer = '';
      }

      // Treat signal-killed exit as success if we saw the result event
      const exitCode = this._completedNormally ? 0 : (payload.code ?? 1);
      console.log('[Claude] Process exited with code', exitCode);
      if (exitCode !== 0 && this.stderrBuffer.trim()) {
        this.events.emit('errorOccurred', this.stderrBuffer.trim());
      }
      this.stderrBuffer = '';
      this.child = null;
      this.events.emit('finished', exitCode);
    });

    command.on('error', (error: string) => {
      this.events.emit('errorOccurred', error);
    });

    // Kill process when Claude finishes (Tauri can't close stdin, so process hangs)
    this.streamParser.events.on('resultReady', (payload) => {
      if (payload.result?.type === 'result' && this.child) {
        this._completedNormally = true;
        this.child.kill().catch(() => {});
      }
    });

    // Build JSON envelope
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
      this.events.emit('started', undefined);

      // Write JSON envelope to stdin then close
      const json = JSON.stringify(envelope);
      console.log('[Claude →]', json);
      await this.child.write(json + '\n');
      // Note: Tauri shell plugin doesn't have closeWriteChannel equivalent.
      // The stdin is kept open, but the CLI reads the first JSON message and proceeds.
    } catch (err: any) {
      this.child = null;
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
      console.log('[Claude] Process exited with code', exitCode);
      if (exitCode !== 0 && this.stderrBuffer.trim()) {
        this.events.emit('errorOccurred', this.stderrBuffer.trim());
      }
      this.stderrBuffer = '';
      this.child = null;
      this.events.emit('finished', exitCode);
    });

    command.on('error', (error: string) => {
      this.events.emit('errorOccurred', error);
    });

    // Kill process when Claude finishes (Tauri can't close stdin, so process hangs)
    this.streamParser.events.on('resultReady', (payload) => {
      if (payload.result?.type === 'result' && this.child) {
        this._completedNormally = true;
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
      this.events.emit('started', undefined);
      const json = JSON.stringify(envelope);
      console.log('[Claude →]', json);
      await this.child.write(json + '\n');
    } catch (err: any) {
      this.child = null;
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

    try {
      await this.child.kill();
    } catch {
      // Process may already be dead
    }

    this.child = null;
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
