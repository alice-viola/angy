<template>
  <div class="flex flex-col h-full bg-[var(--bg-base)]">
    <!-- Header -->
    <div class="flex items-center justify-between px-3 h-11 bg-[var(--bg-base)]">
      <span class="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Effects</span>
      <button
        @click="toggleScope"
        class="text-[10px] px-2 py-0.5 rounded bg-[var(--bg-raised)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] border border-[var(--border-subtle)] transition-colors"
      >
        {{ scope }}
      </button>
    </div>

    <!-- Stats bar -->
    <div v-if="fileCount > 0" class="px-3 py-1 text-[11px] text-[var(--text-muted)]">
      {{ fileCount }} file{{ fileCount !== 1 ? 's' : '' }}
      <span v-if="totalAdded > 0" class="text-[var(--accent-green)] font-semibold"> +{{ totalAdded }}</span>
      <span v-if="totalRemoved > 0" class="text-[var(--accent-red)] font-semibold"> -{{ totalRemoved }}</span>
    </div>

    <!-- File list or empty state -->
    <div class="flex-1 overflow-y-auto">
      <div
        v-if="groupedChanges.length === 0"
        class="flex flex-col items-center justify-center h-full text-center px-6"
      >
        <div class="w-6 h-6 mb-2 opacity-30 mx-auto">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-[var(--text-muted)]">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
            <path d="M14 2v6h6" />
          </svg>
        </div>
        <div class="text-[11px] text-[var(--text-muted)]">No changes yet</div>
        <div class="text-[10px] text-[var(--text-faint)] mt-1">File edits will appear as your agent works</div>
        <SectionTip tipId="effects-intro" title="Effects" icon="📝" class="mt-3 w-full">
          This panel tracks every file your agents create or modify. Use the toggle to see changes from one agent or all agents. Click a file to open it in the editor.
        </SectionTip>
      </div>
      <template v-else>
        <template v-for="group in groupedChanges" :key="group.turnId">
          <TurnDivider
            :turn-id="group.turnId"
            :highlighted="group.turnId === highlightedTurn"
            :relative-time="formatRelativeTime(group.turnId)"
            @click="$emit('turn-clicked', $event)"
          />
          <FileChangeItem
            v-for="change in group.files"
            :key="change.filePath"
            :change="change"
            :root-path="rootPath"
            @click="$emit('file-clicked', $event)"
            @diff-requested="$emit('diff-requested', $event)"
          />
        </template>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { FileChange } from '../../engine/types';
import { useSessionsStore } from '../../stores/sessions';
import FileChangeItem from './FileChangeItem.vue';
import TurnDivider from './TurnDivider.vue';
import SectionTip from '../common/SectionTip.vue';

// ── Props & Emits ────────────────────────────────────────────────────────

defineEmits<{
  'file-clicked': [filePath: string];
  'diff-requested': [filePath: string];
  'turn-clicked': [turnId: number];
}>();

// ── State ────────────────────────────────────────────────────────────────

const sessionsStore = useSessionsStore();
const scope = ref<'Session' | 'All'>('Session');
const rootPath = ref('');
const currentSessionId = ref('');
const highlightedTurn = ref(-1);

// Keep currentSessionId in sync with the sessions store
watch(() => sessionsStore.activeSessionId, (newId) => {
  if (newId) currentSessionId.value = newId;
}, { immediate: true });

// sessionId -> turnId -> filePath -> FileChange
const sessionChanges = ref(new Map<string, Map<number, Map<string, FileChange>>>());
const turnTimestamps = ref(new Map<number, number>());

// ── Public API (exposed to parent) ──────────────────────────────────────

function setRootPath(path: string) {
  rootPath.value = path;
}

function setCurrentSession(sessionId: string) {
  currentSessionId.value = sessionId;
}

function setHighlightedTurn(turnId: number) {
  highlightedTurn.value = turnId;
}

function setTurnTimestamps(timestamps: Map<number, number>) {
  turnTimestamps.value = timestamps;
}

function onFileChanged(filePath: string, change: FileChange & { sessionId?: string; turnId?: number }) {
  const sid = change.sessionId || currentSessionId.value;
  const turn = change.turnId ?? 0;

  let sessionMap = sessionChanges.value.get(sid);
  if (!sessionMap) {
    sessionMap = new Map();
    sessionChanges.value.set(sid, sessionMap);
  }

  let turnMap = sessionMap.get(turn);
  if (!turnMap) {
    turnMap = new Map();
    sessionMap.set(turn, turnMap);
  }

  turnMap.set(filePath, change);

  // Force reactivity
  sessionChanges.value = new Map(sessionChanges.value);
}

function populateFromHistory(sessionId: string, changes: (FileChange & { turnId?: number })[]) {
  for (const change of changes) {
    const turn = change.turnId ?? 0;

    let sessionMap = sessionChanges.value.get(sessionId);
    if (!sessionMap) {
      sessionMap = new Map();
      sessionChanges.value.set(sessionId, sessionMap);
    }

    let turnMap = sessionMap.get(turn);
    if (!turnMap) {
      turnMap = new Map();
      sessionMap.set(turn, turnMap);
    }

    turnMap.set(change.filePath, change);
  }

  // Force reactivity
  sessionChanges.value = new Map(sessionChanges.value);
}

function hasChangesForSession(sessionId: string): boolean {
  const sessionMap = sessionChanges.value.get(sessionId);
  if (!sessionMap) return false;
  for (const turnMap of sessionMap.values()) {
    if (turnMap.size > 0) return true;
  }
  return false;
}

function clear() {
  sessionChanges.value = new Map();
  turnTimestamps.value = new Map();
  highlightedTurn.value = -1;
}

function toggleScope() {
  scope.value = scope.value === 'Session' ? 'All' : 'Session';
}

// ── Computed ─────────────────────────────────────────────────────────────

interface ChangeGroup {
  turnId: number;
  files: FileChange[];
}

const visibleChanges = computed(() => {
  const entries: { turnId: number; filePath: string; change: FileChange }[] = [];

  const collectSession = (sid: string) => {
    const sessionMap = sessionChanges.value.get(sid);
    if (!sessionMap) return;
    for (const [turnId, turnMap] of sessionMap) {
      for (const [filePath, change] of turnMap) {
        entries.push({ turnId, filePath, change });
      }
    }
  };

  if (scope.value === 'All') {
    for (const sid of sessionChanges.value.keys()) {
      collectSession(sid);
    }
  } else {
    collectSession(currentSessionId.value);
  }

  return entries;
});

const groupedChanges = computed<ChangeGroup[]>(() => {
  const entries = visibleChanges.value;

  // Sort by turnId ascending, then filePath
  const sorted = [...entries].sort((a, b) => {
    if (a.turnId !== b.turnId) return a.turnId - b.turnId;
    return a.filePath.localeCompare(b.filePath);
  });

  // Group by turnId
  const groups: ChangeGroup[] = [];
  let lastTurnId = -1;

  for (const entry of sorted) {
    if (entry.turnId !== lastTurnId) {
      groups.push({ turnId: entry.turnId, files: [] });
      lastTurnId = entry.turnId;
    }
    groups[groups.length - 1].files.push(entry.change);
  }

  return groups;
});

const fileCount = computed(() => {
  const unique = new Set<string>();
  for (const entry of visibleChanges.value) {
    unique.add(entry.filePath);
  }
  return unique.size;
});

const totalAdded = computed(() => {
  let sum = 0;
  for (const entry of visibleChanges.value) {
    sum += entry.change.linesAdded;
  }
  return sum;
});

const totalRemoved = computed(() => {
  let sum = 0;
  for (const entry of visibleChanges.value) {
    sum += entry.change.linesRemoved;
  }
  return sum;
});

// ── Helpers ──────────────────────────────────────────────────────────────

function formatRelativeTime(turnId: number): string | undefined {
  if (highlightedTurn.value <= 0) return undefined;
  const refTs = turnTimestamps.value.get(highlightedTurn.value);
  const turnTs = turnTimestamps.value.get(turnId);
  if (!refTs || !turnTs || refTs === turnTs) return undefined;

  const diff = turnTs - refTs;
  const absDiff = Math.abs(diff);
  const sign = diff >= 0 ? '+' : '\u2212';

  if (absDiff < 60) return `${sign}${absDiff}s`;
  if (absDiff < 3600) return `${sign}${Math.floor(absDiff / 60)} min`;
  if (absDiff < 86400) return `${sign}${Math.floor(absDiff / 3600)}h ${Math.floor((absDiff % 3600) / 60)}m`;
  return `${sign}${Math.floor(absDiff / 86400)}d`;
}

// ── Expose ───────────────────────────────────────────────────────────────

defineExpose({
  setRootPath,
  setCurrentSession,
  setHighlightedTurn,
  setTurnTimestamps,
  onFileChanged,
  populateFromHistory,
  hasChangesForSession,
  clear,
});
</script>
