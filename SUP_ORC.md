# Angy Orchestration Engine — Master Design

## The Problem This Solves

Today's engine has a critical flaw: parallel agents share the same working directory.
Two implementers running simultaneously will overwrite each other's files. This is not
edge-case behavior — it happens on every parallel delegation.

**Git worktrees are the fix and the foundation.** Everything else builds on top of them.

---

## Architecture Overview

```
Root Orchestrator (depth 0)
  │  workspace: /project           (main worktree)
  │
  ├─ Sub-Orchestrator (depth 1)    ← spawned for complex sub-tasks
  │    workspace: /project/.worktrees/team-abc/d1-auth
  │    branch: angy/team-abc/d1-auth
  │
  ├─ implementer-1                 ← simple tasks go straight to specialists
  │    workspace: /project/.worktrees/team-abc/implementer-1
  │    branch: angy/team-abc/implementer-1
  │
  └─ implementer-2
       workspace: /project/.worktrees/team-abc/implementer-2
       branch: angy/team-abc/implementer-2
```

Each agent gets its own worktree → its own branch → zero file conflicts.
When agents complete, their branches merge back to main.

---

## Tier 1 — Foundation (Correctness, implement first)

### 1.1 WorktreeManager

New class: `src/engine/WorktreeManager.ts`

Wraps all `git worktree` operations. Used by the Orchestrator whenever it spawns
any child — specialist or sub-orchestrator.

```typescript
export interface WorktreeHandle {
  path: string;           // absolute path of the worktree directory
  branch: string;         // e.g. "angy/team-abc/implementer-2"
  teamId: string;
  agentName: string;
}

export class WorktreeManager {
  constructor(private repoRoot: string) {}

  /** Create a new worktree for an agent. Branch is auto-named. */
  async create(teamId: string, agentName: string): Promise<WorktreeHandle>

  /**
   * Merge a completed agent's branch back to the current branch of the
   * calling worktree (usually main). Strategy: squash-merge by default,
   * regular merge optional.
   *
   * Returns: { ok: true } or { ok: false, conflicts: string[] }
   */
  async merge(handle: WorktreeHandle, strategy: 'squash' | 'merge' = 'squash'): Promise<MergeResult>

  /** Remove a worktree and delete its branch. Always call after merge or on cancel. */
  async remove(handle: WorktreeHandle): Promise<void>

  /** Remove all worktrees for a given teamId. Called on orchestrator done/fail/cancel. */
  async cleanup(teamId: string): Promise<void>

  /** List all angy-managed worktrees (for UI display and crash recovery). */
  async list(): Promise<WorktreeHandle[]>
}
```

Branch naming convention: `angy/<teamId>/<agentName>`
Worktree path: `<repoRoot>/.worktrees/<teamId>/<agentName>`
`.worktrees/` should be in `.gitignore`.

**Merge conflict policy:**
1. Attempt squash-merge (clean, single commit, no history noise).
2. If conflicts: report back to orchestrator with the conflict list.
3. Orchestrator can re-delegate the conflict resolution to an implementer
   scoped to the conflicting files.
4. Never silently discard work.

### 1.2 Per-Agent Worktree in executeDelegation

`Orchestrator.ts` → `executeDelegation()`:

```typescript
// Before spawning the child agent:
const handle = await this.worktreeManager.create(this.teamId, agentName);

// Pass the worktree path as the child's workspace.
// The child agent writes ONLY to its own worktree directory.
const childId = this.chatPanel.delegateToChild(
  this._sessionId,
  cmd.task,
  context,
  profileId,
  this.contextProfileIds,
  agentName,
  this.teamId,
  teammates,
  handle.path,  // ← child workspace is the worktree, not the repo root
);

// Track the handle alongside the pending child:
this.pendingChildren.set(childId, {
  sessionId: childId,
  role: cmd.role,
  agentName,
  completed: false,
  output: '',
  worktreeHandle: handle,   // ← new field
});
```

### 1.3 Merge on Completion

`checkAllChildrenDone()` — after all children in a batch are done:

```typescript
// For each completed child, merge its worktree back:
const mergeResults: MergeResult[] = [];
for (const child of completedChildren) {
  if (child.worktreeHandle) {
    const result = await this.worktreeManager.merge(child.worktreeHandle);
    mergeResults.push(result);
    await this.worktreeManager.remove(child.worktreeHandle);
  }
}

// If any merges had conflicts, tell the orchestrator:
const conflicts = mergeResults.filter(r => !r.ok).flatMap(r => r.conflicts);
if (conflicts.length > 0) {
  this.feedResult(
    `${completedChildren.length} agent(s) completed but merge conflicts detected:\n` +
    conflicts.map(f => `- ${f}`).join('\n') +
    `\n\nDelegate to implementer to resolve these conflicts.`
  );
  return;
}

// All clean — report normal completion:
this.feedResult(`${completedChildren.length} agent(s) completed and merged successfully. ...`);
```

### 1.4 Graceful Fallback (No Git)

If `git worktree` is unavailable (not a repo, old git version):
- `WorktreeManager.create()` returns a temp directory (no branch isolation).
- Warn the orchestrator once in the system prompt.
- Parallel agents still work but file-conflict risk is noted.
- UI shows a "no isolation" badge on agent cards.

---

## Tier 2 — Core Features

### 2.1 Recursive Orchestration (Fractal Depth)

An orchestrator can spawn sub-orchestrators for truly complex, multi-phase sub-goals.

```typescript
export interface OrchestratorOptions {
  depth?: number;       // current depth (0 = root)
  maxDepth?: number;    // hard cap (default: 3)
  parentSessionId?: string;
  teamId?: string;      // inherited from parent
  workspace?: string;   // worktree path assigned by parent
}
```

**When to spawn a sub-orchestrator vs. a specialist:**
> If the sub-task requires multiple sequential phases (architect → implement → validate)
> or multiple parallel independent subsystems, spawn a sub-orchestrator.
> If a single specialist can do it in one shot, delegate directly.

**New MCP tool: `spawn_orchestrator(goal, context)`**
- Only available when `depth < maxDepth`.
- Creates a new `Orchestrator` at `depth + 1`, assigns it a worktree.
- Its `done()` result bubbles back to the parent exactly like a specialist's result.
- Depth label in agent names: `d0-orchestrator`, `d1-orchestrator-1`, `d2-implementer-3`.

**System prompt is depth-aware:**
- At `depth < maxDepth`: `spawn_orchestrator` is listed alongside `delegate`.
- At `depth === maxDepth`: `spawn_orchestrator` is removed entirely from the prompt.

**Guard against "middle management":**
Inject this rule whenever `spawn_orchestrator` is available:
> "Only spawn a sub-orchestrator when the sub-task has multiple sequential phases
> or parallel independent subsystems. If one or two specialist calls suffice, use
> `delegate` directly."

### 2.2 Strict JSON Handoffs (AgentHandoff)

Replace the plain-string `done(summary)` with a structured result. This is essential
for reliable information flow up the orchestration tree.

```typescript
export interface AgentHandoff {
  status: 'success' | 'partial' | 'failed';
  summary: string;                    // ≤ 300 chars, human-readable
  artifacts: string[];                // file paths written/modified
  unresolved_dependencies: string[];  // blockers for the parent to handle
  metadata?: Record<string, string>;  // e.g. { testsPassed: "12" }
}
```

**Enforcement:**
- MCP `done(result: AgentHandoff)` replaces `done(summary: string)`.
- `checkAllChildrenDone()` parses each child output with `JSON.parse()`.
- If parsing fails → feed error back: "Your done() output was not valid JSON.
  Re-call done() with the correct schema."
- Root orchestrator `completed` event payload: `{ handoff: AgentHandoff }`.

**Sub-orchestrator aggregation before calling its own `done()`:**
```typescript
const merged: AgentHandoff = {
  status: children.every(c => c.status === 'success') ? 'success' : 'partial',
  summary: children.map(c => c.summary).join('; '),
  artifacts: children.flatMap(c => c.artifacts),
  unresolved_dependencies: children.flatMap(c => c.unresolved_dependencies),
};
```

### 2.3 Session Resumability

Long-running orchestrations must survive process restarts.

**Snapshot on every phase transition and after every delegation batch:**

```typescript
export interface OrchestratorSnapshot {
  version: 2;
  snapshotId: string;
  savedAt: string;                    // ISO timestamp
  goal: string;
  depth: number;
  maxDepth: number;
  teamId: string;
  sessionId: string;
  currentPhase: string;
  totalDelegations: number;
  autoCommit: boolean;
  workspace: string;
  pendingChildren: PendingChildSnapshot[];
  completedHandoffs: AgentHandoff[];
}

export interface PendingChildSnapshot {
  sessionId: string;
  role: string;
  agentName: string;
  worktreeBranch: string;    // branch name for recovery
  worktreePath: string;
  completed: boolean;
  handoff?: AgentHandoff;
}
```

Snapshot path: `~/.angy/snapshots/<teamId>.json`

**Resume flow:**
```typescript
static async resume(snapshotId: string, chatPanel: OrchestratorChatPanelAPI): Promise<Orchestrator>
```
1. Load snapshot.
2. Re-instantiate `Orchestrator` with saved state.
3. Re-verify worktrees via `WorktreeManager.list()` — re-attach or re-issue missing ones.
4. For each `completed: false` child, check if Claude session has output (`sessionFinalOutput`).
   If yes → call `onDelegateFinished()` to replay.
   If not → re-issue the delegation with the original task.

**UI:** "New Orchestration" dialog shows resumable snapshots with timestamp, goal preview,
current phase, and a Resume button.

---

## Tier 3 — Power Features

### 3.1 Multiverse Execution (branch tool)

For high-stakes decisions (algorithm choice, architecture), spawn N isolated solutions
in parallel, evaluate them, and merge the winner.

**New MCP tool: `branch(n, goal, evaluator)`**
- Only available at depth 0.
- `n`: number of branches (2–4, hardcoded max).
- `evaluator`: shell command returning an exit code (0 = pass, score from stdout).

**Execution:**
1. For each `i` in `[0..n)`:
   - `WorktreeManager.create(teamId, `branch-${i}`)` → worktree + branch.
   - Spawn child orchestrator (or specialist) scoped to that worktree.
2. Wait for all to return `AgentHandoff`.
3. Run `evaluator` in each worktree. Capture exit code + stdout score.
4. Pick the branch with the best score.
5. `git merge --squash` the winning branch into main.
6. `WorktreeManager.cleanup()` all losing branches.
7. Feed handoff back to root orchestrator as a delegation result.

**Guardrails:**
- Max `n = 4`.
- Branching forbidden at `depth > 0`.
- Each branch inherits `MAX_TOTAL_DELEGATIONS / n` budget.

### 3.2 Agent Graph Visualization

A live, force-directed graph replacing the Effects panel in orchestrator mode.

**What it shows:**
- Agent nodes (circle, colored by role, pulsing when active).
- Tool call nodes (small rect with icon).
- File nodes (diamond, badge with +N/-N lines, colored dots for which agents touched it).
- Delegation edges (thick, parent→child).
- Worktree edges (dashed, agent→worktree branch label).
- Merge event nodes (git-merge icon, appears when a worktree merges back).
- Conflict nodes (red, when a merge fails).

**Two modes:**
- **Live**: reactive stream from orchestrator events + ChatPanel tool calls.
- **Replay**: reconstructed from DB (`sessions`, `messages`, `file_changes` tables) with
  a timeline scrubber.

**Worktree layer in the graph:**
Each agent node shows its assigned branch name. When merge completes, an animated edge
flows from the agent node back to the root/parent node with a "merged" label. Conflict
nodes are highlighted red and link to the conflicting file nodes.

**Implementation:** Canvas 2D, no external graph library. See AGENTGRAPH.md for the
detailed rendering/layout plan (still valid, add worktree node/edge types).

---

## Tier 4 — Future (Do Not Block On)

### 4.1 Remote MCP Endpoints

```typescript
export interface AgentEndpoint {
  type: 'local' | 'remote';
  profileId?: string;   // local
  url?: string;         // remote
  apiKey?: string;
  schema?: object;
}
```

Remote delegation: POST `{ task, context, schema: AgentHandoff }` → poll/SSE for result.
Registry: `~/.angy/agent-registry.json` maps role names to endpoints.

### 4.2 Token Budget Tracking

Global counter passed down through options. Each depth level's budget =
parent budget / expected number of children. Enforced via `MAX_TOTAL_DELEGATIONS`
inherited from root (not reset per sub-orchestrator).

---

## Implementation Rollout

| Phase | Feature | Key Files |
|-------|---------|-----------|
| 1 | `WorktreeManager` — create/merge/remove/cleanup | `src/engine/WorktreeManager.ts` |
| 2 | `PendingChild.worktreeHandle` + per-agent worktree in `executeDelegation` | `Orchestrator.ts` |
| 3 | Merge-on-completion in `checkAllChildrenDone()` with conflict reporting | `Orchestrator.ts` |
| 4 | Graceful fallback if no git or old git version | `WorktreeManager.ts` |
| 5 | `OrchestratorOptions` depth/maxDepth + `spawn_orchestrator` MCP tool | `Orchestrator.ts`, `orchestrator_server.py` |
| 6 | Depth-aware system prompt (tool gating) + agent name depth labels | `Orchestrator.ts` |
| 7 | `AgentHandoff` schema replaces plain string `done()` | MCP server + `Orchestrator.ts` |
| 8 | `checkAllChildrenDone()` parses + validates + merges `AgentHandoff` | `Orchestrator.ts` |
| 9 | `OrchestratorSnapshot` serialization on phase transitions | `Orchestrator.ts` |
| 10 | `Orchestrator.resume()` static method + worktree recovery | `Orchestrator.ts` |
| 11 | Resume dialog in UI | Vue components |
| 12 | `branch(n, goal, evaluator)` MCP tool + worktree-based evaluation | `Orchestrator.ts`, MCP server |
| 13 | Branch winner merge + loser cleanup | `WorktreeManager.ts`, `Orchestrator.ts` |
| 14 | Agent graph — data layer, graph store, Canvas renderer | `src/components/graph/` |
| 15 | Agent graph — worktree nodes/edges + merge events | Graph components |
| 16 | Agent graph — live mode event wiring + replay mode | Graph composables |

---

## Critical Traps

### File Conflict (resolved by Tier 1)
Without worktrees, parallel agents corrupt each other. This is the highest-priority fix.

### "Middle Management" Problem
LLMs will over-use `spawn_orchestrator`. Hard prompt rule + token budget enforcement
are the mitigations. Do not soften the rule.

### Context Dilution
Summaries lose detail as they bubble up the tree. `AgentHandoff.artifacts` (file paths,
not content) + a shared artifact store (files on disk in known locations) prevent this.
Orchestrators pass paths, not content.

### Worktree Leaks
If the app crashes mid-run, worktrees are orphaned on disk. `WorktreeManager.list()`
at startup + the snapshot recovery flow handles this. Add a "Clean up orphaned worktrees"
button to settings.

### Merge Storm
When N branches all complete simultaneously, N merges fire at once. Serialize them via
the existing `GitManager` op queue to prevent race conditions.

---

## Open Questions (Decide Before Implementing)

1. **Worktree path**: inside repo (`.worktrees/`) vs. alongside repo (`../angy-worktrees/<repo>/`)?
   Inside is simpler but pollutes the project directory.
2. **Default merge strategy**: squash (clean history) vs. regular merge (preserves agent commits)?
   Squash is recommended — history should reflect logical phases, not agent bookkeeping.
3. **Conflict resolution UI**: Should a merge conflict pause the orchestration and show a diff
   in the UI, or always re-delegate resolution to an implementer agent?
4. **maxDepth user control**: Slider 1–4 in the "New Orchestration" dialog?
5. **Snapshot TTL**: Auto-delete resumable snapshots after N days?
6. **Branch evaluator**: Support a judge LLM (in addition to shell command) for multiverse scoring?
