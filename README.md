<p align="center">
  <img src="public/angy-new-logo.png" width="64" alt="Angy logo" />
</p>

<h1 align="center">Angy</h1>

<p align="center">A fleet manager for Claude agents. Goals in, working code out.</p>
<p align="center">
  <a href="https://alice-viola.github.io/angy/">View the website</a>
</p>
<p align="center">
  <img src="https://img.shields.io/badge/version-v0.3.1-blue" alt="Version" />
  <img src="https://img.shields.io/badge/platform-macOS-lightgrey" alt="Platform" />
  <a href="LICENSE.md"><img src="https://img.shields.io/badge/license-see%20LICENSE.md-green" alt="License" /></a>
</p>

---

Most AI coding tools give you one agent and one conversation. Angy gives you a **command center**.

The scope of Angy is be able to build entire products from scratch, or to improve existing codebases. Angy is able to run for days continuously.

You define high-level goals called **Epics**. An autonomous scheduler picks them up, spawns a pipeline per epic, and that pipeline breaks the work into specialist agents — architects, builders, testers, counterparts — each running inside a dedicated git branch. When they're done, you approve. Work merges. The scheduler picks the next thing.

No micromanaging. No copy-pasting context. Just goals in, working code out.

<p align="center">
  <img src="public/overview.png" alt="Angy kanban" width="700">
</p>

## Features

### Kanban Board

Epics flow through a visual pipeline:

<p align="center">
  <img src="public/kanban.png" alt="Angy pipeline" width="700">
</p>


Each Epic carries a full spec: title, description, acceptance criteria, priority (critical → low), complexity (trivial → epic), target repositories, and dependencies on other epics. You steer the roadmap; Angy executes it.

### Autonomous Scheduler
A background engine that **continuously prioritizes and dispatches work**:

- Scores Todo epics using configurable weights: priority hint, age, complexity, dependency depth, and rejection penalty
- Respects concurrency limits (e.g. max 3 epics running in parallel)
- Enforces per-repo locks so two epics never write to the same codebase simultaneously
- Skips blocked epics until their dependencies land in Done
- Recovers crashed or interrupted epics automatically on restart
- Tracks daily API cost budgets and pauses when limits are hit

Set it and forget it. Or tune the weights and let it reflect your team's priorities.

### Incremental Build Pipeline

The core of Angy is the **HybridPipelineRunner** — a TypeScript state machine that drives multi-agent builds the way a human developer would: incrementally, with verification at every step.

<p align="center">
  <img src="public/agents.png" alt="Angy agents" width="700">
</p>

Instead of trying to build an entire application in one shot (the approach every other AI coding tool takes), Angy splits the work into sequential increments — scaffold, data layer, API, frontend shell, features — and verifies each one compiles and works before starting the next.

```
Phase 1: Plan
  Architect designs the solution
  Counterpart adversarially verifies the plan
  Challenge loop until approved (architect rewrites the full plan each cycle)

Phase 2: Incremental Build
  Splitter breaks the plan into 4-8 sequential increments
  For each increment:
    Builder implements it
    Tester verifies it (compile check / smoke test)
    Fix loop if verification fails (max 3 cycles)

Phase 3: Integration Review
  Persistent counterpart reviews the full codebase
  Fresh builder fixes any issues
  Loop until counterpart approves

Phase 4: Final Testing
  Tester runs full end-to-end verification
  Builder fixes any failures
  Counterpart does final review
  Loop until all pass
```

**Why incremental?** When you build 50 files at once and then test, errors compound — a wrong field name in the data model cascades into broken APIs and a broken frontend. With incremental builds, you catch the data model mistake before anyone builds on top of it. The blast radius of any error is one increment deep.

### Pipeline Types

| Pipeline | Purpose |
|----------|---------|
| **Create** | Full incremental build pipeline (architect → incremental build → review → test) |
| **Fix** | Targeted bug fixing (diagnose → debug → fix → test → review) |
| **Investigate** | Read-only codebase analysis and reporting |
| **Plan** | Read-only architectural planning |

### Git-Native Workflow
Every epic gets its own `epic/{id}` branch per target repository. When the pipeline completes, the branch is squash-merged into master. The Review column is a human gate before anything lands — you approve, it merges; you reject (with feedback), it goes back to Todo for another attempt.

### Agent Fleet
- **Agent fleet** — spawn, rename, favorite, and remove agents; each has an independent session
- **Pipeline sessions** — epic agents are visually grouped in the sidebar with green accent bars and pipeline badges
- **Parallel delegation** — within an increment, work fans out to specialist agents simultaneously
- **Streaming responses** — real-time token streaming with thinking blocks and tool call visualization
- **Image support** — attach images to messages
- **File checkpointing** — rewind file changes to any prior checkpoint in a session

### Specialist Roles

| Role | Access | Purpose |
|------|--------|---------|
| **Architect** | Read, Glob, Grep | Analyzes codebases, designs solutions, produces structured plans |
| **Builder** | Bash, Read, Edit, Write, Glob, Grep | Implements code per the plan, self-verifies before finishing |
| **Counterpart** | Bash, Read, Edit, Write, Glob, Grep | Adversarial reviewer — independently verifies claims, finds flaws, fixes bugs |
| **Tester** | Bash, Read, Edit, Write, Glob, Grep | Builds projects, runs tests, performs smoke tests and e2e verification |

### Live Observability
Every agent session has its own chat panel, Monaco code editor, and Xterm.js terminal. Watch the fleet work in real time or come back to the Review column when things are done.

- **Integrated editor** — Monaco-based code viewer with syntax highlighting, diff view, inline edit bar, and breadcrumb navigation
- **Integrated terminal** — Xterm.js terminal panel per agent
- **Git integration** — diff tracking and a Git panel in the sidebar
- **Profiles** — configure custom system prompts and tool sets per-profile; stack multiple profiles on an agent
- **Local-first** — everything stored in SQLite on disk; no cloud account required beyond your Claude subscription

## How It Works

1. **Create an epic** — write a title, description, and acceptance criteria on the Kanban board.
2. **Move it to Todo** — the scheduler picks it up on the next tick (default: every 30s).
3. **Scheduler scores and dispatches** — selects the highest-priority unblocked epic, checks repo locks, and spawns the pipeline.
4. **Architect plans** — designs the full solution. A persistent counterpart adversarially verifies the plan, challenging contradictions and gaps. The architect rewrites the complete plan each cycle until approved.
5. **Splitter breaks the plan into increments** — 4-8 sequential, independently-verifiable steps (e.g., scaffold → data layer → API → frontend shell → features).
6. **Incremental build** — each increment is built by a fresh builder agent, then verified by a tester (compile check, smoke test). If verification fails, a fix loop runs before moving on.
7. **Integration review** — the persistent counterpart reviews the full implementation against the original plan and acceptance criteria. A fresh builder fixes any issues.
8. **Final testing** — a tester runs full end-to-end verification including adversarial inputs. Builder fixes failures. Counterpart does final approval.
9. **Branch merges** — the epic branch is squash-merged into master.
10. **Review gate** — the epic lands in the Review column. Approve to close it, or reject with feedback to send it back to Todo.

## Installation

### Pre-built Binary (macOS arm64)

If you've cloned the repo, a pre-built binary is available at the repo root:

```bash
chmod +x ./angy_v010
./angy_v010
```

> Note: The binary requires the `resources/` directory to be present alongside it. No standalone release packages are available yet.

### Build from source

**Prerequisites:**

- **Node.js** (LTS recommended)
- **Rust toolchain** — install via [rustup.rs](https://rustup.rs)
- **Claude Code CLI** — must be installed and authenticated (`claude` binary in your PATH)
- **Git** — required for branch management and epic workflows

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Run a separate dev instance (for developing Angy with Angy)
npm run tauri:dev-instance

# Build a production binary
npm run build
```

The production build type-checks, bundles the frontend, and packages a native desktop binary via Tauri. Output is in `src-tauri/target/release/`.

## Configuration

All settings are configurable via the **Settings UI** inside the app.

- **Scheduler** — concurrency limits (max parallel epics), daily API cost budgets, and priority scoring weights (priority hint, age, complexity, dependency depth, rejection penalty)
- **Profiles** — custom system prompts and tool sets per agent profile

## Project Structure

```
src/engine/       Core pipeline engine
                  HybridPipelineRunner, Orchestrator, Scheduler,
                  BranchManager, ClaudeProcess, ProcessManager
src/components/   Vue 3 UI components
                  Kanban board, chat, fleet panel, terminal, Monaco editor
src/composables/  Vue composables
src/stores/       Pinia state management
src-tauri/        Tauri / Rust backend
resources/mcp/    MCP server (Python) for LLM-driven orchestration fallback
```

## Architecture

Angy wraps the `claude` CLI using Tauri's shell plugin. Each agent session spawns a new `claude` process with `--input-format stream-json` / `--output-format stream-json`, writes a JSON message envelope to stdin, and streams structured JSON events back on stdout.

The **HybridPipelineRunner** is a coded TypeScript state machine that drives the multi-agent pipeline programmatically — no LLM decides what to do next. It uses Claude CLI's `--json-schema` for structured extraction of verdicts, increment plans, and test results. Specialist agents (architect, builder, counterpart, tester) run as normal agent sessions with full tool access.

The pipeline's key innovation is **incremental building with verification gates**: instead of building everything at once and testing at the end, it splits the architect's plan into sequential increments and verifies each one before starting the next. This dramatically reduces error compounding and makes fix loops small and focused.

## Tech stack

| Layer | Technology |
|---|---|
| Desktop shell | [Tauri 2](https://tauri.app) (Rust) |
| Frontend | [Vue 3](https://vuejs.org) + TypeScript |
| Styling | [Tailwind CSS 4](https://tailwindcss.com) |
| State | [Pinia](https://pinia.vuejs.org) |
| Code editor | [Monaco Editor](https://microsoft.github.io/monaco-editor/) |
| Terminal | [Xterm.js](https://xtermjs.org) |
| Syntax highlighting | [Shiki](https://shiki.style) |
| Persistence | SQLite via `@tauri-apps/plugin-sql` |

## Troubleshooting

- **Claude CLI not found** — ensure the `claude` binary is installed and on your PATH. Run `claude --version` to verify.
- **Git not installed** — git is required for branch management. Install it via Xcode Command Line Tools (`xcode-select --install`) or [git-scm.com](https://git-scm.com).
- **Platform support** — Angy is currently macOS-focused. Linux and Windows support is not yet available.

## Next Steps

The immediate next milestone is replacing the current dependency on the `claude` CLI with **our own agentic loop** — a first-party implementation that communicates directly with AI provider APIs, allowing us to have an alternative to Claude Code.

The custom agentic loop will support both the **Gemini** and **Anthropics** APIs, enabling Angy to run agents against either provider (or both simultaneously within the same pipeline). This opens the door to model diversity across specialist roles, cost optimization, and provider redundancy — without any changes to how epics or pipelines are defined.

## Status

**v0.3.1** — active development. macOS and Linux for now. Expect breaking changes.

---

> _Managing a fleet of AI agents that autonomously rewrites your codebase while you're away is, frankly, a little terrifying. You should feel something._
