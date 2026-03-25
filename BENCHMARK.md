# BENCHMARK.md — Agentic Loop Evaluation Framework

## Goal

A reproducible, automated benchmark that answers three questions:

1. **How good is our AgentLoop today?** (absolute quality)
2. **Did a change make it better or worse?** (regression detection)
3. **How does it compare to Claude Code?** (competitive gap)

Every task has a deterministic starting state, an automated verifier, and produces structured metrics. No human judgment required for scoring.

---

## Architecture

```
bench/
├── runner.ts              # Harness: sets up repos, runs agents, collects metrics
├── scorer.ts              # Verifies task outcomes, computes scores
├── report.ts              # Generates comparison tables and markdown reports
├── adapters/
│   ├── agentloop.ts       # Runs task via @angycode/core AgentLoop (HTTP/SSE)
│   └── claudecode.ts      # Runs task via `claude` CLI (stream-json)
├── tasks/
│   ├── task.schema.ts     # TypeScript type for task definitions
│   ├── single-file-edit/
│   │   ├── task.json       # Task definition
│   │   ├── repo/           # Git repo snapshot (the starting state)
│   │   └── verify.sh       # Verification script (exit 0 = pass)
│   ├── fix-type-error/
│   ├── add-feature/
│   ├── multi-file-refactor/
│   ├── debug-test-failure/
│   ├── large-codebase-nav/
│   ├── long-session-coherence/
│   ├── error-recovery/
│   ├── from-scratch/
│   └── ambiguous-spec/
├── results/
│   └── {run-id}/
│       ├── metrics.json
│       └── traces/          # Full event logs per task
└── fixtures/
    └── repos/               # Template repos, cloned per run
```

---

## Task Definition Format

Each task is a directory under `bench/tasks/` containing:

```jsonc
// task.json
{
  "id": "fix-type-error",
  "name": "Fix a TypeScript type error",
  "category": "debugging",        // navigation | editing | debugging | generation | coherence
  "difficulty": "easy",           // easy | medium | hard | expert
  "description": "The project has a TypeScript type error in src/auth.ts. Fix it so `npm run typecheck` passes.",
  "goal": "Fix the TypeScript type error in this project. The type checker should pass after your fix.",
  "maxTurns": 30,
  "maxTimeSeconds": 180,
  "repo": "./repo",              // path to git repo snapshot
  "verify": "./verify.sh",       // verification script
  "metrics": {
    "ideal_turns": 3,            // expert human would need ~3 turns
    "ideal_edits": 1             // minimum edits to solve
  }
}
```

**Verification script** (`verify.sh`): Runs inside the task's working directory after the agent finishes. Must exit 0 for pass, non-zero for fail. Can run tests, type-checks, diff comparisons — whatever proves correctness.

```bash
#!/bin/bash
# verify.sh for fix-type-error
cd "$1"  # working directory passed as argument
npx tsc --noEmit 2>&1
exit $?
```

---

## The 10 Benchmark Tasks

### Category 1: Navigation & Discovery

#### Task 1: `large-codebase-nav`
**Difficulty:** Medium  
**Goal:** "In this project, find the function that handles user authentication and tell me which file it's in, what arguments it takes, and what it returns."  
**Repo:** A 200-file TypeScript project with a nested directory structure. The auth function is in `src/services/internal/auth/handler.ts`.  
**Verify:** Check the agent's final text output contains the correct file path, function name, and signature. Pattern match against known answers.  
**What it measures:** How efficiently the agent navigates a codebase. Penalizes agents that read every file vs. those that use Grep/Glob strategically.

#### Task 2: `ambiguous-spec`
**Difficulty:** Hard  
**Goal:** "Add input validation to the user registration endpoint."  
**Repo:** An Express.js API with multiple endpoints. The registration endpoint exists but has no validation. The spec is intentionally vague — the agent must make reasonable decisions about what to validate.  
**Verify:** Run the test suite (`npm test`). Pre-written tests cover: email format, password length, required fields, SQL injection prevention. Agent doesn't know these tests exist.  
**What it measures:** How well the agent handles ambiguity. Does it ask clarifying questions (bad — wastes turns), make reasonable assumptions (good), or hallucinate requirements (bad)?

### Category 2: Single-File Editing

#### Task 3: `single-file-edit`
**Difficulty:** Easy  
**Goal:** "Add a `createdBy` field (type string) to the `Project` interface in src/types.ts, and update the `createProject` function in src/projects.ts to accept and store it."  
**Repo:** A small TypeScript project (~15 files). Clean, no existing errors.  
**Verify:** `npx tsc --noEmit && npm test` — both must pass. Tests verify the new field exists and is stored.  
**What it measures:** Basic edit competence. Can the agent read, understand, and modify two files without breaking anything?

#### Task 4: `fix-type-error`
**Difficulty:** Easy  
**Goal:** "Fix the TypeScript type error in this project. The type checker should pass after your fix."  
**Repo:** Same small project, but with a deliberately introduced type error (wrong argument type in a function call on line 42 of `src/auth.ts`).  
**Verify:** `npx tsc --noEmit` passes.  
**What it measures:** Diagnostic ability. Can the agent identify and fix a type error without being told which file or line?

### Category 3: Multi-File Changes

#### Task 5: `add-feature`
**Difficulty:** Medium  
**Goal:** "Add a DELETE /api/projects/:id endpoint to the Express API. It should check that the project exists, delete it from the database, and return 204. Add appropriate error handling for 404."  
**Repo:** An Express API with existing GET/POST/PUT endpoints, a database layer, and test infrastructure.  
**Verify:** `npm test` — pre-written tests cover: successful deletion, 404 for non-existent project, idempotency.  
**What it measures:** Feature implementation across multiple files (route, controller, test). Requires understanding the existing patterns.

#### Task 6: `multi-file-refactor`
**Difficulty:** Hard  
**Goal:** "Refactor the authentication module. Extract the JWT logic from src/auth/middleware.ts into a new src/auth/jwt.ts file. Update all imports. The existing tests must continue to pass."  
**Repo:** A 40-file project with auth logic tangled in middleware. 8 files import from the auth module.  
**Verify:** `npx tsc --noEmit && npm test` — zero regressions.  
**What it measures:** Multi-file refactoring discipline. Does the agent update all imports? Does it preserve the public API? Does it break things and then scramble to fix them?

### Category 4: Debugging

#### Task 7: `debug-test-failure`
**Difficulty:** Medium  
**Goal:** "The test suite has 2 failing tests. Fix the code (not the tests) so all tests pass."  
**Repo:** A project where `npm test` shows 2 failures. The bugs are: (1) an off-by-one error in pagination logic, (2) a missing null check in user lookup.  
**Verify:** `npm test` — all tests pass.  
**What it measures:** Debugging workflow. Does the agent run the tests first? Does it read the test assertions to understand expected behavior? Does it fix the right thing (code, not tests)?

#### Task 8: `error-recovery`
**Difficulty:** Hard  
**Goal:** "Add a caching layer to the database queries in src/db.ts. Use a simple in-memory Map with TTL expiry."  
**Repo:** A project with a database module. The catch: the initial `src/db.ts` has a subtle pre-existing issue — one function has an incorrect return type annotation that doesn't match the actual return. This will cause the agent's edits to cascade into type errors if it doesn't notice.  
**Verify:** `npx tsc --noEmit && npm test`  
**What it measures:** Error recovery. When the agent's first edit triggers unexpected type errors, does it diagnose the root cause (pre-existing issue) or spiral into a fix loop?

### Category 5: Generation & Coherence

#### Task 9: `from-scratch`
**Difficulty:** Expert  
**Goal:** "Create a CLI tool in TypeScript that reads a CSV file and outputs a formatted markdown table. Support: --input (file path), --columns (comma-separated column names to include), --sort (column to sort by). Use no external dependencies beyond Node.js built-ins and TypeScript."  
**Repo:** An empty directory with only `package.json` (with TypeScript as devDependency) and `tsconfig.json`.  
**Verify:** Run a test script that: (1) creates a sample CSV, (2) runs the CLI with various flag combinations, (3) validates the markdown output format and content. Also: `npx tsc --noEmit`.  
**What it measures:** From-scratch generation quality. Can the agent create a working, well-structured tool without an existing codebase to reference?

#### Task 10: `long-session-coherence`
**Difficulty:** Expert  
**Goal:** "Implement a complete REST API for a todo-list application. Requirements: CRUD endpoints, SQLite storage, input validation, error handling, and tests for every endpoint. Use Express and better-sqlite3."  
**Repo:** Empty project with `package.json` listing dependencies.  
**Verify:** `npm test` — comprehensive test suite (written by the agent) must pass. Also: `npx tsc --noEmit`. Manual check: at least 5 test files, at least 15 test cases.  
**What it measures:** Coherence over a long session (likely 20-40 turns). Does the agent maintain a consistent architecture? Do later changes break earlier work? Does it remember what it already built?

---

## Metrics Collected Per Task

```ts
interface TaskResult {
  taskId: string;
  adapter: 'agentloop' | 'claudecode';
  model: string;

  // ── Outcome ──
  passed: boolean;              // did verify.sh exit 0?
  partialScore: number;         // 0.0-1.0, from scorer (e.g., 3/5 tests pass = 0.6)

  // ── Efficiency ──
  turns: number;                // total provider round-trips
  totalInputTokens: number;     // cumulative input tokens across all turns
  totalOutputTokens: number;    // cumulative output tokens
  totalCostUsd: number;         // estimated cost
  wallTimeSeconds: number;      // wall clock from start to finish

  // ── Quality signals ──
  editAttempts: number;         // total Edit/Write tool calls
  editFailures: number;         // Edit calls that returned is_error: true
  editFailureRate: number;      // editFailures / editAttempts
  toolCallsTotal: number;       // total tool calls
  turnsOnDiscovery: number;     // turns spent on Glob/Read before first Edit/Write
  backtracks: number;           // times the agent re-read a file it already read

  // ── Context health ──
  peakInputTokens: number;      // highest input_tokens in any single turn
  tokenGrowthRate: number;      // linear regression slope of input_tokens over turns
  turnWhereCoherenceDegraded: number | null; // first turn where edit_failure_rate > 50%
}
```

### Derived Scores

```ts
interface AggregateScore {
  adapter: string;
  model: string;

  passRate: number;              // tasks passed / total tasks
  avgPartialScore: number;       // mean partial score across all tasks
  avgTurns: number;              // mean turns per task
  avgCostUsd: number;            // mean cost per task
  avgWallTime: number;           // mean wall time per task
  avgEditFailureRate: number;    // mean edit failure rate
  avgDiscoveryTurns: number;     // mean turns on discovery
  efficiencyScore: number;       // passRate * (ideal_turns / actual_turns), capped at 1.0
  coherenceScore: number;        // fraction of tasks with no coherence degradation
}
```

---

## Adapter Implementations

### `agentloop.ts` — Tests @angycode/core

Starts the `@angycode/server`, sends a POST to `/sessions` with the task goal, consumes events from `/sessions/:id/events`, collects all `AgentEvent` objects until `done` or timeout.

```ts
async function runAgentLoop(task: Task, config: RunConfig): Promise<RawTrace> {
  // 1. Clone task repo to temp directory
  // 2. Start angycode-server (if not already running)
  // 3. POST /sessions { goal, provider, apiKey, workingDir, maxTurns, maxTokens }
  // 4. GET /sessions/:id/events (SSE) — collect events
  // 5. On 'done' or timeout: close connection
  // 6. Return collected events + timing data
}
```

Events are mapped to `TaskResult` metrics:
- `turns` = count of `usage` events
- `totalInputTokens` = sum of `usage.input_tokens`
- `editFailures` = count of `tool_output` events where `name === 'Edit' && is_error === true`
- `turnsOnDiscovery` = turns before the first `tool_start` event with `name in ['Edit', 'Write']`

### `claudecode.ts` — Tests Claude Code CLI

Spawns the `claude` CLI in stream-json mode (same approach as `ClaudeProcess`), feeds the task goal, collects output events. Uses the same StreamParser from the app.

```ts
async function runClaudeCode(task: Task, config: RunConfig): Promise<RawTrace> {
  // 1. Clone task repo to temp directory
  // 2. Spawn: claude -p --input-format stream-json --output-format stream-json
  //           --permission-mode bypassPermissions --model {model}
  //           --add-dir {workingDir} --max-turns {maxTurns}
  // 3. Write goal as stream-json envelope to stdin
  // 4. Parse stdout line-by-line through StreamParser
  // 5. On 'result' event or timeout: kill process
  // 6. Return collected events + timing data
}
```

The Claude Code adapter maps its event format to the same `TaskResult` structure. Some metrics differ:
- Claude Code reports cost directly in the `result` event
- Tool calls are detected via `assistant` snapshot messages with `tool_use` blocks
- Turn count is inferred from the number of `assistant` messages

---

## Runner: How a Benchmark Run Works

```
$ npx tsx bench/runner.ts --adapter agentloop --model gemini-2.5-flash --tasks all

[1/10] large-codebase-nav .............. PASS  (4 turns, 2.1s, $0.003)
[2/10] ambiguous-spec .................. PASS  (12 turns, 28.4s, $0.041)
[3/10] single-file-edit ................ PASS  (3 turns, 8.2s, $0.012)
[4/10] fix-type-error .................. PASS  (4 turns, 11.1s, $0.015)
[5/10] add-feature ..................... PASS  (8 turns, 22.3s, $0.032)
[6/10] multi-file-refactor ............. FAIL  (18 turns, 54.2s, $0.078)
[7/10] debug-test-failure .............. PASS  (6 turns, 16.7s, $0.024)
[8/10] error-recovery .................. FAIL  (22 turns, 71.0s, $0.102)
[9/10] from-scratch .................... PASS  (15 turns, 42.8s, $0.061)
[10/10] long-session-coherence ......... PASS  (32 turns, 98.1s, $0.142)

═══════════════════════════════════════════════════════
  AgentLoop + gemini-2.5-flash
  Pass rate:      8/10 (80%)
  Avg turns:      12.4
  Avg cost:       $0.051
  Avg wall time:  35.5s
  Edit fail rate: 12.3%
  Discovery:      2.1 turns avg
  Coherence:      9/10 (90%)
═══════════════════════════════════════════════════════

Results saved to bench/results/2026-03-24T19-30-00/
```

### Isolation

Each task runs in a fresh temp directory cloned from the task's `repo/` snapshot. Tasks never share filesystem state. The temp directory is deleted after verification (unless `--keep` is passed for debugging).

### Reproducibility

The runner records:
- Full event trace (every event from the adapter)
- Git SHA of the benchmark repo
- Exact model name and provider
- Timestamp and environment info
- The task.json used

Re-running with the same config + model produces comparable (not identical — LLMs are stochastic) results. Statistical significance requires 3+ runs per configuration.

### Timeout

Each task has `maxTimeSeconds`. If the agent hasn't finished, the runner:
1. Sends abort
2. Waits 5s for cleanup
3. Runs verify.sh anyway (partial work might still pass)
4. Records `timedOut: true` in metrics

---

## Comparison Reports

```
$ npx tsx bench/report.ts --runs 2026-03-24T19-30-00 2026-03-24T20-15-00

Comparison: AgentLoop (gemini-2.5-flash) vs Claude Code (claude-sonnet-4-6)
─────────────────────────────────────────────────────────────────────────────
Task                     │ AgentLoop         │ Claude Code       │ Winner
─────────────────────────┼───────────────────┼───────────────────┼────────
large-codebase-nav       │ ✅  4t   $0.003   │ ✅  3t   $0.045   │ agentloop (cost)
ambiguous-spec           │ ✅ 12t   $0.041   │ ✅  8t   $0.120   │ claudecode (turns)
single-file-edit         │ ✅  3t   $0.012   │ ✅  2t   $0.030   │ tie
fix-type-error           │ ✅  4t   $0.015   │ ✅  2t   $0.030   │ claudecode (turns)
add-feature              │ ✅  8t   $0.032   │ ✅  6t   $0.090   │ agentloop (cost)
multi-file-refactor      │ ❌ 18t   $0.078   │ ✅ 10t   $0.150   │ claudecode
debug-test-failure       │ ✅  6t   $0.024   │ ✅  4t   $0.060   │ agentloop (cost)
error-recovery           │ ❌ 22t   $0.102   │ ✅ 12t   $0.180   │ claudecode
from-scratch             │ ✅ 15t   $0.061   │ ✅ 11t   $0.165   │ agentloop (cost)
long-session-coherence   │ ✅ 32t   $0.142   │ ✅ 22t   $0.330   │ agentloop (cost)
─────────────────────────┼───────────────────┼───────────────────┼────────
TOTALS                   │ 8/10  $0.051 avg  │ 10/10 $0.120 avg │
Efficiency               │ 0.62              │ 0.78              │ claudecode
Cost-efficiency          │ $0.0064/pass      │ $0.0120/pass      │ agentloop
─────────────────────────────────────────────────────────────────────────────
```

### A/B Comparison for AGENTICLOOP_OPUS Phases

After implementing each phase, run:

```bash
# Baseline (current code, committed as tag v0.x-baseline)
npx tsx bench/runner.ts --adapter agentloop --model gemini-2.5-flash --runs 3 --tag baseline

# After Phase 1 (context compaction)
npx tsx bench/runner.ts --adapter agentloop --model gemini-2.5-flash --runs 3 --tag phase1

# Compare
npx tsx bench/report.ts --compare baseline phase1
```

The report highlights statistically significant changes (p < 0.05 across 3 runs via paired t-test on per-task scores).

---

## Building the Task Repos

Each task needs a self-contained git repo that can be cloned and used as a clean starting state. Here's how to create them:

### Strategy: Small, purpose-built repos

Don't use real open-source projects (too large, too fragile, too many dependencies). Build tiny, focused repos that test exactly one capability.

### Template: TypeScript + Express + Vitest

Most tasks use the same base template:

```
template-ts/
├── package.json          # express, better-sqlite3, vitest, typescript
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts          # Express app setup
│   ├── types.ts          # Shared types
│   ├── db.ts             # Database layer
│   ├── routes/
│   │   ├── projects.ts
│   │   └── users.ts
│   └── auth/
│       ├── middleware.ts
│       └── jwt.ts
└── tests/
    ├── projects.test.ts
    └── users.test.ts
```

Each task forks from this template and introduces the specific scenario (type error, missing feature, failing tests, etc.).

### Repo setup script

```bash
#!/bin/bash
# bench/scripts/setup-task-repo.sh
# Creates a clean git repo from a task's source directory

TASK_DIR=$1
REPO_DIR="$TASK_DIR/repo"

cd "$REPO_DIR"
git init
git add -A
git commit -m "initial state"

# Install deps (cached in CI)
npm install --ignore-scripts
```

### Verify scripts are simple

```bash
#!/bin/bash
# verify.sh — generic pattern for most tasks
WORKDIR="$1"
cd "$WORKDIR"

# Type check
npx tsc --noEmit 2>&1 || exit 1

# Tests
npx vitest run --reporter=json 2>&1 || exit 2

exit 0
```

For tasks with specific requirements (like `from-scratch`), the verify script runs custom assertions:

```bash
#!/bin/bash
# verify.sh for from-scratch
WORKDIR="$1"
cd "$WORKDIR"

# Must compile
npx tsc --noEmit || exit 1

# Must have a CLI entry point
[ -f src/index.ts ] || [ -f src/cli.ts ] || exit 2

# Create test CSV
echo "name,age,city" > /tmp/test.csv
echo "Alice,30,NYC" >> /tmp/test.csv
echo "Bob,25,LA" >> /tmp/test.csv

# Must produce markdown output
OUTPUT=$(npx tsx src/index.ts --input /tmp/test.csv 2>&1) || exit 3
echo "$OUTPUT" | grep -q "|" || exit 4  # must contain table pipes
echo "$OUTPUT" | grep -q "Alice" || exit 5

# Must support --columns flag
OUTPUT2=$(npx tsx src/index.ts --input /tmp/test.csv --columns name,city 2>&1) || exit 6
echo "$OUTPUT2" | grep -qv "age" || exit 7  # age column should be excluded

exit 0
```

---

## Fairness Between Adapters

### Same model when possible

When comparing AgentLoop vs Claude Code, use the same underlying model. Both support `claude-sonnet-4-6`. This isolates the loop quality from the model quality.

### Same tool set

The AgentLoop tools (Read, Write, Edit, Bash, Glob, Grep, Think) map 1:1 to Claude Code's tools. No adapter gets extra tools that the other doesn't have.

### Same system prompt baseline

For Claude Code, use `--append-system-prompt` to inject the same behavioral rules. This ensures both agents get the same instructions.

### No caching between tasks

Each task starts from a fresh clone. No persistent state between tasks. No warm caches.

### Temperature

Both adapters use default temperature (not configurable in most cases). Accept that LLM output is stochastic. Run 3+ times for statistical significance.

---

## What the Benchmark Does NOT Measure

| Not measured | Why |
|---|---|
| UI responsiveness | This benchmarks the loop, not the frontend. StreamParser and SSE latency are outside scope. |
| Multi-agent orchestration | HybridPipelineRunner is a separate system. Benchmark the core loop first. |
| Human preference | Automated verification only. "Does the code look clean?" is subjective and out of scope. |
| Very large repos (10K+ files) | Our task repos are 15-200 files. Real-world large repo performance is important but requires different infrastructure (SWE-bench style). |
| Cost optimization | We measure cost but don't optimize for it. A $0.50 run that passes beats a $0.01 run that fails. |

---

## Implementation Sequence

```
Week 1:
  - Build the runner harness (runner.ts, scorer.ts, report.ts)
  - Build the agentloop adapter
  - Create tasks 3, 4 (easy, validates the harness works)

Week 2:
  - Build the claudecode adapter
  - Create tasks 1, 5, 7 (medium difficulty)
  - Run first comparison: agentloop vs claudecode on 5 tasks

Week 3:
  - Create tasks 2, 6, 8, 9, 10 (hard/expert)
  - Run full 10-task benchmark on both adapters
  - Publish baseline numbers

Ongoing:
  - Before merging each AGENTICLOOP_OPUS phase: run benchmark, compare to baseline
  - Store results in bench/results/ with git tags for each phase
  - Track trends over time in a simple spreadsheet or dashboard
```

---

## Quick-Start: Running the Benchmark

```bash
# Install benchmark dependencies
cd bench && npm install

# Run all tasks against AgentLoop with Gemini
export GEMINI_API_KEY=...
npx tsx runner.ts --adapter agentloop --provider gemini --model gemini-2.5-flash

# Run all tasks against Claude Code
# (requires `claude` CLI installed and authenticated)
npx tsx runner.ts --adapter claudecode --model claude-sonnet-4-6

# Run a single task (for development/debugging)
npx tsx runner.ts --adapter agentloop --provider gemini --model gemini-2.5-flash --task fix-type-error --keep

# Compare two runs
npx tsx report.ts --compare results/2026-03-24T19-30-00 results/2026-03-24T20-15-00

# Run 3x for statistical significance
npx tsx runner.ts --adapter agentloop --provider gemini --model gemini-2.5-flash --runs 3 --tag phase1-context-compaction
```
