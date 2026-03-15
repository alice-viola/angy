# Fix Plan: AskUserQuestion Tool in Agents View

## Overview

The `AskUserQuestion` tool is completely broken in the agents/orchestrator view.
When Claude calls this tool, the question silently collapses into a gray "asking question"
row inside a tool call group. The user has no way to see or respond to it. Claude then
waits indefinitely for a tool result that never arrives.

There are **6 distinct bugs**, cascading from data layer to UI to wiring.

---

## Bug 1 — `MessageRecord` has no `toolId` field

**File:** `src/engine/types.ts` — `MessageRecord` interface (lines 84–93)

`MessageRecord` stores everything about a persisted message but is missing `toolId`.
This is the Claude-assigned ID for the tool invocation, which must be echoed back
in the `tool_result` envelope to resume the paused session.

```ts
// Current — toolId is absent
export interface MessageRecord {
  id?: number;
  sessionId: string;
  role: string;
  content: string;
  toolName?: string;
  toolInput?: string;
  turnId: number;
  timestamp: number;
}
```

**Fix:** add `toolId?: string` to `MessageRecord`.

---

## Bug 2 — `storeHandle.addToolUse` in `AgentsView.vue` discards `toolId`

**File:** `src/components/agents/AgentsView.vue` — `storeHandle.addToolUse` (line 180)

`ProcessManager.wireEvents` correctly passes `payload.toolId` as the fifth argument
(line 211 of `ProcessManager.ts`), matching the `AgentHandle` interface:

```ts
// AgentHandle (types.ts:196) — correct signature
addToolUse(sessionId, toolName, summary, toolInput?, toolId?): void
```

But the concrete `storeHandle` implementation silently drops it:

```ts
// AgentsView.vue line 180 — toolId never received or stored
addToolUse(sessionId: string, toolName: string, summary: string, toolInput?: Record<string, any>) {
  ...
  sessionsStore.addMessage(sessionId, {
    role: 'tool',
    toolName,
    toolInput: toolInput ? JSON.stringify(toolInput) : undefined,
    // toolId is never set here
  });
}
```

Without `toolId` in the stored `MessageRecord`, there is no way to later call
`sendToolResult(toolUseId, answer)` — the required ID is gone.

**Fix:** extend the signature to `addToolUse(..., toolId?: string)` and store it:
`toolId` in the created `MessageRecord`.

---

## Bug 3 — DB schema has no `tool_id` column; `toolId` is never persisted

**File:** `src/engine/Database.ts` — `CREATE TABLE messages` (line 64), `saveMessage` (line 399), `loadMessages` (line 444)

The `messages` table has no `tool_id` column. Even after fixing Bug 2, a session reload
from DB will produce `MessageRecord` objects with `toolId: undefined`. An unanswered
question that survives a page reload becomes permanently unanswerable.

```sql
-- Current schema — no tool_id column
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT REFERENCES sessions(session_id),
  role TEXT,
  content TEXT,
  tool_name TEXT,
  tool_input TEXT,
  turn_id INTEGER,
  timestamp INTEGER
);
```

**Fix (three sub-steps):**

1. **Schema migration** — add `ALTER TABLE messages ADD COLUMN tool_id TEXT` to the
   in-code `CREATE TABLE` block (or add a runtime migration guard).
2. **`saveMessage` / `upsertMessage`** — include `tool_id` in the `INSERT` column list
   and pass `msg.toolId ?? null` as the value.
3. **`loadMessages`** — map `r.tool_id` → `toolId` in the returned `MessageRecord`.

---

## Bug 4 — `OrchestratorChat.vue` groups `AskUserQuestion` with regular tool calls

**File:** `src/components/agents/OrchestratorChat.vue` — `timeline` computed (lines 528–534)

The timeline builder treats every message with `toolName` as a "tool call":

```ts
const isToolCall = !!msg.toolName && (msg.role === 'assistant' || msg.role === 'tool');

if (isToolCall) {
  pendingTools.push({ msg, entry: parseToolEntry(msg) });   // AskUserQuestion ends up here
  continue;
}
```

`pendingTools` are flushed into a `ToolCallGroup` item (rendered as a collapsed
"asking question" row). The user sees nothing actionable.

**Fix:**

Before the `isToolCall` check, short-circuit on `AskUserQuestion`:

```ts
if (msg.toolName === 'AskUserQuestion') {
  flushTools();  // flush any preceding tool calls first
  items.push({
    type: 'question',
    message: msg,
    timestamp: msg.timestamp ?? Date.now(),
  });
  continue;
}
```

Add `'question'` to the `TimelineItem.type` union and keep `message` on the item
so the template can read `msg.toolInput` and `msg.toolId`.

---

## Bug 5 — No question UI in `OrchestratorChat.vue`; `QuestionWidget` never rendered

**File:** `src/components/agents/OrchestratorChat.vue` — template (no `v-if="item.type === 'question'"` block exists)

`QuestionWidget.vue` exists in `src/components/chat/QuestionWidget.vue` and is already
used in `ChatPanel.vue`, but `OrchestratorChat.vue` never imports or renders it.
Even after Bug 4 is fixed and a `'question'` item appears in the timeline, nothing
will display it.

**Fix:**

1. Import `QuestionWidget` in `OrchestratorChat.vue`.
2. Parse the question and options from `msg.toolInput` (stored as a JSON string).
   `AskUserQuestion` input shape: `{ questions: [{ question: string, options: { label, description }[] }] }`.
3. Add a template block for `item.type === 'question'`:

```html
<QuestionWidget
  v-else-if="item.type === 'question'"
  :question="parseQuestion(item.message!)"
  :options="parseOptions(item.message!)"
  :sessionId="sessionId"
  :answered="!!item.message!.questionAnswered"
  @answer="(ans) => onQuestionAnswer(item.message!, ans)"
/>
```

4. Track `answered` state. Because `MessageRecord` is reactive (via `sessionsStore`),
   a simple approach is to add a transient `questionAnswered?: boolean` flag to
   `MessageRecord` or to a local `Map<toolId, boolean>` in the component.

---

## Bug 6 — No `sendToolResult` wiring; answered questions never reach Claude

**Files:** `src/components/agents/AgentsView.vue`, `src/components/agents/OrchestratorChat.vue`

`AgentsView.vue` imports `sendMessageToEngine` and `cancelProcess` but NOT
`sendToolResultToEngine`. There is no `onQuestionAnswer` handler anywhere in the
agents view stack. When `QuestionWidget` emits `answer`, no code would send the
tool result back to the paused Claude process.

**Fix — two sub-steps:**

**6a. Emit from `OrchestratorChat.vue` up to `AgentsView.vue`**

Add to `OrchestratorChat.vue`:
```ts
defineEmits<{
  ...
  'question-answered': [toolUseId: string, answer: string];
}>()
```

In `onQuestionAnswer(msg, ans)`:
```ts
function onQuestionAnswer(msg: MessageRecord, answer: string) {
  // Mark answered locally
  answeredToolIds.add(msg.toolId!);
  emit('question-answered', msg.toolId!, answer);
}
```

**6b. Handle in `AgentsView.vue`**

```ts
import { sendToolResultToEngine } from '../../composables/useEngine';

async function onQuestionAnswered(toolUseId: string, answer: string) {
  const sid = selectedAgentId.value;
  if (!sid) return;

  const info = sessionsStore.sessions.get(sid);
  const resumeSessionId = info?.claudeSessionId;
  if (!resumeSessionId) {
    console.warn('[AskQuestion] Cannot answer: no resumeSessionId for', sid);
    return;
  }

  fleetStore.updateAgent({ sessionId: sid, status: 'working', activity: 'Answering question...' });

  sendToolResultToEngine(sid, toolUseId, answer, storeHandle, {
    workingDir: info?.workspace || ui.workspacePath || '.',
    mode: info?.mode || 'agent',
    model: ui.currentModel,
    resumeSessionId,
  });
}
```

Wire it in the template:
```html
<OrchestratorChat
  :sessionId="selectedAgentId"
  @question-answered="onQuestionAnswered"
  ...
/>
```

---

## Execution order

Fix in this sequence to avoid circular blockers:

| Step | What | File(s) |
|------|------|---------|
| 1 | Add `toolId?` to `MessageRecord` | `src/engine/types.ts` |
| 2 | Add `tool_id` column to DB schema + read/write | `src/engine/Database.ts` |
| 3 | Store `toolId` in `storeHandle.addToolUse` | `src/components/agents/AgentsView.vue` |
| 4 | Detect `AskUserQuestion` in timeline; new `'question'` item type | `src/components/agents/OrchestratorChat.vue` |
| 5 | Import + render `QuestionWidget`; parse question/options from `toolInput` | `src/components/agents/OrchestratorChat.vue` |
| 6 | Emit `question-answered`; wire `sendToolResultToEngine` in `AgentsView` | both agent files |

---

## Edge cases to handle

- **Multiple questions in flight**: `AskUserQuestion` input can contain more than one
  entry in the `questions` array. For simplicity render each question block separately,
  each with its own `toolId`. In practice Claude always sends one per call.

- **Session reload with unanswered question**: After DB fix (Bug 3), on reload we
  correctly restore `toolId`. We should detect unanswered questions by checking
  whether a later `user`-role tool-result message exists for that `toolId`.
  If not, render the widget as unanswered (active). If yes, render as answered.
  Simplest heuristic: a question is unanswered if no subsequent `role='user'`
  message exists in the session after that tool's `turnId`.

- **`storeHandle.markDone` turn counter**: `sendToolResult` creates a new
  `ClaudeProcess`. When Claude continues, `appendTextDelta` will use
  `state.turnCounter` which was set when the user originally sent the message.
  This is correct — the answer is part of the same turn. No change needed.

- **`SessionMessageBuffer`**: The buffer in `ProcessManager` persists messages via
  `buffer.addToolMessage`. Check that `SessionMessageBuffer.addToolMessage` also
  passes `toolId` through to `db.saveMessage`. If not, fix it too.
