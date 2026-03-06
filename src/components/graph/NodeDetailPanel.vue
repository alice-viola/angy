<template>
  <div
    class="absolute top-2 right-2 z-30 w-80 max-h-[70%] flex flex-col rounded-lg bg-[var(--bg-raised)] border border-[var(--border-standard)] shadow-xl overflow-hidden"
  >
    <!-- Header -->
    <div class="flex items-center justify-between px-3 py-2 border-b border-[var(--border-subtle)]">
      <div class="flex items-center gap-2 min-w-0">
        <span
          class="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
          :style="{ backgroundColor: statusColor }"
        />
        <span class="text-xs font-medium text-[var(--text-primary)] truncate">
          {{ node.label }}
        </span>
      </div>
      <button
        @click="$emit('close')"
        class="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors ml-2 flex-shrink-0"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M3 3l8 8M11 3l-8 8" />
        </svg>
      </button>
    </div>

    <!-- Body -->
    <div class="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
      <!-- Agent detail: delegation task & result -->
      <template v-if="node.type === 'agent'">
        <div v-if="node.delegationTask">
          <div class="text-[10px] uppercase tracking-wider text-[var(--text-faint)] mb-1">Prompt</div>
          <pre class="whitespace-pre-wrap text-[var(--text-secondary)] bg-[var(--bg-surface)] rounded p-2 max-h-40 overflow-y-auto font-mono text-[11px]">{{ node.delegationTask }}</pre>
        </div>
        <div v-if="node.delegationResult">
          <div class="text-[10px] uppercase tracking-wider text-[var(--text-faint)] mb-1">Result</div>
          <pre class="whitespace-pre-wrap text-[var(--text-secondary)] bg-[var(--bg-surface)] rounded p-2 max-h-40 overflow-y-auto font-mono text-[11px]">{{ node.delegationResult }}</pre>
        </div>
        <div v-if="!node.delegationTask && !node.delegationResult" class="text-[var(--text-muted)] italic">
          No delegation details available.
        </div>
      </template>

      <!-- Tool detail: Edit/Write diff/content -->
      <template v-else-if="node.type === 'tool' && isEditOrWrite">
        <div v-if="filePath">
          <div class="text-[10px] uppercase tracking-wider text-[var(--text-faint)] mb-1">File</div>
          <div class="text-[var(--accent-blue)] font-mono text-[11px] truncate">{{ filePath }}</div>
        </div>

        <!-- Edit: show old → new diff -->
        <template v-if="isEdit && node.toolInput">
          <div v-if="node.toolInput.old_string">
            <div class="text-[10px] uppercase tracking-wider text-[var(--text-faint)] mb-1">Removed</div>
            <pre class="whitespace-pre-wrap text-red-400 bg-[rgba(239,68,68,0.08)] rounded p-2 max-h-32 overflow-y-auto font-mono text-[11px] border border-red-900/20">{{ node.toolInput.old_string }}</pre>
          </div>
          <div v-if="node.toolInput.new_string">
            <div class="text-[10px] uppercase tracking-wider text-[var(--text-faint)] mb-1">Added</div>
            <pre class="whitespace-pre-wrap text-green-400 bg-[rgba(34,197,94,0.08)] rounded p-2 max-h-32 overflow-y-auto font-mono text-[11px] border border-green-900/20">{{ node.toolInput.new_string }}</pre>
          </div>
        </template>

        <!-- Write: show content -->
        <template v-else-if="isWrite && node.toolInput?.content">
          <div>
            <div class="text-[10px] uppercase tracking-wider text-[var(--text-faint)] mb-1">Content Written</div>
            <pre class="whitespace-pre-wrap text-[var(--text-secondary)] bg-[var(--bg-surface)] rounded p-2 max-h-48 overflow-y-auto font-mono text-[11px]">{{ truncateContent(node.toolInput.content) }}</pre>
          </div>
        </template>

        <div v-else class="text-[var(--text-muted)] italic">
          No content details available.
        </div>
      </template>

      <!-- Generic tool/node info -->
      <template v-else>
        <div v-if="node.toolName" class="text-[var(--text-secondary)]">
          Tool: <span class="font-mono">{{ node.toolName }}</span>
        </div>
        <div v-if="node.status" class="text-[var(--text-secondary)]">
          Status: {{ node.status }}
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { GraphNode } from './GraphTypes';

const props = defineProps<{
  node: GraphNode;
}>();

defineEmits<{
  close: [];
}>();

const STATUS_COLORS: Record<string, string> = {
  idle: '#6b7280',
  working: '#14b8a6',
  done: '#22c55e',
  error: '#ef4444',
  blocked: '#f59e0b',
};

const statusColor = computed(() => {
  if (props.node.type === 'tool') return '#3b82f6';
  return STATUS_COLORS[props.node.status || 'idle'] || '#6b7280';
});

const filePath = computed(() => props.node.toolInput?.file_path || props.node.toolInput?.path || props.node.toolInput?.filePath);

const isEdit = computed(() => {
  const name = props.node.toolName?.toLowerCase();
  return name === 'edit' || name === 'strreplace' || name === 'str_replace';
});

const isWrite = computed(() => {
  const name = props.node.toolName?.toLowerCase();
  return name === 'write';
});

const isEditOrWrite = computed(() => isEdit.value || isWrite.value);

function truncateContent(text: string, maxLen = 2000): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '\n\n... (truncated)';
}
</script>
