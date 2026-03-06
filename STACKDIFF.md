# Stacked Diff — Auto-Commit by Phase

## Concept

The orchestrator already works in natural phases: architect → implement → validate → (fix → re-validate) → review → done. We add a **`checkpoint`** MCP tool that the orchestrator calls after each successful phase to commit the work with a descriptive message. This produces a clean, incremental git history — one commit per logical step.

The user controls this via a toggle in the input bar (next to the Orchestrate button). When disabled, the orchestrator never sees the `checkpoint` tool and behaves as today.

---

## Design

### New MCP Tool: `checkpoint(message)`

```
checkpoint(message: string)
  — Commit all current changes with the given message.
    Only call after a phase is validated and complete.
```

- **Why a tool, not auto-commit on validation pass?**
  - Not every validation pass is a phase boundary (fix → re-validate cycles are not separate phases)
  - The orchestrator knows the semantic boundaries and can write a meaningful commit message
  - Explicit tool calls are visible in the agent graph — the user sees each commit as a node
  - The orchestrator can batch multiple implementer outputs into one commit if they belong to the same phase

### Git Availability

Not all workspaces are git repos. At orchestration start:
1. Run `git rev-parse --is-inside-work-tree` in the workspace directory
2. Store result as `gitAvailable: boolean` on the Orchestrator instance
3. If git is unavailable:
   - Don't expose `checkpoint` to the orchestrator (omit from system prompt)
   - Don't register it in the MCP allowed tools list
   - Silently skip — no error, no warning to the orchestrator

### Commit Strategy

When `checkpoint(message)` is intercepted by `Orchestrator.ts`:
1. Run `git add -A` in the workspace (stages all changes from the phase)
2. Run `git commit -m "<message>"` with the orchestrator-provided message
3. Return success/failure result to the orchestrator
4. Emit a new event `checkpointCreated: { hash, message }` for the graph

If the commit fails (nothing to commit, merge conflict, etc.), return the error to the orchestrator so it can decide what to do.

---

## Changes

### 1. UI Store (`src/stores/ui.ts`)

Add persistent toggle:

```ts
autoCommitEnabled: ref(false)

function toggleAutoCommit() {
  autoCommitEnabled.value = !autoCommitEnabled.value;
}
```

### 2. Input Bar (`ChatPanel.vue` — footer-left slot)

Add a toggle button next to the existing Orchestrate button:

```html
<button
  @click="uiStore.toggleAutoCommit()"
  :class="uiStore.autoCommitEnabled ? 'bg-green-500/20 text-green-400' : 'text-muted'"
  title="Auto-commit after each orchestration phase"
>
  <GitCommitIcon :size="14" />
  Auto-Commit
</button>
```

- Only **visible** when orchestrate mode is active (no point showing it for normal chat)
- Green tint when active to distinguish from the mauve orchestrate button
- Persists across sessions via the ui store (unlike the one-shot orchestrate toggle)

### 3. MCP Server (`resources/mcp/orchestrator_server.py`)

Add the `checkpoint` tool definition:

```python
{
    "name": "checkpoint",
    "description": "Commit all current changes to git with a descriptive message. Call this after each phase is validated.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "message": {
                "type": "string",
                "description": "Commit message describing what this phase accomplished"
            }
        },
        "required": ["message"]
    }
}
```

Acknowledgment: `"checkpoint": "Command received. Commit will be executed and result provided in your next message."`

The orchestrator TypeScript code intercepts this just like it does `delegate`/`validate`.

### 4. Orchestrator (`src/engine/Orchestrator.ts`)

#### New state:

```ts
private autoCommit = false;
private gitAvailable = false;
```

#### Git detection (in `start()` and `attachToSession()`):

```ts
private async detectGit(): Promise<boolean> {
  try {
    const cmd = Command.create('exec-sh', ['-c', 'git rev-parse --is-inside-work-tree'], {
      cwd: this.workspace || undefined,
    });
    const result = await cmd.execute();
    return result.code === 0;
  } catch {
    return false;
  }
}
```

#### New command handler (in `executeCommand()`):

```ts
case 'checkpoint':
  this.executeCheckpoint(cmd);
  break;
```

#### Checkpoint execution:

```ts
private async executeCheckpoint(cmd: OrchestratorCommand) {
  if (!this.gitAvailable || !this.autoCommit) {
    this.feedResult('Checkpoint skipped (git not available or auto-commit disabled).');
    return;
  }

  const message = cmd.message || 'orchestrator checkpoint';
  this._currentPhase = 'committing';
  this.events.emit('phaseChanged', { phase: this._currentPhase });

  try {
    // Stage all changes
    const addCmd = Command.create('exec-sh', ['-c', 'git add -A'], {
      cwd: this.workspace || undefined,
    });
    await addCmd.execute();

    // Commit
    const commitCmd = Command.create('exec-sh', ['-c', `git commit -m ${JSON.stringify(message)}`], {
      cwd: this.workspace || undefined,
    });
    const result = await commitCmd.execute();
    const output = (result.stdout + '\n' + result.stderr).trim();

    if (result.code === 0) {
      // Get short hash
      const hashCmd = Command.create('exec-sh', ['-c', 'git rev-parse --short HEAD'], {
        cwd: this.workspace || undefined,
      });
      const hashResult = await hashCmd.execute();
      const hash = hashResult.stdout.trim();

      this.events.emit('checkpointCreated', { hash, message });
      this.feedResult(`Checkpoint committed: ${hash} — ${message}`);
    } else {
      this.feedResult(`Checkpoint failed: ${output}`);
    }
  } catch (e: any) {
    this.feedResult(`Checkpoint error: ${e.message}`);
  }
}
```

#### System prompt changes:

When `autoCommit && gitAvailable`, append to `ORCHESTRATOR_SYSTEM_PROMPT`:

```
- checkpoint(message) — Commit current changes to git with a descriptive message.
  Call this after each implementation phase is validated and complete.
  Write a concise, conventional commit message (e.g. "feat: add user authentication API").
  Do NOT call checkpoint after architect-only or review-only phases (no code changes).
```

And add to the workflow section:

```
1. Delegate to architect to analyze and design.
2. Delegate to implementer to write code.
3. Validate with build/test commands.
4. If validation fails, delegate fixes and re-validate.
5. **Call checkpoint() with a descriptive commit message.**
6. Repeat steps 1-5 for each phase of the work.
7. Optionally delegate to reviewer.
8. Call done() when all work is complete.
```

#### Allowed tools:

In `ClaudeProcess.ts`, when auto-commit is enabled, add `mcp__c3p2-orchestrator__checkpoint` to the orchestrator's `--allowedTools` list.

### 5. Events & Graph

Add event type:

```ts
checkpointCreated: { hash: string; message: string };
```

In `useGraphBuilder.ts`, subscribe to `orchestrator:checkpointCreated` and render it as a distinct node in the agent graph (e.g., a git-commit icon node between phase clusters).

### 6. `OrchestratorCommand` type update

```ts
export interface OrchestratorCommand {
  action: 'delegate' | 'validate' | 'done' | 'fail' | 'checkpoint' | 'unknown';
  // ... existing fields ...
  message?: string;  // for checkpoint
}
```

---

## Flow (happy path)

```
User enables Auto-Commit toggle → clicks Orchestrate → sends goal
    │
    ▼
Orchestrator starts, detects git ✓
    │
    ▼
delegate(architect, "analyze requirements")
    → Architect analyzes, returns design
    │
    ▼
delegate(implementer, "implement auth API")
    → Implementer writes code
    │
    ▼
validate("npm test")
    → Tests pass ✓
    │
    ▼
checkpoint("feat: add user authentication API")      ← git commit #1
    │
    ▼
delegate(implementer, "add input validation")
    → Implementer writes code
    │
    ▼
validate("npm test")
    → Tests pass ✓
    │
    ▼
checkpoint("feat: add request validation middleware") ← git commit #2
    │
    ▼
delegate(reviewer, "review all changes")
    → Reviewer approves
    │
    ▼
done("Implemented auth API with validation")
```

---

## Files to modify

| File | Change |
|------|--------|
| `src/stores/ui.ts` | Add `autoCommitEnabled` + toggle |
| `src/components/chat/ChatPanel.vue` | Add Auto-Commit toggle button in footer-left |
| `resources/mcp/orchestrator_server.py` | Add `checkpoint` tool definition + ack |
| `src/engine/Orchestrator.ts` | Add git detection, checkpoint execution, conditional system prompt |
| `src/engine/ClaudeProcess.ts` | Add `checkpoint` to allowed tools when enabled |
| `src/composables/useGraphBuilder.ts` | Subscribe to `checkpointCreated` event, render node |
| `src/components/graph/GraphTypes.ts` | Add checkpoint node type (optional) |

---

## Edge cases

- **No git**: Toggle visible but grayed out / disabled with tooltip "No git repository detected"
- **Nothing to commit**: `git commit` returns non-zero → orchestrator gets error, continues normally
- **Dirty working tree at start**: First checkpoint includes pre-existing changes — acceptable, user opted in
- **Orchestrator forgets to call checkpoint**: No commit happens for that phase — acceptable, not destructive
- **Multiple implementers in parallel**: All their changes get committed together in one checkpoint — correct behavior since they're part of the same phase
