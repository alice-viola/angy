# MULTIORCH — Multi-Orchestrator Implementation Plan (Option B)

**Option B**: Branch-per-epic, no git worktrees. Sub-orchestrators share the same epic branch
checkout. Isolation is enforced by the scheduler (one epic per repo at a time). Sub-orchestrators
targeting different repos may run in parallel; same-repo sub-orchestrators must run sequentially.

This document covers only the multi-orchestrator layer. The underlying epic/scheduler/branch
infrastructure from KOS_IMPROVED.md is already implemented.

---

## Current State

### What Works

| Feature | Status | File |
|---|---|---|
| `spawn_orchestrator` MCP tool definition | ✓ | `resources/mcp/orchestrator_server.py:149` |
| `spawn_orchestrator` parsed in tool handler | ✓ | `Orchestrator.ts:672` |
| `executeSpawnOrchestrator` stub | ✓ | `Orchestrator.ts:1078` |
| `OrchestratorOptions` depth/maxDepth/repoPaths | ✓ | `KosTypes.ts:120` |
| Depth-aware system prompt addition | ✓ | `Orchestrator.ts:1163` |
| `spawn_orchestrator` gated at maxDepth | ✓ | `Orchestrator.ts:1091` |
| `spawn_orchestrator` in initial message tool list | ✓ | `Orchestrator.ts:536, 551` |
| `OrchestratorPool.registerSubOrchestrator` | ✓ (defined) | `OrchestratorPool.ts:158` |
| `OrchestratorPool.canSpawnChild` | ✓ | `OrchestratorPool.ts:234` |

### Critical Bug: Sub-Orchestrator Runs as Agent, Not Orchestrator

`executeSpawnOrchestrator` calls `chatPanel.delegateToChild(...)` with profile
`'specialist-orchestrator'`. In `AngyEngine.buildHeadlessPanelAPI`, `delegateToChild` launches
the child via `processes.sendMessage(..., { mode: 'agent', ... })`.

**This means the sub-orchestrator is a raw Claude subprocess with no Orchestrator state machine.**
When it calls `delegate()`, `done()`, or `spawn_orchestrator()`, those tool call outputs emit to
stdout as JSON but nothing processes them. The parent orchestrator waits for `onDelegateFinished`
which is only called when the Claude process exits — so the sub-orchestrator can never coordinate
multiple specialists or report back correctly.

`OrchestratorPool.registerSubOrchestrator` is never called because there is no sub-orchestrator
instance to register.

### Secondary Gaps

1. **Cancel**: `cancelEpicOrchestration` kills processes via the pool but only cancels the root
   `Orchestrator` state machine. Sub-orchestrator state machines are not cancelled.
2. **`working_dir` validation**: No check that `working_dir` in `spawn_orchestrator` or `delegate`
   falls within the epic's `repoPaths`.
3. **Sequential constraint**: No runtime guard preventing two same-repo sub-orchestrators from
   running in parallel. Currently enforced only by system prompt wording.
4. **ChatPanel path**: `ChatPanel.vue`'s `delegateToChild` (standalone mode) has no
   `spawnChildOrchestrator` implementation.
5. **Fleet UI**: No visual distinction between orchestrator and sub-orchestrator nodes.
6. **Missing `spawn_orchestrator` `target_repos` parameter**: Current MCP tool has `working_dir`
   but not `target_repos` (array). The current single-directory approach works but limits
   multi-repo sub-orchestrators.

---

## Implementation Phases

### Phase 1 — `spawnChildOrchestrator` API method (Critical)

**Goal**: When `spawn_orchestrator` is called, create a real `Orchestrator` instance instead of
a raw agent process.

#### 1.1 Add `spawnChildOrchestrator` to `OrchestratorChatPanelAPI`

**File**: `src/engine/Orchestrator.ts`

Add to the `OrchestratorChatPanelAPI` interface:

```typescript
/**
 * Spawn a child Orchestrator (not a specialist agent) for a complex sub-task.
 * The child orchestrator has its own delegation loop and can recurse up to maxDepth.
 * Returns the child's session ID, or null on failure.
 */
spawnChildOrchestrator?(
  parentSessionId: string,
  task: string,
  childEpicOptions: OrchestratorOptions,
  agentName: string,
  teamId: string,
  workingDir?: string,
): Promise<string | null>;
```

#### 1.2 Call `spawnChildOrchestrator` from `executeSpawnOrchestrator`

**File**: `src/engine/Orchestrator.ts`, method `executeSpawnOrchestrator` (~line 1078)

Replace the `delegateToChild(... 'specialist-orchestrator' ...)` call with:

```typescript
if (this.chatPanel.spawnChildOrchestrator) {
  const childId = await this.chatPanel.spawnChildOrchestrator(
    this._sessionId,
    cmd.task,
    childEpicOptions,
    agentName,
    this.teamId,
    workingDir,
  );
  if (childId) {
    this.pendingChildren.set(childId, {
      sessionId: childId,
      role: 'sub-orchestrator',
      agentName,
      completed: false,
      output: '',
      workingDir,
    });
    console.log(`[Orchestrator] Spawned sub-orchestrator: ${agentName} depth=${childEpicOptions.depth} child=${childId}`);
  }
} else {
  this.feedResult('ERROR: spawnChildOrchestrator not available in this panel context.');
}
```

Remove the old `delegateToChild` call and the `pendingChildren.set` that follows it.

#### 1.3 Implement `spawnChildOrchestrator` in `AngyEngine.buildHeadlessPanelAPI`

**File**: `src/engine/AngyEngine.ts`, method `buildHeadlessPanelAPI`

Add `spawnChildOrchestrator` to the returned API object. The implementation:

```typescript
spawnChildOrchestrator: async (
  parentSessionId,
  task,
  childEpicOptions,
  agentName,
  teamId,
  workingDir,
) => {
  const resolvedDir = workingDir || workspace;

  // 1. Create the sub-orchestrator instance
  const subOrch = new Orchestrator();
  subOrch.setEpicOptions(childEpicOptions);
  subOrch.setPipelineType('create');  // sub-orchestrators always create/implement

  // Pass auto-profiles from root orchestrator down
  subOrch.setAutoProfiles(_orch.getAutoProfiles());

  // 2. Create a dedicated HeadlessHandle for the sub-orchestrator's own children
  const subHandle = new HeadlessHandle(this.db, this.sessions.manager);
  subHandle.onDelegateFinished = (grandChildSid, result) => {
    this.sessions.persistSession(grandChildSid);
    subOrch.onDelegateFinished(grandChildSid, result);
  };
  subHandle.onPersistSession = (sid) => {
    this.sessions.persistSession(sid);
  };

  // 3. Build the sub-orchestrator's own panel API (recursive)
  const subPanelAPI = this.buildHeadlessPanelAPI(subHandle, subOrch, resolvedDir, model);
  subOrch.setChatPanel(subPanelAPI);
  subOrch.setWorkspace(resolvedDir);

  // 4. Wire the sub-orchestrator's events
  this.wireOrchestratorEvents(subOrch, childEpicOptions.epicId);

  // When the sub-orchestrator calls done()/fail(), notify the parent
  subOrch.events.once('completed', ({ summary }) => {
    const subSid = subOrch.sessionId();
    if (!subSid) return;
    const result = summary || '';
    this.sessions.manager.setDelegationStatus(subSid, DelegationStatus.Completed);
    this.sessions.manager.setDelegationResult(subSid, result);
    this.sessions.persistSession(subSid);
    handle.onDelegateFinished?.(subSid, result);
  });
  subOrch.events.once('failed', ({ reason }) => {
    const subSid = subOrch.sessionId();
    if (!subSid) return;
    const result = `FAILED: ${reason || 'unknown error'}`;
    this.sessions.manager.setDelegationStatus(subSid, DelegationStatus.Completed);
    this.sessions.manager.setDelegationResult(subSid, result);
    this.sessions.persistSession(subSid);
    handle.onDelegateFinished?.(subSid, result);
  });

  // 5. Start the sub-orchestrator — this calls subPanelAPI.newChat() to get the session ID
  const subSid = await subOrch.start(task, [], _orch.isAutoCommitEnabled());

  // 6. Rename the session for clarity
  const sessionInfo = this.sessions.getSession(subSid);
  if (sessionInfo) {
    sessionInfo.title = agentName.charAt(0).toUpperCase() + agentName.slice(1);
    sessionInfo.epicId = childEpicOptions.epicId;
    await this.sessions.persistSession(subSid);
  }

  // 7. Link as child of the parent session in the session tree
  this.sessions.manager.linkAsChild(parentSessionId, subSid);

  // 8. Register in OrchestratorPool for tracking and cancellation
  this.pool.registerSubOrchestrator(parentSessionId, subSid, childEpicOptions.maxDepth);

  // 9. Store the sub-orchestrator instance for cancellation
  this.subOrchestrators.set(subSid, subOrch);

  // 10. Notify UI
  engineBus.emit('session:created', { sessionId: subSid, parentSessionId });

  return subSid;
},
```

**Notes:**
- `_orch` (currently unused, prefixed with `_`) is now used to propagate auto-profiles.
  Remove the underscore prefix: rename to `orch` throughout `buildHeadlessPanelAPI`.
- `handle` (parent's HeadlessHandle) is already in scope as a closure variable.
- `model` is already in scope.
- `DelegationStatus` import must be added.

---

### Phase 2 — Sub-Orchestrator Storage and Cancellation

**Goal**: Sub-orchestrators can be cancelled cleanly when the epic is cancelled.

#### 2.1 Add `subOrchestrators` map to `AngyEngine`

**File**: `src/engine/AngyEngine.ts`

Add a map alongside `epicOrchestrators`:

```typescript
// sessionId → Orchestrator (for sub-orchestrators spawned by root orchestrators)
private subOrchestrators = new Map<string, Orchestrator>();
```

#### 2.2 Cancel sub-orchestrator state machines in `cancelEpicOrchestration`

**File**: `src/engine/AngyEngine.ts`, method `cancelEpicOrchestration`

After killing processes and cancelling the root orchestrator, also cancel sub-orchestrators:

```typescript
// Cancel all sub-orchestrator state machines for this epic
const subSids = this.pool.getSessionsForEpic(epicId).filter(
  sid => sid !== this.epicOrchestrators.get(epicId)?.sessionId?.() // not root
);
// simpler: iterate subOrchestrators map
for (const [subSid, subOrch] of this.subOrchestrators) {
  const epicForSub = this.pool.getEpicForSession(subSid);
  if (epicForSub === epicId) {
    subOrch.cancel();
    this.subOrchestrators.delete(subSid);
  }
}
```

#### 2.3 Clean up `subOrchestrators` on epic completion

**File**: `src/engine/AngyEngine.ts`, method `wireOrchestratorEvents` (or wherever the
root orchestrator's `completed`/`failed` events are handled)

When the root orchestrator completes, remove its sub-orchestrators from the map:

```typescript
orch.events.once('completed', () => {
  this.cleanupSubOrchestrators(epicId);
});
orch.events.once('failed', () => {
  this.cleanupSubOrchestrators(epicId);
});
```

```typescript
private cleanupSubOrchestrators(epicId: string): void {
  for (const [subSid] of this.subOrchestrators) {
    if (this.pool.getEpicForSession(subSid) === epicId) {
      this.subOrchestrators.delete(subSid);
    }
  }
}
```

---

### Phase 3 — `SessionManager.linkAsChild` (or verify existing mechanism)

**Goal**: Sub-orchestrator sessions appear in the session tree under the parent session.

#### 3.1 Check `SessionManager` for child-linking

**File**: `src/engine/SessionManager.ts`

The existing `createChildSession(parentSessionId, ...)` creates a child session in one step.
But `spawnChildOrchestrator` creates the sub-orchestrator session via `subOrch.start()` → `newChat()`,
which calls `this.sessions.createSession(...)` (top-level, no parent).

Check if `SessionManager` has a `linkAsChild(parentSid, childSid)` method. If not, add one:

```typescript
linkAsChild(parentSessionId: string, childSessionId: string): void {
  const child = this.sessionInfo(childSessionId);
  if (child) {
    child.parentSessionId = parentSessionId;
  }
}
```

Also confirm `SessionInfo` has a `parentSessionId` field (it likely does via `session.parent_session_id`
in the DB). If not, add it.

#### 3.2 Verify `session:created` event payload

The `engineBus.emit('session:created', { sessionId, parentSessionId })` in `spawnChildOrchestrator`
must use the exact payload shape expected by the Pinia `sessions` store listener.

**File**: `src/stores/sessions.ts` — verify the `session:created` handler accepts `parentSessionId`.

---

### Phase 4 — `working_dir` Validation

**Goal**: Prevent sub-orchestrators and delegates from escaping their epic's repo scope.

#### 4.1 Add `validateWorkingDir` helper to `AngyEngine`

**File**: `src/engine/AngyEngine.ts`

```typescript
private isAllowedWorkingDir(dir: string, repoPaths: Record<string, string>): boolean {
  if (!dir) return true; // empty → default, always OK
  return Object.values(repoPaths).some(
    repoPath => dir === repoPath || dir.startsWith(repoPath + '/')
  );
}
```

#### 4.2 Apply validation in `buildHeadlessPanelAPI.delegateToChild`

When a delegate's `working_dir` is outside the epic's repoPaths, fall back to the default
workspace and log a warning. Do NOT error out — fall back gracefully.

```typescript
if (workingDir && !this.isAllowedWorkingDir(workingDir, _orch.getEpicOptions()?.repoPaths || {})) {
  console.warn(`[AngyEngine] working_dir "${workingDir}" outside epic scope, falling back to ${workspace}`);
  workingDir = undefined;
}
```

Apply the same validation in `spawnChildOrchestrator`.

---

### Phase 5 — System Prompt Enhancements

**Goal**: Reduce "middle management" (unnecessary sub-orchestrator spawning) and enforce the
same-repo sequential rule at the prompt level.

#### 5.1 Add sequential-repo rule to `getEpicSystemPromptAddition`

**File**: `src/engine/Orchestrator.ts`, method `getEpicSystemPromptAddition`

In the Sub-Orchestrator Spawning section, add:

```typescript
lines.push(
  '\n**Same-repo rule**: Sub-orchestrators that modify the SAME repository MUST run sequentially.',
  'Do NOT spawn two sub-orchestrators targeting the same repo in the same delegate batch.',
  'Sub-orchestrators targeting DIFFERENT repos may run in parallel.',
  'When in doubt, run sub-orchestrators sequentially — correctness over speed.',
  '\n**Anti-middle-management rule**: Only spawn a sub-orchestrator when the sub-task has',
  'multiple sequential phases (architect → implement → test) or multiple independent subsystems.',
  'If a single specialist call suffices, use delegate() directly.',
);
```

#### 5.2 Expose `target_repos` in `spawn_orchestrator` MCP tool

**File**: `resources/mcp/orchestrator_server.py`, `spawn_orchestrator` tool definition (~line 149)

Add `target_repos` as an optional parameter alongside `working_dir`:

```python
{
  "name": "target_repos",
  "type": "array",
  "items": {"type": "string"},
  "description": (
    "Repo paths this sub-orchestrator will work in. "
    "Must be a subset of the parent's repos. "
    "Defaults to all parent repos if omitted."
  ),
},
```

#### 5.3 Pass `target_repos` through to `childEpicOptions`

**File**: `src/engine/Orchestrator.ts`, `OrchestratorCommand` interface and parsing

Add `target_repos?: string[]` to `OrchestratorCommand`. In the `spawn_orchestrator` parse case:

```typescript
case 'spawn_orchestrator':
  cmd.action = 'spawn_orchestrator';
  cmd.task = args.goal || args.task || '';
  cmd.working_dir = args.working_dir || '';
  cmd.target_repos = args.target_repos || [];
  break;
```

In `executeSpawnOrchestrator`, filter `repoPaths` to only the requested repos:

```typescript
let childRepoPaths = this.epicOptions.repoPaths;
if (cmd.target_repos && cmd.target_repos.length > 0) {
  // Keep only repos whose paths are in target_repos
  childRepoPaths = Object.fromEntries(
    Object.entries(this.epicOptions.repoPaths).filter(
      ([, path]) => cmd.target_repos!.includes(path)
    )
  );
}
const childEpicOptions: OrchestratorOptions = {
  ...
  repoPaths: childRepoPaths,
  ...
};
```

---

### Phase 6 — Fleet UI: Sub-Orchestrator Distinction

**Goal**: Sub-orchestrators appear in the fleet panel with a different visual treatment than
specialist agents.

#### 6.1 Surface the `depth` in session metadata

**File**: `src/engine/AngyEngine.ts`, in `spawnChildOrchestrator`

The `sessionInfo` object should carry the orchestrator depth. Add to `SessionInfo` type and
persist it:

```typescript
sessionInfo.orchestratorDepth = childEpicOptions.depth;
```

**File**: `src/engine/SessionManager.ts` / `SessionInfo` type

Add `orchestratorDepth?: number` to `SessionInfo`.

#### 6.2 Display sub-orchestrators in `AgentCard.vue`

**File**: `src/components/fleet/AgentCard.vue`

When `session.orchestratorDepth > 0`, render the card with:
- A "sub-orchestrator" badge (e.g., depth indicator `d1`, `d2`)
- A different icon (nested brackets or chain icon)
- Slightly indented or visually grouped under its parent

The existing `AgentFleetPanel.vue` already builds a session tree. Check if it uses
`parentSessionId` for grouping and extend it to show depth.

---

### Phase 7 — Scheduler Bugs (SCHEDULER_IMPRO.md)

These bugs cause silent failures in the broader multi-epic system. Fix them alongside
the multi-orch work to avoid unstable test conditions.

#### 7.1 CRITICAL: `releaseRepos` missing from `rejectEpic`

**File**: `src/engine/Scheduler.ts`, method `rejectEpic` (~line 427)

Add at the beginning of `rejectEpic`:

```typescript
this.releaseRepos(epicId);
```

#### 7.2 HIGH: Repo lock TTL

**File**: `src/engine/Scheduler.ts`, method `canAcquireRepos` (~line 237)

Add TTL check (10-minute default):

```typescript
const LOCK_TTL_MS = 10 * 60 * 1000;
const now = Date.now();
const lock = this.repoLocks.get(repoId);
if (lock) {
  const age = now - new Date(lock.acquiredAt).getTime();
  if (age < LOCK_TTL_MS) return false; // still valid
  this.repoLocks.delete(repoId); // stale — remove silently
}
```

#### 7.3 HIGH: `stop()` async race

**File**: `src/engine/Scheduler.ts`

```typescript
private tickPromise: Promise<void> | null = null;

async stop(): Promise<void> {
  this.running = false;
  if (this.tickTimer) {
    clearInterval(this.tickTimer);
    this.tickTimer = null;
  }
  if (this.tickPromise) await this.tickPromise;
}
```

Update `AngyEngine.stopScheduler()` to `await this.scheduler.stop()`.

#### 7.4 HIGH: Stale in-progress epic recovery in `tick()`

**File**: `src/engine/Scheduler.ts`, method `tick()`

At the top of tick, add a health check:

```typescript
const GRACE_MS = 5 * 60 * 1000;
for (const epic of allEpics.filter(e => e.column === 'in-progress')) {
  if (!this.pool.isEpicActive(epic.id) &&
      epic.startedAt && Date.now() - epic.startedAt > GRACE_MS) {
    this.releaseRepos(epic.id);
    await this.moveEpic(epic.id, 'todo');
    await this.logAction({ type: 'requeue', epicId: epic.id,
      projectId: epic.projectId, reason: 'Stale in-progress: orchestrator not active' });
  }
}
```

---

## File Change Index

| File | Change Type | What Changes |
|---|---|---|
| `src/engine/Orchestrator.ts` | Modified | `OrchestratorChatPanelAPI`: add `spawnChildOrchestrator?`; `executeSpawnOrchestrator`: call new method instead of `delegateToChild`; `getEpicSystemPromptAddition`: add sequential-repo + anti-middle-management rules; `OrchestratorCommand`: add `target_repos`; parse `target_repos` in handler |
| `src/engine/AngyEngine.ts` | Modified | `buildHeadlessPanelAPI`: implement `spawnChildOrchestrator`; rename `_orch` → `orch`; add `subOrchestrators` map; `cancelEpicOrchestration`: cancel sub-orchestrator state machines; `cleanupSubOrchestrators` helper; `isAllowedWorkingDir` helper; `cancelEpicOrchestration`: await scheduler stop |
| `src/engine/OrchestratorPool.ts` | Unchanged | `registerSubOrchestrator` already exists and is called from AngyEngine |
| `src/engine/SessionManager.ts` | Modified | Add `linkAsChild(parentSid, childSid)` if missing; add `orchestratorDepth?` to `SessionInfo` |
| `src/engine/Scheduler.ts` | Modified | Fix issues #1 (releaseRepos in rejectEpic), #4 (async stop), #5 (lock TTL), #3 (stale recovery in tick) |
| `resources/mcp/orchestrator_server.py` | Modified | `spawn_orchestrator` tool: add `target_repos` parameter |
| `src/components/fleet/AgentCard.vue` | Modified | Show sub-orchestrator depth badge when `session.orchestratorDepth > 0` |
| `src/stores/sessions.ts` | Modified | Verify/add `orchestratorDepth` in session state; verify `session:created` handler propagates `parentSessionId` |

---

## Critical Traps

### `start()` creates a new session — child session ID is known only after `await subOrch.start(task)`

In `spawnChildOrchestrator`, `pool.registerSubOrchestrator(parentSid, subSid, ...)` and
`handle.onDelegateFinished` must use the session ID returned by `await subOrch.start(task)`.
The parent's `pendingChildren` entry is added by `executeSpawnOrchestrator` AFTER
`spawnChildOrchestrator` returns. Ensure the returned `subSid` is the correct session ID.

### `completed` event fires before `pendingChildren` is set

`subOrch.start()` sends the initial message and returns immediately. If the sub-orchestrator
finishes very quickly (e.g., calls `done()` in its first turn), the `completed` event fires
before `executeSpawnOrchestrator` adds the child to `pendingChildren`. This would cause
`onDelegateFinished(subSid, result)` to be called before the parent knows about this child.

Fix: ensure `pendingChildren.set(childId, ...)` runs BEFORE `subOrch.start()`, or buffer
the completion signal until after the return.

Recommended approach: buffer via a flag:
```typescript
// In spawnChildOrchestrator, before subOrch.start():
let earlyResult: string | null = null;
let earlyCompleted = false;

subOrch.events.once('completed', ({ summary }) => {
  earlyResult = summary || '';
  earlyCompleted = true;
  // Notify after subSid is established
  setImmediate(() => handle.onDelegateFinished?.(subOrch.sessionId()!, earlyResult!));
});

const subSid = await subOrch.start(task, [], autoCommit);
// At this point earlyCompleted may already be true — that's fine,
// setImmediate defers the notification until after the synchronous return.
```

### Sub-orchestrator's `newChat()` creates a top-level session

When `subOrch.start()` calls `subPanelAPI.newChat()`, it calls
`this.sessions.createSession(workspace, 'orchestrator')` which creates a root-level session
with no parent. Call `sessions.manager.linkAsChild(parentSid, subSid)` AFTER `start()` returns.

### AutoCommit propagation

The sub-orchestrator should inherit the root orchestrator's `autoCommit` setting. Pass it
from `_orch.isAutoCommitEnabled()` when calling `subOrch.start(task, [], autoCommit)`.

### `wireOrchestratorEvents` and double epic-completion

`wireOrchestratorEvents(subOrch, epicId)` will fire epic-level events (like `scheduler.moveToReview`)
when the SUB-orchestrator completes. This is wrong — only the ROOT orchestrator's completion
should trigger the epic review flow.

Fix: Do NOT call `wireOrchestratorEvents` for sub-orchestrators. Instead, wire only the
`completed`/`failed` → `handle.onDelegateFinished` path as described in Phase 1.3.

---

## Validation Checklist

After implementation, verify each scenario manually:

- [ ] Root orchestrator calls `spawn_orchestrator("subtask")` → sub-orchestrator appears in fleet
- [ ] Sub-orchestrator calls `delegate(architect, ...)` → architect session appears under sub-orchestrator in fleet
- [ ] Sub-orchestrator calls `done("result")` → parent orchestrator receives result and continues
- [ ] Sub-orchestrator calls `fail("reason")` → parent orchestrator receives FAILED result and can handle it
- [ ] Root at `maxDepth=1` spawns sub at depth 1 which calls `spawn_orchestrator` → error response, not crash
- [ ] Sub-orchestrator at depth 1 can call `delegate()` to specialist → specialist runs, result returns
- [ ] Cancel epic while sub-orchestrator is active → all processes and state machines are cancelled
- [ ] Restart after crash: stale in-progress epic is recovered to `todo` column on next tick
- [ ] Two epics on different repos start in parallel: both run independently
- [ ] Two epics on same repo: second waits until first releases the lock
- [ ] `rejectEpic` releases repo locks (verifiable by starting a new epic on same repo immediately after)
