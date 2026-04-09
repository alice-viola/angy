/**
 * ProcessManager — owns ClaudeProcess lifecycle, fully UI-independent.
 *
 * Creates ClaudeProcess instances and wires StreamParser events to an
 * AgentHandle. Can be used headlessly (with HeadlessHandle) or with a
 * Vue component (ChatPanel implementing AgentHandle).
 */

import { Command } from '@tauri-apps/plugin-shell';
import { ClaudeProcess } from './ClaudeProcess';
import { CodexProcess } from './CodexProcess';
import type { AgentHandle, ProcessOptions } from './types';
import { engineBus } from './EventBus';
import type { Database } from './Database';
import { SessionMessageBuffer } from './SessionMessageBuffer';
import { summarizeTool } from './toolSummary';

type ManagedProcess = ClaudeProcess | CodexProcess;

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Extract file paths from an `rm` shell command, handling separate flags,
 * quoted paths, and shell operators like `&&`, `||`, `;`, pipes, redirects.
 */
function extractRmPaths(cmd: string): string[] {
  const rmMatch = cmd.match(/\brm\s+(.*)/);
  if (!rmMatch) return [];
  const rmPart = rmMatch[1].split(/\s*(?:&&|\|\||;|>|>>|\|)\s*/)[0];
  const paths: string[] = [];
  const tokens = rmPart.match(/(?:"[^"]*"|'[^']*'|\S)+/g) || [];
  for (const token of tokens) {
    if (token.startsWith('-')) continue;
    const clean = token.replace(/^["']|["']$/g, '');
    if (clean && !clean.includes('*') && !clean.includes('?')) {
      paths.push(clean);
    }
  }
  return paths;
}

async function runAutoCommit(workingDir: string): Promise<void> {
  try {
    const addCmd = Command.create('exec-sh', ['-c', 'git add -A'], { cwd: workingDir || undefined });
    await addCmd.execute();
    const commitCmd = Command.create('exec-sh', ['-c', "git commit -m 'autocommit'"], { cwd: workingDir || undefined });
    await commitCmd.execute();
    console.log('[AutoCommit] Committed successfully');
  } catch (e) {
    console.warn('[AutoCommit] Failed:', e);
  }
}

// ── ProcessManager ───────────────────────────────────────────────────────

export class ProcessManager {
  private processes = new Map<string, ManagedProcess>();
  private buffer: SessionMessageBuffer;
  /** Generation counter per session — stale finished handlers detect they are outdated. */
  private generations = new Map<string, number>();

  constructor(db: Database) {
    this.buffer = new SessionMessageBuffer(db);
  }

  /**
   * Send a message to Claude for a given session.
   * Creates a new ClaudeProcess, wires all StreamParser events to the handle,
   * and sends the message.
   */
  sendMessage(
    sessionId: string,
    text: string,
    handle: AgentHandle,
    options: ProcessOptions,
  ): ManagedProcess {
    // Cancel any existing process for this session
    const existing = this.processes.get(sessionId);
    if (existing?.isRunning()) {
      existing.cancel();
    }

    const proc = this.createProcess(options.model);
    proc.setWorkingDirectory(options.workingDir);
    if (options.mode) proc.setMode(options.mode);
    if (options.model) proc.setModel(options.model);
    if (options.systemPrompt) proc.setSystemPrompt(options.systemPrompt);
    if (options.resumeSessionId) proc.setSessionId(options.resumeSessionId);
    if (options.agentName) proc.setAgentName(options.agentName);
    if (options.specialistRole) proc.setSpecialistRole(options.specialistRole);

    // Bump generation so stale finished handlers from cancelled processes are ignored
    const gen = (this.generations.get(sessionId) ?? 0) + 1;
    this.generations.set(sessionId, gen);

    this.processes.set(sessionId, proc);
    this.wireEvents(sessionId, proc, handle, options, gen);
    proc.sendMessage(text, options.images);

    return proc;
  }

  /**
   * Send a tool result back to Claude for a given session.
   * If the process is still running (paused at a tool_use stop), writes directly to its stdin.
   * Otherwise creates a new ClaudeProcess that resumes the session.
   */
  sendToolResult(
    sessionId: string,
    toolUseId: string,
    content: string,
    handle: AgentHandle,
    options: ProcessOptions & { resumeSessionId: string },
  ): ManagedProcess {
    const existing = this.processes.get(sessionId);
    if (existing?.isRunning()) {
      // Process is alive and waiting for the tool_result — write directly to its stdin.
      existing.writeToolResult(toolUseId, content);
      return existing;
    }

    const proc = this.createProcess(options.model);
    proc.setWorkingDirectory(options.workingDir);
    if (options.mode) proc.setMode(options.mode);
    if (options.model) proc.setModel(options.model);
    proc.setSessionId(options.resumeSessionId);

    // Bump generation so stale finished handlers from cancelled processes are ignored
    const gen = (this.generations.get(sessionId) ?? 0) + 1;
    this.generations.set(sessionId, gen);

    this.processes.set(sessionId, proc);
    this.wireEvents(sessionId, proc, handle, options, gen);
    proc.sendToolResult(toolUseId, content);

    return proc;
  }

  /** Cancel the running process for a session. */
  cancelProcess(sessionId: string): void {
    const proc = this.processes.get(sessionId);
    if (proc?.isRunning()) {
      proc.cancel();
      // Issue 5 fix: do NOT delete from processes here — let the finished handler
      // be the sole owner of process-map cleanup. This prevents races where a new
      // sendMessage arrives before the stale finished handler fires.
    }
  }

  /** Get the active process for a session (if any). */
  getProcess(sessionId: string): ManagedProcess | undefined {
    return this.processes.get(sessionId);
  }

  private createProcess(model?: string): ManagedProcess {
    if (model?.startsWith('codex-')) {
      return new CodexProcess();
    }
    return new ClaudeProcess();
  }

  // ── Event wiring (shared by sendMessage / sendToolResult) ──────────

  private wireEvents(
    sessionId: string,
    proc: ManagedProcess,
    handle: AgentHandle,
    options: ProcessOptions,
    generation: number,
  ): void {
    // ── StreamParser events → AgentHandle ──

    proc.streamParser.events.on('textDelta', (text) => {
      this.buffer.appendAssistantDelta(sessionId, text);
      handle.appendTextDelta(sessionId, text);
    });

    proc.streamParser.events.on('thinkingStarted', () => {
      this.buffer.appendAssistantDelta(sessionId, '<thinking>');
      handle.setThinking(sessionId, true);
    });

    proc.streamParser.events.on('thinkingDelta', (text) => {
      this.buffer.appendAssistantDelta(sessionId, text);
      handle.appendThinkingDelta(sessionId, text);
    });

    proc.streamParser.events.on('thinkingStopped', () => {
      this.buffer.appendAssistantDelta(sessionId, '</thinking>\n');
      handle.setThinking(sessionId, false);
    });

    proc.streamParser.events.on('toolUseStarted', (payload) => {
      const summary = summarizeTool(payload.toolName, payload.input);
      this.buffer.addToolMessage(sessionId, {
        toolName: payload.toolName,
        summary,
        toolInput: payload.input ? JSON.stringify(payload.input) : undefined,
        toolId: payload.toolId,
        timestamp: Math.floor(Date.now() / 1000),
      });
      handle.addToolUse(sessionId, payload.toolName, summary, payload.input, payload.toolId);

      // Broadcast status change so fleet UI can track activity for all handle types
      const activity = `${payload.toolName}: ${summary.substring(0, 50)}`;
      engineBus.emit('agent:statusChanged', {
        agentId: sessionId,
        status: 'working',
        activity,
      });

      // Notify about file edits
      if (['Edit', 'Write', 'StrReplace', 'MultiEdit'].includes(payload.toolName)) {
        const filePath = payload.input?.file_path || payload.input?.path || '';
        if (filePath) {
          handle.onFileEdited?.(sessionId, filePath, payload.toolName, payload.input);
        }
      }

      // Detect file deletions from Bash rm commands
      if (payload.toolName === 'Bash') {
        const cmd = (payload.input?.command as string) ?? '';
        for (const p of extractRmPaths(cmd)) {
          handle.onFileEdited?.(sessionId, p, 'Delete', payload.input);
        }
      }

    });

    proc.streamParser.events.on('costReported', (data) => {
      engineBus.emit('agent:costUpdate', {
        sessionId: data.sessionId,
        costUsd: data.costUsd,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
      });
    });

    proc.streamParser.events.on('errorOccurred', (error) => {
      // Persist error text through the buffer (sole persistence point for errors).
      // Do NOT call showError here — let proc.events.errorOccurred handle UI feedback.
      this.buffer.appendAssistantDelta(sessionId, `Error: ${error}`);
    });

    proc.streamParser.events.on('resultReady', (payload) => {
      if (payload.sessionId) {
        handle.setRealSessionId(sessionId, payload.sessionId);
      }
    });

    let checkpointIdx = 0;
    proc.streamParser.events.on('checkpointReceived', (uuid) => {
      handle.onCheckpointReceived?.(sessionId, uuid, checkpointIdx);
      checkpointIdx++;
    });

    // ── ClaudeProcess lifecycle events ──

    proc.events.on('finished', (exitCode) => {
      // Issue 5 fix: if a newer process has been started for this session,
      // this is a stale finished handler — skip cleanup to avoid wiping new state
      if (this.generations.get(sessionId) !== generation) {
        return;
      }

      this.buffer.flush(sessionId).then(() => {
        // Re-check generation after async flush in case a new process started while flushing
        if (this.generations.get(sessionId) !== generation) {
          return;
        }

        handle.markDone(sessionId);
        this.buffer.clear(sessionId);
        this.processes.delete(sessionId);

        // Broadcast idle status + session:finished so fleet UI updates for all handle types
        engineBus.emit('agent:statusChanged', {
          agentId: sessionId,
          status: 'idle',
          activity: '',
        });
        engineBus.emit('session:finished', { sessionId, exitCode });

        // Auto-commit after agent completes
        if (options.autoCommit) {
          runAutoCommit(options.workingDir);
        }
      });
    });

    proc.events.on('errorOccurred', (error) => {
      // UI feedback only — do NOT touch the buffer here.
      // Error text is already persisted by streamParser.events.errorOccurred above.
      // The finished handler (which always fires after this) is the sole flusher.
      handle.showError(sessionId, error);
    });
  }
}
