/**
 * ProcessManager — owns ClaudeProcess lifecycle, fully UI-independent.
 *
 * Extracted from composables/useEngine.ts. Creates ClaudeProcess instances,
 * wires StreamParser events to an AgentHandle, and routes MCP orchestrator
 * tool calls to the correct Orchestrator instance.
 *
 * Can be used headlessly (with HeadlessHandle) or with a Vue component
 * (ChatPanel implementing AgentHandle).
 */

import { Command } from '@tauri-apps/plugin-shell';
import { ClaudeProcess } from './ClaudeProcess';
import type { AgentHandle, ProcessOptions } from './types';
import type { Orchestrator } from './Orchestrator';
import { engineBus } from './EventBus';

// ── MCP Prefix ───────────────────────────────────────────────────────────

const MCP_ORCHESTRATOR_PREFIX = 'mcp__c3p2-orchestrator__';

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

/** Summarize a tool call for display. */
function summarizeTool(toolName: string, input: Record<string, any>): string {
  switch (toolName) {
    case 'Edit':
    case 'StrReplace':
    case 'Write':
    case 'Read':
      return input.file_path || input.path || 'file';
    case 'Bash':
      return (input.command || '').substring(0, 80);
    case 'Glob':
    case 'Grep':
      return input.pattern || '';
    case 'TodoWrite':
      return 'updating tasks';
    case 'Agent':
      return input.description || 'subagent';
    case 'AskUserQuestion':
      return 'asking question';
    default:
      return toolName;
  }
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
  private processes = new Map<string, ClaudeProcess>();
  private orchestratorLookup: ((sessionId: string) => Orchestrator | null) | null = null;

  /**
   * Register a function that maps sessionId → Orchestrator instance.
   * Used for pool-aware MCP tool routing: when a tool call like
   * `mcp__c3p2-orchestrator__delegate` is detected, the ProcessManager
   * looks up the correct Orchestrator and forwards the call.
   */
  setOrchestratorLookup(
    lookup: ((sessionId: string) => Orchestrator | null) | null,
  ): void {
    this.orchestratorLookup = lookup;
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
  ): ClaudeProcess {
    // Cancel any existing process for this session
    const existing = this.processes.get(sessionId);
    if (existing?.isRunning()) {
      existing.cancel();
    }

    const proc = new ClaudeProcess();
    proc.setWorkingDirectory(options.workingDir);
    if (options.mode) proc.setMode(options.mode);
    if (options.model) proc.setModel(options.model);
    if (options.systemPrompt) proc.setSystemPrompt(options.systemPrompt);
    if (options.resumeSessionId) proc.setSessionId(options.resumeSessionId);
    if (options.agentName) proc.setAgentName(options.agentName);
    if (options.teamId) proc.setTeamId(options.teamId);
    if (options.autoCommit) proc.setAutoCommit(options.autoCommit);

    this.processes.set(sessionId, proc);
    this.wireEvents(sessionId, proc, handle, options);
    proc.sendMessage(text, options.images);

    return proc;
  }

  /**
   * Send a tool result back to Claude for a given session.
   * Creates a new ClaudeProcess that resumes the session and sends a tool_result envelope.
   */
  sendToolResult(
    sessionId: string,
    toolUseId: string,
    content: string,
    handle: AgentHandle,
    options: ProcessOptions & { resumeSessionId: string },
  ): ClaudeProcess {
    const existing = this.processes.get(sessionId);
    if (existing?.isRunning()) {
      existing.cancel();
    }

    const proc = new ClaudeProcess();
    proc.setWorkingDirectory(options.workingDir);
    if (options.mode) proc.setMode(options.mode);
    if (options.model) proc.setModel(options.model);
    proc.setSessionId(options.resumeSessionId);

    this.processes.set(sessionId, proc);
    this.wireEvents(sessionId, proc, handle, options);
    proc.sendToolResult(toolUseId, content);

    return proc;
  }

  /** Cancel the running process for a session. */
  cancelProcess(sessionId: string): void {
    const proc = this.processes.get(sessionId);
    if (proc?.isRunning()) {
      proc.cancel();
    }
    this.processes.delete(sessionId);
  }

  /** Get the active process for a session (if any). */
  getProcess(sessionId: string): ClaudeProcess | undefined {
    return this.processes.get(sessionId);
  }

  // ── Event wiring (shared by sendMessage / sendToolResult) ──────────

  private wireEvents(
    sessionId: string,
    proc: ClaudeProcess,
    handle: AgentHandle,
    options: ProcessOptions,
  ): void {
    // ── StreamParser events → AgentHandle ──

    proc.streamParser.events.on('textDelta', (text) => {
      handle.appendTextDelta(sessionId, text);
    });

    proc.streamParser.events.on('thinkingStarted', () => {
      handle.setThinking(sessionId, true);
    });

    proc.streamParser.events.on('thinkingDelta', (text) => {
      handle.appendThinkingDelta(sessionId, text);
    });

    proc.streamParser.events.on('thinkingStopped', () => {
      handle.setThinking(sessionId, false);
    });

    proc.streamParser.events.on('toolUseStarted', (payload) => {
      const summary = summarizeTool(payload.toolName, payload.input);
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

      // MCP orchestrator tool interception
      if (payload.toolName.startsWith(MCP_ORCHESTRATOR_PREFIX)) {
        if (this.orchestratorLookup) {
          const orch = this.orchestratorLookup(sessionId);
          if (orch) {
            orch.onMcpToolCalled(sessionId, payload.toolName, payload.input);
          }
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
      handle.showError(sessionId, error);
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
      handle.markDone(sessionId);
      this.processes.delete(sessionId);

      // Broadcast idle status + session:finished so fleet UI updates for all handle types
      engineBus.emit('agent:statusChanged', {
        agentId: sessionId,
        status: 'idle',
        activity: '',
      });
      engineBus.emit('session:finished', { sessionId, exitCode });

      // Notify orchestrator of session turn completion
      if (this.orchestratorLookup) {
        const orch = this.orchestratorLookup(sessionId);
        if (orch) {
          orch.onSessionFinishedProcessing(sessionId);
        }
      }

      // Auto-commit for simple agent modes (orchestrator handles its own commits)
      if (options.autoCommit && options.mode !== 'orchestrator') {
        runAutoCommit(options.workingDir);
      }
    });

    proc.events.on('errorOccurred', (error) => {
      handle.showError(sessionId, error);
    });
  }
}
