#!/usr/bin/env node
/**
 * Test the context compactor against real exported chat sessions.
 *
 * Converts the UI-layer export format to core Message[] format,
 * inflates tool results to realistic sizes (the exports only store summaries),
 * then runs compaction and shows before/after stats.
 */

import { readFileSync } from 'node:fs';

// ── Import compactor (inline types to avoid build dependency) ───────────

// Duplicated minimal types to avoid needing to build @angycode/core
interface TextPart { type: 'text'; text: string; }
interface ToolUsePart { type: 'tool_use'; id: string; name: string; input: Record<string, unknown>; }
interface ToolResultPart { type: 'tool_result'; tool_use_id: string; content: string; is_error: boolean; }
interface ImagePart { type: 'image'; data: string; mimeType: string; }
type ContentPart = TextPart | ToolUsePart | ToolResultPart | ImagePart;
interface Message { role: 'user' | 'assistant'; content: ContentPart[]; }

// ── Inline the compactor (so we don't need to build the core package) ──

interface CompactOptions {
  contextWindow: number;
  workingTurns?: number;
  systemTokens?: number;
  toolTokens?: number;
  triggerThreshold?: number;
  emergencyThreshold?: number;
}

interface CompactResult {
  messages: Message[];
  compacted: boolean;
  originalTokens: number;
  compactedTokens: number;
  staleMessages: number;
  workingMessages: number;
}

function estimateMessageTokens(messages: Message[]): number {
  let chars = 0;
  for (const msg of messages) {
    for (const part of msg.content) {
      switch (part.type) {
        case 'text': chars += part.text.length; break;
        case 'tool_use': chars += part.name.length + JSON.stringify(part.input).length + 20; break;
        case 'tool_result': chars += part.content.length + 20; break;
        case 'image': chars += 1000; break;
      }
    }
    chars += 10;
  }
  return Math.ceil(chars / 3.5);
}

function summarizeToolResult(
  toolName: string,
  toolInput: Record<string, unknown>,
  content: string,
  isError: boolean,
): string {
  if (isError) return content;
  if (content.length <= 120) return content;

  switch (toolName) {
    case 'Read': {
      const path = toolInput.file_path ?? toolInput.path ?? 'file';
      const match = content.match(/\[Lines (\d+)-(\d+) of (\d+)\]/);
      if (match) return `[Read ${path}: lines ${match[1]}-${match[2]} of ${match[3]}]`;
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
      if (exitCode !== '0') {
        const stderrMatch = content.match(/<stderr>([\s\S]*?)<\/stderr>/);
        const stderr = stderrMatch ? stderrMatch[1].trim() : '';
        const firstError = (stderr || stdout).split('\n').find((l: string) => l.trim()) ?? '';
        if (firstError) summary += `\n${firstError.substring(0, 200)}`;
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
    case 'Think': return '[Thought recorded]';
    case 'WebFetch': {
      const url = toolInput.url ?? '?';
      return `[Fetched ${url}: ${content.length} chars]`;
    }
    default:
      return content.length > 500 ? content.substring(0, 400) + '\n[...truncated]' : content;
  }
}

function buildToolUseMap(messages: Message[]): Map<string, { name: string; input: Record<string, unknown> }> {
  const map = new Map<string, { name: string; input: Record<string, unknown> }>();
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;
    for (const part of msg.content) {
      if (part.type === 'tool_use') map.set(part.id, { name: part.name, input: part.input });
    }
  }
  return map;
}

function findWorkingBoundary(messages: Message[], turns: number): number {
  let turnCount = 0;
  let i = messages.length - 1;
  while (i >= 1 && turnCount < turns) {
    if (messages[i].role === 'assistant') turnCount++;
    if (turnCount < turns) i--;
  }
  return Math.max(1, i);
}

function deepCopyMessages(messages: Message[]): Message[] {
  return JSON.parse(JSON.stringify(messages));
}

function compactMessages(messages: Message[], options: CompactOptions): CompactResult {
  const workingTurns = options.workingTurns ?? 6;
  const systemTokens = options.systemTokens ?? 0;
  const toolTokens = options.toolTokens ?? 0;
  const triggerThreshold = options.triggerThreshold ?? 0.40;
  const emergencyThreshold = options.emergencyThreshold ?? 0.75;
  const originalTokens = estimateMessageTokens(messages) + systemTokens + toolTokens;

  if (originalTokens < options.contextWindow * triggerThreshold) {
    return { messages, compacted: false, originalTokens, compactedTokens: originalTokens, staleMessages: 0, workingMessages: messages.length };
  }

  const toolUseMap = buildToolUseMap(messages);
  const boundary = findWorkingBoundary(messages, workingTurns);
  const staleZone = deepCopyMessages(messages.slice(0, boundary));
  const workingWindow = messages.slice(boundary);

  // Compact stale tool_results
  for (const msg of staleZone) {
    if (msg.role !== 'user') continue;
    for (const part of msg.content) {
      if (part.type !== 'tool_result') continue;
      const lookup = toolUseMap.get(part.tool_use_id);
      if (!lookup) continue;
      part.content = summarizeToolResult(lookup.name, lookup.input, part.content, part.is_error);
    }
  }

  let result = [...staleZone, ...workingWindow];
  let compactedTokens = estimateMessageTokens(result) + systemTokens + toolTokens;

  // Emergency: also truncate assistant text
  if (compactedTokens > options.contextWindow * emergencyThreshold) {
    for (const msg of staleZone) {
      if (msg.role !== 'assistant') continue;
      for (const part of msg.content) {
        if (part.type === 'text' && part.text.length > 300) {
          part.text = part.text.substring(0, 200) + '\n[...truncated]';
        }
      }
    }
    result = [...staleZone, ...workingWindow];
    compactedTokens = estimateMessageTokens(result) + systemTokens + toolTokens;
  }

  return { messages: result, compacted: true, originalTokens, compactedTokens, staleMessages: boundary, workingMessages: messages.length - boundary };
}

// ── Export format → Core Message[] converter ────────────────────────────

interface ExportMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  turnId?: number;
  toolName?: string;
  toolInput?: string;
  toolId?: string;
  timestamp?: number;
}

/** Simulate realistic tool result sizes based on tool type. */
function inflateToolResult(toolName: string, toolInput: Record<string, unknown>, summary: string): string {
  switch (toolName) {
    case 'Read': {
      const path = toolInput.file_path ?? toolInput.path ?? summary;
      // Simulate a 100-line file read
      const lines = Array.from({ length: 100 }, (_, i) =>
        `${String(i + 1).padStart(6)}\t${'  '.repeat(i % 4)}const x${i} = doSomething(${i}); // line ${i + 1}`
      ).join('\n');
      return `[Lines 1-100 of 100]\n${lines}`;
    }
    case 'Bash': {
      const cmd = String(toolInput.command ?? summary);
      // Simulate 30 lines of output
      const stdout = Array.from({ length: 30 }, (_, i) =>
        `output line ${i + 1}: processing item ${i} of 30...`
      ).join('\n');
      return `<stdout>${stdout}</stdout><stderr></stderr><exit_code>0</exit_code>`;
    }
    case 'Grep': {
      const pattern = String(toolInput.pattern ?? '');
      // Simulate 15 matches
      const matches = Array.from({ length: 15 }, (_, i) =>
        `src/module${i}.ts:${10 + i}:  const result = ${pattern}Handler(input);`
      ).join('\n');
      return matches;
    }
    case 'Glob': {
      // Simulate 50 files
      const files = Array.from({ length: 50 }, (_, i) =>
        `src/components/module${i}/index.ts`
      ).join('\n');
      return files;
    }
    case 'Think': {
      // Return a realistic-length thought (400 chars)
      return 'I need to analyze this carefully. The user wants me to modify the authentication module. ' +
        'First, I should read the current implementation. Then identify which functions need to change. ' +
        'The JWT validation logic is spread across three files. I should consolidate it. ' +
        'Let me start by reading src/auth/middleware.ts to understand the current flow. ' +
        'After that, I will create src/auth/jwt.ts and move the token-related functions there.';
    }
    case 'Edit':
    case 'Write': {
      // These are already short in real usage
      const path = toolInput.file_path ?? '';
      return `Replaced 1 occurrence in ${path}`;
    }
    case 'WebFetch': {
      // Simulate 2000 chars of fetched content
      return 'Lorem ipsum '.repeat(170);
    }
    default:
      return summary;
  }
}

function convertExportToCore(exportMsgs: ExportMessage[]): Message[] {
  const coreMessages: Message[] = [];
  let pendingToolUses: ToolUsePart[] = [];
  let pendingToolResults: ToolResultPart[] = [];

  for (let i = 0; i < exportMsgs.length; i++) {
    const m = exportMsgs[i];

    if (m.role === 'user') {
      // Flush any pending tool results as a user message
      if (pendingToolResults.length > 0) {
        coreMessages.push({ role: 'user', content: [...pendingToolResults] });
        pendingToolResults = [];
      }
      coreMessages.push({ role: 'user', content: [{ type: 'text', text: m.content }] });
    } else if (m.role === 'assistant') {
      // Flush any pending tool results as a user message
      if (pendingToolResults.length > 0) {
        coreMessages.push({ role: 'user', content: [...pendingToolResults] });
        pendingToolResults = [];
      }
      // Start a new assistant message
      const parts: ContentPart[] = [];
      if (m.content) {
        parts.push({ type: 'text', text: m.content });
      }
      // Look ahead for tool calls that follow this assistant message
      let j = i + 1;
      while (j < exportMsgs.length && exportMsgs[j].role === 'tool') {
        const t = exportMsgs[j];
        let toolInput: Record<string, unknown> = {};
        try {
          toolInput = JSON.parse(t.toolInput ?? '{}');
        } catch { /* empty */ }

        const toolId = t.toolId ?? `tool_${j}`;
        parts.push({
          type: 'tool_use',
          id: toolId,
          name: t.toolName ?? 'unknown',
          input: toolInput,
        });

        // Generate a realistic-sized tool result
        const inflated = inflateToolResult(t.toolName ?? '', toolInput, t.content);
        pendingToolResults.push({
          type: 'tool_result',
          tool_use_id: toolId,
          content: inflated,
          is_error: false,
        });

        j++;
      }
      coreMessages.push({ role: 'assistant', content: parts });
      i = j - 1; // skip the tool messages we consumed
    } else if (m.role === 'tool') {
      // Orphan tool message (no preceding assistant) — shouldn't happen but handle gracefully
      let toolInput: Record<string, unknown> = {};
      try { toolInput = JSON.parse(m.toolInput ?? '{}'); } catch { /* empty */ }
      const toolId = m.toolId ?? `tool_orphan_${i}`;

      // Create a synthetic assistant with the tool_use
      if (pendingToolResults.length > 0) {
        coreMessages.push({ role: 'user', content: [...pendingToolResults] });
        pendingToolResults = [];
      }
      coreMessages.push({
        role: 'assistant',
        content: [{ type: 'tool_use', id: toolId, name: m.toolName ?? 'unknown', input: toolInput }],
      });
      const inflated = inflateToolResult(m.toolName ?? '', toolInput, m.content);
      pendingToolResults.push({
        type: 'tool_result',
        tool_use_id: toolId,
        content: inflated,
        is_error: false,
      });
    }
  }

  // Flush remaining
  if (pendingToolResults.length > 0) {
    coreMessages.push({ role: 'user', content: [...pendingToolResults] });
  }

  return coreMessages;
}

// ── Analysis helpers ────────────────────────────────────────────────────

function analyzeMessages(messages: Message[], label: string): void {
  let totalChars = 0;
  let toolResultChars = 0;
  let assistantChars = 0;
  let toolUseCount = 0;
  let toolResultCount = 0;
  const toolResultSizes: { name: string; size: number }[] = [];

  const toolUseMap = buildToolUseMap(messages);

  for (const msg of messages) {
    for (const part of msg.content) {
      const size = part.type === 'text' ? part.text.length
        : part.type === 'tool_result' ? part.content.length
        : part.type === 'tool_use' ? JSON.stringify(part.input).length + part.name.length
        : 0;
      totalChars += size;

      if (part.type === 'tool_result') {
        toolResultChars += size;
        toolResultCount++;
        const lookup = toolUseMap.get(part.tool_use_id);
        toolResultSizes.push({ name: lookup?.name ?? '?', size });
      }
      if (part.type === 'text' && msg.role === 'assistant') {
        assistantChars += size;
      }
      if (part.type === 'tool_use') toolUseCount++;
    }
  }

  const tokens = estimateMessageTokens(messages);

  console.log(`\n  ${label}:`);
  console.log(`    Messages: ${messages.length}`);
  console.log(`    Total chars: ${totalChars.toLocaleString()}`);
  console.log(`    Estimated tokens: ${tokens.toLocaleString()}`);
  console.log(`    Tool results: ${toolResultCount} (${toolResultChars.toLocaleString()} chars, ${totalChars ? Math.round(toolResultChars * 100 / totalChars) : 0}%)`);
  console.log(`    Assistant text: ${assistantChars.toLocaleString()} chars (${totalChars ? Math.round(assistantChars * 100 / totalChars) : 0}%)`);
  console.log(`    Tool calls: ${toolUseCount}`);

  // Show top 5 largest tool results
  toolResultSizes.sort((a, b) => b.size - a.size);
  if (toolResultSizes.length > 0) {
    console.log(`    Largest tool results:`);
    for (const { name, size } of toolResultSizes.slice(0, 5)) {
      console.log(`      ${name}: ${size.toLocaleString()} chars`);
    }
  }
}

function pad(s: string | number, width: number): string {
  return String(s).padStart(width);
}

// ── Simulate per-turn token growth ──────────────────────────────────────

function simulateTurnByTurn(messages: Message[], contextWindow: number): void {
  console.log(`\n  Per-turn token growth simulation (contextWindow=${contextWindow.toLocaleString()}):`);
  console.log(`    ${pad('Turn', 6)}  ${pad('Raw tokens', 12)}  ${pad('Compacted', 12)}  ${pad('Savings', 8)}  ${pad('Compacted?', 10)}`);

  // Simulate sending messages[0..i] for each "turn"
  // A turn ends with a user message (tool_results)
  let turnNum = 0;
  for (let i = 0; i < messages.length; i++) {
    // A turn boundary = after a user message that follows an assistant message
    if (messages[i].role === 'user' && i > 0 && messages[i - 1]?.role === 'assistant') {
      turnNum++;
    }
    if (messages[i].role !== 'user' || i === 0) continue;
    // Only log every few turns to keep output readable
    if (turnNum % 3 !== 0 && i < messages.length - 1) continue;

    const slice = messages.slice(0, i + 1);
    const rawTokens = estimateMessageTokens(slice);

    const result = compactMessages(slice, {
      contextWindow,
      workingTurns: 6,
      systemTokens: 500,
      toolTokens: 400,
    });

    const savings = rawTokens > 0 ? Math.round((1 - result.compactedTokens / rawTokens) * 100) : 0;
    const flag = result.compacted ? 'YES' : 'no';

    console.log(`    ${pad(turnNum, 6)}  ${rawTokens.toLocaleString().padStart(12)}  ${result.compactedTokens.toLocaleString().padStart(12)}  ${(savings + '%').padStart(8)}  ${flag.padStart(10)}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────

const files = [
  { path: '/Users/alice/Desktop/Agentloop_2.json', label: 'Agentloop_2 (Gemini session)' },
  { path: '/Users/alice/Desktop/Chat_1_compact.json', label: 'Chat_1_compact (Anthropic session)' },
];

for (const { path, label } of files) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  ${label}`);
  console.log(`${'═'.repeat(70)}`);

  const data = JSON.parse(readFileSync(path, 'utf-8'));
  const exportMsgs: ExportMessage[] = data.sessions[0].messages;
  console.log(`  Export: ${exportMsgs.length} messages (${exportMsgs.filter(m => m.role === 'user').length} user, ${exportMsgs.filter(m => m.role === 'assistant').length} assistant, ${exportMsgs.filter(m => m.role === 'tool').length} tool)`);

  // Convert to core format with inflated tool results
  const coreMessages = convertExportToCore(exportMsgs);

  // Analyze before compaction
  analyzeMessages(coreMessages, 'BEFORE compaction');

  // Run compaction with a 200K context window (Anthropic-sized)
  const result200K = compactMessages(coreMessages, {
    contextWindow: 200_000,
    workingTurns: 6,
    systemTokens: 500,
    toolTokens: 400,
  });
  analyzeMessages(result200K.messages, 'AFTER compaction (200K window)');
  console.log(`    Compacted: ${result200K.compacted}`);
  console.log(`    Token reduction: ${result200K.originalTokens.toLocaleString()} → ${result200K.compactedTokens.toLocaleString()} (${Math.round((1 - result200K.compactedTokens / result200K.originalTokens) * 100)}% savings)`);
  console.log(`    Stale zone: ${result200K.staleMessages} messages | Working window: ${result200K.workingMessages} messages`);

  // Run compaction with a smaller window to force it (simulate budget pressure)
  const resultSmall = compactMessages(coreMessages, {
    contextWindow: 30_000,
    workingTurns: 6,
    systemTokens: 500,
    toolTokens: 400,
  });
  analyzeMessages(resultSmall.messages, 'AFTER compaction (30K window — forced)');
  console.log(`    Compacted: ${resultSmall.compacted}`);
  console.log(`    Token reduction: ${resultSmall.originalTokens.toLocaleString()} → ${resultSmall.compactedTokens.toLocaleString()} (${Math.round((1 - resultSmall.compactedTokens / resultSmall.originalTokens) * 100)}% savings)`);

  // Show per-turn simulation
  simulateTurnByTurn(coreMessages, 30_000);

  // Verify structural integrity
  console.log(`\n  Structural integrity check:`);
  const toolUseIds = new Set<string>();
  const toolResultIds = new Set<string>();
  for (const msg of resultSmall.messages) {
    for (const part of msg.content) {
      if (part.type === 'tool_use') toolUseIds.add(part.id);
      if (part.type === 'tool_result') toolResultIds.add(part.tool_use_id);
    }
  }
  const orphanResults = [...toolResultIds].filter(id => !toolUseIds.has(id));
  const orphanUses = [...toolUseIds].filter(id => !toolResultIds.has(id));
  console.log(`    tool_use IDs: ${toolUseIds.size}`);
  console.log(`    tool_result IDs: ${toolResultIds.size}`);
  console.log(`    Orphan tool_results (no matching tool_use): ${orphanResults.length}`);
  console.log(`    Orphan tool_uses (no matching tool_result): ${orphanUses.length}`);
  console.log(`    Pairing intact: ${orphanResults.length === 0 && orphanUses.length === 0 ? '✅ YES' : '❌ NO'}`);

  // Show sample compacted tool_results
  console.log(`\n  Sample compacted tool results from stale zone:`);
  let shown = 0;
  for (const msg of resultSmall.messages.slice(0, resultSmall.staleMessages)) {
    for (const part of msg.content) {
      if (part.type === 'tool_result' && shown < 8) {
        const lookup = buildToolUseMap(resultSmall.messages).get(part.tool_use_id);
        console.log(`    [${lookup?.name ?? '?'}] → "${part.content.substring(0, 100)}${part.content.length > 100 ? '...' : ''}"`);
        shown++;
      }
    }
  }
}

console.log(`\n${'═'.repeat(70)}`);
console.log('  Done.');
console.log(`${'═'.repeat(70)}`);
