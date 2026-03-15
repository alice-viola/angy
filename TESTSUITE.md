# Angy Test Suite Plan

Complete analysis of what to test, how to test it, and where to put everything.
No test framework is currently installed. This plan covers setup, structure, and per-module test specifications.

---

## 1. Framework Setup

### Why Vitest

The project uses Vite + TypeScript. Vitest is the natural choice:
- Zero-config with an existing `vite.config.ts`
- Native TypeScript, ESM, and top-level `await` support
- Jest-compatible API (`describe`, `it`, `expect`, `vi`)
- Fast (runs in the same Vite transform pipeline)

### Packages to install

```bash
npm install --save-dev vitest @vitest/coverage-v8 happy-dom @vue/test-utils
```

| Package | Purpose |
|---|---|
| `vitest` | Test runner + assertions |
| `@vitest/coverage-v8` | Code coverage via V8 |
| `happy-dom` | Lightweight DOM for Vue component tests |
| `@vue/test-utils` | Vue component mounting |

### vite.config.ts changes

Add a `test` block to `vite.config.ts`:

```ts
test: {
  environment: 'happy-dom',
  globals: true,
  include: ['tests/**/*.test.ts'],
  coverage: {
    provider: 'v8',
    include: ['src/engine/**', 'src/composables/**'],
    exclude: ['src/components/**', 'src/stores/**'],
  },
}
```

### package.json scripts

```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

---

## 2. The Tauri Boundary Problem

Almost every engine file imports from `@tauri-apps/api` or `@tauri-apps/plugin-*`. These APIs only exist inside the Tauri runtime — they throw at test time. Every unit test must mock them.

### Strategy: global Tauri mocks in `tests/mocks/tauri.ts`

```ts
// tests/mocks/tauri.ts
vi.mock('@tauri-apps/api/path', () => ({
  homeDir: vi.fn().mockResolvedValue('/home/testuser'),
  join: vi.fn((...parts: string[]) => parts.join('/')),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn().mockResolvedValue(true),
  readTextFile: vi.fn().mockResolvedValue(''),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/plugin-shell', () => ({
  Command: {
    create: vi.fn().mockReturnValue({
      execute: vi.fn().mockResolvedValue({ stdout: '', stderr: '', code: 0 }),
      on: vi.fn(),
      spawn: vi.fn(),
    }),
  },
}));

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: {
    load: vi.fn().mockResolvedValue({
      execute: vi.fn().mockResolvedValue({ lastInsertId: 1, rowsAffected: 1 }),
      select: vi.fn().mockResolvedValue([]),
    }),
  },
}));
```

Each test file that touches engine code adds `import '../mocks/tauri'` at the top. Alternatively, configure `setupFiles: ['tests/mocks/tauri.ts']` in vitest config to apply it globally.

### Strategy: Singleton reset

Both `Scheduler` and `OrchestratorPool` use singletons. Between tests, these must be reset.

- `OrchestratorPool.resetInstance()` — already public, use it directly in `afterEach`.
- `Scheduler` — instance is private. Two options:
  1. Add a `static resetInstance()` method (mirrors what OrchestratorPool already does).
  2. Bypass via `(Scheduler as any)['instance'] = null` — works but brittle.
  **Recommendation:** add `static resetInstance()` to Scheduler (one-line change).

---

## 3. File & Folder Structure

```
tests/
├── mocks/
│   ├── tauri.ts             # Global Tauri API mocks
│   ├── database.ts          # In-memory Database mock
│   ├── epicRepo.ts          # In-memory EpicRepository mock
│   ├── projectRepo.ts       # In-memory ProjectRepository mock
│   └── pool.ts              # OrchestratorPool mock for Scheduler tests
├── unit/
│   ├── scheduler/
│   │   ├── priorityScore.test.ts
│   │   ├── isBlocked.test.ts
│   │   ├── getBlockingReasons.test.ts
│   │   ├── repoLocking.test.ts
│   │   ├── rejectEpic.test.ts
│   │   ├── tick.test.ts
│   │   ├── executeStart.test.ts
│   │   └── configReconciliation.test.ts
│   ├── orchestratorPool/
│   │   ├── tracking.test.ts
│   │   ├── depthLimits.test.ts
│   │   └── resumeVsSpawn.test.ts
│   ├── pipeline/
│   │   ├── phaseRouting.test.ts
│   │   ├── cancel.test.ts
│   │   └── features.test.ts
│   └── branchManager/
│       └── staticHelpers.test.ts
└── integration/
    ├── schedulerPool.test.ts
    └── epicLifecycle.test.ts
```

---

## 4. Mock Implementations

These are used by all unit tests. Write them once, import everywhere.

### `tests/mocks/database.ts`

An in-memory stub implementing the `Database` interface:

```ts
export function makeMockDb(overrides?: Partial<Database>): Database {
  return {
    loadSchedulerConfig: vi.fn().mockResolvedValue(defaultConfig()),
    saveSchedulerConfig: vi.fn().mockResolvedValue(undefined),
    appendSchedulerLog: vi.fn().mockResolvedValue(undefined),
    loadSchedulerLog: vi.fn().mockResolvedValue([]),
    totalCostSince: vi.fn().mockResolvedValue(0),
    loadEpicBranches: vi.fn().mockResolvedValue([]),
    saveEpicBranch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
```

### `tests/mocks/epicRepo.ts`

Wraps an in-memory array, implementing `EpicRepository`:

```ts
export function makeMockEpicRepo(initialEpics: Epic[] = []): EpicRepository {
  let epics = [...initialEpics];
  return {
    listEpics: () => epics,
    getEpic: (id) => epics.find(e => e.id === id) ?? null,
    reload: vi.fn().mockResolvedValue(undefined),
    moveEpic: vi.fn(async (id, col) => { const e = epics.find(e => e.id === id); if (e) e.column = col; }),
    updateEpic: vi.fn(async (id, updates) => { const e = epics.find(e => e.id === id); if (e) Object.assign(e, updates); }),
    incrementRejection: vi.fn(async (id) => { const e = epics.find(e => e.id === id); if (e) e.rejectionCount++; }),
    saveEpic: vi.fn(async (epic) => { epics.push(epic); }),
  };
}
```

### `tests/mocks/projectRepo.ts`

```ts
export function makeMockProjectRepo(repos: ProjectRepo[] = []): ProjectRepository {
  return {
    reposByProjectId: (projectId) => repos.filter(r => r.projectId === projectId),
    reload: vi.fn().mockResolvedValue(undefined),
  };
}
```

### `tests/mocks/pool.ts`

```ts
export function makeMockPool(overrides?: Partial<OrchestratorPool>): OrchestratorPool {
  return {
    isEpicActive: vi.fn().mockReturnValue(false),
    spawnRoot: vi.fn().mockResolvedValue('session-abc'),
    resumeOrSpawnRoot: vi.fn().mockResolvedValue('session-abc'),
    removeEpic: vi.fn().mockResolvedValue(undefined),
    setMaxDepth: vi.fn(),
    activeByProject: vi.fn().mockReturnValue(0),
    totalActive: vi.fn().mockReturnValue(0),
    ...overrides,
  } as unknown as OrchestratorPool;
}
```

### `tests/helpers/epicFactory.ts`

A builder for minimal valid `Epic` objects to avoid boilerplate in every test:

```ts
export function makeEpic(overrides: Partial<Epic> = {}): Epic {
  return {
    id: crypto.randomUUID(),
    projectId: 'proj-1',
    title: 'Test epic',
    description: '',
    acceptanceCriteria: '',
    column: 'todo',
    priorityHint: 'medium',
    complexity: 'small',
    pipelineType: 'hybrid',
    useGitBranch: false,
    useWorktree: false,
    baseBranch: 'main',
    targetRepoIds: [],
    dependsOn: [],
    runAfter: undefined,
    rejectionCount: 0,
    rejectionFeedback: '',
    lastAttemptFiles: [],
    lastValidationResults: [],
    lastArchitectPlan: '',
    model: undefined,
    rootSessionId: null,
    costTotal: 0,
    computedScore: 0,
    parallelAgentCount: 1,
    startedAt: null,
    completedAt: null,
    suspendedAt: null,
    createdAt: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}
```

---

## 5. Scheduler Unit Tests

### 5.1 `priorityScore.test.ts`

**File:** `tests/unit/scheduler/priorityScore.test.ts`
**What:** `Scheduler.computePriorityScore()` is a pure function. Zero I/O. Most straightforward test in the suite.

**Tests:**

```
computePriorityScore
  ├── critical/trivial epic scores highest (near 1.0)
  ├── none/epic complexity scores lowest (near 0.0)
  ├── score is sum of exactly 5 weighted components
  ├── age normalizes at 30 days (ageNormalized caps at 1.0)
  ├── new epic (0 days old) has ageScore = 0
  ├── rejectionCount=0 has full rejectionScore
  ├── rejectionCount=5 reduces rejectionScore by 1.0 (penalty = 0)
  ├── rejectionCount>5 doesn't go negative (max(0, ...))
  ├── dependsOn.length=0 gets max depthScore
  ├── dependsOn.length=5+ gets depthScore close to 0
  └── score respects custom weight config (change weights, verify proportions)
```

**How:** Create a `Scheduler` instance, call `setDatabase()` with `makeMockDb()`, call `loadConfig()` manually (or just set `scheduler['config']` directly to avoid async), then call `computePriorityScore(epic)`.

Because `config` is a private field, the cleanest approach is to call `loadConfig()` once before each test group to populate it via the mock db.

---

### 5.2 `isBlocked.test.ts`

**File:** `tests/unit/scheduler/isBlocked.test.ts`
**What:** `Scheduler.isBlocked()` — pure function, takes `(epic, allEpics[])`.

**Tests:**

```
isBlocked
  runAfter
  ├── returns false when runAfter is undefined
  ├── returns true when predecessor is 'in-progress'
  ├── returns true when predecessor is 'todo'
  ├── returns false when predecessor is 'review'
  ├── returns false when predecessor is 'done'
  └── returns false when predecessor ID doesn't exist in allEpics (deleted)

  dependsOn
  ├── returns false when dependsOn is empty
  ├── returns true when direct dependency is 'todo'
  ├── returns true when direct dependency is 'in-progress'
  ├── returns false when all direct deps are 'done'
  ├── returns true when transitive dep is not done
  │     (A depends on B, B depends on C, C is 'todo' → A is blocked)
  ├── returns false when full transitive chain is done
  ├── handles diamond dependency (A→B, A→C, B→D, C→D) without false block
  └── cycle detection: epic depends on itself → returns true (blocked, not infinite loop)
      cycle detection: A→B→A → returns true, no infinite loop
```

**How:** Pure call to `scheduler.isBlocked(epic, epics)`. No mocks needed beyond epic objects.

---

### 5.3 `getBlockingReasons.test.ts`

**File:** `tests/unit/scheduler/getBlockingReasons.test.ts`
**What:** `Scheduler.getBlockingReasons()` — returns typed reasons array.

**Tests:**

```
getBlockingReasons
  ├── empty array when nothing blocks
  ├── type='runAfter' reason when predecessor not finished
  ├── type='dependency' reason for each unfinished dep
  ├── type='repoLock' reason when a repo is locked by another epic
  ├── no repoLock reason for worktree epics (useWorktree=true)
  ├── type='concurrency' when inProgressCount >= maxConcurrentEpics
  ├── type='projectConcurrency' when per-project count >= limit
  │     (only when maxConcurrentPerProject > 0)
  ├── no projectConcurrency reason when maxConcurrentPerProject = 0
  └── multiple blocking reasons stack (all applicable reasons returned)
```

**How:** Use `makeMockDb()`, call `loadConfig()`, then manually inject repo locks via `acquireRepos()` before calling `getBlockingReasons()`.

---

### 5.4 `repoLocking.test.ts`

**File:** `tests/unit/scheduler/repoLocking.test.ts`
**What:** `canAcquireRepos` / `acquireRepos` / `releaseRepos` — in-memory lock map.

**Tests:**

```
repo locking
  ├── canAcquireRepos returns true when no locks exist
  ├── canAcquireRepos returns false when any target repo is locked
  ├── canAcquireRepos returns true for worktree epics even if repo locked
  ├── acquireRepos locks all targetRepoIds
  ├── acquireRepos locks all project repos when targetRepoIds is empty
  ├── releaseRepos removes only locks held by that epicId
  ├── releaseRepos does not release locks held by other epics
  └── lock has correct epicId and acquiredAt timestamp
```

**How:** Wire `makeMockProjectRepo()` via `setRepositories()`. No async needed.

---

### 5.5 `rejectEpic.test.ts`

**File:** `tests/unit/scheduler/rejectEpic.test.ts`
**What:** Rejection escalation: 1–4 rejections → `todo`, 5+ rejections → `backlog`.

**Tests:**

```
rejectEpic
  ├── increments rejectionCount by 1
  ├── stores rejectionFeedback
  ├── moves epic to 'todo' when rejectionCount becomes 1
  ├── moves epic to 'todo' when rejectionCount becomes 4
  ├── moves epic to 'backlog' when rejectionCount becomes 5
  ├── moves epic to 'backlog' when rejectionCount becomes 6 (already escalated)
  ├── releases repo locks on reject
  └── emits scheduler:info event when moving to backlog
```

**How:** Use `makeMockEpicRepo()` with an epic at various `rejectionCount` values. Spy on `engineBus.emit`.

**Important:** `engineBus` is module-level singleton. Use `vi.spyOn(engineBus, 'emit')` and reset after each test.

---

### 5.6 `tick.test.ts`

**File:** `tests/unit/scheduler/tick.test.ts`
**What:** The main scheduling loop. This is the most complex test in the scheduler suite.

**Tests:**

```
tick()
  budget guard
  ├── skips all scheduling when todaySpend >= dailyCostBudget
  └── proceeds normally when spend is under budget

  slot management
  ├── starts up to maxConcurrentEpics epics per tick
  ├── skips tick entirely when slotsAvailable = 0
  └── decrements available slots as epics start

  todo selection & ordering
  ├── skips blocked epics (isBlocked returns true)
  ├── skips repo-locked epics (canAcquireRepos returns false)
  ├── skips epics over project concurrency limit
  ├── starts highest-scoring epic first (sorted by computedScore)
  └── updates computedScore on started epics

  resume
  ├── uses resumeOrSpawnRoot when epic.suspendedAt is set
  ├── uses resumeOrSpawnRoot when epicId is in epicsPendingResume
  ├── uses spawnRoot for normal (non-suspended) epics
  └── removes epicId from epicsPendingResume after use

  health check
  ├── recovers orphaned in-progress epic (not active in pool, startedAt > grace)
  ├── does NOT recover epic within grace period (< 5 min)
  ├── does NOT recover epic that is active in pool
  └── recovered epic is added to epicsPendingResume

  error handling
  └── emits scheduler:error and returns error action on exception
```

**How:** Wire a full `Scheduler` with `makeMockEpicRepo()`, `makeMockProjectRepo()`, `makeMockDb()`, and `makeMockPool()`. Call `tick()` directly without starting the timer. Use `vi.spyOn(pool, 'spawnRoot')` to assert call arguments.

---

### 5.7 `executeStart.test.ts`

**File:** `tests/unit/scheduler/executeStart.test.ts`
**What:** `executeStart()` handles parallel agent duplication and the spawn path.

**Tests:**

```
executeStart
  column guard
  ├── returns false when epic column changed since scheduling
  └── returns true and proceeds when column still matches

  parallel agents
  ├── creates N clone epics when parallelAgentCount > 1
  ├── clone titles get " X1", " X2", ... suffix
  ├── existing X-suffix stripped before re-duplicating (no "X1 X1")
  ├── original epic is moved to 'discarded'
  ├── returns false (clones scheduled on next tick)
  └── parallelAgentCount=1 skips duplication entirely

  normal start
  ├── moves epic to 'in-progress'
  ├── clears suspendedAt when set
  ├── acquires repo locks
  ├── builds correct OrchestratorOptions (depth=0, parentSessionId=null)
  ├── calls pool.spawnRoot with resolved repoPaths
  ├── stores rootSessionId on epic
  ├── emits scheduler:info event
  └── returns false and emits scheduler:error if pool.spawnRoot throws
```

---

### 5.8 `configReconciliation.test.ts`

**File:** `tests/unit/scheduler/configReconciliation.test.ts`
**What:** `saveConfig()` reconciles the running state of the tick timer.

**Tests:**

```
saveConfig
  ├── starts timer when enabled=true and scheduler was stopped
  ├── stops timer when enabled=false and scheduler was running
  ├── restarts timer when tickIntervalMs changes while running
  ├── does nothing when config changes but enabled/interval unchanged
  └── updates pool maxDepth when maxOrchestratorDepth changes
```

**How:** Use `vi.useFakeTimers()` to control `setInterval`/`clearInterval`. Assert `scheduler.isRunning()` state after each `saveConfig()` call.

---

## 6. OrchestratorPool Unit Tests

### 6.1 `tracking.test.ts`

**File:** `tests/unit/orchestratorPool/tracking.test.ts`
**What:** Core map operations — register, look up, remove.

**Tests:**

```
OrchestratorPool tracking
  ├── isEpicActive returns false before spawnRoot
  ├── isEpicActive returns true after spawnRoot
  ├── totalActive reflects spawned epic count
  ├── activeByProject counts correctly by projectId
  ├── getEpicForSession returns epicId for root session
  ├── getSessionsForEpic returns all sessions (root + children)
  ├── getChildSessions returns only direct children of parent
  └── removeEpic clears all maps (epicOrchestrators, sessionOrchestrators, epicProjects)
```

**How:** Use `OrchestratorPool.resetInstance()` in `beforeEach`. Inject a mock `orchestratorFactory` that returns a fixed session ID. Call `spawnRoot()` directly.

For `spawnRoot()` — it calls `branchManager.createCheckpoint()`. Mock `BranchManager` or pass a stub.

---

### 6.2 `depthLimits.test.ts`

**File:** `tests/unit/orchestratorPool/depthLimits.test.ts`
**What:** Sub-orchestrator depth enforcement.

**Tests:**

```
registerSubOrchestrator
  ├── registers child at depth = parent.depth + 1
  ├── depth=0 (root) can register child at depth=1
  ├── child at depth=1 can register grandchild at depth=2
  ├── throws when parent depth >= maxDepth
  ├── throws when parentSessionId not in pool
  └── canSpawnChild returns false when at maxDepth

canSpawnChild
  ├── returns true when depth < maxDepth
  ├── returns false when depth >= maxDepth
  ├── returns false when sessionId not in pool
  └── uses pool.maxDepth when maxDepth arg is omitted

getDepth
  ├── returns 0 for root session
  ├── returns 1 for first-level child
  └── returns 0 for unknown sessionId (default)
```

---

### 6.3 `resumeVsSpawn.test.ts`

**File:** `tests/unit/orchestratorPool/resumeVsSpawn.test.ts`
**What:** `resumeOrSpawnRoot()` tries resume factory first, falls back to spawn.

**Tests:**

```
resumeOrSpawnRoot
  ├── calls resumeFactory when pipelineType='hybrid' and not read-only
  ├── returns resumeFactory sessionId on success
  ├── falls back to spawnRoot when resumeFactory returns null (no snapshot)
  ├── falls back to spawnRoot when resumeFactory throws
  ├── never calls resumeFactory for pipelineType='investigate'
  ├── never calls resumeFactory for pipelineType='plan'
  ├── throws when epic already has active orchestrator
  └── registers session in both maps after resume

spawnRoot
  ├── throws when called twice for same epicId
  ├── skips repo preparation for read-only pipelines (investigate/plan)
  ├── calls branchManager.createWorktree when useWorktree=true
  ├── calls branchManager.createAndCheckoutEpicBranch when useGitBranch=true
  ├── records tracking branch when neither flag set
  ├── uses inheritFromPredecessor when runAfter is set
  └── throws when no orchestratorFactory configured
```

---

## 7. HybridPipelineRunner Unit Tests

The runner depends heavily on async process delegation. Most tests at this level focus on the **observable state** and **routing logic**, not the full LLM loop.

### 7.1 `phaseRouting.test.ts`

**File:** `tests/unit/pipeline/phaseRouting.test.ts`
**What:** The `run()` method routes to different execution strategies based on `pipelineType` and `rejectionContext`.

**Tests:**

```
run() routing
  ├── calls executeInvestigateMode when pipelineType='investigate'
  ├── calls executePlanMode when pipelineType='plan'
  ├── calls executeFixMode when pipelineType='fix'
  ├── calls executeFixMode even for pipelineType='hybrid' when rejectionContext is set
  │     (rejectionContext overrides pipelineType — effectiveType = 'fix')
  └── follows hybrid path when pipelineType='hybrid' and no rejectionContext

trivial complexity shortcut
  ├── skips architect phase for complexity='trivial'
  └── proceeds directly to builder for trivial
```

**How:** Spy on `runner['executeInvestigateMode']`, `runner['executeFixMode']` etc. using `vi.spyOn`. Mock `handle`, `processes`, and `sessions` with stubs. This avoids running actual LLM delegation.

---

### 7.2 `cancel.test.ts`

**File:** `tests/unit/pipeline/cancel.test.ts`
**What:** `cancel()` cleanly stops all in-flight work.

**Tests:**

```
cancel()
  ├── sets _cancelled = true, _running = false
  ├── calls cancelProcess for every active session
  ├── resolves all pending resolvers with 'CANCELLED'
  ├── calls healthMonitor.cancel()
  ├── sets phase to 'cancelled'
  ├── emits 'failed' event with reason 'Pipeline cancelled'
  └── checkpointing state is attempted (even if it fails silently)
```

**How:** Inject a `handle` stub and a `ProcessManager` stub with a `cancelProcess` spy. Register fake active processes and pending resolvers into the runner's private state (via `runner['activeProcesses'].add(...)`) before calling `cancel()`.

---

### 7.3 `features.test.ts`

**File:** `tests/unit/pipeline/features.test.ts`
**What:** `getPipelineFeatures()` maps complexity → feature flags. This is pure business logic.

**Tests:**

```
getPipelineFeatures
  ├── complexity='trivial' → { architectTurns: 0, useCounterpart: false, ... }
  ├── complexity='small'   → { architectTurns: 1, useCounterpart: false, ... }
  ├── complexity='medium'  → { architectTurns: 2, useCounterpart: true, ... }
  ├── complexity='large'   → { architectTurns: 3, useCounterpart: true, ... }
  └── complexity='epic'    → { architectTurns: 4, useCounterpart: true, ... }
```

**Note:** If `getPipelineFeatures()` is currently private, it should either be made `protected` or tested indirectly through the routing tests. Given it's a pure lookup, making it `internal` or extracting it to a pure function would make it directly testable.

---

## 8. BranchManager Static Helpers

### 8.1 `staticHelpers.test.ts`

**File:** `tests/unit/branchManager/staticHelpers.test.ts`
**What:** `BranchManager.epicTitleToSlug()` and `BranchManager.computeWorktreePath()` are pure static functions.

**Tests:**

```
epicTitleToSlug
  ├── lowercases the title
  ├── replaces spaces with hyphens
  ├── removes characters not in [a-z0-9-]
  ├── collapses multiple consecutive hyphens into one
  ├── trims leading/trailing hyphens
  ├── truncates very long titles (check max length)
  ├── handles all-special-character title gracefully (no empty string result)
  └── 'Add OAuth2 support' → 'add-oauth2-support'

computeWorktreePath
  ├── produces a sibling directory to the repo (parent dir / slug)
  ├── uses the '.angy-worktrees' prefix convention
  ├── two repos with same slug → different paths (because parent dir differs)
  └── handles repo paths with trailing slash
```

---

## 9. Integration Tests

Integration tests wire multiple real classes together. They use real in-memory implementations (no Tauri I/O mocks needed for the non-git parts) but still mock the process spawning layer.

### 9.1 `schedulerPool.test.ts`

**File:** `tests/integration/schedulerPool.test.ts`
**What:** `Scheduler` + `OrchestratorPool` working together, as they do in production.

**Tests:**

```
Scheduler + OrchestratorPool integration
  ├── tick() calls pool.spawnRoot when a todo epic is eligible
  ├── tick() calls pool.resumeOrSpawnRoot for suspended epic
  ├── tick() does NOT spawn when pool.isEpicActive returns true for an in-progress epic
  ├── moveToReview() calls pool.removeEpic and releases repo locks
  ├── approveEpic() moves to 'done' and calls pool.removeEpic
  ├── rejectEpic() moves to 'todo' and releases locks but does NOT call pool.removeEpic
  │     (pool cleanup happens in AngyEngine on epic:failed)
  └── health recovery: orphaned in-progress epic recovered, added to pendingResume,
        then resumed on next tick
```

---

### 9.2 `epicLifecycle.test.ts`

**File:** `tests/integration/epicLifecycle.test.ts`
**What:** Full epic column state machine — from `todo` through `done`, including rejection escalation.

**Tests:**

```
Epic lifecycle state machine
  happy path
  ├── todo → in-progress (via executeStart)
  ├── in-progress → review (via moveToReview)
  └── review → done (via approveEpic)

  rejection path
  ├── in-progress → todo (via rejectEpic, rejectionCount=1)
  ├── todo → in-progress → todo cycle repeats (rejectionCount increments)
  ├── at rejectionCount=5: moves to 'backlog' not 'todo'
  └── backlog epic is NOT picked up by tick() (column !== 'todo')

  crash recovery path
  ├── initialize() with stale in-progress epics → moved to todo + marked for resume
  ├── next tick() resumes them via resumeOrSpawnRoot
  └── tick() health check recovers orphaned epic after grace period

  parallel agents path
  ├── epic with parallelAgentCount=3 → discarded, 3 clones created with X1/X2/X3 suffix
  ├── clones have parallelAgentCount=1 (no recursive duplication)
  └── next tick starts each clone independently
```

---

## 10. Scheduler Singleton Reset — Required Code Change

The only code change needed to make all tests work correctly is adding `resetInstance()` to `Scheduler`. This mirrors the pattern already in `OrchestratorPool`.

**Location:** `src/engine/Scheduler.ts`, after `getInstance()`:

```ts
static resetInstance(): void {
  Scheduler.instance = null;
}
```

This one-liner is the only code modification. Everything else is additive (new test files, new mock files, config changes).

---

## 11. What Is NOT Tested Here (and Why)

| Area | Reason |
|---|---|
| `HybridPipelineRunner` full pipeline (phases 1–3) | Requires real Claude subprocess. Integration-test territory, not unit test. Use E2E/manual testing. |
| `BranchManager` git operations (`createWorktree`, `commitEpicWork`, etc.) | Shell commands. Requires a real filesystem + git. Integration tests need a temp git repo fixture. Out of scope for now. |
| `ClaudeProcess` spawning + stream parsing | Spawns the real `claude` binary. Covered by E2E tests. `StreamParser` alone can be unit tested if extracted. |
| `Database` SQLite operations | `@tauri-apps/plugin-sql` is Tauri-only. Would need `better-sqlite3` shim or a mock DB layer. Consider as a follow-up. |
| Vue components (`AgentsView.vue`, `OrchestratorChat.vue`) | Visual/interaction tests. Use `@vue/test-utils` + Storybook separately. Not part of engine testing. |
| `AngyEngine` wiring | Thin facade delegating to tested units. High cost to test, low marginal value. |

---

## 12. Priority Order

If implementing incrementally, build in this order:

1. **Mocks** (`tests/mocks/`) — unblocks everything else
2. **`epicFactory.ts` helper** — eliminates boilerplate in all tests
3. **Scheduler `resetInstance()`** — the one code change needed
4. **`priorityScore.test.ts`** — fastest to write, pure math, immediate value
5. **`isBlocked.test.ts`** — pure logic, covers the most critical scheduling gate
6. **`getBlockingReasons.test.ts`** — builds on `isBlocked`, covers UI-facing data
7. **`repoLocking.test.ts`** — in-memory, no async complexity
8. **`rejectEpic.test.ts`** — covers escalation business rule
9. **`OrchestratorPool/tracking.test.ts`** + **`depthLimits.test.ts`** — pool invariants
10. **`tick.test.ts`** + **`executeStart.test.ts`** — full scheduler orchestration
11. **`resumeVsSpawn.test.ts`** — resume/spawn fallback
12. **`staticHelpers.test.ts`** — quick win for branch naming
13. **Integration tests** — final layer, validates the seams between modules
