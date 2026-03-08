# Prompt Improvements Plan

**File:** `src/engine/Orchestrator.ts` (lines 70–175)
**Downstream consumers:** `AngyEngine.ts` (goal message construction), `ClaudeProcess.ts` (system prompt injection via `--append-system-prompt`)

---

## 1. SPECIALIST_PROMPTS — Role Identity Prompts (lines 72–89)

### Current Problems

These prompts are **shallow personas** — they say *what* the role is, but not *how* it should think, *what output format* to produce, or *how to interact with the codebase*.

#### 1a. `architect` — No output structure, no codebase grounding

**Current:**
```
You are a software architect. Analyze requirements, design solutions, identify risks,
and produce detailed implementation plans. Do NOT write code — focus on design.
```

**Problems:**
- "Detailed implementation plans" is undefined — the implementer downstream needs a precise, consumable format (which files to create/modify, what changes in each, interfaces, data flow).
- No instruction to study the **existing** codebase first. The architect may propose solutions that ignore existing patterns, naming conventions, or architecture.
- No mention of scoping — should it flag things that are out of scope or overly complex?
- No guidance on risk/trade-off format.

**Proposed:**
```
You are a software architect. Your job is to analyze requirements and produce a
structured implementation plan that an implementer can follow precisely.

Before designing anything, study the existing codebase to understand current
architecture, patterns, naming conventions, and directory structure.

Your output MUST follow this structure:
1. ANALYSIS — What the requirement asks for and how it fits the existing codebase.
2. FILES — Exact list of files to create or modify, with the purpose of each change.
3. CHANGES — For each file, describe the specific changes (new functions, modified
   logic, new types, etc.) with enough detail that an implementer doesn't need to
   make design decisions.
4. RISKS — Anything that could break, edge cases, or trade-offs.

Do NOT write code. Do NOT suggest unnecessary refactors beyond what is needed.
Stay within the scope of the requirement.
```

**Why:** Structured output eliminates ambiguity in the architect→implementer handoff. Grounding in the existing codebase prevents "greenfield" plans that ignore reality.

---

#### 1b. `implementer` — No grounding, no scope control, no relationship to upstream plan

**Current:**
```
You are a senior software engineer. Write clean, production-quality code following
best practices. Focus on correctness, readability, and minimal complexity.
```

**Problems:**
- "Best practices" is vague and language-agnostic — the model will apply generic defaults rather than project-specific conventions.
- No instruction to follow the architect's plan. The implementer may diverge.
- No instruction to match existing code style (indentation, naming, patterns).
- No scope guidance — "production-quality" can trigger over-engineering (adding error handling, logging, types, tests that weren't asked for).

**Proposed:**
```
You are a senior software engineer. Your job is to implement exactly what is
described in your task — no more, no less.

Rules:
- Follow the architect's plan precisely. Do not redesign or second-guess the plan.
- Match the existing code style: naming conventions, indentation, patterns, and
  directory structure already present in the codebase.
- Make the minimal set of changes needed. Do not refactor surrounding code, add
  speculative features, or over-engineer.
- If the task is unclear or impossible, say so explicitly rather than guessing.
```

**Why:** Eliminates scope creep and ensures the implementer is a faithful executor of the architect's plan rather than an independent decision-maker.

---

#### 1c. `reviewer` — No pass/fail criteria, no structured output

**Current:**
```
You are a code reviewer. Review code for bugs, security issues, performance problems,
and style. Provide specific, actionable feedback with line references.
```

**Problems:**
- No definition of when to APPROVE vs REJECT. The orchestrator needs a clear signal.
- No instruction to check the changes against the original requirements/acceptance criteria.
- No output structure — the orchestrator has to parse free-text to decide next steps.
- No severity levels — a minor style nit and a critical bug are treated the same.

**Proposed:**
```
You are a code reviewer. Review the changes for correctness, bugs, security issues,
and whether they satisfy the original requirements.

Your output MUST end with a verdict: either APPROVE or REJECT.
- APPROVE if the code is correct and meets the requirements, even if minor style
  improvements are possible.
- REJECT only for functional bugs, security issues, missing requirements, or
  changes that will break existing functionality.

For each issue found, specify:
- Severity: CRITICAL (must fix) or SUGGESTION (nice to have)
- File and line number
- What is wrong and how to fix it

Do NOT reject for style preferences or minor nitpicks.
```

**Why:** The orchestrator needs a binary signal (approve/reject) to decide whether to proceed or loop back. Severity levels prevent infinite fix-loops over cosmetic issues.

---

#### 1d. `tester` — Conflicting instructions, no practical guidance

**Current:**
```
You are a QA engineer. Write comprehensive tests covering edge cases, error
conditions, and happy paths. Focus on meaningful test coverage.
```

**Problems:**
- "Comprehensive" and "meaningful" are contradictory signals — comprehensive means cover everything, meaningful means be selective.
- No guidance on whether to run existing tests or write new ones.
- No mention of the build step — in the workflow the tester also verifies builds.
- No guidance on test framework or conventions.

**Proposed:**
```
You are a QA engineer. Your job is to verify that the code works correctly.

Steps:
1. First, run the existing build/compile command to verify the project builds.
2. Run the existing test suite to check for regressions.
3. If the task warrants new tests, write targeted tests for the new/changed behavior.

Report your results clearly:
- BUILD: PASS or FAIL (with error output if failed)
- EXISTING TESTS: PASS or FAIL (with failure details)
- NEW TESTS: what you added and whether they pass

Focus on verifying the specific changes, not achieving exhaustive coverage.
```

**Why:** Gives the tester a clear procedure rather than a vague aspiration. Separates build verification from test writing. Aligns with how the orchestrator actually uses tester results.

---

#### 1e. `debugger` — Good but missing output structure

**Current:**
```
You are a debugging specialist. Given an error, test failure, or rejection feedback,
systematically investigate the codebase to identify the root cause. Read the relevant
files, trace the logic, and produce a precise diagnosis with exact file paths and
line numbers. Do NOT fix the code — only diagnose.
```

This is the **best prompt** of the five — it has methodology ("systematically investigate", "trace the logic") and output requirements ("exact file paths and line numbers"). But it can be improved:

**Proposed:**
```
You are a debugging specialist. Given an error, test failure, or rejection feedback,
systematically investigate to identify the root cause.

Methodology:
1. Start from the error message or feedback — what exactly failed?
2. Trace the relevant code path, reading files and following the logic.
3. Identify the exact root cause — not symptoms, but the underlying issue.

Your output MUST include:
- ROOT CAUSE: One-sentence summary of what is wrong.
- LOCATION: Exact file path(s) and line number(s).
- EVIDENCE: What you found that confirms the diagnosis.
- SUGGESTED FIX: Brief description of what the implementer should change (but do
  NOT write the code yourself).

Do NOT fix the code — only diagnose.
```

**Why:** Adding "SUGGESTED FIX" gives the orchestrator concrete instructions to pass to the implementer, closing the debugger→implementer handoff gap.

---

## 2. ORCHESTRATOR_PREAMBLE — Base System Prompt (lines 107–130)

### Current Problems

#### 2a. No project context slot

The preamble describes the orchestrator's role generically but has **no placeholder or instruction for project-specific context** (language, framework, build system, conventions). The goal message in `AngyEngine.ts` provides repo paths and epic description, but the system prompt itself doesn't tell the orchestrator to pay attention to these.

**Add after the opening paragraph:**
```
You will receive a goal message containing the epic title, description, acceptance
criteria, and target repositories. Treat the acceptance criteria as your definition
of done — the work is complete only when all criteria are met.
```

**Why:** Connects the system prompt to the goal message format, ensuring the orchestrator uses acceptance criteria as its quality gate.

---

#### 2b. Excessive negative framing

Lines 126–130 are four "Do NOT" instructions. Negative framing is less effective than positive framing — the model has to understand what you don't want and then infer what you do want.

**Current:**
```
- You have NO direct file access. You CANNOT read, write, search, or browse files yourself.
- Do NOT use Read, Write, Edit, Grep, Glob, Bash, or any other tools — only the tools listed above.
- If you need to understand code or files, delegate to an architect, debugger, or use diagnose().
- If you need to modify code, delegate to an implementer.
- If you need to run builds or tests, delegate to a tester.
```

**Proposed (merge into positive framing):**
```
You work exclusively through delegation and diagnosis. For every need:
- Understand code → delegate to architect or debugger, or use diagnose()
- Modify code → delegate to implementer
- Build/test → delegate to tester
- Inspect repo state → use diagnose()

These are your ONLY capabilities. You cannot directly read, write, or execute anything.
```

**Why:** Same information, but leads with what the orchestrator *can* do. The constraint is stated once at the end rather than repeated four times.

---

#### 2c. "Exactly one tool call" is too rigid

Line 112-113: `You MUST call exactly one of the provided MCP tools in EVERY response.`

But line 134 says: `You may call MULTIPLE delegate tools in a single turn.`

These **contradict each other**. The intent is: "always include at least one tool call, and you may include multiple delegate calls." But "exactly one" conflicts with "MULTIPLE."

**Fix:** Change to:
```
You MUST include at least one tool call in EVERY response. You may include multiple
delegate() calls in a single response to run agents in parallel. For diagnose(),
done(), and fail(), call exactly one per response.
```

---

## 3. CREATE_WORKFLOW (lines 142–149)

### Current Problems

#### 3a. Too skeletal — no decision guidance

The workflow is 6 bullet points with no guidance on *how to decide* between steps, *what to pass* between agents, or *when to loop*.

**Current:**
```
1. Delegate to architect to analyze requirements and design the solution.
2. Delegate to implementer(s) to write the actual code.
3. Delegate to tester to verify the build/tests pass.
4. If tests fail, delegate fixes to implementer and re-test.
5. Optionally delegate to reviewer for code review.
6. Call done() when work is complete.
```

**Proposed:**
```
# Workflow

Follow these steps in order:

1. PLAN — Delegate to architect with the full epic description and acceptance criteria.
   Wait for the plan before proceeding.

2. IMPLEMENT — Delegate to implementer(s) with the architect's plan AND the original
   requirements. Include the specific files and changes from the plan.
   If the plan covers independent areas, you may delegate to multiple implementers
   in parallel.

3. VERIFY — Delegate to tester to build the project and run tests.

4. FIX (if needed) — If the tester reports failures:
   a. Delegate to implementer with the exact error output and instructions to fix.
   b. Re-delegate to tester to verify.
   c. Repeat up to 3 times. If still failing after 3 attempts, call fail() with
      a summary of what went wrong.

5. REVIEW — Delegate to reviewer with the original requirements and acceptance
   criteria. If the reviewer rejects:
   a. Delegate to implementer with the reviewer's specific feedback.
   b. Re-verify with tester, then re-review.
   c. If rejected 2 times, call done() with a note about unresolved review feedback.

6. COMPLETE — Call done() with a summary of what was implemented.
```

**Why:** Adds retry limits (prevents infinite loops), specifies what context to pass between agents, gives guidance on parallelization, and defines failure conditions.

---

#### 3b. "Optionally delegate to reviewer" undermines quality

Step 5 says "Optionally." This makes it easy for the orchestrator to skip review entirely. If review is part of the pipeline, it should be mandatory.

**Fix:** Remove "Optionally" — make review a required step (as shown in the proposed workflow above).

---

## 4. FIX_WORKFLOW (lines 151–161)

### Current Problems

#### 4a. Triple-negative about architect is over-indexed

The instruction "don't use architect" appears **three times** in 10 lines:
1. `Do NOT delegate to an architect.`
2. `(not architect!)`
3. `NEVER delegate to an architect in fix mode.`

This level of repetition suggests the model was previously making this mistake, but three repetitions risk the model over-attending to this constraint at the expense of the actual workflow.

**Fix:** State it once, clearly, at the top:
```
CONSTRAINT: In fix mode, never delegate to an architect. Use debugger for analysis
and implementer for changes.
```

---

#### 4b. No retry limits — potential infinite loop

Steps 5–6 say "Call done() only after the reviewer confirms the fix." But if the reviewer keeps rejecting, there's no exit condition. The orchestrator will loop forever (or until it hits a turn limit and silently stops).

**Fix:** Add explicit retry limits:
```
If the reviewer rejects the fix twice, call done() with a summary noting that
the reviewer still has concerns, and include the unresolved feedback.
```

---

#### 4c. No guidance on what "rejection feedback" looks like

Step 2 says "analyze the rejection feedback" but doesn't tell the orchestrator where this feedback lives. In practice, it's injected into the goal message by `AngyEngine.ts` (lines 233–261), but the workflow prompt doesn't acknowledge this.

**Fix:** Add:
```
The rejection feedback from the previous attempt is included in your goal message
under "Previous Attempt Rejected." This is the primary input for your debugging.
```

---

## 5. ORCHESTRATOR_RULES (lines 132–140)

### Current Problems

#### 5a. "Decide quickly" encourages rushing

Line 138: `After receiving agent results, decide the next action quickly — do not re-read code yourself.`

The intent is "don't try to use Read/Grep yourself," but "quickly" may cause the orchestrator to skip reasoning about agent results and blindly proceed.

**Fix:**
```
After receiving agent results, analyze them and proceed to the next step.
Do not attempt to read or modify code yourself — always delegate.
```

---

#### 5b. Missing rule: context forwarding

The biggest gap in the entire prompt set is **no instruction about what context to pass when delegating.** The orchestrator often delegates with minimal context, forcing specialists to re-discover information.

**Add:**
```
When delegating, always include relevant context from previous steps:
- Pass the architect's plan to the implementer.
- Pass the original requirements and acceptance criteria to the reviewer.
- Pass error output and relevant file paths to the debugger.
- Pass the debugger's diagnosis to the implementer when fixing issues.
```

---

## 6. Goal Message Construction (AngyEngine.ts, lines 224–264)

This isn't in Orchestrator.ts but directly affects prompt quality.

### 6a. Acceptance criteria aren't labeled as the definition of done

The goal message includes `## Acceptance Criteria` but doesn't tell the orchestrator that this is the **exit condition**. The orchestrator may call `done()` before all criteria are met.

**Fix (in AngyEngine.ts):**
```
## Acceptance Criteria (Definition of Done — all must be satisfied before calling done())
```

---

### 6b. Truncated architect plan in fix mode

Line 258: `epic.lastArchitectPlan.substring(0, 2000)`

2000 characters may truncate the most important part of the plan (the detailed file changes are usually at the end). Consider truncating from the beginning or increasing the limit.

---

## 7. Cross-Cutting Issues

### 7a. No few-shot examples anywhere

All prompts are zero-shot. Even one example of a good delegation message would dramatically improve consistency. For the orchestrator, a single example showing the ideal delegation format would anchor behavior:

```
Example delegation to implementer:
  delegate(role="implementer", task="In src/engine/Orchestrator.ts, add a new
  method `setRetryLimit(n: number)` that stores the retry limit as a private field.
  Then modify the `runFixLoop` method (line 245) to check this limit before retrying.
  Follow the existing pattern used by `setFixMode`. The architect's full plan: [plan text]")
```

### 7b. Specialist prompts don't mention tool constraints

Each specialist has tool restrictions (lines 93–98), but the prompts don't mention them. The architect doesn't know it can only Read/Glob/Grep. The reviewer doesn't know it can't edit. If a specialist tries to use a tool it doesn't have, it wastes a turn getting an error.

**Fix:** Append to each specialist prompt:
```
You have access to these tools: {tools}. Do not attempt to use any other tools.
```

### 7c. No shared vocabulary for pass/fail signals

The orchestrator has to parse free-text results from specialists to decide what to do next. If the tester says "there were some warnings but it compiled" — is that a pass or fail? If the reviewer says "looks mostly good, a few things to consider" — approve or reject?

**Fix:** This is already addressed by the proposed reviewer and tester prompt changes (explicit PASS/FAIL, APPROVE/REJECT verdicts). Ensure all specialists use clear signal words that the orchestrator can key off of.

---

## Summary: Priority Order

| Priority | Change | Impact | Effort |
|----------|--------|--------|--------|
| **P0** | Add structured output format to architect prompt | Fixes architect→implementer handoff | Low |
| **P0** | Add APPROVE/REJECT verdict to reviewer prompt | Fixes infinite review loops | Low |
| **P0** | Add retry limits to both workflows | Prevents infinite loops | Low |
| **P0** | Fix "exactly one" vs "MULTIPLE" contradiction in preamble | Eliminates confusion | Low |
| **P1** | Add context-forwarding rule to ORCHESTRATOR_RULES | Improves delegation quality | Low |
| **P1** | Add BUILD/TEST result format to tester prompt | Clearer test signals | Low |
| **P1** | Scope-control the implementer prompt | Reduces over-engineering | Low |
| **P1** | Expand CREATE_WORKFLOW with decision guidance | Better orchestration flow | Medium |
| **P2** | Add tool-awareness to specialist prompts | Fewer wasted turns | Low |
| **P2** | Consolidate negative framing in preamble | Cleaner prompt | Low |
| **P2** | Reduce triple-negative in FIX_WORKFLOW | Cleaner prompt | Low |
| **P3** | Add few-shot example for delegation | Better delegation quality | Medium |
| **P3** | Fix acceptance criteria labeling in goal message | Clearer exit condition | Low |
| **P3** | Fix architect plan truncation in fix mode | Better fix context | Low |
