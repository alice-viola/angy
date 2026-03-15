# Epic Panel Redesign Plan

## Current Problems

1. **Feels foreign** — the panel is a fixed 440px right drawer that visually sits on top of the board, not within it. It uses its own card/section styling that doesn't match the Kanban or Fleet design language.
2. **Complexity and Pipeline are disconnected** — the single most important relationship (complexity → pipeline behavior) is represented as two independent dropdowns with no visual link.
3. **Model is buried** — hidden inside a collapsible "Configuration" section, despite being a first-class decision.
4. **Git options are buried too** — `useGitBranch`, `useWorktree`, `baseBranch` are in the same collapsed section, making them invisible by default.
5. **Actions are mixed in with form fields** — approve/reject, suspend, stop, and PR buttons share space with the edit form. In a narrow panel this creates cognitive chaos.

---

## Design Principles

- **Integrated, not overlaid.** The panel must feel like it belongs to the board, using the same CSS variables and card anatomy as `ActiveCard`, `ReviewCard`, etc.
- **Group by meaning, not by technical category.** Complexity + Pipeline + Model belong together because they define _how_ the work runs. Git options belong together because they define _where_ the work runs.
- **Progressive disclosure for depth, not for importance.** Show important things first. Hide verbose details, not critical options.
- **Actions are contextual and prominent.** When the epic is in review, the approve/reject UI dominates. When in-progress, suspend/stop dominate. The form recedes.
- **No horizontal section dividers that look like new panels.** Use subtle separators (`--border-subtle`) or just whitespace.

---

## Layout

### Panel Placement

Keep the right-side panel position. It integrates well with the board flow (read left-to-right, detail on the right). Do NOT make it a modal or a popover — the current slide-in pattern is correct.

**Width:** increase from 440px → 480px. The extra 40px gives breathing room for the git/complexity groups without overflow.

**Integration trick:** the panel background must use `--bg-surface` (same as the board background), not a raised or windowed background. Add a `1px` left border with `--border-standard`. Remove the current box-shadow that makes it feel "floated". The panel should look like a column of the board, not a tooltip.

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  BOARD COLUMNS (scrollable horizontally)              │ EPIC PANEL (480px, fixed)    │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐       │ (same bg, border-left only)  │
│  │ IDEA │ │ UPCO │ │ ACTI │ │ REVI │ │ DONE │       │                              │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘       │                              │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Panel Internal Structure

The panel has three zones, stacked vertically:

```
┌───────────────────────────────┐
│  A. HEADER (fixed, 48px)      │  Title + column badge + close
├───────────────────────────────┤
│  B. BODY (scrollable)         │  All form fields (see groups below)
│                               │
│  ─── if contextual actions ── │
│  C. ACTION ZONE               │  Approve/Reject OR Suspend/Stop OR PR
├───────────────────────────────┤
│  D. FOOTER (fixed, 52px)      │  Save/Create   [Delete]
└───────────────────────────────┘
```

---

## Body Groups

### Group 1 — What (always visible, no label)

```
Title field (full width, large text, no border until focus)
```

A plain `textarea` or `contenteditable`-style title with large font (`text-base font-semibold`), no visible border at rest. On hover/focus it shows `--border-standard`. This is how the fleet sidebar agent title feels — inline, not a form field.

---

### Group 2 — How It Runs (always visible)

This is the core group. **Complexity, Pipeline, and Model are grouped together in a visual card**, using `--bg-raised` background and `rounded-xl`, matching card anatomy.

```
┌──────────────────────────────────────────────┐
│  HOW IT RUNS                                 │   ← section label (text-xs uppercase muted)
│                                              │
│  COMPLEXITY     ●●●●○  large                 │   ← 5-dot visual selector (see below)
│  ─────────────────────────────────────────── │   ← subtle divider
│  PIPELINE       [Create ✓] [Fix] [Invest] [Plan] │  ← pill tabs
│  Plan → Build → Verify → Review → Test       │   ← pipeline description (text-xs muted)
│  ─────────────────────────────────────────── │
│  MODEL          [Sonnet 4.6 ▾]               │   ← compact dropdown
└──────────────────────────────────────────────┘
```

**Complexity 5-dot selector:**
Replace the dropdown with 5 clickable labeled dots in a row:

```
  ○ ─── ○ ─── ○ ─── ○ ─── ○
trivial small medium large epic
```

Selected dot is filled (`--accent-mauve`). Dots to the left of selection are filled too (cumulative fill like a progress bar). Label of selected value shows to the right, with a one-line description below it. This makes it instantly scannable and visually links complexity to "how much pipeline" is activated.

**Pipeline tabs:**
Pill-style tab group, same style as the `IdeaCard` complexity badge but as interactive tabs. Selecting a pipeline immediately updates the description text below, showing the exact steps.

The **visual connection** between Complexity and Pipeline: when complexity changes, the pipeline tab that is most appropriate gets a subtle highlight ring (not forced selection — just a hint). This signals the relationship without enforcing it.

**Model dropdown:**
Compact, same line as "MODEL" label. Options: Default (CLI default), Sonnet 4.6, Opus 4.6, Haiku 4.5. Use a small custom select styled with `--bg-base` background to match the rest.

---

### Group 3 — Where It Runs (always visible, collapsed by default only on `isNew`)

```
┌──────────────────────────────────────────────┐
│  WHERE IT RUNS            [▸ expand]         │
│                                              │
│  REPOS    [repo-1 ✓] [repo-2] [repo-3]       │   ← toggleable repo chips
│  ─────────────────────────────────────────── │
│  GIT      ◉ Git branch   ○ Worktree          │   ← radio group, not separate toggles
│           base: [master ▾]                   │   ← shown only when worktree selected
│  ─────────────────────────────────────────── │
│  AGENTS   ●●●● (1–4 parallel agents)         │   ← dot-picker (same style as complexity)
└──────────────────────────────────────────────┘
```

**Git options as a radio group:**
Instead of two separate boolean toggles (`useGitBranch`, `useWorktree`), present them as a three-way radio:
- `None` — no branch isolation
- `Git branch` — creates `epic/{id}` branch, same worktree
- `Worktree` — full worktree isolation (disables parallel > 1)

This maps to the same underlying data (`useGitBranch` + `useWorktree` booleans) but is clearer to the user.

---

### Group 4 — Description & Criteria (always visible)

```
Description
[textarea, grows with content, 3 row min]

Acceptance criteria
[textarea, grows with content, 3 row min]
```

Plain textareas, consistent `--bg-base` fill, `--border-subtle` border, `--border-standard` on focus. No fancy wrapper.

---

### Group 5 — Scheduling (collapsible, collapsed by default)

```
▾ SCHEDULING
  Priority    [●●●●○ medium]     ← same 5-dot selector style
  Run after   [epic title ▾]
  Depends on  [+ Add dependency]
```

Priority gets the same dot-picker treatment as Complexity for consistency.

---

## Action Zone (contextual, inside body, above footer)

The action zone appears between body and footer, in a visually distinct area using a `--border-standard` top separator. It changes based on `epic.column`:

### `column === 'review'`
```
┌──────────────────────────────────────────────┐
│  ✦ REVIEW NEEDED                             │   ← section header with amber accent
│  [feedback textarea, 3 rows]                 │
│                                              │
│  [✓ Approve]              [✗ Reject]         │   ← full-width split buttons
└──────────────────────────────────────────────┘
```
Approve = green accent, Reject = red accent. Both full-width halves of the same row.

### `column === 'in-progress'`
```
┌──────────────────────────────────────────────┐
│  ⬡ IN PROGRESS                               │   ← teal accent header
│  [Open Workspace ↗]  [⏸ Suspend]  [■ Stop]  │   ← three actions, equal width
└──────────────────────────────────────────────┘
```

### `column === 'done'` with branch
```
┌──────────────────────────────────────────────┐
│  ✔ DONE  · epic/{id}                         │   ← green accent, branch name
│  [↑ Create Pull Request]                     │   ← full-width button, accent-mauve
└──────────────────────────────────────────────┘
```

### `suspendedAt !== null`
```
┌──────────────────────────────────────────────┐
│  ⏸ SUSPENDED                                 │   ← yellow accent header
│  [▶ Resume]                                  │
└──────────────────────────────────────────────┘
```

**Key UX rule:** the action zone is never hidden — if no contextual action applies (e.g., `idea` column, new epic), the zone is simply absent. Do NOT render an empty section.

---

## Footer

```
┌──────────────────────────────────────────────┐
│  [Delete]                   [Save / Create]  │
└──────────────────────────────────────────────┘
```

- Delete: left-aligned, `text-sm text-muted`, shows red on hover. For new epics, this button is absent.
- Save/Create: right-aligned, `--accent-mauve` background, full-round button. Label is "Create" when `isNew`, "Save" otherwise.
- Footer uses `--bg-surface` with a `border-top: 1px solid --border-subtle` to separate from body scroll.

---

## UX Details

### Inline title editing

The title field should look like text at rest, not a form input. This matches the Fleet sidebar where agent titles are plain text until clicked. Use `border-transparent` + `bg-transparent` at rest, `border --border-standard` + `bg --bg-base` on focus.

### Complexity ↔ Pipeline visual hint

When the user changes complexity, briefly pulse the pipeline description text (opacity 0.4 → 1, 200ms). This draws the eye to show "this changed because of what you just did."

### Scroll behavior

The body scrolls independently. The header and footer are sticky. This is already the pattern — preserve it.

### Empty states

- Description and acceptance criteria: use `placeholder` text that reads as examples, not just "What should be built and why...". E.g., for description: `"Explain what to build and why it matters."` For criteria: `"List what must be true for this to be considered done."`

### Column badge in header

The header shows a small pill badge with the current column name (e.g., `● REVIEW` in amber, `● ACTIVE` in teal). This gives immediate context without needing to look at the board. Matches the status badge style used in `AgentCard`.

---

## Style Consistency Checklist

| Element | Pattern to match |
|---|---|
| Panel background | `--bg-surface` (same as KanbanView background) |
| Panel left border | `1px solid --border-standard` |
| Group cards (How/Where) | `--bg-raised`, `rounded-xl`, `p-4`, same as `ActiveCard` inner sections |
| Section labels | `text-xs uppercase tracking-wider text-muted` |
| Textareas | `bg: --bg-base`, `border: --border-subtle`, `focus: --border-standard` |
| Dot pickers | Filled dots = `--accent-mauve`, empty = `--bg-raised-hover` |
| Pipeline tabs | Pill style same as column status badges |
| Action zone separator | `border-top: 1px solid --border-standard` |
| Approve button | `--accent-green` background |
| Reject button | `--accent-red` background |
| PR button | `--accent-mauve` background |
| Footer | `--bg-surface` + `border-top: 1px solid --border-subtle` |

---

## What NOT to Change

- **All wiring to actions must remain intact.** `approve()`, `reject()`, `suspendEpic()`, `stopEpic()`, `resumeEpic()`, `createPR()`, `save()`, `remove()`, `moveEpic()` — same functions, same EventBus emissions, same store calls.
- **Props and emits interface** — `epicId`, `isNew`, `close`, `created` — unchanged.
- **Transitions** — the slide-in from right is correct, preserve it.
- **Column-based conditional rendering** — the logic that shows/hides action zones based on `epic.column` must not be simplified away.

---

## Implementation Notes

- The redesign is **EpicDetailPanel.vue only**. No other files need to change except possibly scoped CSS tweaks in `main.css` if new utility classes are needed.
- The 5-dot picker for Complexity and Priority is a small reusable inline component (`DotPicker.vue`), used only within the panel. No need to make it a global shared component unless reuse is planned.
- The git radio group maps to: `None → useGitBranch=false, useWorktree=false`; `Git branch → useGitBranch=true, useWorktree=false`; `Worktree → useGitBranch=true, useWorktree=true`.
- Parallel agents dot-picker: 1–4 dots. When `useWorktree=true` is selected, set `parallelAgentCount` max to 1 (disable the other dots with a tooltip: "Worktree mode requires single agent").
