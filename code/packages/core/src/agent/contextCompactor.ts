/**
 * Context Compactor — reduces token usage by summarizing stale tool results.
 *
 * Operates on a Message[] array and returns a NEW compacted copy.
 * The original array is never modified. Structural pairing
 * (tool_use ↔ tool_result) is always preserved.
 */

import type { Message, ContentPart, ToolResultPart, ToolUsePart } from '../types.js';

// ── Public API ──────────────────────────────────────────────────────────

export interface CompactOptions {
  /** Model's max context window in tokens. */
  contextWindow: number;
  /** Number of recent turns to keep raw. A turn = 1 assistant msg + 1 user msg. Default: 6. */
  workingTurns?: number;
  /** Estimated tokens consumed by the system prompt. */
  systemTokens?: number;
  /** Estimated tokens consumed by tool definitions. */
  toolTokens?: number;
  /** Fraction of context window that triggers compaction. Default: 0.40. */
  triggerThreshold?: number;
  /** Fraction of context window that triggers emergency (aggressive) compaction. Default: 0.75. */
  emergencyThreshold?: number;
}

export interface CompactResult {
  messages: Message[];
  compacted: boolean;
  originalTokens: number;
  compactedTokens: number;
  staleMessages: number;
  workingMessages: number;
}

/**
 * Compact a message array by summarizing stale tool results.
 * Returns a new array — the original is never mutated.
 */
export function compactMessages(
  messages: Message[],
  options: CompactOptions,
): CompactResult {
  const workingTurns = options.workingTurns ?? 6;
  const systemTokens = options.systemTokens ?? 0;
  const toolTokens = options.toolTokens ?? 0;
  const triggerThreshold = options.triggerThreshold ?? 0.40;
  const emergencyThreshold = options.emergencyThreshold ?? 0.75;

  const originalTokens = estimateMessageTokens(messages) + systemTokens + toolTokens;

  // PHASE 1: Should we compact?
  if (originalTokens < options.contextWindow * triggerThreshold) {
    return {
      messages,
      compacted: false,
      originalTokens,
      compactedTokens: originalTokens,
      staleMessages: 0,
      workingMessages: messages.length,
    };
  }

  // PHASE 2: Build tool_use lookup
  const toolUseMap = buildToolUseMap(messages);

  // PHASE 3: Find the working window boundary
  const boundary = findWorkingBoundary(messages, workingTurns);

  // PHASE 4: Compact the stale zone
  const staleZone = deepCopyMessages(messages.slice(0, boundary));
  const workingWindow = messages.slice(boundary); // no copy needed — not modified

  compactStaleZone(staleZone, toolUseMap);

  let result = [...staleZone, ...workingWindow];
  let compactedTokens = estimateMessageTokens(result) + systemTokens + toolTokens;

  // PHASE 5: Emergency compression
  if (compactedTokens > options.contextWindow * emergencyThreshold) {
    compactAssistantText(staleZone);

    // Shrink working window if still over budget
    const smallerBoundary = findWorkingBoundary(messages, Math.max(3, workingTurns - 2));
    if (smallerBoundary < boundary) {
      const extraStale = deepCopyMessages(messages.slice(boundary, boundary + (boundary - smallerBoundary)));
      compactStaleZone(extraStale, toolUseMap);
      compactAssistantText(extraStale);
      result = [...staleZone, ...extraStale, ...messages.slice(smallerBoundary > boundary ? smallerBoundary : boundary)];
    } else {
      result = [...staleZone, ...workingWindow];
    }

    compactedTokens = estimateMessageTokens(result) + systemTokens + toolTokens;
  }

  return {
    messages: result,
    compacted: true,
    originalTokens,
    compactedTokens,
    staleMessages: boundary,
    workingMessages: messages.length - boundary,
  };
}

// ── Token estimation ────────────────────────────────────────────────────

export function estimateMessageTokens(messages: Message[]): number {
  let chars = 0;
  for (const msg of messages) {
    for (const part of msg.content) {
      switch (part.type) {
        case 'text':
          chars += part.text.length;
          break;
        case 'tool_use':
          chars += part.name.length + JSON.stringify(part.input).length + 20;
          break;
        case 'tool_result':
          chars += part.content.length + 20;
          break;
        case 'image':
          chars += 1000;
          break;
      }
    }
    chars += 10; // role/envelope overhead
  }
  return Math.ceil(chars / 3.5);
}

// ── Summarization ───────────────────────────────────────────────────────

export function summarizeToolResult(
  toolName: string,
  toolInput: Record<string, unknown>,
  content: string,
  isError: boolean,
): string {
  // Never compress errors — they're important diagnostic signal
  if (isError) return content;

  // Already short: keep as-is
  if (content.length <= 120) return content;

  switch (toolName) {
    case 'Read': {
      const path = toolInput.file_path ?? toolInput.path ?? 'file';
      const match = content.match(/\[Lines (\d+)-(\d+) of (\d+)\]/);
      if (match) {
        return `[Read ${path}: lines ${match[1]}-${match[2]} of ${match[3]}]`;
      }
      const lineCount = content.split('\n').length;
      return `[Read ${path}: ${lineCount} lines]`;
    }

    case 'Bash': {
      const codeMatch = content.match(/<exit_code>(-?\d+)<\/exit_code>/);
      const exitCode = codeMatch ? codeMatch[1] : '?';
      const stdoutMatch = content.match(/<stdout>([\s\S]*?)<\/stdout>/);
      const stdout = stdoutMatch ? stdoutMatch[1] : '';
      const lineCount = stdout.split('\n').filter((l: string) => l.trim()).length;
      const cmd = String(toolInput.command ?? '').substring(0, 60);

      let summary = `[Bash \`${cmd}\`: exit ${exitCode}, ${lineCount} lines]`;

      // For failed commands, preserve the first error line
      if (exitCode !== '0') {
        const stderrMatch = content.match(/<stderr>([\s\S]*?)<\/stderr>/);
        const stderr = stderrMatch ? stderrMatch[1].trim() : '';
        const firstError = (stderr || stdout).split('\n').find((l: string) => l.trim()) ?? '';
        if (firstError) {
          summary += `\n${firstError.substring(0, 200)}`;
        }
      }
      return summary;
    }

    case 'Grep': {
      const lines = content.split('\n').filter((l: string) => l.trim());
      const pattern = toolInput.pattern ?? '?';
      return `[Grep '${pattern}': ${lines.length} matches]`;
    }

    case 'Glob': {
      const lines = content.split('\n').filter((l: string) => l.trim());
      const pattern = toolInput.pattern ?? '?';
      return `[Glob '${pattern}': ${lines.length} files]`;
    }

    case 'Think': {
      return '[Thought recorded]';
    }

    case 'WebFetch': {
      const url = toolInput.url ?? '?';
      return `[Fetched ${url}: ${content.length} chars]`;
    }

    default: {
      if (content.length > 500) {
        return content.substring(0, 400) + '\n[...truncated]';
      }
      return content;
    }
  }
}

// ── Internal helpers ────────────────────────────────────────────────────

function buildToolUseMap(
  messages: Message[],
): Map<string, { name: string; input: Record<string, unknown> }> {
  const map = new Map<string, { name: string; input: Record<string, unknown> }>();
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;
    for (const part of msg.content) {
      if (part.type === 'tool_use') {
        map.set(part.id, { name: part.name, input: part.input });
      }
    }
  }
  return map;
}

/**
 * Find the message index where the "working window" starts.
 * Counts `turns` turns back from the end. A turn = one assistant message
 * followed by one user message (with tool_results).
 * Returns the index of the first message in the working window.
 * The initial user message (index 0) is always in the stale zone
 * (but it's never compacted — it has no tool_results).
 */
function findWorkingBoundary(messages: Message[], turns: number): number {
  let turnCount = 0;
  let i = messages.length - 1;

  while (i >= 1 && turnCount < turns) {
    // Walk backward looking for assistant messages (turn boundaries)
    if (messages[i].role === 'assistant' || messages[i].role === 'user') {
      // A complete turn is user(tool_results) + assistant
      if (messages[i].role === 'assistant') {
        turnCount++;
      }
    }
    if (turnCount < turns) {
      i--;
    }
  }

  // Don't put the goal message (index 0) in the working window
  return Math.max(1, i);
}

function deepCopyMessages(messages: Message[]): Message[] {
  return messages.map((msg) => ({
    role: msg.role,
    content: msg.content.map((part): ContentPart => {
      switch (part.type) {
        case 'text':
          return { ...part };
        case 'tool_use':
          return { ...part, input: { ...part.input } };
        case 'tool_result':
          return { ...part };
        case 'image':
          return { type: 'image', data: part.data, mimeType: part.mimeType };
      }
    }),
  }));
}

function compactStaleZone(
  messages: Message[],
  toolUseMap: Map<string, { name: string; input: Record<string, unknown> }>,
): void {
  for (const msg of messages) {
    if (msg.role !== 'user') continue;

    for (const part of msg.content) {
      if (part.type !== 'tool_result') continue;

      const lookup = toolUseMap.get(part.tool_use_id);
      if (!lookup) continue;

      const summary = summarizeToolResult(
        lookup.name,
        lookup.input,
        part.content,
        part.is_error,
      );
      (part as ToolResultPart).content = summary;
    }
  }
}

function compactAssistantText(messages: Message[]): void {
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;

    for (const part of msg.content) {
      if (part.type === 'text' && part.text.length > 300) {
        part.text = part.text.substring(0, 200) + '\n[...truncated]';
      }
    }
  }
}
