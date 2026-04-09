import { Command, type Child } from '@tauri-apps/plugin-shell';
import { homeDir, join, tempDir } from '@tauri-apps/api/path';
import { exists, mkdir, remove, writeFile } from '@tauri-apps/plugin-fs';
import { CODEX_DEFAULT_MODEL_ID } from '@/constants/models';
import { getPlatformInfo } from '@/engine/platform';
import mitt from 'mitt';
import type { StreamParserEvents } from './StreamParser';

export type CodexProcessEvents = {
  started: void;
  finished: number;
  errorOccurred: string;
  rewindCompleted: boolean;
};

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export class CodexProcess {
  readonly events = mitt<CodexProcessEvents>();
  readonly streamParser = { events: mitt<StreamParserEvents>() };

  private child: Child | null = null;
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private workingDir = '';
  private mode = 'agent';
  private model = '';
  private systemPrompt = '';
  private _sessionId = '';
  private _completedNormally = false;
  private tempImagePaths: string[] = [];
  private startedToolIds = new Set<string>();

  get sessionId(): string { return this._sessionId; }

  setWorkingDirectory(dir: string): void { this.workingDir = dir; }
  setSessionId(id: string): void { this._sessionId = id; }
  setMode(mode: string): void { this.mode = mode; }
  setModel(model: string): void { this.model = model; }
  setSystemPrompt(prompt: string): void { this.systemPrompt = prompt; }
  setAgentName(_name: string): void {}
  setSpecialistRole(_role: string): void {}

  isRunning(): boolean { return this.child !== null; }

  async sendMessage(
    message: string,
    images: Array<{ data: string; mediaType: string }> = [],
  ): Promise<void> {
    if (this.child) {
      this.events.emit('errorOccurred', 'Process already running');
      return;
    }

    this.stdoutBuffer = '';
    this.stderrBuffer = '';
    this._completedNormally = false;
    this.startedToolIds.clear();
    await this.cleanupTempImages();

    const prompt = this.systemPrompt
      ? `${this.systemPrompt.trim()}\n\n${message}`
      : message;

    const args = await this.buildArguments(prompt, images);
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
      this.stderrBuffer += data;
    });

    command.on('close', async (payload) => {
      if (this.stdoutBuffer.trim()) {
        this.processStdoutBuffer(true);
      }

      const exitCode = this._completedNormally ? 0 : (payload.code ?? 1);
      if (exitCode !== 0 && this.stderrBuffer.trim()) {
        this.events.emit('errorOccurred', this.stderrBuffer.trim());
      }

      this.stderrBuffer = '';
      this.child = null;
      await this.cleanupTempImages();
      this.events.emit('finished', exitCode);
    });

    command.on('error', (error: string) => {
      this.events.emit('errorOccurred', error);
    });

    try {
      this.child = await command.spawn();
      this.events.emit('started', undefined);
    } catch (err: any) {
      this.child = null;
      await this.cleanupTempImages();
      this.events.emit('errorOccurred',
        `Failed to start 'codex'. Is it installed and in your PATH? ${err?.message ?? err}`);
      this.events.emit('finished', 1);
    }
  }

  async sendToolResult(_toolUseId: string, _content: string): Promise<void> {
    this.events.emit('errorOccurred', 'Codex backend does not support external tool_result resumes');
  }

  async writeToolResult(_toolUseId: string, _content: string): Promise<void> {
    this.events.emit('errorOccurred', 'Codex backend does not support external tool_result resumes');
  }

  async rewindFiles(_checkpointUuid: string): Promise<void> {
    this.events.emit('rewindCompleted', false);
  }

  async cancel(): Promise<void> {
    if (!this.child) return;

    try {
      await this.child.kill();
    } catch {
      // Process may already be gone.
    }

    this.child = null;
    await this.cleanupTempImages();
    this.events.emit('finished', -1);
  }

  private async buildArguments(
    prompt: string,
    images: Array<{ data: string; mediaType: string }>,
  ): Promise<string[]> {
    const args: string[] = [];
    const useDefaultModel = !this.model || this.model === CODEX_DEFAULT_MODEL_ID;
    const rawModel = this.model.replace(/^codex-/, '');
    const isReadOnly = this.mode === 'ask' || this.mode === 'plan' || this.mode === 'investigate';

    if (this._sessionId) {
      args.push('exec', 'resume', '--json', '--skip-git-repo-check');
      if (isReadOnly) {
        args.push('--sandbox', 'read-only');
      } else {
        args.push('--full-auto');
      }
      if (!useDefaultModel && rawModel) args.push('-m', rawModel);
      for (const imagePath of await this.prepareImageFiles(images)) {
        args.push('-i', imagePath);
      }
      args.push(this._sessionId, prompt);
      return args;
    }

    args.push('exec', '--json', '--skip-git-repo-check');
    if (isReadOnly) {
      args.push('--sandbox', 'read-only');
    } else {
      args.push('--full-auto');
    }
    if (this.workingDir) args.push('-C', this.workingDir);
    if (!useDefaultModel && rawModel) args.push('-m', rawModel);
    for (const imagePath of await this.prepareImageFiles(images)) {
      args.push('-i', imagePath);
    }
    args.push(prompt);
    return args;
  }

  private async prepareImageFiles(images: Array<{ data: string; mediaType: string }>): Promise<string[]> {
    if (images.length === 0) return [];

    const tmpDir = await tempDir();
    const dir = await join(tmpDir, `angy-codex-images-${Date.now()}`);
    await mkdir(dir, { recursive: true });

    const paths: string[] = [];
    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      const extension = image.mediaType.split('/')[1] || 'png';
      const filePath = await join(dir, `image-${i}.${extension}`);
      await writeFile(filePath, base64ToBytes(image.data));
      this.tempImagePaths.push(filePath);
      paths.push(filePath);
    }
    return paths;
  }

  private async cleanupTempImages(): Promise<void> {
    if (this.tempImagePaths.length === 0) return;
    const paths = this.tempImagePaths.splice(0);
    await Promise.all(paths.map(async (filePath) => {
      try {
        await remove(filePath);
      } catch {
        // Best-effort cleanup.
      }
    }));
  }

  private async resolveCodexBinary(): Promise<string> {
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
        if (await exists(candidate)) return candidate;
      } catch {
        // Ignore invalid candidates.
      }
    }
    return 'codex';
  }

  private async buildEnhancedPath(): Promise<string> {
    const home = (await homeDir()).replace(/\/+$/, '');
    const { os } = await getPlatformInfo();
    const extraPaths = [
      `${home}/.local/bin`,
      `${home}/.linuxbrew/bin`,
      `${home}/.nix-profile/bin`,
      '/home/linuxbrew/.linuxbrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
    ];
    if (os === 'macos') extraPaths.unshift('/opt/homebrew/bin', '/opt/homebrew/sbin');
    return extraPaths.join(':');
  }

  private async buildEnvironment(): Promise<Record<string, string>> {
    return {
      HOME: (await homeDir()).replace(/\/+$/, ''),
      PATH: await this.buildEnhancedPath(),
    };
  }

  private async buildShellCommand(args: string[]): Promise<[string, string[]]> {
    const codexBin = await this.resolveCodexBinary();
    const escapedArgs = args.map(shellEscape).join(' ');
    return ['exec-sh', ['-c', `exec ${shellEscape(codexBin)} ${escapedArgs}`]];
  }

  private processStdoutBuffer(flushRest = false): void {
    while (true) {
      const newlineIdx = this.stdoutBuffer.indexOf('\n');
      if (newlineIdx < 0) {
        if (flushRest && this.stdoutBuffer.trim()) {
          this.handleStdoutLine(this.stdoutBuffer);
          this.stdoutBuffer = '';
        }
        break;
      }
      const line = this.stdoutBuffer.slice(0, newlineIdx);
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIdx + 1);
      this.handleStdoutLine(line);
    }
  }

  private handleStdoutLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) return;

    let event: any;
    try {
      event = JSON.parse(trimmed);
    } catch {
      return;
    }

    switch (event.type) {
      case 'thread.started':
        if (typeof event.thread_id === 'string' && event.thread_id) {
          this._sessionId = event.thread_id;
          this.streamParser.events.emit('resultReady', {
            sessionId: event.thread_id,
            result: event,
          });
        }
        break;

      case 'item.started':
        this.handleItemStarted(event.item);
        break;

      case 'item.completed':
        this.handleItemCompleted(event.item);
        break;

      case 'turn.completed':
        this._completedNormally = true;
        this.streamParser.events.emit('costReported', {
          sessionId: this._sessionId,
          costUsd: 0,
          inputTokens: event.usage?.input_tokens ?? 0,
          outputTokens: event.usage?.output_tokens ?? 0,
        });
        break;

      case 'error':
        this.streamParser.events.emit('errorOccurred', event.message ?? JSON.stringify(event));
        break;
    }
  }

  private handleItemStarted(item: any): void {
    if (!item || typeof item !== 'object') return;
    if (item.type !== 'command_execution') return;

    const toolId = String(item.id ?? crypto.randomUUID());
    this.startedToolIds.add(toolId);
    this.streamParser.events.emit('toolUseStarted', {
      toolName: 'Bash',
      toolId,
      input: { command: item.command ?? '' },
    });
  }

  private handleItemCompleted(item: any): void {
    if (!item || typeof item !== 'object') return;

    if (item.type === 'agent_message' && typeof item.text === 'string' && item.text) {
      this.streamParser.events.emit('textDelta', item.text);
      return;
    }

    if (item.type === 'command_execution') {
      const toolId = String(item.id ?? crypto.randomUUID());
      if (!this.startedToolIds.has(toolId)) {
        this.streamParser.events.emit('toolUseStarted', {
          toolName: 'Bash',
          toolId,
          input: { command: item.command ?? '' },
        });
      }
      if (typeof item.aggregated_output === 'string' && item.aggregated_output) {
        this.streamParser.events.emit('toolResultReceived', item.aggregated_output);
      }
    }
  }
}
