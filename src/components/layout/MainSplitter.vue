<template>
  <div class="h-full w-full flex flex-col bg-[var(--bg-base)] text-[var(--text-primary)]">
    <!-- Mission Control: full-screen graph dashboard -->
    <MissionControlView
      v-if="ui.viewMode === 'mission-control'"
      class="flex-1 !min-h-0"
      @exit-mission-control="$emit('exit-mission-control')"
      @filter-changed="$emit('mission-control-filter', $event)"
      @agent-selected="(nodeId: string) => emit('agent-selected', nodeId.startsWith('agent:') ? nodeId.slice(6) : nodeId)"
      @file-clicked="(path: string) => emit('file-clicked', path)"
      @turn-clicked="(turn: number) => emit('turn-clicked', turn)"
    />

    <!-- Main content area (all 5 panes always in DOM; hidden panes collapse to size 0) -->
    <Splitpanes v-else class="flex-1 !min-h-0">
      <!-- Panel 0: Agent Fleet (Manager only) -->
      <Pane :size="panelSizes[0]" :min-size="inManager ? 15 : 0" :max-size="inManager ? 25 : 0">
        <AgentFleetPanel
          v-if="inManager"
          @agent-selected="(sid: string) => $emit('agent-selected', sid)"
          @new-agent-requested="$emit('new-chat')"
          @delete-requested="(sid: string) => $emit('delete-agent', sid)"
          @rename-requested="(sid: string, title: string) => $emit('rename-agent', sid, title)"
          @favorite-toggled="(sid: string) => $emit('favorite-toggled', sid)"
          @delete-all-requested="$emit('delete-all')"
          @delete-older-requested="$emit('delete-older')"
          @keep-today-requested="$emit('keep-today')"
        />
      </Pane>

      <!-- Panel 1: Left Tabs (Editor only) -->
      <Pane :size="panelSizes[1]" :min-size="inEditor ? 10 : 0" :max-size="inEditor ? 25 : 0">
        <div v-if="inEditor" class="h-full flex flex-col bg-[var(--bg-base)]">
          <!-- Header with back button + compact tab switcher -->
          <div class="flex items-center justify-between px-3 h-11 border-b border-[var(--border-subtle)]">
            <button
              @click="$emit('toggle-view')"
              class="flex items-center gap-1.5 text-[11px] text-[var(--accent-teal)] hover:text-[var(--text-primary)] transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M8 2L4 6L8 10" />
              </svg>
              AGM
            </button>
            <div class="flex border rounded border-[var(--border-subtle)] overflow-hidden">
              <button
                v-for="tab in leftTabs"
                :key="tab.id"
                @click="ui.activeLeftTab = tab.id"
                class="text-[10px] px-2 py-0.5 transition-colors"
                :class="ui.activeLeftTab === tab.id
                  ? 'text-[var(--text-primary)] bg-[var(--bg-raised)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'"
              >
                {{ tab.label }}
              </button>
            </div>
          </div>
          <div class="flex-1 overflow-hidden">
            <WorkspaceTree v-if="ui.activeLeftTab === 'files'"
              :rootPath="ui.workspacePath"
              :gitEntries="git.entries"
              @file-selected="(p: string) => emit('file-clicked', p)"
              @file-deleted="(p: string) => emit('file-deleted', p)" />
            <GitPanel v-else-if="ui.activeLeftTab === 'git'"
              @file-clicked="(p: string) => emit('file-clicked', p)" />
            <SearchPanel v-else-if="ui.activeLeftTab === 'search'"
              :workspacePath="ui.workspacePath"
              @file-selected="(p: string) => emit('file-clicked', p)" />
          </div>
        </div>
      </Pane>

      <!-- Panel 2: Center (CodeViewer / DiffSplitView / Manager inline preview) -->
      <Pane :size="panelSizes[2]" :min-size="0" :max-size="showCodePane ? 100 : 0">
        <div v-if="showCodePane" class="h-full flex flex-col">
          <!-- Back bar for inline preview / diff dismiss (Manager mode only) -->
          <div
            v-if="inManager && (ui.inlinePreviewFile || ui.diffView)"
            class="flex items-center h-8 px-3 border-b border-[var(--border-subtle)] bg-[var(--bg-window)] cursor-pointer"
            @click="closeCenterPane"
          >
            <span class="text-[11px] text-[var(--accent-teal)]">← Back to Chat</span>
            <span class="text-[11px] text-[var(--text-faint)] mx-2">·</span>
            <span class="text-[11px] text-[var(--text-primary)] font-medium">{{ previewFileName }}</span>
          </div>
          <!-- Git diff view -->
          <DiffSplitView
            v-if="ui.diffView"
            :filePath="ui.diffView.filePath"
            :oldContent="ui.diffView.oldContent"
            :newContent="ui.diffView.newContent"
            :leftLabel="ui.diffView.leftLabel"
            :rightLabel="ui.diffView.rightLabel"
            @close="ui.closeDiffView()"
          />
          <!-- Normal code viewer -->
          <template v-else>
            <slot name="code-viewer" />
          </template>
          <slot name="terminal" v-if="inEditor && ui.terminalVisible" />
        </div>
      </Pane>

      <!-- Panel 3: Chat Panel -->
      <Pane :size="panelSizes[3]" :min-size="chatPaneMin" :max-size="chatPaneMax">
        <div class="h-full">
          <slot name="chat" />
        </div>
      </Pane>

      <!-- Panel 4: Effects / Graph Panel (Manager only) -->
      <Pane :size="panelSizes[4]" :min-size="effectsPaneMin" :max-size="effectsPaneMax">
        <div v-show="inManager && ui.effectsPanelVisible" class="h-full flex flex-col">
          <!-- Tab switcher -->
          <div class="flex items-center px-3 h-8 border-b border-[var(--border-subtle)] bg-[var(--bg-window)]">
            <div class="flex border rounded border-[var(--border-subtle)] overflow-hidden">
              <button
                @click="ui.setRightPanelMode('effects')"
                class="text-[10px] px-2 py-0.5 transition-colors"
                :class="ui.rightPanelMode === 'effects'
                  ? 'text-[var(--text-primary)] bg-[var(--bg-raised)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'"
              >
                Effects
              </button>
              <button
                @click="ui.setRightPanelMode('graph')"
                class="text-[10px] px-2 py-0.5 transition-colors"
                :class="ui.rightPanelMode === 'graph'
                  ? 'text-[var(--text-primary)] bg-[var(--bg-raised)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'"
              >
                Graph
              </button>
            </div>
          </div>
          <!-- Content -->
          <div class="flex-1 min-h-0 overflow-hidden">
            <div v-show="ui.rightPanelMode === 'effects'" class="h-full">
              <slot name="effects" />
            </div>
            <AgentGraph
              v-show="ui.rightPanelMode === 'graph'"
              :nodes="graphStore.visibleNodes"
              :edges="graphStore.visibleEdges"
              :is-live="graphStore.isLive"
              :min-turn="graphStore.minTurn"
              :max-turn="graphStore.maxTurn"
              :vertical="true"
              @agent-selected="(nodeId: string) => emit('agent-selected', nodeId.startsWith('agent:') ? nodeId.slice(6) : nodeId)"
              @file-clicked="(path: string) => emit('file-clicked', path)"
              @turn-clicked="(turn: number) => emit('turn-clicked', turn)"
            />
          </div>
        </div>
      </Pane>
    </Splitpanes>

  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import { Splitpanes, Pane } from 'splitpanes';
import 'splitpanes/dist/splitpanes.css';
import { useUiStore } from '../../stores/ui';
import { useGitStore } from '../../stores/git';
import AgentFleetPanel from '../fleet/AgentFleetPanel.vue';
import WorkspaceTree from '../sidebar/WorkspaceTree.vue';
import GitPanel from '../sidebar/GitPanel.vue';
import SearchPanel from '../sidebar/SearchPanel.vue';
import AgentGraph from '../graph/AgentGraph.vue';
import MissionControlView from '../graph/MissionControlView.vue';
import DiffSplitView from '../editor/DiffSplitView.vue';
import { useGraphStore } from '../../stores/graph';

// ── Emits ─────────────────────────────────────────────────────────────────

const emit = defineEmits<{
  'agent-selected': [sessionId: string];
  'new-chat': [];
  'delete-agent': [sessionId: string];
  'rename-agent': [sessionId: string, newTitle: string];
  'favorite-toggled': [sessionId: string];
  'delete-all': [];
  'delete-older': [];
  'keep-today': [];
  'file-clicked': [filePath: string];
  'file-deleted': [filePath: string];
  'turn-clicked': [turnId: number];
  'toggle-view': [];
  'exit-mission-control': [];
  'mission-control-filter': [sessionId: string | null];
}>();

// ── Store ─────────────────────────────────────────────────────────────────

const ui = useUiStore();
const git = useGitStore();
const graphStore = useGraphStore();

// ── Computed ──────────────────────────────────────────────────────────────

const inManager = computed(() => ui.viewMode === 'agents');
const inEditor = computed(() => ui.viewMode === 'code');
const showCodePane = computed(() => inEditor.value || (inManager.value && (!!ui.inlinePreviewFile || !!ui.diffView)));

// Pane constraints — allow collapse when panel is toggled off
const effectsPaneMin = computed(() => (inManager.value && ui.effectsPanelVisible) ? 15 : 0);
const effectsPaneMax = computed(() => (inManager.value && ui.effectsPanelVisible) ? 30 : 0);
const chatPaneMin = computed(() => {
  if (inEditor.value && !ui.editorChatVisible) return 0;
  return 0; // no minimum in manager (inline preview can take it)
});
const chatPaneMax = computed(() => {
  if (inEditor.value && !ui.editorChatVisible) return 0;
  if (inManager.value && ui.inlinePreviewFile) return 0;
  return 100;
});

const previewFileName = computed(() => {
  const full = ui.diffView?.filePath ?? ui.inlinePreviewFile;
  if (!full) return '';
  return full.split('/').pop() ?? full;
});

function closeCenterPane() {
  ui.closeDiffView();
  ui.dismissInlinePreview();
}

const leftTabs = [
  { id: 'files' as const, label: 'Files' },
  { id: 'git' as const, label: 'Git' },
  { id: 'search' as const, label: 'Find' },
];

// Default sizes per mode (all 5 panes always present; hidden panes get size 0).
// Manager: [Fleet, 0, 0, Chat, Effects]   Editor: [0, LeftTabs, Center, Chat, 0]
const MANAGER_DEFAULTS      = [21, 0, 0, 58, 21];
const MANAGER_NO_EFFECTS    = [21, 0, 0, 79,  0];
const EDITOR_DEFAULTS       = [0, 21, 49, 30, 0];
const EDITOR_NO_CHAT        = [0, 21, 79,  0, 0];
const MANAGER_PREVIEW       = [21, 0, 58,  0, 21];

// Live pane sizes — initialized to defaults, updated by user drag.
const panelSizes = ref([...MANAGER_DEFAULTS]);

function computeDefaults(): number[] {
  if (ui.viewMode === 'agents') {
    if (ui.inlinePreviewFile || ui.diffView) return [...MANAGER_PREVIEW];
    return ui.effectsPanelVisible ? [...MANAGER_DEFAULTS] : [...MANAGER_NO_EFFECTS];
  }
  return ui.editorChatVisible ? [...EDITOR_DEFAULTS] : [...EDITOR_NO_CHAT];
}

// Reset to defaults when view mode or panel visibility changes.
// Dispatch resize event to force Splitpanes to re-read size props.
watch(
  [() => ui.viewMode, () => ui.effectsPanelVisible, () => ui.editorChatVisible, () => ui.inlinePreviewFile, () => ui.diffView],
  async () => {
    panelSizes.value = computeDefaults();
    await nextTick();
    window.dispatchEvent(new Event('resize'));
  },
);

</script>
