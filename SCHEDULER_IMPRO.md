# Scheduler Improvement Plan

Based on direct code analysis of the current implementation. Issues are ordered by severity.

---

## 1. CRITICAL — Repo locks not released on rejection

**File:** `src/engine/Scheduler.ts:427-447` (`rejectEpic()`)

`rejectEpic()` moves the epic back to `todo` and increments rejection count, but **never calls `releaseRepos(epicId)`**. Compare:

- `moveToReview()` (line 389): calls `this.releaseRepos(epicId)` ✓
- `cancelEpicOrchestration()` (AngyEngine.ts:338): calls `this.scheduler.releaseRepos(epicId)` ✓
- `rejectEpic()` (line 427-447): **no release call** ✗

**Effect:** Every failed epic permanently locks its repos. After the first failure, all subsequent ticks see the repos as occupied and no new epics can be scheduled against them. The system deadlocks silently.

**Fix:** Add `this.releaseRepos(epicId)` at the start of `rejectEpic()`, before re-queuing the epic.

---

## 2. CRITICAL — Cost budget defined but entirely unenforced

**Files:**
- `KosTypes.ts:92` — `dailyCostBudget: number` in `SchedulerConfig`
- `KosTypes.ts:118` — `budgetRemaining: number | null` in `OrchestratorOptions`
- `Scheduler.ts:355` — `budgetRemaining: null` (hardcoded, never set)
- `Scheduler.ts:192` — default `dailyCostBudget: 50.0` loaded from DB
- `Database.ts:718-754` — stored and retrieved correctly
- `Orchestrator.ts:868-870` — shown in system prompt only if not null

The full pipeline exists on paper: config → DB → scheduler → orchestrator options → system prompt. But the middle link is broken: `budgetRemaining` is always `null` (Scheduler.ts:355), so the system prompt addition never fires and no enforcement happens.

There is also no mechanism to:
- Track actual spend per session or epic
- Accumulate daily spend
- Reset the counter at UTC midnight
- Block new epics when budget is exhausted

**Fix plan:**
1. Add a `DailyCostTracker` (or add methods to `Database.ts`) to record cost per `epicId` with a `date` column.
2. After each orchestrator completes, record its token cost (needs cost extraction from Claude CLI output or HeadlessHandle).
3. In `Scheduler.tick()` (line 285-307), add a pre-check: query today's total spend, if `>= dailyCostBudget` emit a `scheduler:info` event and skip all starts.
4. Compute `budgetRemaining = dailyCostBudget - todaySpend` and pass it (non-null) into `OrchestratorOptions` at `Scheduler.ts:355`.

---

## 3. HIGH — Stale `in-progress` epics only recovered at startup

**File:** `Scheduler.ts:initialize()` (line 102-119)

Recovery of orphaned in-progress epics (where the process crashed and the pool no longer tracks them) happens only once during `initialize()`. If an orchestrator crashes while the engine stays running, the epic stays stuck in `in-progress` indefinitely until the next restart.

**Fix:** Add a health-check pass at the top of `tick()`:

```
for each epic with column === 'in-progress':
  if !this.pool.isEpicActive(epic.id):
    log 'recovered' action
    releaseRepos(epic.id)
    moveEpic(epic.id, 'todo')
```

A minimum grace period (e.g., 5 minutes from `startedAt`) avoids false positives during the brief window between `executeStart()` and `pool.spawnRoot()` completing.

---

## 4. HIGH — `stop()` is not async; races with in-flight tick

**File:** `Scheduler.ts:461-467`

```typescript
stop(): void {
  this.running = false;
  if (this.tickTimer) {
    clearInterval(this.tickTimer);
    this.tickTimer = null;
  }
}
```

`tick()` is async and can be mid-execution when `stop()` is called (e.g., during `AngyEngine.shutdown()`). The timer is cleared but the already-running tick continues, potentially calling `executeStart()` and spawning orchestrators after shutdown begins.

**Fix:**
```typescript
private tickPromise: Promise<void> | null = null;

// in start(): this.tickPromise = this.tick().then(...)
// tick() sets this.tickPromise at start, clears at end

async stop(): Promise<void> {
  this.running = false;
  clearInterval(this.tickTimer);
  this.tickTimer = null;
  if (this.tickPromise) await this.tickPromise;
}
```

`AngyEngine.shutdown()` (line 128-138) should then `await this.scheduler.stop()`.

---

## 5. HIGH — Repo locks have no expiration

**File:** `Scheduler.ts:242-247` (`acquireRepos()`), `KosTypes.ts:80-84` (`RepoLock`)

`RepoLock` records `acquiredAt` (ISO8601 string) but `canAcquireRepos()` (line 237-240) never checks the age of the lock. If `releaseRepos()` is skipped for any reason (see issue #1 above, or a future code path), the lock becomes permanent until restart.

**Fix:** In `canAcquireRepos()`, auto-expire locks older than a configurable threshold (10 minutes is a safe default):

```typescript
canAcquireRepos(epic: Epic): boolean {
  const LOCK_TTL_MS = 10 * 60 * 1000;
  const now = Date.now();
  for (const repoId of epic.targetRepoIds) {
    const lock = this.repoLocks.get(repoId);
    if (lock && now - new Date(lock.acquiredAt).getTime() < LOCK_TTL_MS) {
      return false;
    }
    // stale lock — remove it silently
    if (lock) this.repoLocks.delete(repoId);
  }
  return true;
}
```

---

## 6. MEDIUM — Circular dependency detection missing

**File:** `Scheduler.ts:259-265` (`isBlocked()`)

```typescript
isBlocked(epic: Epic, allEpics: Epic[]): boolean {
  return epic.dependsOn.some(depId => {
    const dep = allEpics.find(e => e.id === depId);
    return !dep || dep.column !== 'done';
  });
}
```

This only checks one level deep. A cycle (`A → B → A`) causes both epics to block each other forever. There is no validation at epic creation time either.

**Fix (two-part):**
1. In `isBlocked()`, detect cycles with a DFS visited-set before evaluating. If a cycle is detected, log a `scheduler:error` event naming the cycle members, and treat cyclic epics as permanently blocked.
2. In `EpicRepository.saveEpic()` or `AngyEngine.createEpic()`, run a cycle check before persisting and return an error if one is found.

---

## 7. MEDIUM — `enabled` toggle only takes effect at startup

**File:** `Scheduler.ts:initialize()` and `start()`

`SchedulerConfig.enabled` is read once during `initialize()` to decide whether to call `start()`. If the user changes the config at runtime (via the UI settings dialog which calls `saveConfig()`), the tick timer is not started or stopped accordingly.

**Fix:** Make `saveConfig()` also reconcile the running state:

```typescript
async saveConfig(config: SchedulerConfig): Promise<void> {
  await this.db.saveSchedulerConfig(config);
  this.config = config;
  if (config.enabled && !this.isRunning()) this.start();
  if (!config.enabled && this.isRunning()) await this.stop();
}
```

Similarly, changing `tickIntervalMs` should restart the interval with the new value.

---

## 8. MEDIUM — Rejection penalty has no floor recovery

**File:** `Scheduler.ts:229`

```typescript
const rejectionPenalty = Math.max(0, 1.0 - epic.rejectionCount * 0.2);
```

At `rejectionCount >= 5`, the penalty contribution is 0. Combined with potentially low scores on other dimensions, an epic can fall below any reasonable scheduling threshold and never be selected again — but it stays in `todo` column, not `backlog`. There is no mechanism to decay the penalty over time or cap the count.

**Fix options (pick one):**
- Auto-move epic to `backlog` after N rejections (e.g., 5), requiring explicit human re-promotion.
- Reset `rejectionCount` to 0 when epic is manually moved back to `todo` from `backlog`.
- Apply exponential decay: instead of `1.0 - count * 0.2`, use `1.0 / (1 + count)` which approaches 0 but never reaches it.

---

## 9. LOW — No concurrency control per project

**File:** `Scheduler.ts:285` (`tick()` loop)

`maxConcurrentEpics` is a global counter. Two projects with independent repos are throttled by the same ceiling. `OrchestratorPool.activeByProject()` (OrchestratorPool.ts:179-187) already exists and provides per-project counts, but the scheduler never calls it.

**Fix:** Add an optional `maxConcurrentEpicsPerProject` field to `SchedulerConfig`. In the tick loop, before calling `executeStart()`, check `pool.activeByProject(epic.projectId) < maxPerProject`.

---

## 10. LOW — Dual data-access paths create consistency risk

**File:** `Scheduler.ts:131-175`

The scheduler supports two code paths:
1. Pinia stores (`this.epicStore`, `this.projectStore`) — set via `setStores()`
2. Engine repositories (`this.epicRepo`, `this.projectRepo`) — set via `setRepositories()`

Both paths are actively maintained. The priority logic (line 141-144) prefers the store if set. If both are set and get out of sync (e.g., a store update that doesn't persist, or a DB update that doesn't notify the store), the scheduler operates on stale data silently.

**Fix:** Remove the Pinia store path from Scheduler entirely. The scheduler should exclusively use `EpicRepository`/`ProjectRepository`. The UI (which uses Pinia) should sync from the DB on relevant events rather than being directly read by the engine.

---

## Summary Table

| # | Severity | Issue | File | Line |
|---|----------|-------|------|------|
| 1 | CRITICAL | Repos not released on rejection | Scheduler.ts | 427-447 |
| 2 | CRITICAL | Cost budget unenforced at runtime | Scheduler.ts | 355 |
| 3 | HIGH | No stale epic recovery during operation | Scheduler.ts | tick() |
| 4 | HIGH | `stop()` races with in-flight tick | Scheduler.ts | 461-467 |
| 5 | HIGH | Repo locks never expire | Scheduler.ts | 237-247 |
| 6 | MEDIUM | Circular dependency detection missing | Scheduler.ts | 259-265 |
| 7 | MEDIUM | `enabled` toggle doesn't apply at runtime | Scheduler.ts | saveConfig() |
| 8 | MEDIUM | Rejection penalty has no recovery path | Scheduler.ts | 229 |
| 9 | LOW | No per-project concurrency ceiling | Scheduler.ts | tick() |
| 10 | LOW | Dual Pinia/repo data paths coexist | Scheduler.ts | 131-175 |

---

## Implementation Order

**Phase 1 — Fix silent failures (no new features, minimal risk):**
- Issue #1: Add `releaseRepos()` to `rejectEpic()`
- Issue #5: Add TTL check to `canAcquireRepos()`
- Issue #4: Make `stop()` async and await the in-flight tick

**Phase 2 — Operational reliability:**
- Issue #3: Add stale-epic health check to `tick()`
- Issue #7: Reconcile timer state in `saveConfig()`
- Issue #8: Decide and implement rejection recovery strategy

**Phase 3 — Missing features:**
- Issue #6: Circular dependency detection
- Issue #2: Budget tracking (requires design: how to extract cost from Claude CLI output)

**Phase 4 — Cleanup:**
- Issue #9: Per-project concurrency (additive, low risk)
- Issue #10: Remove Pinia store path (larger refactor, needs UI audit first)
