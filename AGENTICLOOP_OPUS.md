# AGENTICLOOP_OPUS.md

## Objective

Transform the `@angycode/core` AgentLoop from a bare ReAct loop into a frontier-grade agentic engine. The goal is not feature parity with Claude Code or Cursor — it's to close the gaps that cause agents to **fail at turn 15, waste turns on discovery, silently introduce regressions, and lose track of file state**.

This plan is grounded in the actual source code as of 2026-03-24. Every file path, every line reference, every constraint is verified against the codebase.

## Architecture Context

The system has two execution paths:

1. **ClaudeProcess path** — shells out to the `claude` CLI binary. Inherits Claude Code's context management, file checkpointing, Task delegation. We don't touch this path.
2. **AgentLoop path** — `code/packages/core/src/agent/AgentLoop.ts`, a custom 475-line ReAct loop served over HTTP/SSE via `code/packages/server/`. This is what we're improving.

The AgentLoop path is used for Gemini models (via `AngyCodeProcessManager`) and potentially for direct Anthropic API access. It's the path that's behind.

---

## Guiding Principles

1. **Each phase is self-contained and shippable.** No phase depends on a later phase. Ship, measure, iterate.
2. **Don't destroy persisted data.** The `messageStore` writes raw messages to SQLite. Compaction happens at read-time, before the provider call — never by mutating stored data.
3. **Respect API contracts.** Anthropic requires strict `tool_use`/`tool_result` pairing (enforced by `sanitizeAnthropicMessages` in `anthropic.ts`). Gemini requires `functionCall`/`functionResponse` pairing. Any message transformation must preserve these structural invariants.
4. **Measure before and after.** Every phase defines what "better" looks like. If we can't measure it, we don't ship it.

---

## Phase 1: Context Compaction (P0)

### Why

The `_loop()` method (AgentLoop.ts line 225) passes the raw `messages[]` array to `provider.streamMessage()` on every turn. After 20 turns of reading files and running bash commands, the array contains 100K+ tokens of stale content. The model starts hallucinating because the signal-to-noise ratio collapses. This is the #1 cause of agent failure in long sessions.

### Where

- **New file:** `code/packages/core/src/agent/contextCompactor.ts`
- **Modified:** `code/packages/core/src/agent/AgentLoop.ts` (the `_loop()` method, before the `provider.streamMessage()` call)
- **Modified:** `code/packages/core/src/types.ts` (add context window sizes to config)

### Design

Create a `compactMessages(messages, budget)` function that operates on the in-memory `Message[]` array. It does NOT modify what's stored in SQLite — it returns a new array optimized for the next provider call.

**Algorithm:**

```
1. Estimate total tokens (heuristic: chars / 3.5 for English/code)
2. If total < 60% of model context window → return as-is (no compaction needed)
3. Partition messages into:
   - ANCHOR: system prompt + first user message (the goal) — never touch
   - WORKING: last N turns (N=6 default) — keep raw
   - STALE: everything between ANCHOR and WORKING — candidates for compaction
4. For each message in STALE:
   - tool_result parts: replace `content` with a one-line summary:
     - Read results → "[Read {file_path}: {lineCount} lines]"
     - Bash results → "[Bash: exit_code={code}, {outputLines} lines of output]"
     - Grep results → "[Grep '{pattern}': {matchCount} matches]"
     - Glob results → "[Glob '{pattern}': {fileCount} files]"
     - Edit results → keep as-is (already short: "Replaced 1 occurrence in ...")
     - Write results → keep as-is (already short: "Wrote N bytes to ...")
   - tool_use parts: keep intact (they're small and the model needs to know what it asked for)
   - text parts: keep intact (model reasoning is valuable signal)
5. Re-estimate tokens. If still > 80%, increase aggressiveness:
   - Summarize assistant text parts in STALE to first 200 chars + "..."
   - Drop tool_use input bodies (keep name only)
6. Return compacted array
```

**Critical constraint:** The compacted array must preserve the structural envelope of every `tool_result` (type, tool_use_id, is_error) so that `sanitizeAnthropicMessages` and `toGeminiContents` continue to work. We only replace the `content` string inside `ToolResultPart`, never remove the part itself or change its `tool_use_id`.

**Token budget configuration:**

```ts
// Add to types.ts or a new config file
const CONTEXT_WINDOWS: Record<string, number> = {
  'claude-opus-4-6': 200_000,
  'claude-sonnet-4-6': 200_000,
  'claude-haiku-4-5-20251001': 200_000,
  'gemini-2.0-pro': 1_000_000,
  'gemini-2.0-flash': 1_000_000,
  'gemini-2.5-pro': 2_000_000,
  'gemini-2.5-flash': 1_000_000,
};
```

### Integration Point

In `AgentLoop._loop()`, right before the provider call (line 225):

```ts
// Before:
const stream = this.options.provider.streamMessage({
  model: this.model,
  system,
  messages,
  ...
});

// After:
const contextWindow = CONTEXT_WINDOWS[this.model] ?? 200_000;
const compactedMessages = compactMessages(messages, {
  contextWindow,
  workingTurns: 6,
  systemTokenEstimate: Math.ceil(system.length / 3.5),
});

const stream = this.options.provider.streamMessage({
  model: this.model,
  system,
  messages: compactedMessages,
  ...
});
```

The original `messages` array (used for persistence and working memory) is untouched. Only the compacted copy goes to the provider.

### How to Measure

- Track `inputTokens` across turns. Before: monotonically increasing. After: should plateau or decrease after compaction triggers.
- Run a 30-turn task (e.g., "read 10 files, then refactor the auth module"). Compare turn-15+ coherence (does the model still follow instructions? does it hallucinate file contents?).

### Tests

- Unit test: `compactMessages` with a 50-message array. Verify tool_use/tool_result pairing is preserved.
- Unit test: Verify compacted messages pass through `sanitizeAnthropicMessages` and `toGeminiContents` without error.
- Unit test: Verify ANCHOR and WORKING regions are never modified.
- Integration test: Run a 20-turn session through the loop. Verify the provider receives fewer tokens on turn 20 than on turn 19 (compaction fired).

---

## Phase 2: Codebase Awareness at Session Start (P0)

### Why

The system prompt in `systemPrompt.ts` provides zero information about the project. The model's first action in every session is 3-5 turns of Glob + Read to understand the codebase structure. That's 30+ seconds and thousands of tokens wasted on blind discovery — every single session.

### Where

- **Modified:** `code/packages/core/src/agent/systemPrompt.ts`
- **New file:** `code/packages/core/src/agent/projectContext.ts`
- **Modified:** `code/packages/core/src/agent/AgentLoop.ts` (pass context to `buildSystemPrompt`)

### Design

Create a `gatherProjectContext(workingDir)` function that runs once at session start and returns a structured context block injected into the system prompt.

**What it gathers:**

```
1. File tree (depth-limited)
   - Run: find . -maxdepth 3 -type f | head -200
   - Exclude: node_modules, dist, .git, build, coverage, __pycache__
   - Output: compact tree format (like `tree -L 3 --gitignore`)

2. Technology detection
   - Check for: package.json, tsconfig.json, Cargo.toml, pyproject.toml, go.mod, etc.
   - Extract: name, main dependencies, scripts
   - Output: "TypeScript + Vue 3 + Tauri project. Build: vite. Test: vitest."

3. Git status (if .git exists)
   - Run: git branch --show-current
   - Run: git status --short | head -20
   - Output: "Branch: main. 3 modified files, 1 untracked."

4. README summary (if exists)
   - Read first 500 chars of README.md
   - Output: truncated excerpt
```

**System prompt structure after this phase:**

```
You are AngyCode, an AI coding assistant.
Working directory: /Users/alice/Work/angy
Current date: 2026-03-24

## Project Context

TypeScript + Vue 3 + Tauri desktop app.
Build: vite | Test: vitest | Package manager: npm

Branch: feature/agent-loop | 3 modified, 1 untracked

Key files:
  src/
    engine/
      AngyEngine.ts, HybridPipelineRunner.ts, ClaudeProcess.ts, ...
    components/
      agents/, chat/, kanban/, ...
  code/
    packages/
      core/src/agent/AgentLoop.ts, tools/, providers/, ...
      server/src/server.ts
  (142 files total, showing top 3 levels)

## Core Behavioral Rules
[existing rules]

## Available tools:
[existing tool list]
```

### Performance Constraint

`gatherProjectContext()` must complete in < 500ms. All operations are local filesystem reads. Use `Promise.all` for parallel execution. Cache the result for the session — don't regenerate on `continueSession`.

### Integration Point

In `AgentLoop.run()` (line 75), before building the system prompt:

```ts
const projectContext = await gatherProjectContext(this.options.workingDir);

const system = buildSystemPrompt({
  workingDir: this.options.workingDir,
  tools: toolDefs,
  extra: this.options.systemPromptExtra,
  projectContext,  // NEW
});
```

In `buildSystemPrompt`, insert the context block between the header and the behavioral rules.

### How to Measure

- Count how many turns the model spends on "orientation" (Glob/Read at the start) before making its first Edit/Write. Before: 3-5 turns. After: 0-1 turns.
- Track first-edit latency (wall clock from session start to first file modification).

### Tests

- Unit test: `gatherProjectContext` on a mock directory tree. Verify output format and size limits.
- Unit test: Verify the system prompt includes the context block.
- Smoke test: Start a session with a real project, verify the model's first action is goal-directed (not exploratory).

---

## Phase 3: Post-Edit Diagnostics (P1)

### Why

When the agent edits a TypeScript file and introduces a syntax error, the Edit tool returns "Replaced 1 occurrence in /path/to/file.ts." The model doesn't know it just broke the build. It continues making more edits on top of broken code, discovers the error 5-10 turns later when it runs tests, and then wastes turns backtracking. This is the "silent corruption → late discovery" loop.

### Where

- **Modified:** `code/packages/core/src/tools/edit.ts`
- **Modified:** `code/packages/core/src/tools/write.ts`
- **New file:** `code/packages/core/src/tools/diagnostics.ts`
- **Modified:** `code/packages/core/src/types.ts` (add `diagnosticsCommand` to `AgentLoopOptions`)

### Design

Create a `runDiagnostics(filePath, workingDir)` function that runs a lightweight syntax/type check after a successful file mutation.

**Diagnostic resolution by file type:**

| Extension | Command | Timeout |
|-----------|---------|---------|
| `.ts`, `.tsx` | `npx tsc --noEmit --pretty --incremental 2>&1 \| head -20` | 10s |
| `.js`, `.jsx` | `node --check {file} 2>&1` | 3s |
| `.py` | `python3 -c "import ast; ast.parse(open('{file}').read())" 2>&1` | 3s |
| `.rs` | `cargo check --message-format=short 2>&1 \| head -20` | 15s |
| Other | skip | — |

**The command is configurable** via `AgentLoopOptions.diagnosticsCommand` — the user (or the HybridPipelineRunner) can override with a project-specific command (e.g., `"npm run typecheck"` or `"make lint"`).

**Integration into tool output:**

After a successful edit, the tool result changes from:

```
Replaced 1 occurrence in /path/to/file.ts
```

to:

```
Replaced 1 occurrence in /path/to/file.ts
⚠ Diagnostics (tsc):
  src/file.ts(42,5): error TS2304: Cannot find name 'foo'.
  src/file.ts(43,10): error TS2551: Property 'baz' does not exist on type 'Bar'.
```

Or, on success:

```
Replaced 1 occurrence in /path/to/file.ts
✓ Diagnostics passed
```

**Critical: diagnostics are best-effort.** If the command fails to run (not installed, timeout, etc.), the tool result is returned without diagnostics. We never block or fail an edit because diagnostics couldn't run.

**Rate limiting:** Don't run diagnostics on every single edit if the model is making a batch of rapid edits. Use a simple heuristic: skip diagnostics if the previous edit was < 2 seconds ago to the same file. The last edit in a batch will still get diagnostics.

### How to Measure

- Track "turns to first error detection" after an agent introduces a bug. Before: 5-10 turns (waits until test run). After: 0 turns (immediate feedback).
- Track "total turns per task" on a benchmark of 10 coding tasks. Expect 15-25% reduction from eliminating backtracking.

### Tests

- Unit test: `runDiagnostics` on a valid `.ts` file returns "passed".
- Unit test: `runDiagnostics` on a `.ts` file with a syntax error returns the error message.
- Unit test: Diagnostics timeout doesn't block the edit tool.
- Integration test: Make an edit that introduces a type error, verify the tool result contains the diagnostic.

---

## Phase 4: Edit Tool Returns Diff Context (P1)

### Why

After an edit, the model doesn't see what the file looks like. If it makes 3 sequential edits to the same file, it's working from a mental model that's 3 versions stale. This causes cascading errors: the next edit's `old_string` is based on what the model *thinks* the file looks like, not what it actually looks like.

### Where

- **Modified:** `code/packages/core/src/tools/edit.ts`

### Design

After a successful edit, include the edited region with ±5 context lines in the tool result.

**Current return (line 69-71 of edit.ts):**
```
Replaced 1 occurrence in /path/to/file.ts
```

**New return:**
```
Replaced 1 occurrence in /path/to/file.ts (lines 40-48)

Context after edit:
    38 | import { foo } from './foo';
    39 | import { bar } from './bar';
  → 40 | import { baz } from './baz';
    41 |
    42 | export function main() {
    43 |   const result = baz();
```

**Implementation:**

After the split/join replacement (line 55-61 of edit.ts), before writing to disk:
1. Find the line offset where the replacement occurred (count newlines in `parts[0]`)
2. Split the result into lines
3. Extract `[offset - 5, offset + newStringLineCount + 5]`
4. Format with line numbers, marking changed lines with `→`
5. Append to the success message

**Size guard:** If `new_string` is more than 30 lines, skip the diff context (it would be too large). Just return the existing short message.

### How to Measure

- Track "edit failures due to stale old_string" (the "Error: old_string not found in file" rate). Before: ~15-20% of edits in long sessions. After: < 5%.

### Tests

- Unit test: Edit a file, verify the output contains context lines with correct line numbers.
- Unit test: Edit with a 50-line replacement, verify context is omitted (size guard).
- Unit test: Edit at the very start of a file, verify context doesn't go negative.

---

## Phase 5: Token Budget Tracking (P1)

### Why

The loop doesn't know how close it is to the context limit. It sends everything and hopes. When the provider returns `max_tokens`, the loop sends a "please continue" nudge — but by that point the context is already degraded and the nudge just adds more noise.

### Where

- **Modified:** `code/packages/core/src/agent/AgentLoop.ts` (track cumulative tokens, emit warnings)
- **Modified:** `code/packages/core/src/types.ts` (add budget event type)

### Design

Add a `cumulativeInputTokens` counter to the loop. After each provider response (line 247 in AgentLoop.ts), update it with `inputTokens` from the usage event. This number represents how many tokens the provider actually processed — it's the ground truth, not an estimate.

**Actions based on budget:**

| Threshold | Action |
|-----------|--------|
| < 50% of context window | Normal operation |
| 50-70% | Emit `budget_warning` event. Trigger Phase 1 compaction with `workingTurns: 8` |
| 70-85% | Emit `budget_critical` event. Trigger aggressive compaction with `workingTurns: 4` |
| > 85% | Emit `budget_exhausted` event. Inject a system nudge: "You are approaching the context limit. Wrap up your current task and provide a summary." |

**New event types:**

```ts
export interface BudgetEvent {
  type: 'budget_warning' | 'budget_critical' | 'budget_exhausted';
  used_tokens: number;
  limit_tokens: number;
  percentage: number;
}
```

This integrates directly with Phase 1 — the budget tracker is the trigger for compaction, not a fixed turn count.

### How to Measure

- Track whether sessions that previously failed with incoherent output at turn 20+ now complete successfully.
- Track the percentage of sessions that trigger `budget_exhausted` (should be < 5% after compaction is working).

---

## Phase 6: Parallel Non-Mutating Tool Execution (P2)

### Why

The tool execution loop (AgentLoop.ts line 340) runs every tool sequentially. When the model issues 4 Read calls in one response, that's 4× the latency. This is most noticeable during exploration phases.

### Where

- **Modified:** `code/packages/core/src/types.ts` (add `mutates` flag to `ToolDefinition`)
- **Modified:** `code/packages/core/src/agent/AgentLoop.ts` (partition and parallelize)
- **Modified:** each tool file (add the flag)

### Design

**Step 1: Classify tools.**

Add `mutates?: boolean` to `ToolDefinition` in `types.ts`.

| Tool | `mutates` |
|------|-----------|
| Read | `false` |
| Glob | `false` |
| Grep | `false` |
| Think | `false` |
| WebFetch | `false` |
| Edit | `true` |
| Write | `true` |
| Bash | `true` |

**Step 2: Partition and execute.**

Replace the serial `for` loop (line 340-401) with:

```ts
// Partition
const nonMutating: [string, { name: string; inputJson: string }][] = [];
const mutating: [string, { name: string; inputJson: string }][] = [];

for (const [id, call] of pendingToolCalls) {
  const tool = tools.find(t => t.definition.name === call.name);
  if (tool && tool.definition.mutates === false) {
    nonMutating.push([id, call]);
  } else {
    mutating.push([id, call]); // default to mutating if unknown
  }
}

// Execute non-mutating in parallel
const nonMutatingResults = await Promise.all(
  nonMutating.map(([id, call]) => executeTool(id, call))
);

// Execute mutating serially
const mutatingResults: ToolResultEntry[] = [];
for (const [id, call] of mutating) {
  mutatingResults.push(await executeTool(id, call));
}

// Reassemble in original pendingToolCalls order
// (important: the provider expects results in the same order as the calls)
```

**Important:** The `executeTool` helper encapsulates the existing logic from lines 348-400 (parse JSON, emit tool_start, execute, emit tool_output, record usage, build result part). Extract it as a private method to avoid duplication.

### How to Measure

- Time the tool execution phase on turns with 3+ non-mutating calls. Expect ~3× speedup.
- No correctness regressions (same results, different execution order).

### Tests

- Unit test: 4 concurrent Read calls complete faster than serial execution.
- Unit test: Results are reassembled in the original call order.
- Unit test: A mix of Read + Edit executes Read in parallel, then Edit serially.

---

## Phase 7: File Checkpointing (P2)

### Why

When the agent makes a mistake (writes wrong content, deletes important code), there's no undo. The ClaudeProcess path has file checkpointing via `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=1`, but the AgentLoop path has nothing.

### Where

- **New file:** `code/packages/core/src/agent/fileCheckpoint.ts`
- **Modified:** `code/packages/core/src/tools/edit.ts` (snapshot before edit)
- **Modified:** `code/packages/core/src/tools/write.ts` (snapshot before write)
- **Modified:** `code/packages/core/src/types.ts` (add checkpoint store to ToolContext)

### Design

A lightweight in-memory checkpoint store that captures file state before mutations.

```ts
interface FileCheckpoint {
  turnIndex: number;
  filePath: string;
  originalContent: string; // content before the mutation
  timestamp: number;
}

class CheckpointStore {
  private checkpoints: FileCheckpoint[] = [];

  snapshot(turnIndex: number, filePath: string, content: string): void;
  getCheckpointsForTurn(turnIndex: number): FileCheckpoint[];
  revertToTurn(turnIndex: number): Promise<void>; // restores all files to pre-turn state
  revertFile(filePath: string, turnIndex: number): Promise<void>;
}
```

**Integration:** Add the `CheckpointStore` to `ToolContext`. In `edit.ts` and `write.ts`, before writing to disk, call `ctx.checkpoints.snapshot(turnIndex, filePath, existingContent)`.

**Expose to the model** via a new `Revert` tool (optional — can also be triggered from the UI or by the orchestrator):

```
Revert: Revert a file to its state at a given turn.
  input: { file_path: string, turn: number }
```

**Memory bound:** Keep only the last 20 checkpoints. Older ones are evicted FIFO. For a typical session, this is more than enough.

### How to Measure

- Number of successful reverts in error recovery scenarios.
- Does the agent successfully recover from a bad edit without needing to re-read the file and manually reconstruct the original?

---

## Phase 8: System Prompt Enrichment (P3)

### Why

The behavioral rules in `systemPrompt.ts` are solid but incomplete. They don't teach the model how to recover from errors, how to verify its work, or how to be token-efficient.

### Where

- **Modified:** `code/packages/core/src/agent/systemPrompt.ts`

### Design

Add these rules to the existing `BEHAVIORAL_RULES`:

```markdown
8. **Verify after editing**: After making edits to a file, review the diagnostics
   output. If errors are reported, fix them immediately before moving on.

9. **Re-read stale files**: If you need to edit a file you read more than 5 turns
   ago, re-read it first. The file may have changed since your last read.

10. **Be token-efficient with reads**: Use offset/limit to read specific sections
    of large files. Use Grep to locate the relevant section first, then Read with
    offset/limit to get just that section.

11. **Verify your work**: Before reporting that a task is complete, run the
    project's test suite or type-checker to confirm nothing is broken. If you
    don't know the test command, check package.json scripts or look for a
    Makefile.

12. **Recover from edit failures**: If an Edit fails with "old_string not found",
    the file has likely changed since you last read it. Re-read the file, find
    the correct current text, and retry the edit.

13. **Structure complex tasks**: For tasks involving more than 3 files, plan your
    approach first using Think. List the files to modify and the order of changes.
    This prevents cascading errors from incomplete refactors.
```

### How to Measure

- Track "edit failure recovery" rate: when an edit fails, does the model re-read and retry (good) or hallucinate and retry with the same wrong string (bad)?
- Track whether the model runs tests before declaring done.

---

## Phase 9: Think Tool Optimization (P4)

### Why

The Think tool (`think.ts`) echoes the thought back as the tool result, which means the entire thought gets re-sent to the provider as a `tool_result` in the next turn. For a 500-token thought, that's 500 tokens wasted on an echo.

### Where

- **Modified:** `code/packages/core/src/tools/think.ts`

### Design

Change the return value from echoing the thought to a minimal acknowledgment:

```ts
// Before (line 15-16 of think.ts):
async function execute(input: Record<string, unknown>): Promise<ToolResult> {
  return { content: input.thought as string, is_error: false };
}

// After:
async function execute(input: Record<string, unknown>): Promise<ToolResult> {
  return { content: 'Thought recorded.', is_error: false };
}
```

The thought is already preserved in the `tool_use` part (the model's output). The `tool_result` doesn't need to repeat it.

**For Anthropic extended thinking:** When using Claude 3.7+ with extended thinking enabled, the Think tool is redundant — the model thinks natively via `thinking` blocks. Consider omitting it from the tool list when the provider supports native thinking (detectable via model name).

### How to Measure

- Measure token savings per session. For a typical 20-turn session with 5 Think calls averaging 300 tokens each, this saves ~1,500 tokens of wasted context.

---

## Implementation Order

```
Week 1:  Phase 2 (codebase awareness) — biggest ROI, smallest effort
         Phase 9 (think optimization) — trivial, ship alongside

Week 2:  Phase 4 (edit diff context) — small change, high value
         Phase 8 (system prompt enrichment) — pure text change

Week 3:  Phase 1 (context compaction) — most complex, most important
         Phase 5 (token budget tracking) — pairs with Phase 1

Week 4:  Phase 3 (post-edit diagnostics) — requires testing across ecosystems
         Phase 6 (parallel tool execution) — clean refactor

Week 5:  Phase 7 (file checkpointing) — nice-to-have, lower urgency
```

## What This Plan Does NOT Include (and Why)

| Excluded | Reason |
|----------|--------|
| Fuzzy edit matching / Levenshtein | High risk of false positive matches. The real fix for edit failures is better context (Phases 2, 4, 8), not fuzzy algorithms that guess which code block you meant. |
| Streaming writes to disk | Over-engineered for a marginal UX improvement. The StreamParser in the UI layer already handles incremental display. |
| SEARCH/REPLACE block format | Breaking change to the tool schema requiring re-prompting every consumer. The current `old_string`/`new_string` format works well when the model has accurate file state (which Phases 4 and 8 provide). |
| Sub-agent delegation (Task tool) | High complexity, high risk. Correct implementation requires shared filesystem state, context isolation, and result summarization. Defer until Phases 1-6 are stable. |
| Codebase embeddings / RAG | Requires infrastructure (embedding model, vector store) that doesn't exist. Phase 2's file tree + grep is 80% of the value for 5% of the effort. Revisit when the agent consistently hits context limits even with compaction. |
