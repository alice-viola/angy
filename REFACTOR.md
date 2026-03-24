# 🚀 Angy: The Execution Pipeline Refactor

This document outlines the architectural and UX refactor to move Angy away from a slow, human-centric Kanban board to a hyper-fast, AI-centric **Execution Pipeline**. It also introduces **User-Defined Agent Teams**, allowing users to explicitly configure the models and agents used for each Epic instead of relying on a black-box "complexity" metric.

Because this refactor touches the core of the `Scheduler`, `OrchestratorPool`, and `HybridPipelineRunner`, it is split into four safe, decoupled phases.

---

## 🎯 The Goal
1. **Ditch the Kanban Board:** Replace the 6-column board with a 3-column "CI/CD Pipeline" view (Queue ➔ Live Execution ➔ Review).
2. **Transparent "Icebox":** Make it visually obvious that ideas/drafts will not be touched by the AI until explicitly queued.
3. **User-Defined Pipelines ("Team Assembly"):** Let the user configure the exact pipeline of agents (e.g., Architect [Claude 3.5] ➔ Frontend [GPT-4o] & Backend [Claude 3.5] ➔ Tester [Gemini 1.5 Pro]) when creating an Epic.
4. **DAG Execution:** Upgrade the hardcoded orchestrator to a dynamic Directed Acyclic Graph (DAG) runner that executes the user's custom pipeline.

---

## 🛠️ Phase 1: The 3-Column Layout (UI Only)
*Safely replace the visual layer without breaking the underlying backend engine.*

### 1. The Queue (Left Column)
- [ ] Replace the Kanban grid with a vertical split list.
- [ ] **Top Section (Active Queue):** Epics in the `todo` state. Numbered priority.
- [ ] **Bottom Section (Icebox/Drafts):** Epics in the `idea` and `backlog` states. Visually muted/grayed out to guarantee they are safe from the AI.
- [ ] **UX:** Add a "Send to Queue" / "Send to Icebox" toggle button on the Epic card. Drag and drop across the divider.

### 2. The Live Execution Graph (Center Column)
- [ ] Display Epics currently in the `in-progress` state.
- [ ] Instead of a static card, render a **Subway Map / Flow Graph** of the active agents.
- [ ] *Temporary state:* Since the backend is still hardcoded (Architect ➔ Builder ➔ Reviewer), simply draw this hardcoded graph and pulse the nodes based on the existing `pipeline:internalCall` and `epic:phaseChanged` engine events.

### 3. The Review Inbox (Right Column)
- [ ] Display Epics in `review`, `done`, and `discarded` states as a vertical inbox (like GitHub Pull Requests).
- [ ] Click an item to view test results and diffs.
- [ ] Big **Approve** (Move to Done) and **Reject** (Throw back to Queue with feedback) buttons.

---

## 💾 Phase 2: Database & Type System (Backend)
*Prepare the data layer to hold custom agent pipelines.*

- [ ] Update `KosTypes.ts`:
  - Deprecate `ComplexityEstimate` driving the orchestrator.
  - Introduce a new `PipelineConfig` interface for Epics.
  - `PipelineConfig` contains an array/graph of `AgentNode` objects.
- [ ] Define `AgentNode`:
  - `id`: Unique step ID (e.g., `step-1`)
  - `role`: `architect` | `builder-frontend` | `builder-backend` | `tester` | `custom`
  - `model`: The specific LLM to use (e.g., `claude-3-5-sonnet`)
  - `promptOverride`: Optional specific instructions for this node.
  - `dependsOn`: Array of parent node IDs (for parallelism).
- [ ] Update SQLite schema to store the serialized `pipeline_config` JSON string in the `epics` table.

---

## 🎨 Phase 3: The "Team Assembly" Builder (UI)
*Make configuring the complex pipeline completely frictionless and beautiful.*

- [ ] Update the **Epic Detail Panel** creation flow.
- [ ] When a user selects a Pipeline Type (Create, Fix, Investigate), instantly render the **Subway Map** horizontally.
- [ ] Each node on the map is an Agent Card showing the assigned Model (e.g., `[🤖 Claude 3.5] Architect`).
- [ ] **Interactions:**
  - Hovering a card allows you to change the underlying Model via a dropdown.
  - Toggle a switch on the card to skip/disable that agent entirely (e.g., turning off the `Tester`).
- [ ] Add a dynamic **Estimated Cost** ticker that updates as the user swaps between expensive and cheap models.
- [ ] Save this visual map to the Epic's new `pipeline_config` database field.

---

## ⚙️ Phase 4: The DAG Pipeline Runner (Engine)
*The final, most dangerous cut: replacing the hardcoded state machine.*

- [ ] Deprecate the rigid `HybridPipelineRunner.ts`.
- [ ] Create a new **`DAGPipelineRunner.ts`**.
- [ ] The new runner must:
  1. Read the Epic's `pipeline_config` JSON.
  2. Parse the `dependsOn` arrays to build an execution graph.
  3. Spawn root processes for nodes with no dependencies.
  4. Wait for promises/events to resolve, then fan-out and spawn child processes based on the graph.
  5. Respect the `parallelAgentCount` and repository lock system currently managed by the Scheduler.
- [ ] Wire the generic `DAGPipelineRunner` events back up to the frontend UI so the Center Column's "Live Execution Graph" pulses accurately according to the custom user-defined pipeline.

---

## 🏁 Success Criteria
When finished, Angy will no longer feel like a human task tracker that an AI accidentally reads. It will feel like a hyper-advanced, visual CI/CD pipeline where the user is an **Assembly Manager** orchestrating a team of highly specialized, user-configured LLM workers executing in parallel.