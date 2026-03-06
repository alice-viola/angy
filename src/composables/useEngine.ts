/**
 * useEngine — bridge between ClaudeProcess/StreamParser and ChatPanel.
 *
 * Creates and manages ClaudeProcess instances per session.
 * Wires StreamParser events back to ChatPanel methods.
 */

import { ClaudeProcess } from '../engine/ClaudeProcess';

/**
 * Extract file paths from an `rm` shell command, handling separate flags,
 * quoted paths, and shell operators like `&&`, `||`, `;`, pipes, redirects.
 */
function extractRmPaths(cmd: string): string[] {
  const rmMatch = cmd.match(/\brm\s+(.*)/);
  if (!rmMatch) return [];

  // Isolate the rm arguments before any shell operator
  const rmPart = rmMatch[1].split(/\s*(?:&&|\|\||;|>|>>|\|)\s*/)[0];

  // Tokenize respecting quotes
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

// Active processes keyed by sessionId
const processes = new Map<string, ClaudeProcess>();

// ── Global interceptors for orchestrator MCP tools ──────────────────────────

const MCP_ORCHESTRATOR_PREFIX = 'mcp__c3p2-orchestrator__';

let mcpToolInterceptor: ((sessionId: string, toolName: string, args: Record<string, any>) => void) | null = null;
let sessionFinishedInterceptor: ((sessionId: string) => void) | null = null;

export function setMcpToolInterceptor(
  callback: ((sessionId: string, toolName: string, args: Record<string, any>) => void) | null,
): void {
  mcpToolInterceptor = callback;
}

export function setSessionFinishedInterceptor(
  callback: ((sessionId: string) => void) | null,
): void {
  sessionFinishedInterceptor = callback;
}

export interface ChatPanelHandle {
  appendTextDelta(sessionId: string, text: string): void;
  appendThinkingDelta(sessionId: string, text: string): void;
  addToolUse(sessionId: string, toolName: string, summary: string, toolInput?: Record<string, any>, toolId?: string): void;
  markDone(sessionId: string): void;
  showError(sessionId: string, error: string): void;
  setThinking(sessionId: string, thinking: boolean): void;
  setRealSessionId(sessionId: string, realId: string): void;
  onFileEdited?(sessionId: string, filePath: string, toolName: string, toolInput?: Record<string, any>): void;
  onCheckpointReceived?(sessionId: string, uuid: string, replayIndex: number): void;
}

/**
 * Send a message to Claude for a given session.
 * Creates a new ClaudeProcess, wires all StreamParser events to the chatPanel,
 * and sends the message.
 */
export function sendMessageToEngine(
  sessionId: string,
  text: string,
  chatPanel: ChatPanelHandle,
  options: {
    workingDir: string;
    mode?: string;
    model?: string;
    systemPrompt?: string;
    resumeSessionId?: string;
    images?: Array<{ data: string; mediaType: string }>;
    agentName?: string;
    teamId?: string;
    autoCommit?: boolean;
  } = { workingDir: '.' },
): ClaudeProcess {
  // Cancel any existing process for this session
  const existing = processes.get(sessionId);
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

  processes.set(sessionId, proc);

  // ── Wire StreamParser events → ChatPanel ──

  proc.streamParser.events.on('textDelta', (text) => {
    chatPanel.appendTextDelta(sessionId, text);
  });

  proc.streamParser.events.on('thinkingStarted', () => {
    chatPanel.setThinking(sessionId, true);
  });

  proc.streamParser.events.on('thinkingDelta', (text) => {
    chatPanel.appendThinkingDelta(sessionId, text);
  });

  proc.streamParser.events.on('thinkingStopped', () => {
    chatPanel.setThinking(sessionId, false);
  });

  proc.streamParser.events.on('toolUseStarted', (payload) => {
    const summary = summarizeTool(payload.toolName, payload.input);
    chatPanel.addToolUse(sessionId, payload.toolName, summary, payload.input, payload.toolId);

    // Notify effects panel about file edits
    if (['Edit', 'Write', 'StrReplace', 'MultiEdit'].includes(payload.toolName)) {
      const filePath = payload.input?.file_path || payload.input?.path || '';
      if (filePath) {
        chatPanel.onFileEdited?.(sessionId, filePath, payload.toolName, payload.input);
      }
    }

    // Detect file deletions from Bash rm commands
    if (payload.toolName === 'Bash') {
      const cmd = (payload.input?.command as string) ?? '';
      for (const p of extractRmPaths(cmd)) {
        chatPanel.onFileEdited?.(sessionId, p, 'Delete', payload.input);
      }
    }

    // MCP orchestrator tool interception
    if (mcpToolInterceptor && payload.toolName.startsWith(MCP_ORCHESTRATOR_PREFIX)) {
      mcpToolInterceptor(sessionId, payload.toolName, payload.input);
    }
  });

  proc.streamParser.events.on('errorOccurred', (error) => {
    chatPanel.showError(sessionId, error);
  });

  proc.streamParser.events.on('resultReady', (payload) => {
    if (payload.sessionId) {
      chatPanel.setRealSessionId(sessionId, payload.sessionId);
    }
  });

  let checkpointIdx = 0;
  proc.streamParser.events.on('checkpointReceived', (uuid) => {
    chatPanel.onCheckpointReceived?.(sessionId, uuid, checkpointIdx);
    checkpointIdx++;
  });

  // ── Wire ClaudeProcess lifecycle events ──

  proc.events.on('finished', (_exitCode) => {
    chatPanel.markDone(sessionId);
    processes.delete(sessionId);

    // Notify orchestrator of session turn completion
    if (sessionFinishedInterceptor) {
      sessionFinishedInterceptor(sessionId);
    }
  });

  proc.events.on('errorOccurred', (error) => {
    chatPanel.showError(sessionId, error);
  });

  // ── Send the message ──
  proc.sendMessage(text, options.images);

  return proc;
}

/**
 * Send a tool result back to Claude for a given session.
 * Creates a new ClaudeProcess that resumes the session and sends a tool_result envelope.
 */
export function sendToolResultToEngine(
  sessionId: string,
  toolUseId: string,
  content: string,
  chatPanel: ChatPanelHandle,
  options: {
    workingDir: string;
    mode?: string;
    model?: string;
    resumeSessionId: string;
  },
): ClaudeProcess {
  const existing = processes.get(sessionId);
  if (existing?.isRunning()) {
    existing.cancel();
  }

  const proc = new ClaudeProcess();
  proc.setWorkingDirectory(options.workingDir);
  if (options.mode) proc.setMode(options.mode);
  if (options.model) proc.setModel(options.model);
  proc.setSessionId(options.resumeSessionId);

  processes.set(sessionId, proc);

  // Wire StreamParser events → ChatPanel (same as sendMessageToEngine)
  proc.streamParser.events.on('textDelta', (text) => {
    chatPanel.appendTextDelta(sessionId, text);
  });

  proc.streamParser.events.on('thinkingStarted', () => {
    chatPanel.setThinking(sessionId, true);
  });

  proc.streamParser.events.on('thinkingDelta', (text) => {
    chatPanel.appendThinkingDelta(sessionId, text);
  });

  proc.streamParser.events.on('thinkingStopped', () => {
    chatPanel.setThinking(sessionId, false);
  });

  proc.streamParser.events.on('toolUseStarted', (payload) => {
    const summary = summarizeTool(payload.toolName, payload.input);
    chatPanel.addToolUse(sessionId, payload.toolName, summary, payload.input, payload.toolId);

    if (['Edit', 'Write', 'StrReplace', 'MultiEdit'].includes(payload.toolName)) {
      const filePath = payload.input?.file_path || payload.input?.path || '';
      if (filePath) {
        chatPanel.onFileEdited?.(sessionId, filePath, payload.toolName, payload.input);
      }
    }

    // Detect file deletions from Bash rm commands
    if (payload.toolName === 'Bash') {
      const cmd = (payload.input?.command as string) ?? '';
      for (const p of extractRmPaths(cmd)) {
        chatPanel.onFileEdited?.(sessionId, p, 'Delete', payload.input);
      }
    }
  });

  proc.streamParser.events.on('errorOccurred', (error) => {
    chatPanel.showError(sessionId, error);
  });

  proc.streamParser.events.on('resultReady', (payload) => {
    if (payload.sessionId) {
      chatPanel.setRealSessionId(sessionId, payload.sessionId);
    }
  });

  let checkpointIdx2 = 0;
  proc.streamParser.events.on('checkpointReceived', (uuid) => {
    chatPanel.onCheckpointReceived?.(sessionId, uuid, checkpointIdx2);
    checkpointIdx2++;
  });

  proc.events.on('finished', (_exitCode) => {
    chatPanel.markDone(sessionId);
    processes.delete(sessionId);
  });

  proc.events.on('errorOccurred', (error) => {
    chatPanel.showError(sessionId, error);
  });

  // Send the tool result
  proc.sendToolResult(toolUseId, content);

  return proc;
}

/**
 * Cancel the running process for a session.
 */
export function cancelProcess(sessionId: string): void {
  const proc = processes.get(sessionId);
  if (proc?.isRunning()) {
    proc.cancel();
  }
  processes.delete(sessionId);
}

/**
 * Get the active process for a session (if any).
 */
export function getProcess(sessionId: string): ClaudeProcess | undefined {
  return processes.get(sessionId);
}

/**
 * Summarize a tool call for display.
 */
function summarizeTool(toolName: string, input: Record<string, any>): string {
  switch (toolName) {
    case 'Edit':
    case 'StrReplace':
      return input.file_path || input.path || 'file';
    case 'Write':
      return input.file_path || input.path || 'file';
    case 'Read':
      return input.file_path || input.path || 'file';
    case 'Bash':
      return (input.command || '').substring(0, 80);
    case 'Glob':
      return input.pattern || '';
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
