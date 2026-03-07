# Improvements

## 1. Empty chat welcome screen — simplify to "New chat"
**File:** `src/components/chat/WelcomeScreen.vue`

Remove:
- Logo image (`<img src="/angylogo.png">`) and its wrapping container
- "Angy" title text
- "Agent Fleet Manager" subtitle
- Workspace indicator block (`v-if="ui.workspacePath"`)
- "Change Workspace" / "Open Workspace" button

Keep:
- Keyboard hints grid
- Replace the whole header area with a simple "New chat" heading

---

## 2. Welcome/home page — remove price from topbar
**File:** `src/components/home/SchedulerStatusBar.vue`

Remove:
- The separator `|` before the cost span
- The `$0.00 / $50.00` cost span

---

## 3. Welcome/home page — inline logo next to "Angy" title, remove subtitle
**File:** `src/components/home/HomeView.vue`

- Place the Angy logo image inline to the left of the "Angy" `<h1>` (small, ~24–28px)
- Remove the `<p>` subtitle: "KOS — Kanban Orchestration System"
