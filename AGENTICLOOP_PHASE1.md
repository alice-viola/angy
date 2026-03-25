# AGENTICLOOP_PHASE1.md — Context Compaction

## Why This Is Priority #1

The benchmark proved it. AgentLoop matches Claude Code on pass rate (7/10 both) and beats it on speed. The single weakness is **cost: $4.14 vs $2.31 for the same 10 tasks.**

The root cause is visible in the token growth data:

```
multi-file-refactor (39 turns):
  turn  1: input=  1,820 tokens
  turn 20: input=  7,604 tokens   (4.2× base)
  turn 39: input= 15,708 tokens   (8.6× base)
  TOTAL input across all turns: 320,311 tokens → $1.05

long-session-coherence (41 turns):
  turn  1: input=  1,911 tokens
  turn 20: input= 11,850 tokens   (6.2× base)
  turn 41: input= 20,182 tokens   (10.6× base)
  TOTAL input across all turns: 454,935 tokens → $1.57
```

Every turn resends the entire message history — including stale file reads, old test output, and completed tool results that the model will never reference again. The cost grows **quadratically** because each new turn adds content that gets re-sent on every subsequent turn.

Claude Code avoids this through Anthropic's prompt caching (90% discount on repeated prefixes). We don't get that through the raw API. But we can do something better: **don't send the stale content at all.**

## The Insight: What's Actually Bloating the Context

From the benchmark traces, the large tool outputs (>200 chars) that accumulate in context:

| Tool | Typical size | Frequency | Can compress? |
|------|-------------|-----------|---------------|
| **Read** | 200–2400 chars | 2-3 per task | ✅ After the model has acted on the file, the full content is stale |
| **Bash** | 200–3400 chars | 1-2 per task | ✅ Old test output, compiler output — stale after the model has read it |
| **Think** | 400–1800 chars | 1-2 per task | ✅ The thought served its purpose. The model doesn't re-read old thoughts |
| **Grep** | 400–500 chars | 1-2 per task | ✅ Search results are only relevant for the turn they were requested |
| **Glob** | varies | <1 per task | ✅ File listings go stale after the first exploration |
| **Edit/Write** | 40–80 chars | 2-5 per task | ❌ Already short ("Replaced 1 occurrence in...") |

The compressible content accounts for **60-80% of the context growth**. The rest (assistant reasoning, tool_use inputs, Edit/Write confirmations) is small and should be kept.

## Design

### Core Principle: Replace, Don't Remove

We replace the `content` string inside stale `ToolResultPart` objects with a one-line summary. We never remove parts, never change `tool_use_id`, never break the structural pairing. The compacted messages are structurally identical to the originals — just smaller.

This means:
- `sanitizeAnthropicMessages()` continues to work (it checks `type` and `tool_use_id`, not `content`)
- `toGeminiContents()` continues to work (it wraps `content` in `functionResponse.response.output`)
- The provider sees a valid message history, just with less noise

### Where It Runs

```
  ┌─────────────────────────────────────────────────────┐
  │  messages[] (in-memory, full fidelity)               │
  │  ↕ persisted to messageStore (SQLite) — never touched│
  └──────────────────────┬──────────────────────────────┘
                         │
                    compactMessages()  ← NEW
                         │
                         ▼
              compactedMessages[] (ephemeral copy)
                         │
                         ▼
              provider.streamMessage({ messages: compactedMessages })
```

The raw `messages[]` array is the source of truth. It gets persisted to SQLite as-is. Compaction produces a **new array** that only lives for the duration of one provider call. The original is never modified.

### New File: `code/packages/core/src/agent/contextCompactor.ts`

```ts
interface CompactOptions {
  contextWindow: number;      // model's max context in tokens
  workingTurns: number;       // keep last N turns raw (default: 6)
  systemTokens: number;       // estimated system prompt tokens
  toolTokens: number;         // estimated tool definition tokens
}

function compactMessages(messages: Message[], options: CompactOptions): Message[]
```

### Algorithm

```
PHASE 1 — Should we compact?

  estimatedTokens = estimateMessageTokens(messages) + options.systemTokens + options.toolTokens
  threshold = options.contextWindow * 0.40
  
  if estimatedTokens < threshold:
    return messages  // no compaction needed

PHASE 2 — Build lookup structures

  toolUseMap: Map<tool_use_id, { name, input }>
  
  Walk all messages. For each assistant message, for each tool_use part:
    toolUseMap.set(part.id, { name: part.name, input: part.input })

PHASE 3 — Identify the working window

  Count messages from the end. A "turn" = one assistant message + the 
  following user message (with tool_results). Count back `workingTurns` turns.
  Mark the boundary index.
  
  Messages[0] is always the initial user goal — never compact it.
  Messages[1..boundary] = stale zone
  Messages[boundary..end] = working window (keep raw)

PHASE 4 — Compact the stale zone

  Create a deep copy of messages[0..boundary].
  
  For each user message in the stale zone:
    For each tool_result part in that message:
      lookup = toolUseMap.get(part.tool_use_id)
      summary = summarize(lookup.name, lookup.input, part.content, part.is_error)
      part.content = summary  // replace in the copy

  For each assistant message in the stale zone:
    Keep all text parts as-is (small, valuable reasoning)
    Keep all tool_use parts as-is (small, structural)

PHASE 5 — Emergency compression (if still over budget)

  Re-estimate tokens on the compacted array.
  
  if estimatedTokens > contextWindow * 0.75:
    // Aggressive mode: also compress assistant text in stale zone
    For each assistant message in stale zone:
      For each text part:
        if text.length > 300:
          text = text.substring(0, 200) + "\n[...truncated]"
    
    // Shrink working window
    Repeat PHASE 3-4 with workingTurns = max(3, workingTurns - 2)

PHASE 6 — Return

  Return [...compactedStaleZone, ...rawWorkingWindow]
```

### Summary Functions

The `summarize()` function generates a compact replacement based on the tool name:

```ts
function summarize(
  toolName: string,
  toolInput: Record<string, unknown>,
  content: string,
  isError: boolean,
): string {
  // Never compress error results — they're important diagnostic signal
  if (isError) return content;
  
  // Already-short results: keep as-is
  if (content.length <= 120) return content;

  switch (toolName) {
    case 'Read': {
      // Content format: "[Lines 1-142 of 142]\n     1\t..."
      const match = content.match(/\[Lines (\d+)-(\d+) of (\d+)\]/);
      const path = toolInput.file_path ?? toolInput.path ?? 'file';
      if (match) {
        return `[Read ${path}: lines ${match[1]}-${match[2]} of ${match[3]}]`;
      }
      const lineCount = content.split('\n').length;
      return `[Read ${path}: ${lineCount} lines]`;
    }

    case 'Bash': {
      // Content format: "<stdout>...</stdout><stderr>...</stderr><exit_code>N</exit_code>"
      const codeMatch = content.match(/<exit_code>(-?\d+)<\/exit_code>/);
      const exitCode = codeMatch ? codeMatch[1] : '?';
      const stdoutMatch = content.match(/<stdout>([\s\S]*?)<\/stdout>/);
      const stdout = stdoutMatch ? stdoutMatch[1] : '';
      const lineCount = stdout.split('\n').filter(l => l.trim()).length;
      const cmd = String(toolInput.command ?? '').substring(0, 60);
      
      let summary = `[Bash \`${cmd}\`: exit ${exitCode}, ${lineCount} lines]`;
      
      // For failed commands, keep the first meaningful error line
      if (exitCode !== '0') {
        const stderrMatch = content.match(/<stderr>([\s\S]*?)<\/stderr>/);
        const stderr = stderrMatch ? stderrMatch[1].trim() : '';
        const firstError = (stderr || stdout).split('\n').find(l => l.trim()) ?? '';
        if (firstError) {
          summary += `\n${firstError.substring(0, 200)}`;
        }
      }
      return summary;
    }

    case 'Grep': {
      const lines = content.split('\n').filter(l => l.trim());
      const pattern = toolInput.pattern ?? '?';
      return `[Grep '${pattern}': ${lines.length} matches]`;
    }

    case 'Glob': {
      const lines = content.split('\n').filter(l => l.trim());
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

    default:
      // Unknown tool: truncate if very large
      if (content.length > 500) {
        return content.substring(0, 400) + '\n[...truncated]';
      }
      return content;
  }
}
```

### Token Estimation

Simple heuristic that's good enough for triggering compaction (not for billing):

```ts
function estimateMessageTokens(messages: Message[]): number {
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
          chars += 1000; // rough estimate for image tokens
          break;
      }
    }
    chars += 10; // role/message overhead
  }
  return Math.ceil(chars / 3.5);
}
```

### Integration Into AgentLoop

In `AgentLoop.ts`, the `_loop()` method changes at exactly one point — right before the provider call:

```ts
// line ~225, BEFORE:
const stream = this.options.provider.streamMessage({
  model: this.model,
  system,
  messages,
  tools: toolDefs,
  ...
});

// AFTER:
const compacted = compactMessages(messages, {
  contextWindow: CONTEXT_WINDOWS[this.model] ?? 200_000,
  workingTurns: 6,
  systemTokens: Math.ceil(system.length / 3.5),
  toolTokens: toolDefs.length * 200,
});

const stream = this.options.provider.streamMessage({
  model: this.model,
  system,
  messages: compacted,
  tools: toolDefs,
  ...
});
```

That's it. One call inserted. Everything else — persistence, event emission, tool execution — continues to use the raw `messages` array.

### Context Window Lookup

```ts
const CONTEXT_WINDOWS: Record<string, number> = {
  'claude-sonnet-4-20250514': 200_000,
  'claude-sonnet-4-6':        200_000,
  'claude-opus-4-20250514':   200_000,
  'claude-opus-4-6':          200_000,
  'claude-haiku-4-5-20251001':200_000,
  'gemini-2.5-flash':       1_000_000,
  'gemini-2.5-pro':         2_000_000,
  'gemini-2.0-flash':       1_000_000,
  'gemini-2.0-pro':         1_000_000,
};
```

The 40% trigger threshold means:
- Claude (200K window): compact when estimated tokens > 80K
- Gemini 2.5 Flash (1M window): compact when > 400K
- Gemini rarely needs compaction — its window is enormous

## Projected Impact (from benchmark data)

### multi-file-refactor (39 turns, currently $1.05)

With compaction kicking in at turn 7 (keeping 6 working turns raw):

```
Without compaction:              With compaction:
turn  1: input=  1,820          turn  1: input=  1,820  (no change)
turn 10: input=  4,774          turn 10: input=  3,200  (stale reads compressed)
turn 20: input=  7,604          turn 20: input=  4,100  (46% smaller)
turn 30: input= 11,970          turn 30: input=  5,400  (55% smaller)
turn 39: input= 15,708          turn 39: input=  6,200  (61% smaller)

Total input: 320,311 tokens     Total input: ~170,000 tokens
Cost:        $1.05              Cost:        ~$0.56
```

**Estimated savings: ~$0.49 (47% reduction)**

### long-session-coherence (41 turns, currently $1.57)

```
Without compaction:              With compaction:
Total input: 454,935 tokens     Total input: ~230,000 tokens
Cost:        $1.57              Cost:        ~$0.80

```

**Estimated savings: ~$0.77 (49% reduction)**

### Full benchmark projection

| Task | Current cost | Projected cost | Savings |
|------|-------------|---------------|---------|
| fix-type-error | $0.12 | $0.11 | 8% (short session, minimal compaction) |
| single-file-edit | $0.09 | $0.08 | 11% |
| large-codebase-nav | $0.05 | $0.05 | 0% (under threshold) |
| add-feature | $0.23 | $0.17 | 26% |
| ambiguous-spec | $0.19 | $0.15 | 21% |
| debug-test-failure | $0.29 | $0.20 | 31% |
| error-recovery | $0.24 | $0.17 | 29% |
| multi-file-refactor | $1.05 | $0.56 | 47% |
| from-scratch | $0.31 | $0.22 | 29% |
| long-session-coherence | $1.57 | $0.80 | 49% |
| **TOTAL** | **$4.14** | **~$2.51** | **~39%** |

This would bring AgentLoop's cost from $4.14 down to ~$2.51 — comparable to Claude Code's $2.31.

## Files Changed

| File | Change |
|------|--------|
| **NEW** `code/packages/core/src/agent/contextCompactor.ts` | Core compaction logic: `compactMessages`, `summarize`, `estimateMessageTokens` |
| `code/packages/core/src/agent/AgentLoop.ts` | Import compactor, add one call before `provider.streamMessage()` |
| `code/packages/core/src/agent/index.ts` | Export new module |

No changes to types, tools, providers, messageStore, or the server.

## Testing Strategy

### Unit Tests: `contextCompactor.test.ts`

1. **No compaction when under threshold:** 5-message array with 2000 estimated tokens, contextWindow=200K → returns original array unchanged.

2. **Compaction preserves structure:** 20-message array over threshold → compacted array has same length, same message roles, same tool_use_id values. Pass through `sanitizeAnthropicMessages` — no errors.

3. **Working window untouched:** Last 6 turns (12 messages) are byte-identical to originals.

4. **Goal message untouched:** messages[0] is byte-identical.

5. **Read results compressed:** A Read tool_result with 2000 chars → "[Read src/foo.ts: lines 1-80 of 80]" (~40 chars).

6. **Bash results compressed, errors preserved:** A Bash result with exit_code=1 and 3000 chars → keeps first error line. A Bash result with exit_code=0 → "[Bash `npm test`: exit 0, 45 lines]".

7. **Think results compressed:** 500-char thought → "[Thought recorded]".

8. **Error tool_results never compressed:** A Read with `is_error: true` keeps full content regardless of size.

9. **Edit/Write results untouched:** Already short, kept as-is.

10. **Emergency compression triggers:** Array still over 75% after Phase 4 → assistant text truncated, working window shrinks.

11. **Gemini compatibility:** Compacted messages pass through `toGeminiContents` without error.

### Benchmark Regression Test

After implementation, rerun the full 10-task benchmark:

```bash
npx tsx runner.ts --adapter agentloop --model claude-sonnet-4-20250514 \
  --provider anthropic --parallel 3 --tag phase1-compaction
  
npx tsx report.ts --compare baseline-agentloop phase1-compaction
```

**Pass criteria:**
- Same or better pass rate (≥ 7/10)
- Total cost < $3.00 (down from $4.14)
- No task that previously passed now fails

## What This Does NOT Do

| Not included | Why |
|---|---|
| Token budget tracking / adaptive thresholds | Good idea but separate concern. Phase 1 uses simple heuristic (40% of window). Can add provider-feedback-based triggering later. |
| Prompt caching API integration | Anthropic offers prompt caching via API but it requires specific message structure. Worth exploring as a separate phase — it's complementary to compaction. |
| Source-level truncation (hard cap on Read/Bash output) | The tools already have caps (Bash: 100K, Grep: 50K). Making them more aggressive would lose information for recent turns. Compaction is smarter — it only strips old content. |
| Summarization via LLM call | Using the LLM to summarize old context would produce better summaries but adds latency and cost per turn. The heuristic summaries are good enough. |
