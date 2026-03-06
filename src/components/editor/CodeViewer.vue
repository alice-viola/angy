<template>
  <div class="flex flex-col h-full bg-[var(--bg-base)]">
    <!-- Tab bar (hidden when no files open) -->
    <div v-if="tabs.length > 0"
         class="flex items-center border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-x-auto">
      <div v-for="tab in tabs" :key="tab.filePath"
           class="group tab flex items-center gap-1 px-3 py-1.5 text-xs cursor-pointer border-r border-[var(--border-subtle)] whitespace-nowrap select-none"
           :class="tab.filePath === activeFile ? 'bg-[var(--bg-base)] text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'"
           @click="selectTab(tab.filePath)"
           @auxclick.middle="closeTab(tab.filePath)">
        <span>{{ tab.dirty ? '● ' : '' }}{{ fileName(tab.filePath) }}</span>
        <span @click.stop="closeTab(tab.filePath)"
              @mousedown.prevent
              class="ml-1 opacity-0 group-hover:opacity-100 hover:text-[var(--accent-red)] cursor-pointer transition-opacity">×</span>
      </div>
    </div>

    <!-- Breadcrumb bar -->
    <div v-if="activeFile" class="flex items-center border-b border-[var(--border-subtle)]">
      <BreadcrumbBar :filePath="activeFile" :rootPath="rootPath" class="flex-1" />
      <button
        v-if="isMarkdownFile"
        @click="markdownPreview = !markdownPreview"
        class="px-2 py-1 mr-2 text-xs rounded transition-colors"
        :class="markdownPreview
          ? 'bg-[var(--accent-mauve)] text-[var(--bg-base)]'
          : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-raised)]'"
        :title="markdownPreview ? 'Show code' : 'Preview markdown'"
      >
        {{ markdownPreview ? 'Code' : 'Preview' }}
      </button>
    </div>

    <!-- Markdown preview -->
    <div v-show="markdownPreview && isMarkdownFile" class="markdown-preview flex-1 overflow-y-auto">
      <div class="message-content" v-html="markdownHtml"></div>
    </div>

    <!-- Editor container -->
    <div v-show="!(markdownPreview && isMarkdownFile)" ref="editorContainer" class="flex-1 relative">
      <!-- Empty state when no files -->
      <div v-if="tabs.length === 0"
           class="flex flex-col items-center justify-center h-full">
        <div class="text-3xl mb-3 opacity-30">📄</div>
        <div class="text-sm text-[var(--text-muted)]">No file open</div>
        <div class="text-xs text-[var(--text-faint)] mt-1">Click a file in the Effects panel to view it</div>
      </div>
    </div>

    <!-- Inline edit bar (Cmd+K) -->
    <InlineEditBar v-if="showInlineEdit" ref="inlineEditBar"
      :filePath="activeFile" :selectedCode="selectedCode"
      :startLine="selectionStart" :endLine="selectionEnd"
      @submitted="onInlineEditSubmit"
      @cancelled="showInlineEdit = false"
      @accept-all="onAcceptAll"
      @reject-all="onRejectAll" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, onUnmounted, nextTick, shallowRef, markRaw } from 'vue';
import * as monaco from 'monaco-editor';
import MarkdownIt from 'markdown-it';
import type { FileDiff } from '../../engine/types';
import BreadcrumbBar from './BreadcrumbBar.vue';
import InlineEditBar from './InlineEditBar.vue';
import { getMonacoTheme, detectLanguage } from './monacoSetup';
import { useEditorStore } from '../../stores/editor';

const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

// ── Emits ─────────────────────────────────────────────────────────────────

const emit = defineEmits<{
  'file-saved': [filePath: string];
  'dirty-changed': [filePath: string, dirty: boolean];
  'inline-edit-submitted': [filePath: string, selectedCode: string, instruction: string, startLine: number, endLine: number, modelId: string];
  'inline-diff-accepted': [filePath: string];
  'inline-diff-rejected': [filePath: string];
}>();

// ── Types ─────────────────────────────────────────────────────────────────

interface EditorTab {
  filePath: string;
  dirty: boolean;
  model: monaco.editor.ITextModel | null;
  viewState: monaco.editor.ICodeEditorViewState | null;
}

// ── State ─────────────────────────────────────────────────────────────────

const tabs = ref<EditorTab[]>([]);
const activeFile = ref('');
const rootPath = ref('');
const showInlineEdit = ref(false);
const selectedCode = ref('');
const selectionStart = ref(0);
const selectionEnd = ref(0);
const editorContainer = ref<HTMLDivElement | null>(null);
const inlineEditBar = ref<InstanceType<typeof InlineEditBar> | null>(null);

const editorStore = useEditorStore();

// Markdown preview state
const markdownPreview = ref(false);
const isMarkdownFile = computed(() => {
  const f = activeFile.value;
  return f.endsWith('.md') || f.endsWith('.mdx') || f.endsWith('.markdown');
});
const fileContent = computed(() => {
  const tab = findTab(activeFile.value);
  return tab?.model?.getValue() ?? '';
});
const markdownHtml = computed(() => {
  if (!isMarkdownFile.value || !markdownPreview.value) return '';
  return md.render(fileContent.value);
});

let editor: monaco.editor.IStandaloneCodeEditor | null = null;
let mounted = true;
const diffDecorationIds = shallowRef<string[]>([]);

// Streaming edit state
let streamingFile = '';
let streamingStartLine = 0;

// ── Monaco Setup ──────────────────────────────────────────────────────────

onMounted(async () => {
  monaco.editor.defineTheme('angy-dark', getMonacoTheme());

  // Restore tabs from previous session if any were saved
  if (editorStore.savedTabs.length > 0) {
    for (const saved of editorStore.savedTabs) {
      if (!mounted) return;
      await loadFile(saved.filePath);

      // Restore dirty content and cursor/scroll positions
      const tab = findTab(saved.filePath);
      if (tab) {
        if (saved.dirty && saved.content && tab.model) {
          tab.model.setValue(saved.content);
          tab.dirty = true;
        }
        if (editor) {
          editor.setPosition({ lineNumber: saved.cursorLine, column: saved.cursorColumn });
          editor.setScrollPosition({ scrollTop: saved.scrollTop, scrollLeft: saved.scrollLeft });
        }
      }
    }
    if (!mounted) return;
    if (editorStore.savedActiveFile) {
      selectTab(editorStore.savedActiveFile);
    }
    editorStore.clearTabs();
  }
});

onBeforeUnmount(() => {
  mounted = false;
  saveViewState();
  const serializedTabs = tabs.value.map(tab => ({
    filePath: tab.filePath,
    dirty: tab.dirty,
    cursorLine: tab.viewState?.cursorState?.[0]?.position?.lineNumber ?? 1,
    cursorColumn: tab.viewState?.cursorState?.[0]?.position?.column ?? 1,
    scrollTop: tab.viewState?.viewState?.scrollTop ?? 0,
    scrollLeft: tab.viewState?.viewState?.scrollLeft ?? 0,
    ...(tab.dirty && tab.model ? { content: tab.model.getValue() } : {}),
  }));
  editorStore.saveTabs(serializedTabs, activeFile.value);
});

onUnmounted(() => {
  editor?.dispose();
  for (const tab of tabs.value) {
    tab.model?.dispose();
  }
});

function createEditor() {
  if (!editorContainer.value || editor) return;

  editor = monaco.editor.create(editorContainer.value, {
    theme: 'angy-dark',
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 13,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderLineHighlight: 'line',
    lineNumbers: 'on',
    wordWrap: 'off',
    tabSize: 2,
    automaticLayout: true,
    padding: { top: 8 },
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    bracketPairColorization: { enabled: true },
  });

  // Keybindings
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    saveCurrentFile();
  });

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => {
    showInlineEditBarFn();
  });

  // Track dirty state on model content changes
  editor.onDidChangeModelContent(() => {
    const tab = findTab(activeFile.value);
    if (tab && !tab.dirty) {
      tab.dirty = true;
      emit('dirty-changed', tab.filePath, true);
    }
  });
}

// ── Tab Management ────────────────────────────────────────────────────────

function findTab(filePath: string): EditorTab | undefined {
  return tabs.value.find(t => t.filePath === filePath);
}

function fileName(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}

function selectTab(filePath: string) {
  if (filePath === activeFile.value) return;

  // Save viewState of current tab
  saveViewState();

  activeFile.value = filePath;
  const tab = findTab(filePath);
  if (tab && editor) {
    if (tab.model) {
      editor.setModel(tab.model);
    }
    if (tab.viewState) {
      editor.restoreViewState(tab.viewState);
    }
  }
}

function closeTab(filePath?: string) {
  const target = filePath ?? activeFile.value;
  if (!target) return;

  const idx = tabs.value.findIndex(t => t.filePath === target);
  if (idx < 0) return;

  const tab = tabs.value[idx];
  const wasActive = activeFile.value === target;
  const modelToDispose = tab.model;

  // Switch editor model FIRST — before any reactive changes that trigger
  // Vue re-render.
  if (wasActive && editor) {
    const remaining = tabs.value.filter(t => t.filePath !== target);
    if (remaining.length > 0) {
      const newIdx = Math.min(idx, remaining.length - 1);
      const newTab = remaining[newIdx];
      if (newTab.model) {
        editor.setModel(newTab.model);
        if (newTab.viewState) editor.restoreViewState(newTab.viewState);
      } else {
        editor.setModel(null);
      }
      activeFile.value = newTab.filePath;
    } else {
      editor.setModel(null);
      activeFile.value = '';
    }
  }

  // Now update reactive state — Vue re-render is safe because editor
  // is already consistent with the new model.
  tab.model = null;
  tabs.value.splice(idx, 1);

  if (tabs.value.length === 0) {
    editor?.dispose();
    editor = null;
  }

  // Dispose old model after the frame settles
  if (modelToDispose) {
    requestAnimationFrame(() => modelToDispose.dispose());
  }
}

function saveViewState() {
  if (!editor || !activeFile.value) return;
  const tab = findTab(activeFile.value);
  if (tab) {
    const vs = editor.saveViewState();
    tab.viewState = vs ? markRaw(vs) : null;
  }
}

// ── File Operations ───────────────────────────────────────────────────────

async function loadFile(filePath: string) {
  // If tab already exists, switch to it
  const existing = findTab(filePath);
  if (existing) {
    selectTab(filePath);
    return;
  }

  // Read file content via Tauri fs API
  let content = '';
  try {
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    content = await readTextFile(filePath);
  } catch {
    content = `// Could not read file: ${filePath}`;
  }

  const lang = detectLanguage(filePath);
  const model = markRaw(monaco.editor.createModel(content, lang, monaco.Uri.file(filePath)));

  const tab: EditorTab = {
    filePath,
    dirty: false,
    model,
    viewState: null,
  };

  // Save current tab's viewState before switching
  saveViewState();

  tabs.value.push(tab);
  activeFile.value = filePath;

  // Ensure editor exists
  if (!editor) {
    await nextTick();
    createEditor();
  }

  if (editor) {
    editor.setModel(model);
  }
}

async function refreshFile(filePath?: string) {
  const target = filePath ?? activeFile.value;
  if (!target) return;

  const tab = findTab(target);
  if (!tab || !tab.model) return;

  try {
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const content = await readTextFile(target);
    tab.model.setValue(content);
    tab.dirty = false;
    emit('dirty-changed', target, false);
  } catch {
    // Silently fail — file may have been deleted
  }
}

async function saveCurrentFile(): Promise<boolean> {
  if (!activeFile.value || !editor) return false;

  const tab = findTab(activeFile.value);
  if (!tab || !tab.model) return false;

  try {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(activeFile.value, tab.model.getValue());
    tab.dirty = false;
    emit('dirty-changed', activeFile.value, false);
    emit('file-saved', activeFile.value);
    return true;
  } catch {
    return false;
  }
}

function closeFile(filePath?: string) {
  closeTab(filePath);
}

// ── Diff Decorations ──────────────────────────────────────────────────────

function showDiff(diff: FileDiff) {
  if (!editor) return;
  clearDiffMarkers();

  const decorations: monaco.editor.IModelDeltaDecoration[] = [];

  for (const hunk of diff.hunks) {
    for (let i = 0; i < hunk.lines.length; i++) {
      const line = hunk.lines[i];
      if (line.type === 'add') {
        const lineNum = hunk.newStart + i + 1;
        decorations.push({
          range: new monaco.Range(lineNum, 1, lineNum, 1),
          options: {
            isWholeLine: true,
            className: 'diff-added-line',
            linesDecorationsClassName: 'diff-added-gutter',
          },
        });
      } else if (line.type === 'remove') {
        const lineNum = hunk.oldStart + i + 1;
        decorations.push({
          range: new monaco.Range(lineNum, 1, lineNum, 1),
          options: {
            isWholeLine: true,
            className: 'diff-removed-line',
            linesDecorationsClassName: 'diff-removed-gutter',
          },
        });
      }
    }
  }

  diffDecorationIds.value = editor.deltaDecorations([], decorations);
}

function clearDiffMarkers() {
  if (!editor || diffDecorationIds.value.length === 0) return;
  editor.deltaDecorations(diffDecorationIds.value, []);
  diffDecorationIds.value = [];
}

// ── Inline Diff ───────────────────────────────────────────────────────────

function showInlineDiff(_oldText: string, _newText: string, _startLine: number) {
  // Inline diff overlay using Monaco decorations
  // Future: show old text with strikethrough/red and new text with green
}

// ── Streaming Edit ────────────────────────────────────────────────────────

function beginStreamingEdit(filePath: string, startLine: number) {
  streamingFile = filePath;
  streamingStartLine = startLine;

  const tab = findTab(filePath);
  if (tab) selectTab(filePath);
}

function appendStreamingContent(content: string) {
  if (!editor || !streamingFile) return;

  const model = editor.getModel();
  if (!model) return;

  const lineCount = model.getLineCount();
  const insertLine = Math.min(streamingStartLine, lineCount);
  const col = model.getLineMaxColumn(insertLine);

  editor.executeEdits('streaming', [{
    range: new monaco.Range(insertLine, col, insertLine, col),
    text: content,
  }]);
}

function finalizeStreamingEdit() {
  streamingFile = '';
}

// ── Inline Edit Bar (Cmd+K) ──────────────────────────────────────────────

function showInlineEditBarFn() {
  if (!editor) return;

  const selection = editor.getSelection();
  if (selection && !selection.isEmpty()) {
    selectedCode.value = editor.getModel()?.getValueInRange(selection) ?? '';
    selectionStart.value = selection.startLineNumber;
    selectionEnd.value = selection.endLineNumber;
  } else {
    const pos = editor.getPosition();
    selectedCode.value = '';
    selectionStart.value = pos?.lineNumber ?? 1;
    selectionEnd.value = pos?.lineNumber ?? 1;
  }

  showInlineEdit.value = true;
  nextTick(() => inlineEditBar.value?.focusInput());
}

function onInlineEditSubmit(filePath: string, code: string, instruction: string, startLine: number, endLine: number, modelId: string) {
  emit('inline-edit-submitted', filePath, code, instruction, startLine, endLine, modelId);
  inlineEditBar.value?.setProcessing();
}

function onAcceptAll(filePath: string) {
  showInlineEdit.value = false;
  emit('inline-diff-accepted', filePath);
}

function onRejectAll(filePath: string) {
  showInlineEdit.value = false;
  emit('inline-diff-rejected', filePath);
}

// ── Query Methods ─────────────────────────────────────────────────────────

function currentFilePath(): string {
  return activeFile.value;
}

function selectedTextFn(): string {
  if (!editor) return '';
  const sel = editor.getSelection();
  if (!sel) return '';
  return editor.getModel()?.getValueInRange(sel) ?? '';
}

function openFilesList(): string[] {
  return tabs.value.map(t => t.filePath);
}

function setRootPath(path: string) {
  rootPath.value = path;
}

// ── Expose ────────────────────────────────────────────────────────────────

defineExpose({
  loadFile,
  closeFile,
  refreshFile,
  showDiff,
  clearDiffMarkers,
  showInlineDiff,
  beginStreamingEdit,
  appendStreamingContent,
  finalizeStreamingEdit,
  showInlineEditBar: showInlineEditBarFn,
  saveCurrentFile,
  currentFile: currentFilePath,
  selectedText: selectedTextFn,
  openFiles: openFilesList,
  setRootPath,
});
</script>

<style>
/* Diff decoration styles for Monaco */
.diff-added-line {
  background: rgba(166, 227, 161, 0.1);
}
.diff-added-gutter {
  border-left: 3px solid rgba(166, 227, 161, 0.6);
}
.diff-removed-line {
  background: rgba(243, 139, 168, 0.1);
}
.diff-removed-gutter {
  border-left: 3px solid rgba(243, 139, 168, 0.6);
}

/* Markdown preview */
.markdown-preview {
  padding: 16px 24px;
  color: var(--text-primary);
}
.markdown-preview .message-content {
  font-size: 13px;
  line-height: 1.65;
  max-width: 800px;
}
.markdown-preview .message-content p { margin-bottom: 0.65em; }
.markdown-preview .message-content p:last-child { margin-bottom: 0; }
.markdown-preview .message-content h1,
.markdown-preview .message-content h2,
.markdown-preview .message-content h3,
.markdown-preview .message-content h4,
.markdown-preview .message-content h5,
.markdown-preview .message-content h6 {
  font-weight: 600;
  line-height: 1.3;
  margin-top: 1em;
  margin-bottom: 0.35em;
}
.markdown-preview .message-content h1 { font-size: 1.3em; color: var(--text-primary); }
.markdown-preview .message-content h2 { font-size: 1.15em; color: var(--accent-mauve); }
.markdown-preview .message-content h3 { font-size: 1.05em; color: var(--text-primary); }
.markdown-preview .message-content strong { font-weight: 600; color: var(--text-primary); }
.markdown-preview .message-content em { font-style: italic; color: var(--text-secondary); }
.markdown-preview .message-content :not(pre) > code {
  font-family: var(--font-mono);
  font-size: 0.87em;
  background: var(--bg-raised);
  padding: 1px 5px;
  border-radius: 4px;
}
.markdown-preview .message-content pre {
  background: var(--bg-base);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  padding: 12px 16px;
  overflow-x: auto;
  margin: 8px 0;
  line-height: 1.55;
}
.markdown-preview .message-content pre code {
  font-family: var(--font-mono);
  font-size: 12px;
}
.markdown-preview .message-content ul,
.markdown-preview .message-content ol {
  padding-left: 1.5em;
  margin: 0.4em 0 0.65em;
}
.markdown-preview .message-content li { margin: 0.25em 0; line-height: 1.55; }
.markdown-preview .message-content ul > li { list-style-type: disc; }
.markdown-preview .message-content ol > li { list-style-type: decimal; }
.markdown-preview .message-content blockquote {
  border-left: 3px solid var(--accent-mauve);
  padding: 4px 12px;
  margin: 8px 0;
  color: var(--text-secondary);
}
.markdown-preview .message-content hr {
  border: none;
  border-top: 1px solid var(--border-subtle);
  margin: 12px 0;
}
.markdown-preview .message-content table {
  border-collapse: collapse;
  margin: 10px 0;
  width: 100%;
  font-size: 12px;
}
.markdown-preview .message-content th,
.markdown-preview .message-content td {
  border: 1px solid var(--border-standard);
  padding: 5px 10px;
  text-align: left;
}
.markdown-preview .message-content th {
  background: var(--bg-raised);
  font-weight: 600;
}
.markdown-preview .message-content a {
  color: var(--accent-blue);
  text-decoration: none;
}
.markdown-preview .message-content a:hover {
  text-decoration: underline;
}
</style>
