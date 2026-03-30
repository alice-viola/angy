<template>
  <div class="flex flex-col h-full bg-base w-full border-l border-border-subtle">
    <!-- Header -->
    <div class="px-3 py-2.5 border-b border-border-subtle flex items-center justify-between">
      <span class="text-[11px] font-semibold uppercase tracking-wider text-txt-muted">Effects</span>
      <button
        @click="fleetStore.effectsExpanded = false"
        class="text-txt-faint hover:text-txt-primary transition-colors p-0.5"
        title="Hide Effects"
      >
        <svg class="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M6 4l4 4-4 4" />
        </svg>
      </button>
    </div>

    <!-- Tabs -->
    <div class="flex gap-0 border-b border-border-subtle">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="flex items-center gap-1 text-[10px] px-3 py-2 transition-colors"
        :class="activeTab === tab.id
          ? 'text-ember-500 border-b-2 border-ember-500'
          : 'text-txt-muted hover:text-txt-secondary'"
        @click="activeTab = tab.id"
      >
        <svg class="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
          <path v-if="tab.id === 'effects'" d="M3 3h10v10H3zM6 1v4M10 1v4M1 6h14" />
          <path v-else d="M8 2v12M2 8h12M4 4l8 8M12 4l-8 8" />
        </svg>
        {{ tab.label }}
      </button>
    </div>

    <!-- Summary bar -->
    <div class="px-3 py-2 border-b border-border-subtle flex gap-3 text-[10px] text-txt-muted">
      <span>{{ fileChanges.length }} files</span>
      <span class="text-emerald-400">+{{ totalAdded }}</span>
      <span class="text-accent-red">-{{ totalRemoved }}</span>
      <span v-if="totalCost > 0" class="text-txt-faint">${{ totalCost.toFixed(2) }}</span>
    </div>

    <!-- File list (effects tab) — grouped by agent -->
    <div v-if="activeTab === 'effects'" class="flex-1 overflow-y-auto py-1">
      <template v-if="effectGroups.length > 0">
        <details
          v-for="group in effectGroups"
          :key="group.agentSessionId"
          open
          class="group"
        >
          <!-- Agent group header -->
          <summary class="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-white/[0.03] transition-colors select-none">
            <svg class="w-2.5 h-2.5 text-txt-faint flex-shrink-0 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
            <span class="text-[10px] font-medium text-txt-secondary truncate">{{ group.agentTitle }}</span>
            <span class="flex-1" />
            <span class="text-[9px] text-txt-faint flex-shrink-0">{{ group.changes.length }} file{{ group.changes.length !== 1 ? 's' : '' }}</span>
            <span class="text-[9px] font-mono flex-shrink-0">
              <span class="text-emerald-400">+{{ group.totalAdded }}</span>
              <span class="text-accent-red ml-0.5">-{{ group.totalRemoved }}</span>
            </span>
          </summary>

          <!-- File rows -->
          <div class="space-y-0.5 px-2 pb-1">
            <div
              v-for="change in group.changes"
              :key="change.filePath"
              class="flex items-center gap-2 px-2 py-1 rounded-md cursor-pointer hover:bg-white/[0.03] transition-colors ml-2"
              @click="$emit('diff-requested', change.filePath)"
            >
              <span
                class="text-[10px] px-1 rounded flex-shrink-0"
                :class="changeTypeBadge(change.changeType)"
              >{{ changeTypeLabel(change.changeType) }}</span>
              <span class="text-[11px] text-txt-secondary truncate font-mono flex-1 min-w-0">{{ change.filePath }}</span>
              <button
                @click.stop="$emit('file-clicked', change.filePath)"
                class="flex-shrink-0 p-0.5 rounded text-txt-faint hover:text-accent-mauve hover:bg-white/[0.05] transition-colors"
                title="Open file"
              >
                <svg class="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M10 2H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5l-3-3z"/><path d="M10 2v3h3"/>
                </svg>
              </button>
              <span class="flex-shrink-0 text-[9px] font-mono">
                <span v-if="change.linesAdded" class="text-emerald-400">+{{ change.linesAdded }}</span>
                <span v-if="change.linesRemoved" class="text-accent-red ml-0.5">-{{ change.linesRemoved }}</span>
              </span>
            </div>
          </div>
        </details>
      </template>

      <!-- Empty state -->
      <div
        v-else
        class="flex flex-col items-center justify-center h-full text-center px-6"
      >
        <svg class="w-6 h-6 mb-2 opacity-30 text-txt-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
        </svg>
        <span class="text-[11px] text-txt-muted">No changes yet</span>
        <span class="text-[10px] text-txt-faint mt-1">File edits will appear as your agent works</span>
      </div>
    </div>

    <!-- Graph tab — agent hierarchy visualization -->
    <div v-else class="flex-1 min-h-0 relative">
      <AgentGraph
        v-if="graphStore.visibleNodes.length > 0"
        :nodes="graphStore.visibleNodes"
        :edges="graphStore.visibleEdges"
        :is-live="graphStore.isLive"
        :min-turn="graphStore.minTurn"
        :max-turn="graphStore.maxTurn"
        :vertical="true"
        @agent-selected="(nodeId: string) => $emit('file-clicked', nodeId)"
        @file-clicked="(path: string) => $emit('file-clicked', path)"
      />
      <div
        v-else
        class="flex flex-col items-center justify-center h-full text-center px-6"
      >
        <svg class="w-6 h-6 mb-2 opacity-30 text-txt-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3">
          <circle cx="12" cy="12" r="3" />
          <circle cx="4" cy="6" r="2" />
          <circle cx="20" cy="6" r="2" />
          <circle cx="4" cy="18" r="2" />
          <circle cx="20" cy="18" r="2" />
          <path d="M9.5 10.5L5.5 7.5M14.5 10.5L18.5 7.5M9.5 13.5L5.5 16.5M14.5 13.5L18.5 16.5" />
        </svg>
        <span class="text-[11px] text-txt-muted">No graph data</span>
        <span class="text-[10px] text-txt-faint mt-1">Select an orchestrator to view the agent graph</span>
      </div>
    </div>

    <!-- Approve / Reject -->
    <div v-if="hasPendingApproval" class="px-3 py-3 border-t border-border-subtle flex gap-2 justify-end">
      <button
        class="flex items-center gap-1 bg-white/[0.04] border border-white/[0.06] text-xs text-txt-secondary rounded-lg h-8 px-3 hover:bg-white/[0.06] transition-colors"
        @click="$emit('reject')"
      >
        <svg class="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
        Reject
      </button>
      <button
        class="flex items-center gap-1 bg-gradient-to-r from-ember-500 to-ember-600 text-base text-xs font-medium rounded-lg h-8 px-4 transition-colors"
        @click="$emit('approve')"
      >
        <svg class="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M3 8l4 4 6-7" />
        </svg>
        Approve
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import type { FileChange, MessageRecord } from '../../engine/types';
import { engineBus } from '../../engine/EventBus';
import { getDatabase, useSessionsStore } from '../../stores/sessions';
import { useFleetStore } from '../../stores/fleet';
import { useGraphStore } from '../../stores/graph';
import { useUiStore } from '../../stores/ui';
import { useGraphBuilder } from '../../composables/useGraphBuilder';
import { DiffEngine } from '../../engine/DiffEngine';
import AgentGraph from '../graph/AgentGraph.vue';

interface TaggedFileChange extends FileChange {
  agentSessionId: string;
  agentTitle: string;
}

interface EffectsGroup {
  agentSessionId: string;
  agentTitle: string;
  changes: TaggedFileChange[];
  totalAdded: number;
  totalRemoved: number;
}

const props = defineProps<{
  sessionId: string;
}>();

defineEmits<{
  'file-clicked': [filePath: string];
  'diff-requested': [filePath: string];
  approve: [];
  reject: [];
}>();

const fleetStore = useFleetStore();
const graphStore = useGraphStore();
const graphBuilder = useGraphBuilder();
const ui = useUiStore();

const EDIT_TOOLS = new Set(['Edit', 'Write', 'StrReplace', 'MultiEdit', 'NotebookEdit']);
const diffEngine = new DiffEngine();

const childSessionIds = computed(() => {
  const ids = new Set<string>();
  for (const a of fleetStore.hierarchicalAgents) {
    if (a.parentSessionId === props.sessionId) {
      ids.add(a.sessionId);
    }
  }
  return ids;
});

const activeTab = ref<'effects' | 'graph'>('effects');
const fileChanges = ref<TaggedFileChange[]>([]);
const hasPendingApproval = ref(false);

const tabs = [
  { id: 'effects' as const, label: 'Effects' },
  { id: 'graph' as const, label: 'Graph' },
];

const totalAdded = computed(() => fileChanges.value.reduce((sum, c) => sum + c.linesAdded, 0));
const totalRemoved = computed(() => fileChanges.value.reduce((sum, c) => sum + c.linesRemoved, 0));
const totalCost = computed(() => 0);

const effectGroups = computed((): EffectsGroup[] => {
  const groupMap = new Map<string, TaggedFileChange[]>();
  const titleMap = new Map<string, string>();

  for (const change of fileChanges.value) {
    let list = groupMap.get(change.agentSessionId);
    if (!list) {
      list = [];
      groupMap.set(change.agentSessionId, list);
      titleMap.set(change.agentSessionId, change.agentTitle);
    }
    list.push(change);
  }

  return [...groupMap.entries()].map(([agentSessionId, changes]) => ({
    agentSessionId,
    agentTitle: titleMap.get(agentSessionId) ?? 'Unknown',
    changes,
    totalAdded: changes.reduce((s, c) => s + c.linesAdded, 0),
    totalRemoved: changes.reduce((s, c) => s + c.linesRemoved, 0),
  }));
});

function changeTypeBadge(type: FileChange['changeType']): string {
  switch (type) {
    case 'created': return 'bg-emerald-500/10 text-emerald-400';
    case 'modified': return 'bg-yellow-400/10 text-yellow-400';
    case 'deleted': return 'bg-red-500/10 text-red-400';
  }
}

function changeTypeLabel(type: FileChange['changeType']): string {
  switch (type) {
    case 'created': return 'A';
    case 'modified': return 'M';
    case 'deleted': return 'D';
  }
}

function computeLineCounts(filePath: string, toolName: string, toolInput?: Record<string, any>): { linesAdded: number; linesRemoved: number } {
  let linesAdded = 0;
  let linesRemoved = 0;

  if (toolInput) {
    if (toolName === 'Edit' || toolName === 'StrReplace') {
      const oldString = toolInput.old_string ?? '';
      const newString = toolInput.new_string ?? '';
      if (oldString || newString) {
        diffEngine.recordEditToolChange(filePath, oldString, newString, props.sessionId);
        linesAdded = diffEngine.linesAddedForFile(filePath);
        linesRemoved = diffEngine.linesRemovedForFile(filePath);
      }
    } else if (toolName === 'MultiEdit') {
      const edits = toolInput.edits ?? [];
      for (const edit of edits) {
        diffEngine.recordEditToolChange(filePath, edit.old_string ?? '', edit.new_string ?? '', props.sessionId);
      }
      linesAdded = diffEngine.linesAddedForFile(filePath);
      linesRemoved = diffEngine.linesRemovedForFile(filePath);
    } else if (toolName === 'Write') {
      const content = toolInput.content ?? toolInput.contents ?? '';
      if (content) {
        diffEngine.recordWriteToolChange(filePath, content, props.sessionId);
        linesAdded = diffEngine.linesAddedForFile(filePath);
        linesRemoved = diffEngine.linesRemovedForFile(filePath);
      }
    }
  }

  return { linesAdded, linesRemoved };
}

function resolveAgentTitle(sessionId: string): string {
  const agent = fleetStore.agents.find(a => a.sessionId === sessionId);
  return agent?.title ?? 'Orchestrator';
}

function onFileEdited(evt: { sessionId: string; filePath: string; toolName: string; toolInput?: Record<string, any> }) {
  if (evt.sessionId !== props.sessionId && !childSessionIds.value.has(evt.sessionId)) return;

  let changeType: FileChange['changeType'];
  if (evt.toolName === 'Delete') {
    changeType = 'deleted';
  } else if (evt.toolName === 'Write') {
    changeType = diffEngine.hasFile(evt.filePath) ? 'modified' : 'created';
  } else {
    changeType = 'modified';
  }

  const { linesAdded, linesRemoved } = computeLineCounts(evt.filePath, evt.toolName, evt.toolInput);

  const existing = fileChanges.value.find((c) => c.filePath === evt.filePath && c.agentSessionId === evt.sessionId);
  if (existing) {
    existing.changeType = changeType;
    existing.linesAdded = linesAdded;
    existing.linesRemoved = linesRemoved;
  } else {
    fileChanges.value.push({
      filePath: evt.filePath,
      changeType,
      linesAdded,
      linesRemoved,
      agentSessionId: evt.sessionId,
      agentTitle: resolveAgentTitle(evt.sessionId),
    });
  }
}

function resolveFilePath(filePath: string, workspace: string | undefined): string {
  if (!filePath) return '';
  if (filePath.startsWith('/')) return filePath; // Already absolute
  // Try workspace first, then fall back to ui.workspacePath for absolute path
  const absoluteBase = (workspace && workspace.startsWith('/'))
    ? workspace
    : ui.workspacePath; // ui.workspacePath should be absolute
  if (!absoluteBase || !absoluteBase.startsWith('/')) return filePath; // Can't resolve
  return `${absoluteBase}/${filePath}`;
}

function extractEffects(messages: MessageRecord[], agentSessionId: string, agentTitle: string, results: TaggedFileChange[]) {
  const sessionsStore = useSessionsStore();
  const sessionInfo = sessionsStore.sessions.get(agentSessionId);
  const workspace = sessionInfo?.workspace;

  const byPath = new Map<string, TaggedFileChange>();
  for (const msg of messages) {
    if (msg.toolName && EDIT_TOOLS.has(msg.toolName) && (msg.role === 'tool' || msg.role === 'assistant')) {
      let input: Record<string, any> = {};
      try { input = JSON.parse(msg.toolInput || '{}'); } catch { /* skip */ }
      const rawPath = input.file_path || input.path || '';
      const filePath = resolveFilePath(rawPath, workspace);
      if (filePath) {
        const { linesAdded, linesRemoved } = computeLineCounts(filePath, msg.toolName, input);
        byPath.set(filePath, {
          filePath,
          changeType: (msg.toolName === 'Write' ? 'created' : 'modified') as FileChange['changeType'],
          linesAdded,
          linesRemoved,
          agentSessionId,
          agentTitle,
        });
      }
    }
  }
  for (const change of byPath.values()) {
    results.push(change);
  }
}

watch(() => props.sessionId, async (sessionId) => {
  fileChanges.value = [];

  if (!sessionId) return;

  const db = getDatabase();
  const results: TaggedFileChange[] = [];

  const mainMsgs = await db.loadMessages(sessionId);
  extractEffects(mainMsgs, sessionId, resolveAgentTitle(sessionId), results);

  const children = fleetStore.hierarchicalAgents.filter(a => a.parentSessionId === sessionId);
  if (children.length > 0) {
    await Promise.all(children.map(async (child) => {
      const childMsgs = await db.loadMessages(child.sessionId);
      extractEffects(childMsgs, child.sessionId, child.title || 'Untitled', results);
    }));
  }

  fileChanges.value = results;
}, { immediate: true });

watch([() => props.sessionId, activeTab], async ([sessionId, tab]) => {
  if (tab === 'graph' && sessionId) {
    await graphBuilder.buildFromHistory(sessionId);
  }
}, { immediate: true });

onMounted(() => {
  engineBus.on('agent:fileEdited', onFileEdited);
});

onUnmounted(() => {
  engineBus.off('agent:fileEdited', onFileEdited);
});
</script>
