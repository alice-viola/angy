<template>
  <div class="flex flex-col h-full bg-[var(--bg-base)] border-t border-[var(--border-subtle)]">
    <!-- Header -->
    <div class="flex items-center justify-between px-3 h-8 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)]">
      <div class="flex items-center gap-2">
        <span class="text-xs font-medium text-[var(--text-secondary)]">Terminal</span>
        <div class="flex gap-0.5">
          <button
            v-for="(term, i) in terminals"
            :key="term.id"
            @click="activeTerminal = i"
            class="text-[10px] px-2 py-0.5 rounded transition-colors"
            :class="
              i === activeTerminal
                ? 'bg-[var(--bg-raised)] text-[var(--text-primary)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            "
          >
            {{ term.title || `Terminal ${i + 1}` }}
          </button>
        </div>
      </div>
      <div class="flex gap-1">
        <button
          @click="newClaudeTerminal"
          class="text-xs px-2 py-0.5 rounded hover:bg-white/[0.05] text-[var(--text-muted)]"
          title="New Claude Terminal"
        >
          claude
        </button>
        <button
          @click="newTerminal()"
          class="text-xs p-1 rounded hover:bg-white/[0.05] text-[var(--text-muted)]"
          title="New Terminal"
        >
          +
        </button>
        <button
          @click="closeCurrentTerminal"
          class="text-xs p-1 rounded hover:bg-white/[0.05] text-[var(--text-muted)]"
          title="Close tab"
        >
          &#x2715;
        </button>
        <button
          @click="$emit('close')"
          class="text-xs px-1.5 py-0.5 rounded hover:bg-white/[0.05] text-[var(--text-muted)] border-l border-[var(--border-subtle)] ml-1 pl-2"
          title="Hide terminal panel"
        >
          &#x2304;
        </button>
      </div>
    </div>

    <!-- Terminal instances -->
    <div class="flex-1 relative">
      <div
        v-for="(term, i) in terminals"
        :key="term.id"
        v-show="i === activeTerminal"
        class="absolute inset-0"
      >
        <TerminalWidget
          :ref="(el: any) => (termRefs[i] = el)"
          :workingDirectory="workingDirectory"
          :initialCommand="term.initialCommand"
          @title-changed="term.title = $event"
          @shell-finished="removeTerminal(i)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import TerminalWidget from './TerminalWidget.vue';

const props = defineProps<{
  workingDirectory: string;
  initialCommand?: string;
}>();

defineEmits<{ close: [] }>();

interface TerminalInstance {
  id: number;
  title: string;
  initialCommand?: string;
}

let nextId = 1;
const terminals = reactive<TerminalInstance[]>([]);
const activeTerminal = ref(0);
const termRefs = ref<any[]>([]);

function removeTerminal(index: number) {
  terminals.splice(index, 1);
  termRefs.value.splice(index, 1);
  if (activeTerminal.value >= terminals.length) {
    activeTerminal.value = Math.max(0, terminals.length - 1);
  }
}

function newTerminal(initialCommand?: string) {
  terminals.push({ id: nextId++, title: '', initialCommand });
  activeTerminal.value = terminals.length - 1;
}

function newClaudeTerminal() {
  newTerminal('claude --dangerously-skip-permissions');
}

function closeCurrentTerminal() {
  if (terminals.length === 0) return;
  removeTerminal(activeTerminal.value);
}

onMounted(() => {
  newTerminal(props.initialCommand);
});

defineExpose({
  newTerminal,
  closeCurrentTerminal,
  terminalCount: () => terminals.length,
});
</script>
