<template>
  <details
    :open="agent.status === 'working' || undefined"
    class="tree-node tree-branch anim-fade-in"
    :class="depth > 0 ? 'ml-4' : ''"
  >
    <!-- Summary row -->
    <summary
      class="tree-summary flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-colors select-none"
      :class="summaryClasses"
    >
      <svg
        class="tree-chevron w-3 h-3 text-txt-faint flex-shrink-0 transition-transform"
        fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"
      >
        <path d="M9 18l6-6-6-6" />
      </svg>

      <!-- Avatar -->
      <div
        class="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
        :style="{ background: avatarGradient }"
      >
        <span class="text-[8px] font-bold" :style="{ color: avatarTextColor }">{{ initials }}</span>
      </div>

      <!-- Name -->
      <span
        class="text-xs font-medium truncate"
        :class="agent.status === 'done' ? 'text-txt-secondary' : 'text-txt-primary'"
      >{{ agent.title || 'Untitled' }}</span>

      <!-- Running dot -->
      <span
        v-if="agent.status === 'working'"
        class="w-1.5 h-1.5 rounded-full bg-teal anim-breathe flex-shrink-0"
      />

      <!-- Status badge -->
      <span v-if="agent.status === 'working'" class="text-[9px] px-1.5 py-0.5 rounded bg-teal/10 text-teal flex-shrink-0">running</span>
      <span v-else-if="agent.status === 'done'" class="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 flex-shrink-0">done</span>
      <span v-else-if="agent.status === 'error'" class="text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 flex-shrink-0">failed</span>

      <!-- Done checkmark -->
      <svg v-if="agent.status === 'done'" class="w-3 h-3 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
      </svg>

      <!-- Right meta -->
      <span class="flex-1" />
      <span v-if="agent.costUsd > 0" class="text-[9px] text-txt-faint flex-shrink-0 font-mono">${{ agent.costUsd.toFixed(2) }}</span>
      <span v-if="turnCount > 0" class="text-[9px] text-txt-faint flex-shrink-0 ml-1">Turn {{ turnCount }} · {{ totalToolCalls }} tool calls</span>
    </summary>

    <!-- Children area -->
    <div
      class="tree-children ml-4 pl-4 border-l-2 mt-2 space-y-4 pb-1"
      :class="borderClass"
    >
      <template v-for="(block, i) in messageBlocks" :key="i">

        <!-- ── Thinking block (collapsible) ── -->
        <div v-if="block.type === 'thinking'">
          <details class="group">
            <summary class="flex items-center gap-2 cursor-pointer text-[11px] text-txt-faint hover:text-txt-secondary transition-colors">
              <svg class="w-2.5 h-2.5 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
              Thinking · {{ formatThinkingTime(block.thinkingElapsedMs) }}
            </summary>
            <div class="mt-1.5 p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[11px] text-txt-secondary font-mono leading-relaxed max-h-64 overflow-y-auto">
              {{ block.content }}
            </div>
          </details>
        </div>

        <!-- ── Text content (rendered markdown, with overflow gate) ── -->
        <div v-else-if="block.type === 'text'" class="relative">
          <div
            class="md-content text-[12px] leading-relaxed overflow-hidden"
            :class="[
              agent.status === 'done' ? 'text-txt-secondary' : 'text-txt-primary',
              block.isLong && !expanded.has(i) ? 'max-h-[320px]' : '',
            ]"
            v-html="block.html"
          />
          <!-- Fade + expand button for long blocks -->
          <div
            v-if="block.isLong && !expanded.has(i)"
            class="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-base to-transparent flex items-end justify-center pb-1"
          >
            <button
              class="text-[10px] text-txt-muted hover:text-txt-primary px-3 py-1 rounded-md bg-surface border border-border-subtle hover:border-border-standard transition-colors"
              @click="expanded.add(i)"
            >Show all · {{ block.lineCount }} lines</button>
          </div>
        </div>

        <!-- ── Tool call group (with diffs for edits) ── -->
        <ToolCallGroup
          v-else-if="block.type === 'tool-group'"
          :calls="block.toolCalls ?? []"
          :expanded-by-default="block.hasEdits"
          @file-clicked="(path: string) => $emit('file-clicked', path)"
        />

        <!-- ── User message / task prompt (collapsed by default, markdown rendered) ── -->
        <details v-else-if="block.type === 'user'" class="group my-2">
          <summary class="flex items-center gap-2 cursor-pointer">
            <div class="flex items-center gap-1.5 px-2 py-1 rounded-md bg-purple-500/[0.06] border border-purple-500/10 group-hover:border-purple-500/20 transition-colors">
              <svg class="w-2.5 h-2.5 text-purple-400 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
              <span class="text-[10px] text-purple-400">Task prompt</span>
              <span class="text-[9px] text-txt-faint">· {{ block.lineCount }} lines</span>
            </div>
          </summary>
          <div
            class="mt-2 p-3 rounded-lg bg-white/[0.015] border border-white/[0.04] md-content text-[11px] text-txt-secondary leading-relaxed max-h-[400px] overflow-y-auto"
            v-html="block.html"
          />
        </details>

        <!-- ── Streaming indicator ── -->
        <div v-else-if="block.type === 'streaming'" class="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-teal/5 border border-teal/10">
          <WaveBar :count="3" color="teal" />
          <span class="text-[10px] text-teal">Generating...</span>
        </div>
      </template>

      <!-- Empty state / streaming indicator -->
      <div
        v-if="messageBlocks.length === 0"
        class="flex flex-col items-center justify-center py-4 text-center"
      >
        <template v-if="agent.status === 'working'">
          <WaveBar :count="3" color="teal" />
          <span class="text-[10px] text-teal mt-1.5">Generating...</span>
        </template>
        <span v-else class="text-[11px] text-txt-muted">No messages yet</span>
      </div>
    </div>
  </details>
</template>

<script setup lang="ts">
import { computed, reactive } from 'vue';
import type { HierarchicalAgent } from '../../stores/fleet';
import type { MessageRecord } from '../../engine/types';
import { renderMarkdown } from '../../utils/renderMarkdown';
import WaveBar from '@/components/common/WaveBar.vue';
import ToolCallGroup from '@/components/chat/ToolCallGroup.vue';
import type { ToolCallInfo } from '@/components/chat/ToolCallGroup.vue';

const LINE_LIMIT = 50;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'StrReplace', 'MultiEdit', 'NotebookEdit']);

interface MessageBlock {
  type: 'user' | 'text' | 'thinking' | 'tool-group' | 'streaming';
  content?: string;
  html?: string;
  lineCount?: number;
  isLong?: boolean;
  thinkingElapsedMs?: number;
  toolCalls?: ToolCallInfo[];
  toolCount?: number;
  toolSummary?: string;
  hasEdits?: boolean;
}

const props = defineProps<{
  agent: HierarchicalAgent;
  messages: MessageRecord[];
  depth: number;
}>();

defineEmits<{
  'file-clicked': [filePath: string];
}>();

const expanded = reactive(new Set<number>());

const AVATAR_STYLES = [
  { gradient: 'linear-gradient(135deg, rgba(245,158,11,0.3), rgba(234,88,12,0.3))', textColor: '#fb923c' },
  { gradient: 'linear-gradient(135deg, rgba(16,185,129,0.4), rgba(5,150,105,0.4))', textColor: '#10b981' },
  { gradient: 'linear-gradient(135deg, rgba(251,191,36,0.4), rgba(217,119,6,0.4))', textColor: '#fbbf24' },
  { gradient: 'linear-gradient(135deg, rgba(168,85,247,0.4), rgba(124,58,237,0.4))', textColor: '#a855f6' },
];

const avatarStyle = computed(() => {
  const hash = props.agent.sessionId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return AVATAR_STYLES[hash % AVATAR_STYLES.length];
});

const avatarGradient = computed(() => avatarStyle.value.gradient);
const avatarTextColor = computed(() => avatarStyle.value.textColor);

const initials = computed(() => {
  const name = props.agent.title || 'U';
  const parts = name.trim().split(/[-\s]+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
});

const summaryClasses = computed(() => {
  if (props.agent.status === 'working') {
    return 'bg-surface border border-teal/20 anim-shimmer hover:border-teal/30';
  }
  if (props.agent.status === 'done') {
    return 'bg-surface border border-border-subtle opacity-70 hover:opacity-100';
  }
  return 'bg-surface border border-border-subtle hover:border-purple-500/20';
});

const borderClass = computed(() => {
  switch (props.agent.status) {
    case 'working': return 'border-teal/20';
    case 'done': return 'border-emerald-500/15';
    default: return 'border-purple-500/15';
  }
});

const turnCount = computed(() => {
  const turns = new Set<number>();
  for (const m of props.messages) {
    if (m.turnId != null) turns.add(m.turnId);
  }
  return turns.size;
});

const totalToolCalls = computed(() =>
  props.messages.filter(m => m.role === 'assistant' && m.toolName).length,
);

function countLines(text: string): number {
  return text.split('\n').length;
}

const messageBlocks = computed((): MessageBlock[] => {
  const blocks: MessageBlock[] = [];
  let pendingTools: ToolCallInfo[] = [];

  function flushToolGroup() {
    if (pendingTools.length === 0) return;
    const counts: Record<string, number> = {};
    for (const t of pendingTools) counts[t.toolName] = (counts[t.toolName] ?? 0) + 1;
    const summaryParts = Object.entries(counts).map(([name, n]) =>
      n > 1 ? `${name} ×${n}` : name,
    );
    blocks.push({
      type: 'tool-group',
      toolCalls: [...pendingTools],
      toolCount: pendingTools.length,
      toolSummary: summaryParts.join(', '),
      hasEdits: pendingTools.some(t => t.isEdit),
    });
    pendingTools = [];
  }

  function emitContentBlocks(content: string) {
    const thinkingRegex = /<thinking>([\s\S]*?)<\/thinking>/g;
    let match: RegExpExecArray | null;
    while ((match = thinkingRegex.exec(content)) !== null) {
      const trimmed = match[1].trim();
      if (trimmed) {
        blocks.push({ type: 'thinking', content: trimmed, thinkingElapsedMs: undefined });
      }
    }
    const textOnly = content.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
    if (textOnly) {
      const lines = countLines(textOnly);
      blocks.push({
        type: 'text',
        content: textOnly,
        html: renderMarkdown(textOnly),
        lineCount: lines,
        isLong: lines > LINE_LIMIT,
      });
    }
  }

  const allMsgs = props.messages;
  for (let i = 0; i < allMsgs.length; i++) {
    const msg = allMsgs[i];
    const isToolCall = !!msg.toolName && (msg.role === 'assistant' || msg.role === 'tool');

    if (msg.role === 'user') {
      flushToolGroup();
      const content = msg.content || '';
      const lines = countLines(content);
      blocks.push({
        type: 'user',
        content,
        html: renderMarkdown(content),
        lineCount: lines,
      });
      continue;
    }

    if (isToolCall) {
      let filePath: string | undefined;
      let summary: string | undefined;
      let isEdit = false;
      let oldString: string | undefined;
      let newString: string | undefined;
      try {
        const input = msg.toolInput ? JSON.parse(msg.toolInput) : {};
        filePath = input.file_path || input.filePath || input.path;
        summary = input.command || input.query || input.pattern;
        if (!summary && !filePath && input.content) {
          summary = String(input.content).slice(0, 80);
        }
        if (msg.toolName && EDIT_TOOLS.has(msg.toolName)) {
          isEdit = true;
          oldString = input.old_string;
          newString = input.new_string ?? input.content ?? input.contents;
        }
      } catch { /* ignore parse errors */ }
      pendingTools.push({ toolName: msg.toolName!, filePath, summary, isEdit, oldString, newString });
      continue;
    }

    // Skip bare tool-result messages without toolName
    if (msg.role === 'tool') continue;

    if (msg.role === 'assistant') {
      const rawContent = msg.content || '';
      const stripped = rawContent.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();

      // Skip short narration between tool calls (mid-sequence only)
      if (pendingTools.length > 0 && stripped.length < 200) {
        continue;
      }

      flushToolGroup();

      if (!rawContent.trim()) {
        if (msg === allMsgs[allMsgs.length - 1]) {
          blocks.push({ type: 'streaming' });
        }
        continue;
      }

      emitContentBlocks(rawContent);
    }
  }

  flushToolGroup();
  return blocks;
});

function formatThinkingTime(ms?: number): string {
  if (!ms || ms <= 0) return 'a moment';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
</script>
