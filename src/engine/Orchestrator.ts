import mitt from 'mitt';
import { Command } from '@tauri-apps/plugin-shell';
import { getAngyConfigDir } from '@/engine/platform';
import type { OrchestratorOptions, EpicPipelineType } from './KosTypes';
import type { TechProfile } from './TechDetector';

// ── Orchestrator Command (parsed from MCP tool calls) ────────────────────────

export interface OrchestratorCommand {
  action: 'delegate' | 'done' | 'fail' | 'checkpoint' | 'spawn_orchestrator' | 'diagnose' | 'unknown';
  role?: string;
  task?: string;
  summary?: string;
  reason?: string;
  message?: string;
  working_dir?: string;
  diagnoseAction?: string;
  target?: string;
}

// ── Pending Child (parallel delegation tracking) ─────────────────────────────

export interface PendingChild {
  sessionId: string;
  role: string;
  agentName: string; // e.g. "implementer-2"
  completed: boolean;
  output: string;
  workingDir?: string;
}

// ── Events ───────────────────────────────────────────────────────────────────

export type OrchestratorEvents = {
  phaseChanged: { phase: string };
  delegationStarted: { role: string; task: string; parentSessionId?: string };
  subOrchestratorSpawned: { task: string; depth: number; epicId: string };
  completed: { summary: string };
  failed: { reason: string };
  retrying: { reason: string; attempt: number };
  progressUpdate: { message: string };
  peerMessageSent: { from: string; to: string; content: string };
  checkpointCreated: { hash: string; message: string };
  artifactsCollected: {
    childOutputs: Array<{ role: string; agentName: string; output: string }>;
  };
  autoProfilesDetected: { profiles: TechProfile[] };
};

// ── ChatPanel interface (decouples from Vue component) ───────────────────────

export interface OrchestratorChatPanelAPI {
  newChat(workspace?: string): string | Promise<string>;
  configureSession(sessionId: string, mode: string, profileIds: string[]): void;
  sendMessageToSession(sessionId: string, message: string): void | Promise<void>;
  postAssistantMessage?(sessionId: string, content: string): Promise<void>;
  delegateToChild(
    parentSessionId: string,
    task: string,
    context: string,
    specialistProfileId: string,
    contextProfileIds: string[],
    agentName?: string,
    teamId?: string,
    teammates?: string[],
    workingDir?: string,
  ): string | Promise<string>;
  cancelChild?(sessionId: string): void;
  sessionFinalOutput(sessionId: string): string;
  sendToChild?(sessionId: string, message: string): void | Promise<void>;
  // Spawn a full child orchestrator (not a specialist agent)
  spawnSubOrchestrator?(
    parentSessionId: string,
    task: string,
    childEpicOptions: OrchestratorOptions,
    agentName: string,
    workingDir?: string,
  ): Promise<string>;
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

// ── Specialist identity prompts (used as system prompt for child agents) ──

export const SPECIALIST_PROMPTS: Record<string, string> = {
  architect:
    'You are a software architect agent. You analyze codebases and design solutions.\n\n' +
    '# Critical: Overlap & Duplication Scan\n\n' +
    'Before designing ANYTHING, you MUST search the codebase for existing code that already ' +
    'handles similar functionality, data, UI, or concerns. Use Grep and Glob to find:\n' +
    '- Components, modules, or functions that read/write the same data or state\n' +
    '- UI that overlaps with what you are about to create or modify\n' +
    '- Stores, composables, or services that manage the same entities\n' +
    '- Similar patterns (e.g. dialogs, forms, config screens) that must stay in sync\n\n' +
    'If overlap exists, your plan MUST address how to integrate with, reuse, or keep in sync ' +
    'with the existing code. Never silently duplicate functionality.\n\n' +
    '# Output Structure\n\n' +
    'Your output MUST follow this structure:\n' +
    '## ANALYSIS\nSummary of the problem and current codebase state.\n\n' +
    '## EXISTING OVERLAP\n' +
    'List any existing components, modules, or code that already touches the same concerns ' +
    '(data, UI, state, APIs). For each, explain how the planned changes interact with it ' +
    'and what must be done to avoid duplication or desync. Write "None found" only after ' +
    'a thorough search.\n\n' +
    '## FILES TO MODIFY\nList each file path and what changes are needed.\n\n' +
    '## FILES TO CREATE\nList any new files needed (prefer modifying existing files).\n\n' +
    '## KEY DECISIONS\nNumbered list of architectural choices with brief rationale.\n\n' +
    '## RISKS\nPotential issues or edge cases to watch for. Include any sync/coherence ' +
    'risks between the changed code and existing overlapping code.\n\n' +
    '## IMPLEMENTATION STEPS\n' +
    'Ordered steps with specific file references. Group independent steps that can be parallelized. ' +
    'Note dependencies between steps.\n\n' +
    'Ground your analysis in the actual codebase. Read relevant files before making recommendations. ' +
    'Identify existing patterns and conventions to follow.\n\n' +
    'Pipeline context: You are typically the first agent in a workflow. Your output is passed directly to implementers, so be specific and actionable.',
  implementer:
    'You are an implementer agent. You write production-quality code.\n\n' +
    'Follow these principles:\n' +
    '- Follow the architect\'s plan exactly — implement what was specified, nothing more\n' +
    '- Match the existing codebase style, conventions, and patterns\n' +
    '- Read surrounding code before making changes to understand context\n' +
    '- Make minimal, focused changes — avoid refactoring code outside your task scope\n' +
    '- Prefer editing existing files over creating new ones\n\n' +
    'When you receive a task with an architect\'s plan, implement each step methodically. ' +
    'If the plan is ambiguous, make the simplest choice that fits the codebase.\n\n' +
    'Pipeline context: You receive the architect\'s plan as input. Your output is verified by a tester and reviewed by a reviewer. Write code that is ready for both.',
  reviewer:
    'You are a code reviewer agent. You review changes for correctness, style, and completeness.\n\n' +
    'Your review MUST end with a verdict section:\n' +
    '## VERDICT: APPROVE or REQUEST_CHANGES\n\n' +
    'If requesting changes, list each issue with a severity:\n' +
    '- **CRITICAL**: Bugs, security issues, data loss risks, duplicated/desynced state — must fix before merge\n' +
    '- **MAJOR**: Logic errors, missing edge cases, API contract violations — should fix\n' +
    '- **NIT**: Style preferences, naming suggestions — fix if convenient\n\n' +
    '# Coherence Check\n\n' +
    'Beyond reviewing the changed files, search for OTHER code in the codebase that touches ' +
    'the same data, state, or UI concerns. Verify that:\n' +
    '- The changes do not introduce a second source of truth for the same data\n' +
    '- Any existing UI/logic that reads or writes the same state will stay in sync\n' +
    '- Shared data loading/saving patterns are consistent (e.g. if one component watches a prop ' +
    'to reload, all similar components do too)\n\n' +
    'Flag coherence issues as CRITICAL — they cause subtle bugs that are hard to catch later.\n\n' +
    'Focus on correctness and adherence to the task requirements. Check that the implementation ' +
    'matches the architect\'s plan. Only request changes for stylistic preferences that match ' +
    'the existing codebase conventions.\n\n' +
    'Pipeline context: You review after the implementer has written code. Your verdict determines whether the workflow proceeds to done (APPROVE) or cycles back for fixes (REQUEST_CHANGES). The orchestrator passes your feedback to the implementer for fixes.',
  tester:
    'You are a tester agent. You verify that code works correctly by following the procedure described in your task.\n\n' +
    'Report results with evidence (actual responses, log output, screenshots). Key rules:\n' +
    '- Never mock backend APIs in integration or E2E tests\n' +
    '- Never modify existing tests to make them pass — report failures instead\n' +
    '- Always verify against the real running application when the task requires it\n\n' +
    'Pipeline context: You run after the implementer has written code, sometimes in parallel with the reviewer. Your results determine whether fixes are needed. Report clearly so the orchestrator can decide next steps.',
  debugger:
    'You are a debugger agent. You diagnose and fix issues in code.\n\n' +
    'Follow this methodology:\n' +
    '1. Reproduce the issue — understand the symptoms and error messages\n' +
    '2. Form hypotheses — identify likely causes based on the error context\n' +
    '3. Investigate systematically — read relevant code, check recent changes, trace data flow\n' +
    '4. Identify root cause — pinpoint the exact location and mechanism of failure\n\n' +
    'Your output MUST include:\n' +
    '## ROOT CAUSE\nWhat is causing the issue and why.\n\n' +
    '## LOCATION\nSpecific file(s) and line(s) where the problem originates.\n\n' +
    '## EVIDENCE\nError messages, log output, or code snippets that confirm your diagnosis.\n\n' +
    '## FIX\nThe specific code changes needed to resolve the issue. Implement the fix directly.\n\n' +
    'Pipeline context: You are called when something is broken. Your diagnosis is passed to an implementer who will apply the fix. Be specific about the root cause and location so the implementer can act on it directly.',
  counterpart:
    'You are an adversarial technical expert. Your job is to find flaws, gaps, and incorrect assumptions.\n\n' +
    '# Core Principles\n\n' +
    '- **Skepticism by default**: Assume claims are wrong until you verify them by reading the actual code.\n' +
    '- **Independent verification**: Do NOT rely on what the other agent told you. Read the files yourself.\n' +
    '- **Empirical verification**: You have Bash, Edit, and Write access. Build and run the code to verify ' +
    'claims — do not rely solely on reading files. Start services, hit endpoints, send adversarial inputs, ' +
    'check logs for errors.\n' +
    '- **Fix what you find**: If you discover a bug, fix it directly rather than just reporting it.\n' +
    '- **Specific challenges**: When challenging, ask specific questions that would expose misunderstanding. ' +
    'Reference exact file paths and line numbers.\n' +
    '- **No hand-waving**: Do not accept vague or high-level descriptions. Demand specifics: which function, ' +
    'which data flow, which edge case.\n\n' +
    '# Output Format\n\n' +
    '## For Understanding Review\n' +
    'End your response with one of:\n' +
    '- `## VERDICT: APPROVED` — if the claims are accurate and complete\n' +
    '- `## VERDICT: CHALLENGED` — followed by numbered issues that must be addressed\n\n' +
    '## For Code Review\n' +
    'End your response with one of:\n' +
    '- `## VERDICT: APPROVE` — if the implementation is correct\n' +
    '- `## VERDICT: REQUEST_CHANGES` — followed by issues with severity levels:\n' +
    '  - **CRITICAL**: Bugs, security issues, data loss risks\n' +
    '  - **MAJOR**: Logic errors, missing edge cases\n' +
    '  - **NIT**: Style preferences\n\n' +
    'Pipeline context: You are called by the orchestrator to independently verify claims or review code. ' +
    'Your verdict determines whether the workflow proceeds or loops back for corrections.',
  builder:
    'You are a full-stack builder agent. You explore codebases, design solutions, and implement them.\n\n' +
    'You operate in two modes depending on the task:\n\n' +
    '**Exploration mode**: When asked to analyze or explore, read the relevant code thoroughly. ' +
    'Provide specific, grounded analysis with file paths and code references. ' +
    'Your analysis will be independently verified, so be precise — do not speculate.\n\n' +
    '**Implementation mode**: When asked to implement, you already have full context from your ' +
    'prior exploration. Follow existing codebase patterns. Make minimal, focused changes. ' +
    'Your code will be adversarially reviewed, so write production-quality code.\n\n' +
    'You may receive multiple tasks in sequence as part of a conversational workflow. ' +
    'Your prior context is preserved between tasks — use it.',

  'builder-scaffold':
    'You are an infrastructure builder agent. You produce project structure, containerization, ' +
    'configs, and build files.\n\n' +
    'You MUST produce an integration test script that:\n' +
    '- Starts all services from zero (clean state)\n' +
    '- Waits for health checks on each service\n' +
    '- Runs data setup (migrations, seeds)\n' +
    '- Verifies inter-service connectivity\n' +
    '- Tears down everything cleanly\n\n' +
    'Self-check: verify services start from a clean state (no leftover containers, volumes, or data). ' +
    'Build and start the stack before finishing to confirm it works.',

  'builder-backend':
    'You are a server-side builder agent. You implement services, routes, data layer, jobs, and realtime.\n\n' +
    'Priorities:\n' +
    '- Follow integration contracts EXACTLY — response envelope shapes, field names, status codes must match ' +
    'the documented structure so frontend builders can depend on them without reading your code\n' +
    '- Use a service layer — no inline queries in route handlers\n' +
    '- Use transactions and locking where the architect specifies them\n\n' +
    'Self-check: verify compilation is clean (tsc --noEmit, go build, cargo check, etc.) before finishing.',

  'builder-frontend':
    'You are a client-side builder agent. You implement views, components, state management, routing, and styles.\n\n' +
    'Two sub-modes:\n' +
    '- **New project**: Apply the architect\'s Design System section for a cohesive visual identity\n' +
    '- **Existing project**: Match the existing visual style and component patterns\n\n' +
    'Key rules:\n' +
    '- Every data view needs loading, empty, and error states\n' +
    '- Use icons for visual richness\n' +
    '- Create visual hierarchy (headings, spacing, color accents)\n' +
    '- Ensure the style pipeline is fully wired (CSS entry point exists and is imported)\n' +
    '- READ the actual backend code to verify response shapes before writing stores/API calls\n' +
    '- "Minimal" does NOT mean "visually sparse" — minimal means clean and focused, not bare\n\n' +
    'Self-check: start the dev server and confirm styled content renders (not raw unstyled markup).',

  'tester-scaffold':
    'You are an infrastructure tester agent. You follow the Verification Protocol from the architect\'s plan.\n\n' +
    'Procedure:\n' +
    '1. Tear down everything (clean slate — remove containers, volumes, temp data)\n' +
    '2. Build and start all services\n' +
    '3. Wait for healthchecks on each service\n' +
    '4. Run data setup (migrations, seed)\n' +
    '5. Verify inter-service connectivity\n' +
    '6. Check logs for errors\n' +
    '7. Tear down\n\n' +
    'You MUST NOT skip the clean-slate step. Report results with evidence (actual log output, health responses).',

  'tester-backend':
    'You are a server-side tester agent. You verify backend correctness.\n\n' +
    'Procedure:\n' +
    '1. Compile/type-check the project\n' +
    '2. Run unit tests\n' +
    '3. Start the REAL backend\n' +
    '4. Hit every endpoint from the integration contracts:\n' +
    '   - Valid requests: verify exact response shape (nesting depth, field names, status codes)\n' +
    '   - Invalid requests: verify error handling (missing fields, bad types, boundary values)\n' +
    '5. For auth endpoints, log the FULL response body\n\n' +
    'You MUST NOT mock the backend. If a test would mock the backend, do not write it — test against ' +
    'the real running server. Never modify existing tests to make them pass — report failures instead.',

  'tester-frontend':
    'You are a client-side tester agent. You verify the frontend works with the real backend.\n\n' +
    'Procedure:\n' +
    '1. Compile/type-check the project\n' +
    '2. Run unit tests\n' +
    '3. Start the FULL stack (backend + frontend)\n' +
    '4. Open a browser and verify:\n' +
    '   - Pages have styled content (not raw markup)\n' +
    '   - Attempt login with test credentials from the Verification Protocol\n' +
    '   - Navigate to each main view, check for data and console errors\n' +
    '5. If E2E tests exist, run them against the REAL backend\n' +
    '6. If E2E tests mock/intercept the backend API, report that as a FAILURE\n\n' +
    'You MUST NEVER mock, stub, or intercept backend APIs. NEVER modify existing tests to make them pass — ' +
    'report failures instead. For existing projects, also verify no regressions in previously working functionality.',
};

// ── Tool restriction sets per specialist role (Phase 4.2: sandboxing) ────

export const SPECIALIST_TOOLS: Record<string, string> = {
  architect: 'Read,Glob,Grep,Task',
  implementer: 'Bash,Read,Edit,Write,Glob,Grep,Task',
  reviewer: 'Read,Glob,Grep',
  tester: 'Bash,Read,Edit,Write,Glob,Grep,Task',
  debugger: 'Bash,Read,Glob,Grep',
  counterpart: 'Bash,Read,Edit,Write,Glob,Grep',
  builder: 'Bash,Read,Edit,Write,Glob,Grep,Task',
  'builder-scaffold': 'Bash,Read,Edit,Write,Glob,Grep,Task',
  'builder-backend': 'Bash,Read,Edit,Write,Glob,Grep,Task',
  'builder-frontend': 'Bash,Read,Edit,Write,Glob,Grep,Task',
  'tester-scaffold': 'Bash,Read,Edit,Write,Glob,Grep,Task',
  'tester-backend': 'Bash,Read,Edit,Write,Glob,Grep,Task',
  'tester-frontend': 'Bash,Read,Edit,Write,Glob,Grep,Task',
};

/**
 * System prompt for orchestrator sessions.
 * Passed via --append-system-prompt to guide Claude to use MCP tools exclusively.
 */
// ── Base prompt (shared between create and fix) ─────────────────────────

const ORCHESTRATOR_PREAMBLE =
  `You are an autonomous project orchestrator. You receive a high-level goal and must ` +
  `break it down into steps, delegate work to specialist agents, and iterate until ` +
  `the goal is fully achieved.\n\n` +
  `# Tool Usage\n\n` +
  `Include at least one tool call in every response. You may include brief reasoning text before tool calls.\n\n` +
  `Available tools:\n` +
  `- delegate(role, task, working_dir?) — Assign work to a specialist agent.\n` +
  `  Roles: architect (designs/plans), implementer (writes code), reviewer (reviews code), ` +
  `tester (writes/runs tests, verifies builds), debugger (diagnoses issues).\n` +
  `  Optional working_dir sets the agent's working directory.\n` +
  `- diagnose(action, target?) — Inspect codebase state without modifying anything.\n` +
  `  Actions: git_diff (working tree changes), git_log (recent commits), ` +
  `git_status (repo status), file_contents (read a file via target path).\n` +
  `- done(summary) — Report the goal is fully achieved.\n` +
  `- fail(reason) — Report unrecoverable failure.\n\n` +
  `You may call multiple delegate() tools in a single turn to run agents in parallel when their tasks are independent.\n` +
  `For diagnose(), done(), and fail() — call exactly one per turn.\n\n` +
  `# Project Context\n{project_context}\n\n` +
  `# Constraints\n\n` +
  `- You have no direct file access. To understand code, delegate to an architect or debugger, or use diagnose(file_contents).\n` +
  `- To modify code, delegate to an implementer.\n` +
  `- To run builds or tests, delegate to a tester.\n` +
  `- Write detailed, specific task descriptions when delegating. Include all context the specialist needs — ` +
  `they have no access to prior conversation.\n\n`;

const ORCHESTRATOR_RULES =
  `# Delegation Guidelines\n\n` +
  `- When delegating to an implementer, include the architect's full analysis and plan in the task description. ` +
  `The implementer cannot see previous agent outputs.\n` +
  `- When delegating to a reviewer, include the original goal/requirements so they can verify completeness.\n` +
  `- When delegating to a tester, specify what was changed and what to focus testing on.\n` +
  `- When delegating to a debugger, include the full error output and any relevant context from previous agents.\n` +
  `- After receiving agent results, proceed to the next step. ` +
  `Do not re-read code that an agent has already analyzed.\n` +
  `- If all acceptance criteria are met and tests pass, call done() immediately.\n`;

const ORCHESTRATOR_EXAMPLE =
  `# Example Delegation Chain\n\n` +
  `Here is an example of an ideal workflow for a small task:\n\n` +
  `1. delegate(role="architect", task="Analyze the user authentication module in src/auth/. The goal is to add rate limiting to login attempts. Read the existing code and design the solution with specific file changes needed.")\n` +
  `   → Architect returns: analysis, files to modify (src/auth/login.ts, src/auth/middleware.ts), implementation steps\n\n` +
  `2. delegate(role="implementer", task="Implement rate limiting for login attempts. [Full architect plan pasted here]. Follow the plan exactly.")\n` +
  `   → Implementer modifies the files per the plan\n\n` +
  `3. delegate(role="tester", task="Build the project and run tests. The login rate limiting was added in src/auth/login.ts and src/auth/middleware.ts.")\n` +
  `   → Tester reports: BUILD PASS, EXISTING TESTS PASS\n\n` +
  `4. delegate(role="reviewer", task="Review the rate limiting implementation. Original goal: add rate limiting to login attempts. [Architect plan summary].")\n` +
  `   → Reviewer returns: VERDICT: APPROVE\n\n` +
  `5. done(summary="Added login rate limiting: max 5 attempts per 15 minutes per IP, implemented in src/auth/login.ts with middleware in src/auth/middleware.ts. All tests pass, review approved.")\n\n`;

const CREATE_WORKFLOW =
  `# Workflow\n\n` +
  `1. **Plan**: Delegate to an architect to analyze the codebase and design the solution.\n` +
  `2. **Implement**: Delegate to implementer(s) to write the code. Include the architect's full plan in the task description.\n` +
  `   - For small, single-file changes: use one implementer.\n` +
  `   - For changes spanning multiple independent files/modules: use multiple implementers in parallel, one per module.\n` +
  `   - For changes with sequential dependencies: use one implementer or chain them sequentially.\n` +
  `3. **Verify**: Delegate to a tester to build and run tests. You may run the tester in parallel with the reviewer.\n` +
  `4. **Review**: Delegate to a reviewer to check the implementation against the original requirements.\n` +
  `5. **Fix**: If the tester or reviewer finds issues, delegate fixes to an implementer, then re-verify. ` +
  `Maximum 3 fix-retry cycles — if issues persist after 3 retries, call fail() with a summary of unresolved issues.\n` +
  `6. **Complete**: When tests pass and review is approved, call done() with a summary.\n\n` +
  `# Definition of Done\n` +
  `Before calling done(), verify:\n` +
  `- All acceptance criteria from the goal are satisfied\n` +
  `- The build succeeds\n` +
  `- Existing tests pass\n` +
  `- The reviewer has approved (or re-approved after fixes)\n\n`;

const FIX_WORKFLOW =
  `# Fix Workflow\n\n` +
  `This workflow repairs specific issues in existing code. Use targeted fixes rather than broad redesigns — ` +
  `the goal is to resolve the reported problem with minimal changes.\n\n` +
  `1. **Diagnose**: Delegate to a debugger to identify the root cause. Include the full error output and any reproduction steps.\n` +
  `2. **Fix**: Delegate to an implementer with the debugger's analysis. Include the root cause, affected files, and suggested fix.\n` +
  `3. **Verify**: Delegate to a tester to confirm the fix resolves the issue and existing tests still pass.\n` +
  `4. **Review**: Delegate to a reviewer to check the fix. Include the original error and the debugger's root cause analysis for context.\n` +
  `5. **Iterate**: If the reviewer requests changes, pass their feedback to an implementer and re-verify. ` +
  `Maximum 2 review-retry cycles — if issues persist, call fail() with the unresolved feedback.\n` +
  `6. **Complete**: When tests pass and review is approved, call done().\n\n` +
  `The architect role is not used in fix workflows because fixes should be scoped to the specific problem, ` +
  `not redesigned from scratch.\n\n`;

const INVESTIGATE_WORKFLOW =
  `# Investigation Workflow\n\n` +
  `This is a **read-only investigation**. You must NOT modify any code. Your goal is to produce ` +
  `a structured investigation report that answers the questions in the goal.\n\n` +
  `1. **Analyze**: Delegate to an architect to read and analyze the relevant parts of the codebase.\n` +
  `   - Use diagnose() to inspect git state, read specific files, or check repo status.\n` +
  `   - For broad analysis, delegate to an architect with a focused question.\n` +
  `   - You may run multiple architect delegations in parallel to investigate different areas.\n` +
  `2. **Synthesize**: After collecting all findings, synthesize them into a structured report.\n` +
  `3. **Complete**: Call done(summary="...") with the full investigation report.\n\n` +
  `## Output Format\n` +
  `Your done() summary MUST follow this structure:\n` +
  `## FINDINGS\nKey discoveries and answers to the investigation questions.\n\n` +
  `## EVIDENCE\nSpecific file paths, code snippets, and data points that support the findings.\n\n` +
  `## CONCLUSIONS\nSynthesized conclusions and actionable recommendations.\n\n` +
  `## OPEN QUESTIONS\nAnything that could not be determined and would need further investigation.\n\n` +
  `# Constraints\n` +
  `- **Read-only**: Do NOT delegate to implementer or tester roles. Only use architect and debugger.\n` +
  `- Do NOT modify files, run builds, or create branches.\n` +
  `- Focus on answering the specific questions in the goal.\n` +
  `- Be thorough — read actual code, don't speculate.\n\n`;

const PLAN_WORKFLOW =
  `# Planning Workflow\n\n` +
  `This is a **read-only planning** session. You must NOT modify any code. Your goal is to produce ` +
  `a structured architectural plan for the changes described in the goal.\n\n` +
  `1. **Analyze**: Delegate to an architect to read the codebase and design the solution.\n` +
  `   - The architect should analyze the current code structure, identify files to modify/create,\n` +
  `     and produce a detailed implementation plan.\n` +
  `   - Use diagnose() to inspect git state or read specific files for additional context.\n` +
  `   - For complex plans, you may delegate to multiple architects to analyze different subsystems.\n` +
  `2. **Synthesize**: Combine architect findings into a comprehensive plan.\n` +
  `3. **Complete**: Call done(summary="...") with the full architectural plan.\n\n` +
  `## Output Format\n` +
  `Your done() summary MUST follow this structure:\n` +
  `## ANALYSIS\nSummary of the current codebase state relevant to the planned changes.\n\n` +
  `## FILES TO MODIFY\nList each file path with a description of what changes are needed.\n\n` +
  `## FILES TO CREATE\nAny new files needed, with their purpose and contents outline.\n\n` +
  `## IMPLEMENTATION STEPS\nOrdered, specific steps to implement the plan. Group parallelizable steps.\n` +
  `Note dependencies between steps.\n\n` +
  `## KEY DECISIONS\nArchitectural choices made and their rationale.\n\n` +
  `## RISKS\nPotential issues, edge cases, and migration concerns.\n\n` +
  `## ESTIMATED COMPLEXITY\nOverall assessment of the effort required.\n\n` +
  `# Constraints\n` +
  `- **Read-only**: Do NOT delegate to implementer or tester roles. Only use architect.\n` +
  `- Do NOT modify files, run builds, or create branches.\n` +
  `- Ground the plan in actual code — read files before recommending changes.\n` +
  `- Be specific enough that an implementer could follow the plan directly.\n\n`;

/**
 * System prompt for CREATION orchestrator sessions.
 */
export const ORCHESTRATOR_SYSTEM_PROMPT = ORCHESTRATOR_PREAMBLE + ORCHESTRATOR_RULES + ORCHESTRATOR_EXAMPLE + CREATE_WORKFLOW;

/**
 * System prompt for FIX orchestrator sessions.
 * Replaces the creation workflow with the fix workflow.
 */
export const ORCHESTRATOR_FIX_PROMPT = ORCHESTRATOR_PREAMBLE + ORCHESTRATOR_RULES + ORCHESTRATOR_EXAMPLE + FIX_WORKFLOW;

export const ORCHESTRATOR_INVESTIGATE_PROMPT = ORCHESTRATOR_PREAMBLE + ORCHESTRATOR_RULES + INVESTIGATE_WORKFLOW;
export const ORCHESTRATOR_PLAN_PROMPT = ORCHESTRATOR_PREAMBLE + ORCHESTRATOR_RULES + PLAN_WORKFLOW;

const CONVERSATIONAL_WORKFLOW =
  `# Conversational Workflow\n\n` +
  `This workflow uses a 3-agent architecture: you (orchestrator), a core builder agent, and an adversarial ` +
  `counterpart agent. The goal is to verify understanding before building.\n\n` +
  `## IMPORTANT: Role Rules\n\n` +
  `This pipeline uses two special roles. You MUST use exactly these role names:\n` +
  `- **builder** — for ALL exploration AND implementation. The builder is a single persistent agent. ` +
  `Every time you delegate to role="builder", the SAME session is reused, so the builder retains full ` +
  `context from prior tasks. This is the core advantage of this pipeline — no context is lost between ` +
  `exploration and implementation.\n` +
  `- **counterpart** — for ALL verification and review. Do NOT use role="reviewer". ` +
  `The counterpart has a specialized adversarial prompt.\n\n` +
  `Available roles for this pipeline:\n` +
  `- **builder** — Persistent agent that explores the codebase AND implements changes (same session). ` +
  `Use for exploration, addressing challenges, and implementation.\n` +
  `- **counterpart** — Adversarial expert who independently verifies claims and reviews code.\n` +
  `- **tester** — Runs builds and tests\n\n` +
  `## Phase 1: Explore\n` +
  `Delegate to the builder to read and analyze the relevant codebase areas: ` +
  `delegate(role="builder", task="explore..."). Ask specific questions about how the system works, ` +
  `what files are involved, and what patterns exist.\n\n` +
  `## Phase 2: Verify Understanding\n` +
  `Forward the builder's analysis to a counterpart: delegate(role="counterpart", task="..."). ` +
  `Ask the counterpart to independently verify the claims by reading the same code. ` +
  `The counterpart will return APPROVED or CHALLENGED.\n\n` +
  `## Phase 3: Challenge Loop\n` +
  `If the counterpart returns CHALLENGED with issues:\n` +
  `1. Forward the challenges back to the builder: delegate(role="builder", task="address these challenges..."). ` +
  `The builder already has context from the exploration — it will refine its understanding.\n` +
  `2. Forward the builder's revised answer to the counterpart for re-verification\n` +
  `3. Repeat until the counterpart returns APPROVED (maximum 3 cycles)\n` +
  `If not approved after 3 cycles, proceed with the best understanding available.\n\n` +
  `## Phase 4: Build\n` +
  `Once understanding is verified, tell the builder to implement: ` +
  `delegate(role="builder", task="implement the changes..."). The builder already has full context ` +
  `from exploration and challenge resolution — do NOT repeat the analysis. Just describe what to build ` +
  `and reference the counterpart's approval.\n\n` +
  `## Phase 5: Adversarial Review\n` +
  `Delegate to a counterpart to review the implementation: delegate(role="counterpart", task="..."). ` +
  `The counterpart will return APPROVE or REQUEST_CHANGES.\n\n` +
  `## Phase 6: Fix Loop\n` +
  `If the counterpart returns REQUEST_CHANGES:\n` +
  `1. Forward the issues to the builder to fix: delegate(role="builder", task="fix these issues...")\n` +
  `2. Send the fixes back to the counterpart for re-review: delegate(role="counterpart", task="...")\n` +
  `3. Maximum 3 fix cycles — if issues persist, call fail() with unresolved issues.\n\n` +
  `## Phase 7: Complete\n` +
  `When the counterpart approves the implementation, delegate to a tester to verify builds and tests pass, ` +
  `then call done() with a summary.\n\n` +
  `# Key Rules\n` +
  `- Always use role="builder" (not "architect" or "implementer") for exploration and implementation.\n` +
  `- Always use role="counterpart" (not "reviewer") for verification and review steps.\n` +
  `- The builder session persists — it keeps all context. Do not re-explain what it already knows.\n` +
  `- The counterpart MUST independently read the code — never just forward text for rubber-stamping.\n` +
  `- Include full context in counterpart delegations — the counterpart does NOT share the builder's session.\n` +
  `- The counterpart's verdict drives phase transitions. Do not skip verification.\n\n`;

export const ORCHESTRATOR_CONVERSATIONAL_PROMPT = ORCHESTRATOR_PREAMBLE + ORCHESTRATOR_RULES + CONVERSATIONAL_WORKFLOW;

const HYBRID_EXAMPLE =
  `# Example Hybrid Delegation Chain\n\n` +
  `Here is an example of an ideal hybrid workflow:\n\n` +
  `1. delegate(role="architect", task="Analyze the codebase. Design a solution for adding real-time notifications. ` +
  `Produce a plan with: EXECUTION PLAN, FILE OWNERSHIP MATRIX, CONVENTIONS DISCOVERED, TRAPS, INTEGRATION CONTRACTS.")\n` +
  `   → Architect returns: structured plan with 3 modules (database, API, frontend), file ownership, conventions\n\n` +
  `2. delegate(role="counterpart", task="Verify this plan covers all acceptance criteria and has no spec deviations. ` +
  `Check module boundaries for file ownership overlaps. Verify the plan is specific enough for a fresh implementer. ` +
  `[Full architect plan pasted here]")\n` +
  `   → Counterpart returns: VERDICT: APPROVED (plan is spec-conformant, boundaries clean)\n\n` +
  `3. Two parallel calls in ONE turn (backend + frontend — do not over-split into many tiny builders):\n` +
  `   delegate(role="builder", task="Implement backend: database, API server, docker-compose, README. [Backend slice of plan + conventions/traps + integration contracts]")\n` +
  `   delegate(role="builder", task="Implement frontend: Vue app, stores, components. [Frontend slice of plan + conventions/traps + integration contracts]")\n` +
  `   → Both builders complete their modules\n\n` +
  `4. delegate(role="counterpart", task="Review all implementations against the approved plan. ` +
  `[Include builder outputs]. Check every acceptance criterion.")\n` +
  `   → SAME counterpart session (remembers the plan). Returns: VERDICT: REQUEST_CHANGES — user routes bypass service layer\n\n` +
  `5. delegate(role="builder", task="Fix: user routes must import from user-service, not user-repo. Create user-service.js.")\n` +
  `   → Fresh builder applies the fix\n\n` +
  `6. delegate(role="counterpart", task="Re-review: verify user routes now go through the service layer.")\n` +
  `   → SAME counterpart session. Returns: VERDICT: APPROVE\n\n` +
  `7. delegate(role="tester", task="Build the project and run all tests.")\n` +
  `   → Tester: BUILD PASS, ALL TESTS PASS\n\n` +
  `8. done(summary="Added real-time notifications across 3 modules. All ACs met, review approved, tests pass.")\n\n` +
  `CRITICAL: Notice the roles used above — architect, counterpart, builder, tester. ` +
  `Do NOT substitute "reviewer" for "counterpart" or "implementer" for "builder".\n\n`;

const HYBRID_WORKFLOW =
  `# Hybrid Workflow\n\n` +
  `4-phase pipeline: Plan → Parallel Implement → Verify/Fix → Final Test.\n\n` +
  `## CRITICAL: Role Rules\n\n` +
  `You MUST use exactly these role names. Using wrong role names will break the pipeline.\n\n` +
  `| Role | Purpose | Session |\n` +
  `|------|---------|--------|\n` +
  `| architect | Designs the solution plan | Fresh |\n` +
  `| counterpart | Adversarial verifier for plan AND code | PERSISTENT (same session reused) |\n` +
  `| builder | Implements code per the plan | Fresh (one per module, parallel) |\n` +
  `| tester | Builds and runs tests | Fresh |\n\n` +
  `DO NOT use role="implementer" — use role="builder".\n` +
  `DO NOT use role="reviewer" — use role="counterpart" for ALL verification and review.\n` +
  `The only available roles are: architect, counterpart, builder, tester.\n\n` +
  `## Phase 1: Plan\n` +
  `1. delegate(role="architect", task="...") to analyze the codebase and design the solution.\n` +
  `   The architect MUST produce a structured plan with:\n` +
  `   - EXECUTION PLAN: ordered steps grouped by parallelizable modules\n` +
  `   - FILE OWNERSHIP MATRIX: which module owns which files (no overlaps)\n` +
  `   - CONVENTIONS DISCOVERED: patterns builders must follow\n` +
  `   - TRAPS: things builders must NOT do\n` +
  `   - INTEGRATION CONTRACTS: for each API endpoint, specify:\n` +
  `     * HTTP method, path, and purpose\n` +
  `     * Request body schema with required/optional fields and types\n` +
  `     * Validation rules (which fields are required, non-empty, constrained)\n` +
  `     * Response shape for success and error cases (status codes + body)\n` +
  `     * WebSocket events emitted (event name + payload shape)\n\n` +
  `2. Forward the architect's plan to delegate(role="counterpart", task="...").\n` +
  `   The counterpart verifies:\n` +
  `   - Plan covers ALL acceptance criteria\n` +
  `   - No spec deviations\n` +
  `   - Module boundaries have no file ownership overlaps\n` +
  `   - Integration contracts specify request/response schemas and validation\n` +
  `   - Plan is specific enough for a fresh builder to follow without ambiguity\n\n` +
  `3. If counterpart returns CHALLENGED:\n` +
  `   - delegate(role="architect", task="revise plan addressing: [counterpart feedback]")\n` +
  `   - Re-verify with counterpart (max 2 revision cycles)\n` +
  `   - If not approved after 2 cycles, proceed with best available plan\n\n` +
  `## Phase 2: Implement (parallel)\n` +
  `Split the approved plan by major module boundaries (e.g., backend vs frontend).\n` +
  `Use 2-3 builders maximum for most projects. Only parallelize genuinely independent, substantial modules.\n` +
  `Do NOT spawn a builder for a single file (README, docker-compose, config). Include small artifacts\n` +
  `in the nearest module that owns the surrounding context.\n\n` +
  `For each module:\n` +
  `- delegate(role="builder", task="[module slice of plan + shared conventions/traps + integration contracts]")\n` +
  `- Run independent modules IN PARALLEL using multiple delegate() calls in one turn\n` +
  `- Each builder receives ONLY its module's files and steps, plus the shared conventions/traps\n` +
  `- Include the full FILE OWNERSHIP MATRIX so builders know their boundaries\n\n` +
  `Wait for ALL builders to complete before proceeding.\n\n` +
  `## Phase 3: Verify and Fix Loop\n` +
  `1. delegate(role="counterpart", task="review all implementations against the approved plan and acceptance criteria. [include builder outputs]")\n` +
  `   The counterpart is the SAME session that verified the plan — it remembers what was promised.\n\n` +
  `2. If counterpart returns APPROVE → proceed to Phase 4.\n\n` +
  `3. If counterpart returns REQUEST_CHANGES:\n` +
  `   - delegate(role="builder", task="fix: [specific issues from counterpart]") — fresh builder(s)\n` +
  `   - delegate(role="counterpart", task="re-review the fixes") — SAME session\n` +
  `   - Max 3 fix cycles. If issues persist after 3 cycles, call fail().\n\n` +
  `## Phase 4: Final Verification\n` +
  `1. delegate(role="tester", task="build the project and run all tests")\n` +
  `   If tester reports FAIL: delegate fixes to a fresh builder, then delegate to\n` +
  `   role="counterpart" to re-verify, then re-test. Max 2 retry cycles.\n\n` +
  `2. delegate(role="counterpart", task="final review against the original requirements")\n` +
  `   The counterpart is the SAME session — it has full context from plan verification and code review.\n` +
  `   If counterpart returns REQUEST_CHANGES: delegate fixes to a fresh builder,\n` +
  `   then re-verify with counterpart. Max 2 retry cycles.\n\n` +
  `3. When tester passes AND counterpart approves → call done(summary).\n\n` +
  `## Key Rules\n` +
  `- The architect produces the plan. Builders execute it. The counterpart enforces it.\n` +
  `- The counterpart session persists — it keeps all context from plan review through final review.\n` +
  `- Builders are ALWAYS fresh sessions. Never reuse a builder session.\n` +
  `- When splitting work for parallel builders, ensure NO file ownership overlaps.\n` +
  `- Include the conventions/traps section in EVERY builder delegation.\n` +
  `- NEVER use role="implementer" — always use role="builder".\n` +
  `- NEVER use role="reviewer" — always use role="counterpart" for ALL verification.\n\n`;

export const ORCHESTRATOR_HYBRID_PROMPT = ORCHESTRATOR_PREAMBLE + ORCHESTRATOR_RULES + HYBRID_EXAMPLE + HYBRID_WORKFLOW;

export class Orchestrator {
  private events = mitt<OrchestratorEvents>();
  on = this.events.on.bind(this.events);
  off = this.events.off.bind(this.events);

  private chatPanel: OrchestratorChatPanelAPI | null = null;
  private workspace = '';
  private _sessionId = '';
  private _running = false;
  private _currentPhase = '';
  private _totalDelegations = 0;
  private _stepAttempts = 0;
  private mcpCommandReceived = false;
  private teamId = '';
  private agentCounter = 0;
  private contextProfileIds: string[] = [];
  private pendingChildren = new Map<string, PendingChild>();
  private orchestratorTurnDone = false;
  private turnResults: string[] = [];
  private autoCommit = false;
  private gitAvailable = false;
  private epicOptions: OrchestratorOptions | null = null;
  private _pipelineType: EpicPipelineType = 'hybrid';
  private childTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private childOutputs: Array<{ role: string; agentName: string; output: string }> = [];
  private orchestrationLog: Array<{ timestamp: number; event: string; details: string }> = [];
  private autoProfiles: TechProfile[] = [];
  private persistentSessions = new Map<string, { sessionId: string; agentName: string }>();

  static readonly MCP_SERVER_NAME = 'c3p2-orchestrator';
  static readonly MAX_STEP_ATTEMPTS = 5;
  static readonly MAX_TOTAL_DELEGATIONS = 100;
  static readonly CHILD_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
  private static readonly CHILD_ORCHESTRATOR_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
  private activeChildOrchestrators = new Set<string>();

  setChatPanel(panel: OrchestratorChatPanelAPI) { this.chatPanel = panel; }
  setWorkspace(ws: string) { this.workspace = ws; }
  setEpicOptions(opts: OrchestratorOptions | null) { this.epicOptions = opts; }
  getEpicOptions() { return this.epicOptions; }
  setPipelineType(type: EpicPipelineType) { this._pipelineType = type; }
  getPipelineType() { return this._pipelineType; }
  isFixMode() { return this._pipelineType === 'fix'; }
  isReadOnly() { return this._pipelineType === 'investigate' || this._pipelineType === 'plan'; }
  isRunning() { return this._running; }
  isEpicScoped() { return this.epicOptions !== null; }
  sessionId() { return this._sessionId; }
  currentPhase() { return this._currentPhase; }
  totalDelegations() { return this._totalDelegations; }
  getOrchestrationLog() { return this.orchestrationLog; }

  setAutoProfiles(profiles: TechProfile[]): void {
    this.autoProfiles = profiles;
    if (profiles.length > 0) {
      this.logEvent('autoProfilesDetected', profiles.map(p => p.name).join(', '));
      this.events.emit('autoProfilesDetected', { profiles });
    }
  }
  getAutoProfiles(): TechProfile[] { return this.autoProfiles; }
  getAutoProfileIds(): string[] { return this.autoProfiles.map(p => p.id); }

  private isPersistentRole(role: string): boolean {
    if (this._pipelineType === 'hybrid') return role === 'counterpart';
    return false;
  }

  private logEvent(event: string, details: string = '') {
    this.orchestrationLog.push({ timestamp: Date.now(), event, details });
    console.log(`[Orchestrator] ${event}${details ? ': ' + details : ''}`);
  }

  // ── Install MCP server to ~/.angy/mcp/ and register in ~/.claude.json ───

  static async ensureMcpServerInstalled(): Promise<boolean> {
    try {
      const { mkdir, readTextFile, writeTextFile } = await import('@tauri-apps/plugin-fs');
      const { homeDir, join, resolveResource } = await import('@tauri-apps/api/path');

      const home = await homeDir();
      const mcpDir = await join(await getAngyConfigDir(), 'mcp');
      const targetPath = await join(mcpDir, 'orchestrator_server.py');
      const claudeConfigPath = await join(home, '.claude.json');

      // Ensure directory exists
      try { await mkdir(mcpDir, { recursive: true }); } catch { /* exists */ }

      // Check if script exists and is current version
      let needsInstall = true;
      try {
        const existing = await readTextFile(targetPath);
        if (existing.includes('version: 4.0.0')) {
          needsInstall = false;
        }
      } catch { /* doesn't exist */ }

      if (needsInstall) {
        try {
          const srcPath = await resolveResource('resources/mcp/orchestrator_server.py');
          console.log('[Orchestrator] Copying MCP script from', srcPath, 'to', targetPath);
          const content = await readTextFile(srcPath);
          await writeTextFile(targetPath, content);
          console.log('[Orchestrator] MCP script installed successfully');
        } catch (copyErr) {
          console.warn('[Orchestrator] Could not copy MCP script from resources:', copyErr);
          return false;
        }
      }

      // Register in ~/.claude.json
      let config: Record<string, any> = {};
      try {
        const existing = await readTextFile(claudeConfigPath);
        config = JSON.parse(existing);
      } catch { /* no config yet */ }

      let needsRegister = true;
      if (config.mcpServers?.[Orchestrator.MCP_SERVER_NAME]) {
        const srv = config.mcpServers[Orchestrator.MCP_SERVER_NAME];
        if (srv.args?.[0] === targetPath) {
          needsRegister = false;
        }
      }

      if (needsRegister) {
        if (!config.mcpServers) config.mcpServers = {};
        config.mcpServers[Orchestrator.MCP_SERVER_NAME] = {
          command: 'python3',
          args: [targetPath],
        };
        await writeTextFile(claudeConfigPath, JSON.stringify(config, null, 2) + '\n');
        console.log('[Orchestrator] Registered MCP server in', claudeConfigPath);
      }

      console.log('[Orchestrator] MCP server ready:', targetPath);
      return true;
    } catch (e) {
      console.error('[Orchestrator] ensureMcpServerInstalled failed:', e);
      return false;
    }
  }

  /** Remove the MCP server registration from ~/.claude.json (cleanup on shutdown). */
  static async cleanupMcpRegistration(): Promise<void> {
    try {
      const { readTextFile, writeTextFile } = await import('@tauri-apps/plugin-fs');
      const { homeDir, join } = await import('@tauri-apps/api/path');
      const home = await homeDir();
      const claudeConfigPath = await join(home, '.claude.json');

      const existing = await readTextFile(claudeConfigPath);
      const config = JSON.parse(existing);
      if (config.mcpServers?.[Orchestrator.MCP_SERVER_NAME]) {
        delete config.mcpServers[Orchestrator.MCP_SERVER_NAME];
        if (Object.keys(config.mcpServers).length === 0) {
          delete config.mcpServers;
        }
        await writeTextFile(claudeConfigPath, JSON.stringify(config, null, 2) + '\n');
        console.log('[Orchestrator] Cleaned up MCP server registration');
      }
    } catch {
      // Config may not exist or may already be clean
    }
  }

  // ── Start / Cancel ──────────────────────────────────────────────────────

  async start(goal: string, contextProfileIds: string[] = [], autoCommit = false): Promise<string> {
    if (!this.chatPanel || this._running) return '';

    const mcpOk = await Orchestrator.ensureMcpServerInstalled();
    if (!mcpOk) {
      console.warn('[Orchestrator] MCP server installation/update failed — continuing (server may already be installed from a previous run)');
    }

    this.autoCommit = autoCommit;
    if (autoCommit) await this.detectGit();

    this._running = true;
    this.contextProfileIds = contextProfileIds;
    this._totalDelegations = 0;
    this._stepAttempts = 0;
    this.mcpCommandReceived = false;
    this.orchestratorTurnDone = false;
    this.turnResults = [];
    this.pendingChildren.clear();
    this.childTimeouts.clear();
    this.childOutputs = [];
    this.orchestrationLog = [];
    this.agentCounter = 0;
    this.persistentSessions.clear();
    this._currentPhase = 'planning';
    this.events.emit('phaseChanged', { phase: this._currentPhase });

    this.teamId = crypto.randomUUID();

    try {
      const { mkdir } = await import('@tauri-apps/plugin-fs');
      const { join } = await import('@tauri-apps/api/path');
      await mkdir(await join(await getAngyConfigDir(), 'inboxes', this.teamId), { recursive: true });
    } catch (e) {
      console.warn('[Orchestrator] Failed to create inbox directory:', e);
    }

    this._sessionId = await this.chatPanel.newChat();
    this.chatPanel.configureSession(
      this._sessionId, 'orchestrator', ['specialist-orchestrator'],
    );

    this.logEvent('started', `session=${this._sessionId}, team=${this.teamId}, pipelineType=${this._pipelineType}`);

    const initialMessage = Orchestrator.buildInitialMessage(goal, {
      autoCommit: this.autoCommit,
      gitAvailable: this.gitAvailable,
      epicOptions: this.epicOptions,
      pipelineType: this._pipelineType,
      epicContext: this.getEpicSystemPromptAddition(),
    });

    this.chatPanel.sendMessageToSession(this._sessionId, initialMessage);
    return this._sessionId;
  }

  /**
   * Start orchestration on a pre-existing session.
   * Used for sub-orchestrators where the session is created by the parent.
   */
  async startOnSession(sessionId: string, goal: string, contextProfileIds: string[] = [], autoCommit = false): Promise<void> {
    if (!this.chatPanel || this._running) return;

    const mcpOk = await Orchestrator.ensureMcpServerInstalled();
    if (!mcpOk) {
      console.warn('[Orchestrator] MCP server installation/update failed');
    }

    this.autoCommit = autoCommit;
    if (autoCommit) await this.detectGit();

    this._running = true;
    this._sessionId = sessionId;
    this.contextProfileIds = contextProfileIds;
    this._totalDelegations = 0;
    this._stepAttempts = 0;
    this.mcpCommandReceived = false;
    this.orchestratorTurnDone = false;
    this.turnResults = [];
    this.pendingChildren.clear();
    this.childTimeouts.clear();
    this.childOutputs = [];
    this.orchestrationLog = [];
    this.agentCounter = 0;
    this.persistentSessions.clear();
    this.activeChildOrchestrators = new Set<string>();
    this._currentPhase = 'planning';
    this.events.emit('phaseChanged', { phase: this._currentPhase });

    this.teamId = crypto.randomUUID();

    try {
      const { mkdir } = await import('@tauri-apps/plugin-fs');
      const { join } = await import('@tauri-apps/api/path');
      await mkdir(await join(await getAngyConfigDir(), 'inboxes', this.teamId), { recursive: true });
    } catch (e) {
      console.warn('[Orchestrator] Failed to create inbox directory:', e);
    }

    // Configure session (already exists, just set mode + profiles)
    this.chatPanel.configureSession(sessionId, 'orchestrator', ['specialist-orchestrator']);

    this.logEvent('startedOnSession', `session=${sessionId}, team=${this.teamId}, pipelineType=${this._pipelineType}`);

    const initialMessage = Orchestrator.buildInitialMessage(goal, {
      autoCommit: this.autoCommit,
      gitAvailable: this.gitAvailable,
      epicOptions: this.epicOptions,
      pipelineType: this._pipelineType,
      epicContext: this.getEpicSystemPromptAddition(),
    });

    this.chatPanel.sendMessageToSession(sessionId, initialMessage);
  }

  /**
   * Build the initial user message sent to the orchestrator.
   * Single source of truth — used by both start() and ChatPanel standalone mode.
   */
  static buildInitialMessage(goal: string, options?: {
    autoCommit?: boolean;
    gitAvailable?: boolean;
    epicOptions?: OrchestratorOptions | null;
    fixMode?: boolean;
    pipelineType?: EpicPipelineType;
    epicContext?: string;
  }): string {
    const opts = options || {};
    const pipelineType: EpicPipelineType = opts.pipelineType || (opts.fixMode ? 'fix' : 'hybrid');
    const isReadOnly = pipelineType === 'investigate' || pipelineType === 'plan';

    const extraTools: string[] = [];
    if (opts.autoCommit && opts.gitAvailable && !isReadOnly) {
      extraTools.push(`- \`checkpoint(message)\` — create a git checkpoint commit to save progress`);
    }
    if (opts.epicOptions && !isReadOnly) {
      extraTools.push(`- \`spawn_orchestrator(task, working_dir?)\` — spawn a child orchestrator for complex sub-tasks`);
    }

    let message = `# Goal\n\n${goal}\n\n`;

    if (extraTools.length > 0) {
      message += `# Additional Tools\n${extraTools.join('\n')}\n\n`;
    }

    if (opts.epicContext) {
      message += opts.epicContext;
    }

    const toolNames = ['delegate', 'diagnose'];
    if (opts.autoCommit && opts.gitAvailable && !isReadOnly) toolNames.push('checkpoint');
    if (opts.epicOptions && !isReadOnly) toolNames.push('spawn_orchestrator');
    toolNames.push('done', 'fail');
    message += `Available tools: ${toolNames.join(', ')}. See system prompt for details.\n\n`;

    switch (pipelineType) {
      case 'fix':
        message += `Start by calling diagnose(action="git_diff") to see the current state, ` +
          `then delegate to a debugger to analyze the rejection feedback.\n`;
        break;
      case 'investigate':
        message += `Start by calling delegate(role="architect", task="...") to analyze the codebase and investigate the questions above.\n`;
        break;
      case 'plan':
        message += `Start by calling delegate(role="architect", task="...") to analyze the codebase and design the solution described above.\n`;
        break;
      case 'hybrid':
        message += `Start by calling delegate(role="architect", task="...") to analyze the codebase and design a structured solution plan with module boundaries, conventions, and integration contracts. ` +
          `After receiving the plan, forward it to a counterpart for adversarial verification against the spec. ` +
          `The counterpart session persists — it will verify the plan AND later review the implementation.\n`;
        break;
      default:
        message += `Start by calling delegate(role="architect", task="...") to analyze the codebase and design the solution.\n`;
        break;
    }

    return message;
  }

  /**
   * Attach to an existing session (used when orchestrate mode is triggered from the input bar).
   * Unlike start(), this does NOT create a new session or send an initial message.
   */
  async attachToSession(sessionId: string, autoCommit = false): Promise<void> {
    if (!this.chatPanel || this._running) return;

    await Orchestrator.ensureMcpServerInstalled();

    this.autoCommit = autoCommit;
    if (autoCommit) await this.detectGit();

    this._running = true;
    this._sessionId = sessionId;
    this.contextProfileIds = [];
    this._totalDelegations = 0;
    this._stepAttempts = 0;
    this.mcpCommandReceived = false;
    this.orchestratorTurnDone = false;
    this.turnResults = [];
    this.pendingChildren.clear();
    this.childTimeouts.clear();
    this.childOutputs = [];
    this.orchestrationLog = [];
    this.agentCounter = 0;
    this._currentPhase = 'planning';
    this.events.emit('phaseChanged', { phase: this._currentPhase });

    this.teamId = crypto.randomUUID();

    try {
      const { mkdir } = await import('@tauri-apps/plugin-fs');
      const { join } = await import('@tauri-apps/api/path');
      await mkdir(await join(await getAngyConfigDir(), 'inboxes', this.teamId), { recursive: true });
    } catch (e) {
      console.warn('[Orchestrator] Failed to create inbox directory:', e);
    }

    this.logEvent('attached', `session=${sessionId}`);
  }

  cancel() {
    this._running = false;
    this._currentPhase = 'cancelled';
    this.events.emit('phaseChanged', { phase: this._currentPhase });
    for (const timeout of this.childTimeouts.values()) clearTimeout(timeout);
    this.childTimeouts.clear();

    // Cancel all active children (specialist agents + sub-orchestrators)
    if (this.chatPanel?.cancelChild) {
      for (const child of this.pendingChildren.values()) {
        if (!child.completed) {
          this.chatPanel.cancelChild(child.sessionId);
        }
      }
    }
    this.activeChildOrchestrators.clear();
    this.persistentSessions.clear();

    this.cleanupInboxes();
    this.logEvent('cancelled');
  }

  // ── MCP Tool Interception (primary path) ───────────────────────────────

  onMcpToolCalled(sessionId: string, toolName: string, args: Record<string, any>) {
    if (!this._running) return;
    if (sessionId !== this._sessionId) return;

    // Extract action from tool name: mcp__c3p2-orchestrator__delegate → delegate
    const prefix = `mcp__${Orchestrator.MCP_SERVER_NAME}__`;
    if (!toolName.startsWith(prefix)) return;
    const action = toolName.substring(prefix.length);

    this.logEvent('mcpTool', `${action}: ${JSON.stringify(args).substring(0, 200)}`);

    if (action === 'send_message' || action === 'check_inbox') {
      return;
    }

    // Reset per-turn tracking on the first tool call of a new turn
    if (!this.mcpCommandReceived) {
      this.turnResults = [];
    }

    this.mcpCommandReceived = true;
    this._stepAttempts = 0;

    const cmd: OrchestratorCommand = { action: 'unknown' };

    switch (action) {
      case 'delegate':
        cmd.action = 'delegate';
        cmd.role = args.role || '';
        cmd.task = args.task || '';
        cmd.working_dir = args.working_dir || '';
        break;
      case 'done':
        cmd.action = 'done';
        cmd.summary = args.summary || '';
        break;
      case 'fail':
        cmd.action = 'fail';
        cmd.reason = args.reason || '';
        break;
      case 'checkpoint':
        cmd.action = 'checkpoint';
        cmd.message = args.message || '';
        break;
      case 'spawn_orchestrator':
        cmd.action = 'spawn_orchestrator';
        cmd.task = args.task || '';
        cmd.working_dir = args.working_dir || '';
        break;
      case 'diagnose':
        cmd.action = 'diagnose';
        cmd.diagnoseAction = args.action || '';
        cmd.target = args.target || '';
        break;
      default:
        console.warn('[Orchestrator] Unknown MCP tool action:', action);
        this.feedResult(
          `ERROR: Unknown tool "${action}". Available tools: delegate, diagnose, done, fail` +
          `${this.autoCommit ? ', checkpoint' : ''}${this.epicOptions ? ', spawn_orchestrator' : ''}. ` +
          `Use one of these tools to proceed.`
        );
        return;
    }

    this.executeCommand(cmd);
  }

  // ── Session ID Tracking ────────────────────────────────────────────────

  onSessionIdChanged(oldId: string, newId: string) {
    if (!this._running) return;

    if (oldId === this._sessionId) {
      console.log(`[Orchestrator] Session ID changed: ${oldId} -> ${newId}`);
      this._sessionId = newId;
    }

    // Re-key pending children map if a child session ID changed
    const child = this.pendingChildren.get(oldId);
    if (child) {
      this.pendingChildren.delete(oldId);
      child.sessionId = newId;
      this.pendingChildren.set(newId, child);
    }
  }

  // ── Session Finished Processing (deferred feed) ───────────────────────

  onSessionFinishedProcessing(sessionId: string) {
    if (!this._running) return;
    if (sessionId !== this._sessionId) return;

    this.orchestratorTurnDone = true;

    // Try to flush any accumulated turn results now that the process is done.
    // Results may have been queued while the Claude CLI was still running.
    if (this.turnResults.length > 0) {
      this.mcpCommandReceived = false;
      this.flushTurnResults();
      return;
    }

    // If MCP tool was already handled this turn, skip text parsing
    if (this.mcpCommandReceived) {
      this.mcpCommandReceived = false;
      return;
    }

    // Fallback: try text parsing (MCP server may not be available)
    setTimeout(() => this.onOrchestratorTurnFinished(), 100);
  }

  // ── Delegation Callback ────────────────────────────────────────────────

  onDelegateFinished(childSessionId: string, output: string) {
    if (!this._running) return;

    const child = this.pendingChildren.get(childSessionId);
    if (!child) return;

    // Clear timeout watchdog
    const timeout = this.childTimeouts.get(childSessionId);
    if (timeout) {
      clearTimeout(timeout);
      this.childTimeouts.delete(childSessionId);
    }
    this.activeChildOrchestrators.delete(childSessionId);

    child.completed = true;
    child.output = output;

    // Track for artifact collection
    this.childOutputs.push({
      role: child.role,
      agentName: child.agentName,
      output: output.substring(0, 3000),
    });

    this.logEvent('childFinished', `${child.agentName} (${child.role})`);
    this.checkAllChildrenDone();
  }

  // ── Private: Fallback when MCP tool call was not intercepted ────────

  private onOrchestratorTurnFinished() {
    if (!this._running) return;

    for (const pc of this.pendingChildren.values()) {
      if (!pc.completed) return;
    }

    this._stepAttempts++;
    this.logEvent('noToolCall', `attempt ${this._stepAttempts}/${Orchestrator.MAX_STEP_ATTEMPTS}`);

    if (this._stepAttempts >= Orchestrator.MAX_STEP_ATTEMPTS) {
      this.emitArtifacts();
      this._running = false;
      this._currentPhase = 'failed';
      this.events.emit('phaseChanged', { phase: this._currentPhase });
      this.events.emit('failed', {
        reason: `Orchestrator failed to produce a valid tool call after ${Orchestrator.MAX_STEP_ATTEMPTS} attempts.`,
      });
      return;
    }

    // Escalating recovery messages — generic nudge → concrete suggestion → forced termination
    let message: string;
    if (this._stepAttempts <= 2) {
      let hint = '';
      if (this._totalDelegations === 0) {
        if (this._pipelineType === 'fix') {
          hint = ' Start by calling diagnose(action="git_diff") to inspect the current state.';
        } else {
          hint = ' Start by calling delegate(role="architect", task="...") to analyze the codebase.';
        }
      } else {
        hint = ' Call delegate(role="implementer", task="...") to write the code, ' +
          'or delegate(role="tester", task="verify builds") to check existing work, or done(summary="...") if finished.';
      }
      message =
        `ERROR: Your response did not include a tool call. You MUST call one of: ` +
        `delegate, diagnose, done, or fail. ` +
        `You cannot read files or use other tools — only MCP orchestrator tools.` +
        hint;
    } else if (this._stepAttempts === 3) {
      message =
        `ERROR: No tool call detected (attempt ${this._stepAttempts}/${Orchestrator.MAX_STEP_ATTEMPTS}). ` +
        `You have completed ${this._totalDelegations} delegation(s) so far. ` +
        `You MUST call exactly one tool now. Choose one:\n` +
        `- done(summary="<describe what was accomplished>") — if all work is complete\n` +
        `- fail(reason="<explain why>") — if the goal cannot be achieved\n` +
        `- delegate(role="implementer", task="<specific task>") — if more work is needed\n` +
        `- delegate(role="tester", task="verify builds pass") — to verify existing work`;
    } else {
      message =
        `FINAL WARNING (attempt ${this._stepAttempts}/${Orchestrator.MAX_STEP_ATTEMPTS}): ` +
        `You must call done() or fail() NOW. ` +
        `Next response without a tool call will terminate this orchestration as failed. ` +
        `Call done(summary="...") if any progress was made, or fail(reason="...") otherwise.`;
    }

    this.feedResult(message);
  }

  // ── Command Execution (shared by MCP and fallback paths) ───────────────

  private executeCommand(cmd: OrchestratorCommand) {
    switch (cmd.action) {
      case 'delegate':
        this.executeDelegation(cmd);
        break;

      case 'diagnose':
        this.executeDiagnose(cmd);
        break;

      case 'done':
        this.emitArtifacts();
        if (cmd.summary && this.chatPanel?.postAssistantMessage) {
          this.chatPanel.postAssistantMessage(this._sessionId, cmd.summary).catch(err => {
            console.error('[Orchestrator] Failed to post report message:', err);
          });
        }
        this._running = false;
        this._currentPhase = 'completed';
        this.events.emit('phaseChanged', { phase: this._currentPhase });
        this.logEvent('completed', cmd.summary || '');
        for (const timeout of this.childTimeouts.values()) clearTimeout(timeout);
        this.childTimeouts.clear();
        this.persistentSessions.clear();
        this.cleanupInboxes();
        this.events.emit('completed', { summary: cmd.summary || '' });
        break;

      case 'fail':
        this.emitArtifacts();
        this._running = false;
        this._currentPhase = 'failed';
        this.events.emit('phaseChanged', { phase: this._currentPhase });
        this.logEvent('failed', cmd.reason || '');
        for (const timeout of this.childTimeouts.values()) clearTimeout(timeout);
        this.childTimeouts.clear();
        this.persistentSessions.clear();
        this.cleanupInboxes();
        this.events.emit('failed', { reason: cmd.reason || '' });
        break;

      case 'checkpoint':
        this.executeCheckpoint(cmd.message);
        break;

      case 'spawn_orchestrator':
        this.executeSpawnOrchestrator(cmd);
        break;

      default:
        this.feedResult('ERROR: Unknown action. Use delegate, diagnose, done, or fail.');
        break;
    }
  }

  private async executeDelegation(cmd: OrchestratorCommand) {
    if (!cmd.role || !cmd.task || !this.chatPanel) return;

    // Hybrid pipeline: remap create-pipeline role names to hybrid equivalents.
    // "implementer" → "builder", "reviewer" → "counterpart".
    // The hybrid pipeline has no reviewer role — the persistent counterpart handles all verification.
    if (this._pipelineType === 'hybrid') {
      const roleLow = cmd.role.toLowerCase();
      if (roleLow === 'implementer') {
        this.logEvent('roleRemapped', `${cmd.role} → builder (hybrid pipeline)`);
        cmd.role = 'builder';
      } else if (roleLow === 'reviewer') {
        this.logEvent('roleRemapped', `${cmd.role} → counterpart (hybrid pipeline)`);
        cmd.role = 'counterpart';
      }
    }

    if (this.isReadOnly()) {
      const allowedRoles = ['architect', 'debugger'];
      if (!allowedRoles.includes(cmd.role!.toLowerCase())) {
        this.feedResult(
          `ERROR: Role "${cmd.role}" is not allowed in ${this._pipelineType} pipelines. ` +
          `Only architect and debugger roles are permitted. This is a read-only pipeline.`
        );
        return;
      }
    }

    if (this._totalDelegations >= Orchestrator.MAX_TOTAL_DELEGATIONS) {
      this.feedResult(
        `ERROR: Maximum delegation limit (${Orchestrator.MAX_TOTAL_DELEGATIONS}) reached. ` +
        `You must finish with 'done' or 'fail' now.`,
      );
      return;
    }
    this._totalDelegations++;

    const roleLower = cmd.role.toLowerCase();
    const workingDir = cmd.working_dir || undefined;

    // ── Persistent session reuse (conversational/hybrid pipeline) ──
    const existing = this.persistentSessions.get(roleLower);
    if (existing && this.chatPanel.sendToChild) {
      this._currentPhase = `continuing ${cmd.role}`;
      this.events.emit('phaseChanged', { phase: this._currentPhase });
      this.events.emit('delegationStarted', { role: cmd.role, task: cmd.task, parentSessionId: this._sessionId });

      await this.chatPanel.sendToChild(existing.sessionId, cmd.task);

      this.pendingChildren.set(existing.sessionId, {
        sessionId: existing.sessionId,
        role: cmd.role,
        agentName: existing.agentName,
        completed: false,
        output: '',
        workingDir,
      });

      const oldTimeout = this.childTimeouts.get(existing.sessionId);
      if (oldTimeout) clearTimeout(oldTimeout);
      const timeout = setTimeout(() => {
        const child = this.pendingChildren.get(existing.sessionId);
        if (child && !child.completed) {
          this.logEvent('childTimeout', `${existing.agentName} (${cmd.role}) timed out after ${Orchestrator.CHILD_TIMEOUT_MS / 1000}s`);
          this.chatPanel?.cancelChild?.(existing.sessionId);
          this.onDelegateFinished(
            existing.sessionId,
            `ERROR: Agent ${existing.agentName} timed out after ${Orchestrator.CHILD_TIMEOUT_MS / 1000} seconds. ` +
            `The task may be too complex or the agent may be stuck. Consider breaking it into smaller tasks.`,
          );
        }
      }, Orchestrator.CHILD_TIMEOUT_MS);
      this.childTimeouts.set(existing.sessionId, timeout);

      this.logEvent('continuedSession', `${existing.agentName} (${cmd.role}) session=${existing.sessionId}`);
      return;
    }

    // ── Normal delegation: create new child session ──
    const agentName = this.generateAgentName(cmd.role);
    this._currentPhase = `delegating to ${cmd.role}`;
    this.events.emit('phaseChanged', { phase: this._currentPhase });
    this.events.emit('delegationStarted', { role: cmd.role, task: cmd.task, parentSessionId: this._sessionId });

    const profileId = `specialist-${roleLower}`;
    const context = this.chatPanel.sessionFinalOutput(this._sessionId);

    const teammates = Array.from(this.pendingChildren.values())
      .filter(c => !c.completed)
      .map(c => c.agentName);

    const childId = await this.chatPanel.delegateToChild(
      this._sessionId,
      cmd.task,
      context,
      profileId,
      this.contextProfileIds,
      agentName,
      this.teamId,
      teammates,
      workingDir,
    );

    if (childId) {
      this.pendingChildren.set(childId, {
        sessionId: childId,
        role: cmd.role,
        agentName,
        completed: false,
        output: '',
        workingDir,
      });

      // Register as persistent if role warrants it
      if (this.isPersistentRole(roleLower)) {
        this.persistentSessions.set(roleLower, { sessionId: childId, agentName });
      }

      // Start timeout watchdog
      const timeout = setTimeout(() => {
        const child = this.pendingChildren.get(childId);
        if (child && !child.completed) {
          this.logEvent('childTimeout', `${agentName} (${cmd.role}) timed out after ${Orchestrator.CHILD_TIMEOUT_MS / 1000}s`);
          this.chatPanel?.cancelChild?.(childId);
          this.onDelegateFinished(
            childId,
            `ERROR: Agent ${agentName} timed out after ${Orchestrator.CHILD_TIMEOUT_MS / 1000} seconds. ` +
            `The task may be too complex or the agent may be stuck. Consider breaking it into smaller tasks.`,
          );
        }
      }, Orchestrator.CHILD_TIMEOUT_MS);
      this.childTimeouts.set(childId, timeout);

      this.logEvent('delegated', `${cmd.role}:${agentName} child=${childId} pending=${this.pendingChildren.size}`);
    }
  }

  // ── Diagnose (inspect codebase state — executed by MCP server) ─────

  /**
   * Diagnose: state tracking only.
   * The MCP server executes the command synchronously and returns real results
   * directly to Claude. The orchestrator only tracks phase/events.
   */
  private executeDiagnose(cmd: OrchestratorCommand) {
    this._currentPhase = `diagnosing: ${cmd.diagnoseAction || ''}`;
    this.events.emit('phaseChanged', { phase: this._currentPhase });
    this.logEvent('diagnose', `action=${cmd.diagnoseAction || ''} target=${cmd.target || ''}`);
  }

  // ── Artifact Collection ────────────────────────────────────────────

  private emitArtifacts() {
    this.events.emit('artifactsCollected', {
      childOutputs: this.childOutputs,
    });
  }

  // ── Parallel Children Aggregation ──────────────────────────────────────

  private async checkAllChildrenDone() {
    const pending = Array.from(this.pendingChildren.values());
    if (pending.length === 0) return;
    if (pending.some(c => !c.completed)) return;

    // All done — aggregate results
    const parts = pending.map(
      pc => `## Agent '${pc.agentName}' (${pc.role}) completed\n\n${pc.output}`,
    );

    const count = pending.length;
    const roles = [...new Set(pending.map(pc => pc.role))].join(', ');
    this.pendingChildren.clear();

    // Auto-checkpoint: commit after each delegation batch completes
    let checkpointInfo = '';
    if (this.autoCommit && this.gitAvailable) {
      const commitMsg = `checkpoint: ${roles} phase completed`;
      const hash = await this.doGitCheckpoint(commitMsg);
      if (hash) {
        checkpointInfo = `\n\n**Checkpoint created:** commit ${hash} — "${commitMsg}"`;
        this.events.emit('checkpointCreated', { hash, message: commitMsg });
        console.log(`[Orchestrator] Auto-checkpoint after ${roles}: ${hash}`);
      }
    }

    this.enqueueTurnResult(
      `${count} agent(s) completed successfully.${checkpointInfo}\n\n${parts.join('\n\n---\n\n')}\n\n` +
      `IMPORTANT: Respond with exactly one tool call. Choose one:\n` +
      `- delegate(role, task) — if more work is needed\n` +
      `- delegate(role="tester", task="verify builds/tests pass") — to verify the work\n` +
      `- done(summary) — if all work is complete`,
    );
    this.flushTurnResults();
  }

  // ── Turn Result Accumulation ────────────────────────────────────────────
  //
  // When the orchestrator calls multiple tools in one turn (e.g. multiple delegates),
  // results arrive independently. We accumulate them and only send a single combined
  // message back when ALL operations from the turn are complete.

  /**
   * Queue a result string for the current turn.
   * Does NOT send immediately — call flushTurnResults() to check if all
   * pending operations are done and send the combined result.
   */
  private enqueueTurnResult(resultText: string) {
    if (!this._running || !this.chatPanel) return;
    this.events.emit('progressUpdate', { message: resultText.substring(0, 100) + '...' });
    this.turnResults.push(resultText);
  }

  /**
   * Check whether all pending operations for the current turn are done.
   * If so, concatenate all queued results and send as one message.
   * If not, defer — the last completing operation will trigger the flush.
   */
  private flushTurnResults() {
    if (!this._running || !this.chatPanel) return;
    if (this.turnResults.length === 0) return;

    // Wait for all children to complete (if any were spawned this turn)
    for (const pc of this.pendingChildren.values()) {
      if (!pc.completed) return;
    }

    // Not safe to send yet — the Claude process is still running
    if (!this.orchestratorTurnDone) {
      console.log('[Orchestrator] Deferring flush (process still running)');
      return;
    }

    // All done — combine and send
    const combined = this.turnResults.join('\n\n---\n\n');
    this.turnResults = [];
    this.orchestratorTurnDone = false;
    this.chatPanel.sendMessageToSession(this._sessionId, combined);
  }

  /**
   * Legacy convenience: enqueue a result and immediately attempt to flush.
   * Used by single-result paths (diagnose, checkpoint, error messages, fallback).
   */
  private feedResult(resultText: string) {
    this.enqueueTurnResult(resultText);
    this.flushTurnResults();
  }

  // ── Spawn Sub-Orchestrator (Epic) ───────────────────────────────────────

  private async executeSpawnOrchestrator(cmd: OrchestratorCommand) {
    if (!cmd.task || !this.chatPanel) return;

    if (!this.epicOptions) {
      this.feedResult(
        'ERROR: spawn_orchestrator is only available in epic-scoped mode.',
      );
      return;
    }

    const currentDepth = this.epicOptions.depth;
    const maxDepth = this.epicOptions.maxDepth;

    if (currentDepth >= maxDepth) {
      this.feedResult(
        `ERROR: Maximum orchestrator depth (${maxDepth}) reached at depth ${currentDepth}. ` +
        `Use delegate() instead of spawn_orchestrator() to assign work directly.`,
      );
      return;
    }

    // Check budget
    if (this.epicOptions.budgetRemaining !== null && this.epicOptions.budgetRemaining <= 0) {
      this.feedResult(
        `ERROR: Budget exhausted ($${this.epicOptions.budgetRemaining?.toFixed(2)} remaining). ` +
        `Cannot spawn more sub-orchestrators. Call done() with current progress or fail().`,
      );
      return;
    }

    // Enforce max concurrent children
    const maxConcurrent = this.epicOptions.maxConcurrentChildren ?? 3;
    if (this.activeChildOrchestrators.size >= maxConcurrent) {
      this.feedResult(
        `ERROR: Maximum concurrent sub-orchestrators (${maxConcurrent}) reached. ` +
        `Wait for a running sub-orchestrator to complete before spawning another.`,
      );
      return;
    }

    // Check that spawnSubOrchestrator is available
    if (!this.chatPanel.spawnSubOrchestrator) {
      this.feedResult(
        'ERROR: Sub-orchestrator spawning is not available in this context. Use delegate() instead.',
      );
      return;
    }

    // Create child orchestrator options inheriting the epic context
    const childEpicOptions: OrchestratorOptions = {
      epicId: this.epicOptions.epicId,
      projectId: this.epicOptions.projectId,
      repoPaths: { ...this.epicOptions.repoPaths },
      depth: currentDepth + 1,
      maxDepth,
      parentSessionId: this._sessionId,
      budgetRemaining: this.epicOptions.budgetRemaining,
      maxConcurrentChildren: this.epicOptions.maxConcurrentChildren,
      subOrchestratorTimeoutMs: this.epicOptions.subOrchestratorTimeoutMs,
    };

    this._totalDelegations++;

    const agentName = this.generateAgentName('sub-orchestrator');

    this._currentPhase = `spawning sub-orchestrator (depth ${childEpicOptions.depth})`;
    this.events.emit('phaseChanged', { phase: this._currentPhase });
    this.events.emit('subOrchestratorSpawned', {
      task: cmd.task,
      depth: childEpicOptions.depth,
      epicId: this.epicOptions.epicId,
    });

    const workingDir = cmd.working_dir || undefined;

    try {
      if (!this._running) return;

      const childId = await this.chatPanel.spawnSubOrchestrator(
        this._sessionId,
        cmd.task,
        childEpicOptions,
        agentName,
        workingDir,
      );

      if (!this._running) {
        // Cancelled during spawn — clean up the child
        if (childId) {
          this.chatPanel?.cancelChild?.(childId);
        }
        return;
      }

      if (!childId) {
        this.feedResult(
          'ERROR: Failed to spawn sub-orchestrator — received empty session ID. Use delegate() instead.',
        );
        return;
      }

      this.activeChildOrchestrators.add(childId);

      this.pendingChildren.set(childId, {
        sessionId: childId,
        role: 'sub-orchestrator',
        agentName,
        completed: false,
        output: '',
        workingDir,
      });

      // Start timeout watchdog for sub-orchestrators
      const timeoutMs = this.epicOptions.subOrchestratorTimeoutMs ?? Orchestrator.CHILD_ORCHESTRATOR_TIMEOUT_MS;
      const timeout = setTimeout(() => {
        const child = this.pendingChildren.get(childId);
        if (child && !child.completed) {
          this.logEvent('childTimeout', `${agentName} (sub-orchestrator) timed out after ${timeoutMs / 1000}s`);
          this.chatPanel?.cancelChild?.(childId);
          this.onDelegateFinished(
            childId,
            `ERROR: Sub-orchestrator ${agentName} timed out after ${timeoutMs / (60 * 1000)} minutes. ` +
            `The task may be too complex. Consider breaking it into smaller tasks and using delegate() directly.`,
          );
        }
      }, timeoutMs);
      this.childTimeouts.set(childId, timeout);

      this.logEvent('spawnedSubOrchestrator', `${agentName} depth=${childEpicOptions.depth} child=${childId} pending=${this.pendingChildren.size}`);
    } catch (err) {
      this.feedResult(
        `ERROR: Failed to spawn sub-orchestrator: ${err instanceof Error ? err.message : String(err)}. Use delegate() instead.`,
      );
    }
  }

  // ── Epic System Prompt Addition ─────────────────────────────────────────

  /**
   * Generates additional system prompt context when epicOptions is set.
   * Includes epic details, target repos, and depth information.
   */
  getEpicSystemPromptAddition(): string {
    if (!this.epicOptions) return '';

    const opts = this.epicOptions;
    const lines: string[] = [
      '\n\n# Epic Orchestration Context\n',
      `You are an epic-scoped orchestrator.\n`,
      `- Epic ID: ${opts.epicId}`,
      `- Project ID: ${opts.projectId}`,
      `- Current depth: ${opts.depth} / max ${opts.maxDepth}`,
    ];

    if (opts.parentSessionId) {
      lines.push(`- Parent session: ${opts.parentSessionId}`);
    }

    if (opts.budgetRemaining !== null) {
      lines.push(`- Budget remaining: $${opts.budgetRemaining.toFixed(2)}`);
    }

    // Target repos
    const repoEntries = Object.entries(opts.repoPaths);
    if (repoEntries.length > 0) {
      lines.push('\n## Target Repositories\n');
      for (const [repoId, repoPath] of repoEntries) {
        lines.push(`- ${repoId}: \`${repoPath}\``);
      }
      lines.push(
        '\nUse the `working_dir` parameter on delegate() to run agents in specific repo directories.',
      );
    }

    // Depth-aware instructions
    if (opts.depth < opts.maxDepth) {
      lines.push(
        '\n## Sub-Orchestrator Spawning\n',
        'You can spawn child orchestrators for complex sub-tasks using spawn_orchestrator(task, working_dir).',
        `Current depth: ${opts.depth}. You can spawn ${opts.maxDepth - opts.depth} more level(s) of sub-orchestrators.`,
      );
    } else {
      lines.push(
        '\n## Depth Limit Reached\n',
        'You are at maximum orchestrator depth. Use delegate() for all work assignments.',
      );
    }

    return lines.join('\n');
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private generateAgentName(role: string): string {
    this.agentCounter++;
    return `${role.toLowerCase()}-${this.agentCounter}`;
  }

  private async cleanupInboxes() {
    if (!this.teamId) return;
    try {
      const { remove } = await import('@tauri-apps/plugin-fs');
      const { join } = await import('@tauri-apps/api/path');
      await remove(await join(await getAngyConfigDir(), 'inboxes', this.teamId), { recursive: true });
    } catch { /* ok */ }
    this.teamId = '';
    this.pendingChildren.clear();
  }

  // ── Git Detection ───────────────────────────────────────────────────

  private async detectGit(): Promise<void> {
    try {
      const cmd = Command.create('exec-sh', ['-c', 'git rev-parse --is-inside-work-tree'], {
        cwd: this.workspace || undefined,
      });
      const output = await cmd.execute();
      this.gitAvailable = output.code === 0;
    } catch {
      this.gitAvailable = false;
    }
    console.log(`[Orchestrator] Git available: ${this.gitAvailable}`);
  }

  // ── Checkpoint Execution ──────────────────────────────────────────

  /**
   * Low-level git checkpoint: stage all + commit.
   * Returns the short commit hash on success, or null if nothing to commit / error.
   */
  private async doGitCheckpoint(message: string): Promise<string | null> {
    try {
      const addCmd = Command.create('exec-sh', ['-c', 'git add -A'], {
        cwd: this.workspace || undefined,
      });
      await addCmd.execute();

      const safeMsg = message.replace(/'/g, "'\\''");
      const commitCmd = Command.create('exec-sh',
        ['-c', `git commit -m '${safeMsg}'`], {
          cwd: this.workspace || undefined,
        });
      const commitOutput = await commitCmd.execute();

      if (commitOutput.code !== 0) {
        const stderr = commitOutput.stderr || '';
        if (stderr.includes('nothing to commit')) return null;
        console.warn('[Orchestrator] Checkpoint commit failed:', stderr.substring(0, 200));
        return null;
      }

      const hashCmd = Command.create('exec-sh', ['-c', 'git rev-parse --short HEAD'], {
        cwd: this.workspace || undefined,
      });
      const hashOutput = await hashCmd.execute();
      return hashOutput.stdout.trim();
    } catch (e: any) {
      console.warn('[Orchestrator] Checkpoint error:', e.message);
      return null;
    }
  }

  private async executeCheckpoint(message?: string) {
    if (!this.autoCommit || !this.gitAvailable) {
      this.feedResult('Checkpoint skipped (git not available or auto-commit disabled).');
      return;
    }

    const commitMsg = message || 'checkpoint';
    const hash = await this.doGitCheckpoint(commitMsg);

    if (!hash) {
      this.feedResult('Checkpoint: nothing to commit, working tree clean.');
      return;
    }

    console.log(`[Orchestrator] Checkpoint created: ${hash} — ${commitMsg}`);
    this.events.emit('checkpointCreated', { hash, message: commitMsg });
    this.feedResult(`Checkpoint created: commit ${hash} — "${commitMsg}"`);
  }

  // ── System Prompt (dynamic, includes checkpoint instructions if enabled) ──

  getSystemPrompt(): string {
    let prompt: string;
    switch (this._pipelineType) {
      case 'fix':
        prompt = ORCHESTRATOR_FIX_PROMPT;
        break;
      case 'investigate':
        prompt = ORCHESTRATOR_INVESTIGATE_PROMPT;
        break;
      case 'plan':
        prompt = ORCHESTRATOR_PLAN_PROMPT;
        break;
      case 'hybrid':
        prompt = ORCHESTRATOR_HYBRID_PROMPT;
        break;
      default:
        prompt = ORCHESTRATOR_SYSTEM_PROMPT;
        break;
    }
    prompt = prompt.replace('{project_context}', 'Project context will be provided in the goal message below.');

    if (this.autoCommit && !this.isReadOnly()) {
      prompt +=
        `\n\n# Checkpointing\n\n` +
        `Auto-commit is enabled. After completing each phase (architect, implement, test, review), ` +
        `call the checkpoint tool with a descriptive commit message summarizing what was accomplished ` +
        `in that phase. For example: checkpoint(message="Implemented user authentication module"). ` +
        `This creates incremental git commits so progress is not lost.`;
    }

    prompt += this.getEpicSystemPromptAddition();

    return prompt;
  }

  isAutoCommitEnabled(): boolean {
    return this.autoCommit;
  }
}
