# Angy Documentation

## Table of Contents

- [Overview](#overview)
- [Core Concepts](#core-concepts)
- [Architecture](#architecture)
- [Engine Layer](#engine-layer)
- [Pipeline Execution](#pipeline-execution)
- [Scheduler](#scheduler)
- [Git Workflow](#git-workflow)
- [UI Layer](#ui-layer)
- [State Management](#state-management)
- [Composables](#composables)
- [Tauri Backend](#tauri-backend)
- [Technology Detection](#technology-detection)
- [Database Schema](#database-schema)
- [Configuration](#configuration)
- [Project Structure](#project-structure)

---

## Overview

Angy is a fleet manager for Claude agents. It orchestrates autonomous multi-agent workflows to build entire products from scratch or improve existing codebases. The core innovation is **incremental building with verification gates** — work is split into sequential, independently-verifiable steps rather than building everything at once.

Built as a Tauri desktop app with a Vue 3 frontend and SQLite persistence, Angy wraps the Claude CLI to spawn and manage agent subprocesses. There is no cloud account required beyond your Claude subscription.

---

## Core Concepts

### Epics

Epics are the primary unit of work. They represent high-level goals that flow through a visual Kanban pipeline:

```
idea → backlog → todo → in-progress → review → done / discarded
```

Each epic carries:

| Field | Description |
|---|---|
| `title` | Short description of the goal |
| `description` | Detailed specification |
| `acceptanceCriteria` | What "done" looks like |
| `priorityHint` | `critical`, `high`, `medium`, `low`, or `none` |
| `complexity` | `trivial`, `small`, `medium`, `large`, or `epic` |
| `model` | Claude model to use (e.g. `claude-opus-4.6`) |
| `targetRepoIds` | Which repositories this epic modifies |
| `pipelineType` | `hybrid`, `fix`, `investigate`, or `plan` |
| `dependsOn` | Other epics that must complete first |
| `useGitBranch` | Whether to create a dedicated branch |
| `useWorktree` | Whether to use a git worktree for isolation |
| `baseBranch` | Branch to base the epic branch on |

### Specialist Roles

| Role | Tools | Purpose |
|---|---|---|
| **Architect** | Read, Glob, Grep | Analyzes codebases and designs solutions |
| **Builder** | Bash, Read, Edit, Write, Glob, Grep | Implements code per the plan |
| **Counterpart** | Bash, Read, Edit, Write, Glob, Grep | Adversarial reviewer that independently verifies and finds flaws |
| **Tester** | Bash, Read, Edit, Write, Glob, Grep | Builds projects, runs tests, performs verification |
| **Debugger** | Bash, Read, Glob, Grep | Diagnoses and fixes issues |

Builder and tester have sub-variants for scaffolding, backend, and frontend work (`builder-scaffold`, `builder-backend`, `builder-frontend`, `tester-scaffold`, `tester-backend`, `tester-frontend`).

### Pipeline Types

| Pipeline | Description |
|---|---|
| **Hybrid (Create)** | Full incremental build: architect → counterpart review → incremental build → integration review → final testing |
| **Fix** | Targeted bug fixing: diagnose → debug → fix → test → review |
| **Investigate** | Read-only codebase analysis and reporting |
| **Plan** | Read-only architectural planning |

---

## Architecture

### High-Level Data Flow

```
User (Kanban Board)
  │
  ▼
Scheduler (scores & dispatches epics)
  │
  ▼
OrchestratorPool (manages active orchestrators)
  │
  ▼
HybridPipelineRunner (state machine driving the pipeline)
  │
  ├── Architect session (planning)
  ├── Counterpart session (adversarial review)
  ├── Builder session (implementation)
  └── Tester session (verification)
        │
        ▼
      ClaudeProcess (spawns claude CLI subprocess)
        │
        ▼
      StreamParser (parses JSON stream from stdout)
        │
        ▼
      HeadlessHandle / ChatPanel (agent I/O abstraction)
        │
        ▼
      Database (SQLite persistence)
```

### Key Design Patterns

- **Singleton services**: `AngyEngine`, `Scheduler`, and `OrchestratorPool` are singletons
- **Event bus**: All async state changes emit via a Mitt-based `engineBus`; Pinia stores subscribe to relevant events
- **AgentHandle abstraction**: Decouples agent I/O from UI — `HeadlessHandle` for orchestrator-driven sessions (no Vue/DOM), `ChatPanel` for user-facing sessions
- **Repository pattern**: `EpicRepository` and `ProjectRepository` abstract data access, decoupling the scheduler from Pinia stores
- **Incremental persistence**: Messages are saved as they arrive via `SessionMessageBuffer`, not in batches
- **Snapshot recovery**: `PipelineStateStore` persists pipeline state so crashed epics can resume

---

## Engine Layer

The engine layer (`src/engine/`) contains the core logic and has no dependency on Vue or the DOM. This allows orchestrators to run headlessly.

### AngyEngine (`AngyEngine.ts`)

Top-level facade and singleton. Owns all major services and provides lifecycle management:

```
initialize() → use services → shutdown()
```

Services initialized: `Database`, `SessionService`, `ProcessManager`, `OrchestratorPool`, `Scheduler`, `BranchManager`.

### ClaudeProcess (`ClaudeProcess.ts`)

Spawns the `claude` CLI as a subprocess using Tauri's shell plugin. Communication is via JSON-over-stdin/stdout:

- Input: `--input-format stream-json` — messages are written as JSON to stdin
- Output: `--output-format stream-json` — structured events streamed line-by-line on stdout
- Supports session resume, system prompts, tool restrictions, and JSON schema extraction
- Diagnostic logging to file for debugging

### StreamParser (`StreamParser.ts`)

Parses the line-by-line JSON output from Claude CLI stdout into typed events:

- `textDelta` — incremental text content
- `toolUse` — tool invocation with name, input, and accumulated fields (e.g. `file_path`)
- `toolResult` — tool execution result
- `result` — final response with cost metadata

### ProcessManager (`ProcessManager.ts`)

Manages `ClaudeProcess` instances per session. Wires `StreamParser` events to the appropriate `AgentHandle`, handles tool result delivery, and supports process cancellation. Uses `SessionMessageBuffer` for incremental message persistence.

### HeadlessHandle (`HeadlessHandle.ts`)

No-Vue implementation of the `AgentHandle` interface for orchestrator-driven sessions:

- Tracks per-session state: messages, turn counter, accumulated text
- Handles delegation completion callbacks (`onDelegateFinished`)
- Persists messages directly to the database
- Emits `engineBus` events so the UI can update if the user is watching

### SessionService (`SessionService.ts`)

CRUD for chat sessions. Tracks metadata: title, workspace, mode, timestamps. Manages parent-child relationships for delegation hierarchies.

### SessionManager (`SessionManager.ts`)

Manages session lifecycle (create, update, delete) with event emission via `engineBus`. Provides higher-level session operations on top of `SessionService`.

### SessionMessageBuffer (`SessionMessageBuffer.ts`)

Buffers assistant messages before database insertion with debouncing and epoch tracking. Ensures incremental persistence without excessive write pressure.

### PipelineEngine (`PipelineEngine.ts`)

Defines the pipeline execution model with nodes, states, and an event system. Provides the abstract framework that `HybridPipelineRunner` builds on.

### ClaudeHealthMonitor (`ClaudeHealthMonitor.ts`)

Probes Claude CLI availability with exponential backoff before agent spawns. Prevents launching sessions when the CLI is unreachable.

### InboxManager (`InboxManager.ts`)

Peer messaging system using atomic JSONL file writes for inter-agent communication. Enables agents to exchange messages outside the normal delegation hierarchy.

### AnalyticsTypes (`AnalyticsTypes.ts`)

Type definitions for analytics metrics: cost tracking, token usage, and usage patterns used by the analytics store and dashboard.

### platform (`platform.ts`)

Platform abstraction layer providing OS detection and Angy config directory resolution (`~/.angy`).

### SpawnConcurrencyTest (`SpawnConcurrencyTest.ts`)

Test utility that reproduces parallel builder bugs by simulating `HybridPipelineRunner` phases. Used for debugging concurrency issues.

### EventBus (`EventBus.ts`)

Mitt-based pub/sub singleton (`engineBus`). All `EngineEvents` types flow through this bus, connecting the headless engine to Vue stores and UI components.

---

## Pipeline Execution

### HybridPipelineRunner (`HybridPipelineRunner.ts`)

The core of Angy — a TypeScript state machine that drives multi-agent builds programmatically. No LLM decides what to do next; the state machine controls transitions.

#### Phase 1: Planning

1. **Architect** designs the full solution based on the epic spec
2. **Counterpart** adversarially reviews the plan, challenging contradictions and gaps
3. Architect rewrites the complete plan incorporating feedback
4. Loop continues until the counterpart approves

#### Phase 2: Incremental Build

1. **Splitter** breaks the approved plan into 4-8 sequential increments (e.g. scaffold → data layer → API → frontend → features)
2. For each increment:
   - **Builder** implements it
   - **Tester** verifies it (compile check, smoke test)
   - If verification fails, **Builder** fixes (max 3 attempts per increment)
3. Each increment must pass before the next begins

#### Phase 3: Integration Review

1. **Counterpart** reviews the full codebase against the original plan and acceptance criteria
2. A **fresh Builder** fixes any issues identified
3. Loop until the counterpart approves

#### Phase 4: Final Testing

1. **Tester** runs full end-to-end verification
2. **Builder** fixes any failures
3. **Counterpart** does final approval
4. Loop until all pass

#### Structured Extraction

The pipeline uses Claude CLI's `--json-schema` flag for structured outputs:

- `VERDICT_SCHEMA` — approve/reject decisions from counterpart
- `TODO_SCHEMA` — increment breakdowns from splitter
- `VERIFY_SCHEMA` — verification results from tester
- `TEST_RESULT_SCHEMA` — e2e test results

#### Recovery

`PipelineStateStore` persists `PipelineSnapshot` objects to SQLite. If a pipeline crashes (process killed, app restart), it can resume from the last snapshot rather than starting over.

### OrchestratorPool (`OrchestratorPool.ts`)

Singleton managing active orchestrators:

- Maps `epicId → rootSessionId` and `sessionId → metadata`
- Tracks orchestrator depth (for nested `spawn_orchestrator` calls)
- Supports factory injection for orchestrator creation and resume
- Default factory uses `HybridPipelineRunner`

---

## Scheduler

### Scheduler (`Scheduler.ts`)

Background engine that continuously prioritizes and dispatches work. Ticks every 30 seconds by default.

#### Scoring

Each "todo" epic receives a computed score based on configurable weights:

| Factor | Description |
|---|---|
| Priority hint | Critical, high, medium, low, none |
| Age | How long the epic has been in "todo" |
| Complexity | Trivial to epic scale |
| Dependency depth | How deep the dependency chain is |
| Rejection penalty | Penalty for previously rejected epics |

#### Constraints

The scheduler enforces several constraints before dispatching:

- **Concurrency limit**: Maximum N epics running in parallel (configurable)
- **Repo locks**: No two epics can write to the same repository simultaneously
- **Dependencies**: Blocked epics are skipped until dependencies reach "done"
- **Budget**: Daily API cost limits pause dispatching when exceeded

#### Dispatch Flow

1. Tick fires (every 30s)
2. Query all "todo" epics
3. Filter out blocked epics (unmet dependencies, locked repos, budget exceeded)
4. Score remaining epics
5. Select highest-scored epic
6. Acquire repo lock
7. Spawn orchestrator via `OrchestratorPool`
8. Move epic to "in-progress"
9. Log action to `scheduler_actions` table

---

## Git Workflow

### BranchManager (`BranchManager.ts`)

Manages git branch and worktree operations for epics:

- **Branch naming**: `epic/{epicId}` per target repository
- **Worktree isolation**: Creates worktrees at `~/.angy-worktrees/{slug}` so epics don't interfere with each other or the main working directory
- **Operations**: create/delete branches, checkout, push, commit, restore
- **Slug generation**: `epicTitleToSlug()` converts epic titles to filesystem-safe names

### GitManager (`GitManager.ts`)

General-purpose git operations with event emission:

- Status refresh, file-level status, diffs
- Commit, push, checkout, pull, merge
- Serialized operation queue (one git op at a time)
- Events: `statusChanged`, `branchChanged`, `fileDiffReady`

### Merge Flow

When a pipeline completes:

1. Epic branch (`epic/{id}`) contains all changes
2. Epic moves to the "review" column
3. Human approves → branch is squash-merged into the default branch (usually `master`)
4. Human rejects with feedback → epic moves back to "todo" with `rejectionCount` incremented and `rejectionFeedback` stored
5. Scheduler picks it up again for another attempt

---

## UI Layer

### Components (`src/components/`)

| Directory | Contents |
|---|---|
| `kanban/` | Kanban board: `EpicCard`, `ProgressRing`, `PriorityBadge`, `ActiveCard`, `ReviewCard`, `DoneCard`, `UpcomingCard`, `IdeaCard`, `SchedulerConfigDialog`, `RepoScopeSelector` |
| `chat/` | `ChatPanel`, `ChatMessage`, `ThinkingIndicator`, `ThinkingBlock`, `ToolCallGroup`, `WelcomeScreen`, `QuestionWidget` with Shiki syntax highlighting |
| `agents/` | `AgentsView` — fleet panel with parent-child grouping for delegation hierarchies |
| `editor/` | `CodeViewer` — Monaco-based code viewer with diff mode, inline edit bar, breadcrumb navigation |
| `terminal/` | `TerminalPanel` — Xterm.js-based terminal per agent |
| `layout/` | `AppShell`, `MainSplitter` — 3-panel layout: sidebar, chat, code |
| `effects/` | `EffectsPanel` — animated agent activity visualizations |
| `gitgraph/` | Git commit graph visualization |
| `analytics/` | Analytics dashboard: cost by day, model usage, session modes, epic throughput |
| `home/` | `HomeView`, `ProjectCard`, `NewProjectDialog`, `ProjectSettingsDialog`, `NotificationToast` |
| `sidebar/` | `WorkspaceTree`, `GitPanel`, `SearchPanel`, `TreeNode` |
| `settings/` | `SettingsDialog`, `ProfileEditor`, `OrchestratorDialog` |
| `graph/` | Multi-session graph visualization for Mission Control |
| `code/` | Code editing UI: `CodeView`, `CodeEditorPane`, `CodeFileTree`, `CodeChatPanel`, `CodeChatCollapsed`, `CodeViewHeader` |
| `common/` | Shared UI utilities: `InfoTip`, `PopoverPanel`, `ProjectFilterChips`, `SectionTip`, `ToastNotification`, `WaveBar` |
| `fleet/` | Agent fleet management: `AgentFleetPanel`, `AgentCard`, `FleetHeader` |
| `input/` | User input controls: `InputBar`, `ModeSelector`, `ModelSelector`, `ProfileSelector`, `ContextPopup`, `SlashCommandPopup` |

### Views

The app has two primary views:

1. **Home** — project listing, creation, and settings
2. **Workspace** — the main 3-panel layout with sidebar, chat panel, and code editor; includes the Kanban board, agent fleet, analytics, and Mission Control as sub-views

---

## State Management

All stores use Pinia (Vue 3 state management).

| Store | Responsibility |
|---|---|
| `epics.ts` | Epic CRUD, column filtering, blocking reason computation |
| `sessions.ts` | Session and message persistence, session lifecycle |
| `projects.ts` | Project and repository CRUD |
| `fleet.ts` | Agent summaries, hierarchical ordering, expansion state |
| `git.ts` | Git status, branch tracking, diff state |
| `ui.ts` | View mode, workspace selection, active panels |
| `theme.ts` | Color scheme and font preferences |
| `editor.ts` | Code editor open files and state |
| `code.ts` | Code viewer file/line selection |
| `activityLog.ts` | System activity log entries |
| `analytics.ts` | Cost data and session analytics |
| `filter.ts` | Search and date range filters |
| `graph.ts` | Multi-session graph state for Mission Control |

Stores subscribe to `engineBus` events to stay synchronized with the headless engine layer. This ensures the UI is always up-to-date whether changes originate from user actions or autonomous pipeline execution.

---

## Composables

Vue 3 composables (`src/composables/`) bridge the engine layer and Vue components:

| Composable | Purpose |
|---|---|
| `useOrchestrator` | Wraps `OrchestratorPool` and `HybridPipelineRunner`; exposes reactive state: phase, running status, delegations, active epic count |
| `useEngine` | Thin bridge to `ProcessManager`; exports `sendMessageToEngine()`, `sendToolResultToEngine()`, `cancelProcess()` |
| `useEpicCardActions` | Epic CRUD actions: create, update, delete, move between columns |
| `useMissionControl` | Mission Control lifecycle: enter/exit, multi-session graph filtering |
| `useGraphBuilder` | Builds multi-session graphs from message history and live events |
| `useMultiRepoGit` | Multi-repo git operations (status, diff, commit across repos) |
| `useCreatePR` | GitHub pull request creation helpers |
| `useGitGraph` | Git commit graph visualization data |
| `useKeyboard` | Keyboard shortcut registration |
| `useVersionCheck` | App version checking |
| `useEpicFromChat` | Transforms chat conversations into structured epics with priority and complexity analysis |

---

## Tauri Backend

The Rust backend (`src-tauri/`) is intentionally thin — most logic lives in the TypeScript engine layer.

### Plugins

| Plugin | Purpose |
|---|---|
| `shell` | Spawns `claude` CLI subprocesses |
| `sql` | SQLite database access |
| `fs` | Filesystem operations |
| `dialog` | Native file/folder dialogs |

### Invoke Handlers

| Handler | Purpose |
|---|---|
| `pty_spawn` | Spawn pseudo-terminal processes |
| `pty_write` | Write to a PTY |
| `pty_resize` | Resize a PTY |
| `pty_kill` | Kill a PTY process |
| `get_platform_info` | Detect OS and architecture |

### Configuration (`tauri.conf.json`)

- Product name: `angy`
- Window: 1400x900, transparent titlebar
- macOS-focused with Linux support planned

---

## Technology Detection

### TechDetector (`TechDetector.ts`)

Automatically detects the technology stack of target repositories by scanning for marker files:

| Technology | Marker Files |
|---|---|
| TypeScript | `tsconfig.json` |
| Vue 3 | `vue` in `package.json` dependencies |
| React | `react` in `package.json` dependencies |
| Rust | `Cargo.toml` |
| Python | `pyproject.toml`, `requirements.txt` |
| PostgreSQL | `pg` or `postgres` in dependencies |
| Tailwind CSS | `tailwind.config.*` |
| Docker | `Dockerfile`, `docker-compose.yml` |
| Tauri | `tauri.conf.json` |

Detected technologies inject context-specific guidelines into specialist agent system prompts, helping agents follow framework-appropriate patterns.

---

## Database Schema

SQLite database managed by `Database.ts` with migration support.

### Core Tables

| Table | Purpose |
|---|---|
| `sessions` | Chat sessions — title, mode, parent_session_id, epic_id, delegation_status |
| `messages` | Messages — role (user/assistant/tool), content, tool_name, tool_input, turn_id |
| `checkpoints` | File rewind points within sessions |
| `file_changes` | Diffs tracked per turn for file history |

### Project Tables

| Table | Purpose |
|---|---|
| `projects` | Project metadata — name, description, color |
| `project_repos` | Repository paths, names, and default branches per project |

### Epic Tables

| Table | Purpose |
|---|---|
| `epics` | Full epic state including rejection count, architect plan, last attempt files |
| `epic_branches` | Git branch metadata per epic/repo combination |
| `repo_locks` | Which epic currently holds the lock on which repo |

### Operational Tables

| Table | Purpose |
|---|---|
| `scheduler_actions` | Audit log of scheduler decisions |
| `activity_logs` | System notifications and activity entries |
| `pipeline_snapshots` | Persisted `HybridPipelineRunner` state for crash recovery |

---

## Configuration

All settings are configurable via the Settings UI inside the app.

### Scheduler Configuration

| Setting | Description |
|---|---|
| Max concurrent epics | How many epics can run in parallel |
| Daily budget | API cost limit per day |
| Tick interval | How often the scheduler checks for work (default: 30s) |
| Priority weight | How much priority hint affects scoring |
| Age weight | How much time-in-todo affects scoring |
| Complexity weight | How much complexity affects scoring |
| Dependency depth weight | How much dependency chain depth affects scoring |
| Rejection penalty weight | How much prior rejections penalize scoring |

### Agent Profiles

Custom profiles allow configuring:

- System prompts per agent role
- Tool sets (which tools an agent can use)
- Profiles can be stacked on a single agent session

---

## Project Structure

```
src/
  engine/                     Core engine (no Vue dependency)
    AngyEngine.ts               Top-level facade / singleton
    Database.ts                 SQLite persistence and migrations
    ClaudeProcess.ts            Claude CLI subprocess management
    StreamParser.ts             JSON stream parser
    ProcessManager.ts           Process lifecycle management
    HybridPipelineRunner.ts     Incremental build state machine
    OrchestratorPool.ts         Multi-orchestrator manager
    Scheduler.ts                Epic scoring and dispatch
    BranchManager.ts            Git branch and worktree operations
    GitManager.ts               Git operations with events
    HeadlessHandle.ts           Headless agent I/O
    SessionService.ts           Session CRUD
    SpecialistConstants.ts      Prompts and tool sets per role
    TechDetector.ts             Technology stack detection
    KosTypes.ts                 Epic/project domain types
    types.ts                    Core type definitions
    EventBus.ts                 Mitt-based pub/sub
    DiffEngine.ts               Unified diff parsing
    ProfileManager.ts           Agent profile management
    PipelineStateStore.ts       Snapshot persistence for recovery
    repositories.ts             Data access abstractions
    SessionManager.ts           Session lifecycle management
    SessionMessageBuffer.ts     Message buffering and persistence
    PipelineEngine.ts           Pipeline execution model
    ClaudeHealthMonitor.ts      CLI health probing
    InboxManager.ts             Inter-agent messaging
    AnalyticsTypes.ts           Analytics type definitions
    platform.ts                 OS detection and config paths
    SpawnConcurrencyTest.ts     Concurrency debugging utility

  components/                 Vue 3 UI components
    kanban/                     Kanban board
    chat/                       Chat panel
    agents/                     Agent fleet panel
    editor/                     Monaco code viewer
    terminal/                   Xterm.js terminal
    layout/                     App shell and splitter
    effects/                    Activity visualizations
    gitgraph/                   Git commit graph
    analytics/                  Cost and usage analytics
    home/                       Home view and project management
    sidebar/                    Workspace tree, git panel, search
    settings/                   Settings and profile editor
    graph/                      Mission Control graph
    code/                       Code editing and file management
    common/                     Shared UI utilities
    fleet/                      Agent fleet management
    input/                      User input controls

  composables/                Vue composables bridging engine ↔ UI
  stores/                     Pinia state management
  App.vue                     Root component
  main.ts                     Vue app entry point

src-tauri/                    Tauri / Rust backend
  src/
    lib.rs                      Plugin initialization
    main.rs                     Entry point
    pty.rs                      PTY operations
    platform.rs                 Platform detection
  tauri.conf.json               Tauri configuration
```
