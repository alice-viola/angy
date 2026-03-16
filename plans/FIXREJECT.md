# Fix: Rejected Epics Don't Re-run with Original Pipeline Type

## Problem

When a user rejects an epic from the review column, the epic is moved back to `todo` and re-queued. However, when it re-runs, it **always executes in `fix` mode**, regardless of what pipeline type the epic was originally set to.

This means:
- A **"Plan"** epic (read-only architect plan) re-runs as **"Fix"** (code builder — wrong)
- An **"Investigate"** epic (read-only analysis) re-runs as **"Fix"** (code builder — wrong)
- A **"Create"** (hybrid) epic re-runs as **"Fix"** — this is actually intentional and correct (the code already exists, skip re-planning)

## Root Cause

There are **two places** that override the pipeline type to `'fix'` when a rejection exists. Both need to be fixed.

### Bug 1 — `src/engine/AngyEngine.ts:374`

```typescript
// CURRENT (wrong):
const pipelineType = hasRejection ? 'fix' as const : epic.pipelineType;

// FIXED:
const pipelineType = (hasRejection && (epic.pipelineType === 'hybrid' || epic.pipelineType === 'fix'))
  ? 'fix' as const
  : epic.pipelineType;
```

Only `hybrid` and `fix` type epics should be routed to fix mode on rejection. `plan` and `investigate` must keep their original type.

### Bug 2 — `src/engine/HybridPipelineRunner.ts:263`

```typescript
// CURRENT (wrong):
const effectiveType = this.rejectionContext ? 'fix' : this.pipelineType;

// FIXED:
const effectiveType = this.pipelineType;
```

The runner should trust the `pipelineType` passed in by `AngyEngine`. Having a second override here is redundant and causes the same problem even if AngyEngine is fixed.

## Additional Improvement: Inject Rejection Feedback into Plan/Investigate Prompts

Since `plan` and `investigate` modes are re-running after a rejection, the agent should know what was wrong with the previous attempt. The `rejectionContext` (which includes the user's feedback text) should be injected into their prompts.

### `executeInvestigateMode` — `src/engine/HybridPipelineRunner.ts` (~line 598)

Add after the `# Goal` section in the delegate prompt:

```typescript
(this.rejectionContext
  ? `\n# Previous Attempt Feedback\nThis investigation was previously rejected with the following feedback:\n${this.rejectionContext.feedback}\n\nPlease address this feedback in your investigation.\n\n`
  : '')
```

### `executePlanMode` — `src/engine/HybridPipelineRunner.ts` (~line 638)

Add after the `# Acceptance Criteria` section in the delegate prompt:

```typescript
(this.rejectionContext
  ? `\n# Previous Attempt Feedback\nThis plan was previously rejected with the following feedback:\n${this.rejectionContext.feedback}\n\nPlease address this feedback and improve upon the previous plan.\n\n`
  : '')
```

## Files to Change

| File | Lines | What |
|------|-------|------|
| `src/engine/AngyEngine.ts` | 374 | Conditional override — only hybrid/fix → fix on rejection |
| `src/engine/HybridPipelineRunner.ts` | 263 | Remove blanket fix override |
| `src/engine/HybridPipelineRunner.ts` | ~598 | Inject rejection feedback in investigate prompt |
| `src/engine/HybridPipelineRunner.ts` | ~638 | Inject rejection feedback in plan prompt |

## No Files to Create

## Testing

1. Create a **Plan** epic, let it run to review, reject it with feedback → should re-run as Plan (read-only), not Fix (code changes)
2. Create an **Investigate** epic, let it run to review, reject it with feedback → should re-run as Investigate
3. Create a **Create** (hybrid) epic, reject it → should still re-run as Fix (existing behavior, correct)
4. Create a **Fix** epic, reject it → should still re-run as Fix

## Complexity

Trivial — four surgical edits, no new files, no type changes.
