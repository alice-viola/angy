# Agent Graph — Live Visualization Plan

## Overview

A reactive, real-time graph visualization that replaces the Effects panel (Panel 4) in AGM mode. It visualizes the **work graph** of agents: tool calls, file edits, delegation links between orchestrated agents, and timeline progression. Works both **live** (streaming as agents work) and in **replay mode** (reconstructed from chat history/DB).

---

## 1. What It Shows

### Nodes

| Node Type | Shape | Data Source |
|-----------|-------|-------------|
| **Agent Session** | Large circle with status color | `fleet.agents[]`, `sessions.sessions` |
| **Tool Call** | Small rounded rect | `ChatMsg` where `role === 'tool'` |
| **File** | Diamond / hexagon | Extracted from `toolInput.file_path` on Edit/Write/Read tools |
| **Validation** | Octagon | `OrchestratorEvents.validationStarted/Result` |
| **Milestone** (done/fail) | Star/cross | `OrchestratorEvents.completed/failed` |

### Edges

| Edge Type | Style | Meaning |
|-----------|-------|---------|
| **Parent → Child** | Thick, colored by role | Orchestrator delegation (`parentSessionId`) |
| **Agent → Tool** | Thin line, animated when live | Agent performed this tool call |
| **Tool → File** | Dotted line | Tool touched this file |
| **Agent ↔ Agent** | Dashed bidirectional | Peer message (`send_message` / `check_inbox`) |
| **Validation → Agent** | Red/green arrow | Validation result fed back |

### Node Decorations

- Agent nodes: pulsing ring when `status === 'working'`, status dot color matches `AgentStatus`
- Tool nodes: icon from `ToolCallGroup.toolIconMap` (Edit=✎, Bash=⌘, Read=◧, etc.)
- File nodes: badge showing `+N / -N` lines changed, colored green/red
- Timestamps on edges (relative to session start)

---

## 2. Two Modes

### 2a. Live Mode (default when agents are working)

- Graph updates reactively as events stream in
- New nodes animate into position (spring physics or force-directed settle)
- Active tool call nodes glow/pulse, then settle when complete
- Data sources (all already exist):
  - `ChatPanel.addToolUse()` — new tool call node
  - `ChatPanel.appendTextDelta()` — agent is producing output (pulse agent node)
  - `ChatPanel.markDone()` — agent finished (settle node)
  - `Orchestrator.events` — delegation, validation, done, fail, peer messages
  - `EffectsPanel.onFileChanged()` — file modification events
  - `fleet.agents[]` — agent status changes

### 2b. Replay Mode (historical reconstruction)

- Activated when selecting a past session (not currently running)
- Reconstructs the full graph from persisted data:
  1. Load `sessions` table → agent nodes + parent→child edges
  2. Load `messages` table → tool call nodes + agent→tool edges
  3. Load `file_changes` table → file nodes + tool→file edges
  4. Parse `toolInput` JSON for file paths, tool parameters
- **Timeline scrubber**: slider at the bottom, keyed by `turnId` or `timestamp`
  - Dragging the scrubber shows the graph **at that point in time**
  - Nodes/edges fade in as the scrubber advances
  - Allows "replaying" the orchestration step by step

### Reconstruction Algorithm

```
function buildGraphFromHistory(sessionId: string):
  // 1. Find all sessions in this orchestration tree
  rootSession = findRoot(sessionId)  // walk parentSessionId up
  allSessions = collectTree(rootSession)  // BFS children

  // 2. For each session, load messages
  for session in allSessions:
    messages = db.loadMessages(session.sessionId)
    addAgentNode(session)

    if session.parentSessionId:
      addEdge(parent → session, type='delegation')

    for msg in messages:
      if msg.role === 'tool':
        toolNode = addToolNode(msg.toolName, msg.turnId, msg.timestamp)
        addEdge(session → toolNode, type='tool-call')

        filePath = parseFilePath(msg.toolInput)
        if filePath:
          fileNode = getOrCreateFileNode(filePath)
          addEdge(toolNode → fileNode, type='file-touch')

  // 3. Load file_changes for line counts
  for session in allSessions:
    changes = db.loadFileChanges(session.sessionId)
    for change in changes:
      updateFileNode(change.filePath, change.linesAdded, change.linesRemoved)
```

---

## 3. Architecture

### New Files

```
src/
├── components/
│   └── graph/
│       ├── AgentGraph.vue          # Main component (canvas + overlay)
│       ├── GraphRenderer.ts        # Canvas 2D rendering engine
│       ├── GraphLayout.ts          # Force-directed layout algorithm
│       └── GraphTypes.ts           # GraphNode, GraphEdge, GraphState types
├── stores/
│   └── graph.ts                    # Pinia store: graph state, node/edge data
└── composables/
    └── useGraphBuilder.ts          # Builds graph from live events or DB history
```

### No New Dependencies

Use **Canvas 2D** for rendering — no D3/vis.js needed. The graph is simple enough (typically <100 nodes) that a custom renderer with requestAnimationFrame gives better control over animations and keeps the bundle small. This matches the project's philosophy of minimal dependencies.

### Store: `stores/graph.ts`

```typescript
interface GraphNode {
  id: string
  type: 'agent' | 'tool' | 'file' | 'validation' | 'milestone'
  label: string
  sessionId?: string        // which agent session owns this node
  toolName?: string         // for tool nodes
  filePath?: string         // for file nodes
  status?: AgentStatus      // for agent nodes
  linesAdded?: number       // for file nodes
  linesRemoved?: number     // for file nodes
  turnId: number            // when this node appeared
  timestamp: number
  // Layout
  x: number
  y: number
  vx: number                // velocity for physics
  vy: number
  pinned: boolean           // user dragged
}

interface GraphEdge {
  id: string
  source: string            // node id
  target: string            // node id
  type: 'delegation' | 'tool-call' | 'file-touch' | 'peer-message' | 'validation'
  label?: string
  turnId: number
  timestamp: number
}

interface GraphState {
  nodes: Map<string, GraphNode>
  edges: GraphEdge[]
  // Timeline
  minTurn: number
  maxTurn: number
  currentTurn: number       // scrubber position (-1 = show all)
  isLive: boolean
  // View
  zoom: number
  panX: number
  panY: number
  hoveredNodeId: string | null
  selectedNodeId: string | null
}
```

### Composable: `useGraphBuilder.ts`

Two entry points:

1. **`buildLiveGraph(sessionId)`** — subscribes to:
   - `engineBus` events (`agent:statusChanged`, `diff:fileChanged`, etc.)
   - `orchestrator.on(...)` events (delegation, validation, peer messages)
   - `ChatPanel` exposed methods (tool calls via watch on `sessionStates`)
   - Returns cleanup function

2. **`buildHistoryGraph(sessionId)`** — reads from DB:
   - `db.loadSessions()` → find orchestration tree
   - `db.loadMessages(sid)` for each session → tool nodes
   - `db.loadFileChanges(sid)` → file nodes
   - Populates the graph store in one pass

Both write to the same `useGraphStore()` Pinia store, so the `AgentGraph.vue` component doesn't care about the source.

---

## 4. Layout Integration

### MainSplitter Changes

Panel 4 (currently Effects-only) becomes a switchable slot:

```
<!-- Panel 4: Effects or Graph (Manager only) -->
<Pane :size="panelSizes[4]" ...>
  <div v-show="inManager && ui.rightPanelVisible">
    <AgentGraph v-if="ui.rightPanelMode === 'graph'" />
    <slot name="effects" v-else />
  </div>
</Pane>
```

### UI Store Changes

```typescript
// In stores/ui.ts
rightPanelMode: ref<'effects' | 'graph'>('effects')
rightPanelVisible: ref(true)  // replaces effectsPanelVisible

function toggleRightPanelMode() {
  rightPanelMode.value = rightPanelMode.value === 'effects' ? 'graph' : 'effects'
}
```

### Toggle Button

In the `AgentFleetPanel` or as a small tab strip at the top of Panel 4:

```
[Effects] [Graph]   ← tab toggle
```

When the user clicks an agent card while in Graph mode, the graph highlights that agent's subtree and connected files.

---

## 5. Rendering Details

### Canvas Renderer (`GraphRenderer.ts`)

- `requestAnimationFrame` loop, only redraws when dirty flag is set
- Node shapes: `arc()` for agents, `roundRect()` for tools, rotated `rect()` for files
- Edge rendering: `bezierCurveTo()` for smooth curves, animated dash offset for live edges
- Colors from CSS variables (`getComputedStyle` to read `--accent-teal`, `--accent-green`, etc.)
- Text rendering: `fillText()` with font from `--font-mono`

### Force-Directed Layout (`GraphLayout.ts`)

Simple spring-embedder:
- Agent nodes repel each other (Coulomb)
- Connected nodes attract (Hooke's spring)
- File nodes cluster to the right, agent nodes to the left
- Tool nodes orbit their parent agent
- Simulation runs for ~100 iterations on load, then settles
- New nodes added during live mode get a brief animation burst

### Interactions

- **Hover**: highlight node + connected edges, show tooltip with details
- **Click agent**: select in fleet panel, show its chat
- **Click file**: open in CodeViewer (inline preview in manager mode)
- **Click tool node**: scroll chat to that tool call's turn
- **Drag node**: pin it in place
- **Scroll wheel**: zoom
- **Middle-click drag**: pan
- **Timeline scrubber** (replay mode): range input at bottom, filters visible nodes by turnId

---

## 6. File-to-Agent Linking

Each file node maintains a `touchedBy: Set<sessionId>` — the set of agents that modified it. This is:

- **Live**: populated from `EffectsPanel.onFileChanged()` events (which include `sessionId`)
- **Replay**: populated from `file_changes` table (has `session_id` column)
- **Displayed**: file node shows colored dots for each agent that touched it, with a count badge

When hovering a file node, all agents in `touchedBy` highlight. When hovering an agent, all its files highlight. This makes cross-agent file conflicts immediately visible.

---

## 7. Implementation Steps

### Phase 1: Data Layer
1. Create `src/components/graph/GraphTypes.ts` — type definitions
2. Create `src/stores/graph.ts` — Pinia store with GraphState
3. Create `src/composables/useGraphBuilder.ts` — history reconstruction from DB
4. Add `buildHistoryGraph()` that loads sessions + messages + file_changes

### Phase 2: Renderer
5. Create `src/components/graph/GraphLayout.ts` — force-directed positioning
6. Create `src/components/graph/GraphRenderer.ts` — Canvas 2D draw loop
7. Create `src/components/graph/AgentGraph.vue` — Vue component wrapping canvas

### Phase 3: Integration
8. Update `src/stores/ui.ts` — add `rightPanelMode`, rename `effectsPanelVisible`
9. Update `src/components/layout/MainSplitter.vue` — switchable Panel 4
10. Wire `AgentGraph` into `App.vue` template as slot content

### Phase 4: Live Mode
11. Add `buildLiveGraph()` to `useGraphBuilder.ts` — subscribe to events
12. Wire orchestrator events → graph store updates
13. Wire `ChatPanel` tool calls → graph store updates
14. Add animation/pulse effects for active nodes

### Phase 5: Replay & Polish
15. Timeline scrubber component (range input + turn labels)
16. Click interactions (agent→chat, file→preview, tool→scroll)
17. Hover tooltips with node details
18. Zoom/pan controls
19. Auto-switch to graph mode when orchestration starts

---

## 8. Data Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│                      LIVE MODE                          │
│                                                         │
│  ChatPanel.addToolUse() ──┐                             │
│  Orchestrator.events ─────┤──► useGraphBuilder ──► graphStore ──► AgentGraph.vue
│  EffectsPanel.onFileChanged()┘      │                   │         (Canvas 2D)
│                                     │                   │
│                              ┌──────┘                   │
│                              │                          │
│                      REPLAY MODE                        │
│                                                         │
│  db.loadSessions() ──────┐                              │
│  db.loadMessages() ──────┤──► useGraphBuilder           │
│  db.loadFileChanges() ───┘      (buildHistoryGraph)     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 9. Example Graph Structure (Orchestration)

```
                    ┌──────────────┐
                    │ Orchestrator │ (mode: orchestrator)
                    │   ● working  │
                    └──┬───┬───┬───┘
          ┌────────────┘   │   └─────────────┐
          ▼                ▼                  ▼
   ┌─────────────┐  ┌────────────┐   ┌─────────────┐
   │ architect-1  │  │implementer-2│  │ reviewer-3  │
   │   ● done     │  │  ● working │  │  ● idle     │
   └──┬──┬──┬─────┘  └──┬──┬──┬──┘   └─────────────┘
      │  │  │            │  │  │
      ▼  ▼  ▼            ▼  ▼  ▼
     Read Glob Grep    Edit Write Bash
      │         │        │    │
      ▼         ▼        ▼    ▼
   types.ts  *.vue    App.vue  store.ts  ← file nodes (shared across agents)
```

---

## 10. Non-Goals (v1)

- 3D visualization
- Graph export/screenshot (can add later)
- Diffing two graph snapshots
- Custom node styling/theming beyond Catppuccin colors
- Graph persistence (always reconstructed from existing DB data)
