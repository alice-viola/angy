<template>
  <div class="flex flex-col h-full">
    <!-- Header -->
    <div class="flex items-center justify-between px-3 py-1.5 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)]">
      <div class="flex gap-4 text-xs">
        <span class="text-[var(--accent-red)]">{{ leftLabel }}</span>
        <span class="text-[var(--text-faint)]">→</span>
        <span class="text-[var(--accent-green)]">{{ rightLabel }}</span>
      </div>
      <div class="flex gap-1">
        <button @click="prevHunk"
                class="text-xs px-2 py-0.5 rounded bg-[var(--bg-raised)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
          ↑ Prev
        </button>
        <button @click="nextHunk"
                class="text-xs px-2 py-0.5 rounded bg-[var(--bg-raised)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
          ↓ Next
        </button>
        <button @click="$emit('close')"
                class="text-xs px-2 py-0.5 rounded bg-[var(--bg-raised)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
          ✕
        </button>
      </div>
    </div>
    <!-- Diff editor container -->
    <div ref="diffContainer" class="flex-1"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import * as monaco from 'monaco-editor';
import { getMonacoTheme, detectLanguage } from './monacoSetup';

// ── Props & Emits ─────────────────────────────────────────────────────────

const props = withDefaults(defineProps<{
  filePath: string;
  oldContent: string;
  newContent: string;
  leftLabel?: string;
  rightLabel?: string;
}>(), {
  leftLabel: 'HEAD',
  rightLabel: 'Working Tree',
});

defineEmits<{
  close: [];
}>();

// ── State ─────────────────────────────────────────────────────────────────

const diffContainer = ref<HTMLDivElement | null>(null);
let diffEditor: monaco.editor.IStandaloneDiffEditor | null = null;
let originalModel: monaco.editor.ITextModel | null = null;
let modifiedModel: monaco.editor.ITextModel | null = null;
let currentHunkIdx = -1;
let pendingDiffDisposable: monaco.IDisposable | null = null;

// ── Lifecycle ─────────────────────────────────────────────────────────────

onMounted(() => {
  if (!diffContainer.value) return;

  // Ensure theme is registered
  monaco.editor.defineTheme('angy-dark', getMonacoTheme());

  diffEditor = monaco.editor.createDiffEditor(diffContainer.value, {
    theme: 'angy-dark',
    readOnly: true,
    renderSideBySide: true,
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 13,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderOverviewRuler: true,
    automaticLayout: true,
  });

  setModels();
});

onUnmounted(() => {
  pendingDiffDisposable?.dispose();
  pendingDiffDisposable = null;
  diffEditor?.dispose();
  originalModel?.dispose();
  modifiedModel?.dispose();
});

// ── Watch props to update models ──────────────────────────────────────────

watch(() => [props.oldContent, props.newContent, props.filePath], () => {
  setModels();
});

function setModels() {
  if (!diffEditor) return;

  const lang = detectLanguage(props.filePath);

  originalModel?.dispose();
  modifiedModel?.dispose();

  originalModel = monaco.editor.createModel(props.oldContent, lang);
  modifiedModel = monaco.editor.createModel(props.newContent, lang);

  diffEditor.setModel({
    original: originalModel,
    modified: modifiedModel,
  });

  currentHunkIdx = -1;

  // Auto-scroll to first change once Monaco finishes computing the diff
  waitForDiffAndJump();
}

function waitForDiffAndJump() {
  if (!diffEditor) return;
  pendingDiffDisposable?.dispose();
  pendingDiffDisposable = diffEditor.onDidUpdateDiff(() => {
    pendingDiffDisposable?.dispose();
    pendingDiffDisposable = null;
    const changes = getLineChanges();
    if (changes.length > 0) {
      currentHunkIdx = 0;
      const line = changes[0].modifiedStartLineNumber;
      diffEditor?.getModifiedEditor().revealLineInCenter(line);
    }
  });
}

// ── Hunk navigation ───────────────────────────────────────────────────────

function getLineChanges(): monaco.editor.ILineChange[] {
  if (!diffEditor) return [];
  return diffEditor.getLineChanges() ?? [];
}

function nextHunk() {
  const changes = getLineChanges();
  if (changes.length === 0) return;

  currentHunkIdx = Math.min(currentHunkIdx + 1, changes.length - 1);
  const change = changes[currentHunkIdx];
  const line = change.modifiedStartLineNumber;
  diffEditor?.getModifiedEditor().revealLineInCenter(line);
}

function prevHunk() {
  const changes = getLineChanges();
  if (changes.length === 0) return;

  currentHunkIdx = Math.max(currentHunkIdx - 1, 0);
  const change = changes[currentHunkIdx];
  const line = change.modifiedStartLineNumber;
  diffEditor?.getModifiedEditor().revealLineInCenter(line);
}

// ── Expose ────────────────────────────────────────────────────────────────

defineExpose({ nextHunk, prevHunk });
</script>
