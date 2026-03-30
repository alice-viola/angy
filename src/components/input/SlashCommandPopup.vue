<template>
  <div
    ref="popupEl"
    class="absolute bottom-full left-4 mb-1 w-72 max-h-64 overflow-y-auto bg-[var(--bg-raised)] border border-[var(--border-standard)] rounded-[var(--radius-md)] shadow-[var(--shadow-md)] z-50"
  >
    <div v-if="loading" class="px-3 py-2 text-xs text-[var(--text-faint)]">
      Loading commands...
    </div>
    <template v-else>
      <div
        v-for="(cmd, i) in filteredCommands"
        :key="cmd.name"
        class="px-3 py-2 cursor-pointer hover:bg-white/[0.05]"
        :class="i === selectedIndex ? 'bg-white/[0.05]' : ''"
        @click="$emit('select', cmd.name)"
      >
        <div class="text-xs font-medium text-[var(--accent-mauve)]">/{{ cmd.name }}</div>
        <div v-if="cmd.description" class="text-[10px] text-[var(--text-muted)]">{{ cmd.description }}</div>
      </div>
      <div
        v-if="filteredCommands.length === 0"
        class="px-3 py-2 text-xs text-[var(--text-faint)]"
      >
        No commands found
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { readDir } from '@tauri-apps/plugin-fs';
import { homeDir } from '@tauri-apps/api/path';

interface SlashCommand {
  name: string;
  description: string;
}

// Module-level cache: scan once per workspace path combination
const commandCache = new Map<string, SlashCommand[]>();
let cachedHome: string | null = null;

const props = defineProps<{
  query: string;
  workspacePath?: string;
}>();

const emit = defineEmits<{
  select: [commandName: string];
  close: [];
}>();

const popupEl = ref<HTMLElement | null>(null);
const selectedIndex = ref(0);
const loading = ref(true);
const commands = ref<SlashCommand[]>([]);

async function collectSkills(dir: string, depth = 0, prefix = ''): Promise<SlashCommand[]> {
  if (depth > 3) return [];
  try {
    const entries = await readDir(dir);
    const files: SlashCommand[] = [];
    const subdirPromises: Promise<SlashCommand[]>[] = [];
    for (const entry of entries) {
      if (!entry.name) continue;
      if (entry.isDirectory) {
        const childPrefix = prefix ? `${prefix}:${entry.name}` : entry.name;
        subdirPromises.push(collectSkills(`${dir}/${entry.name}`, depth + 1, childPrefix));
      } else if (entry.name.endsWith('.md') && entry.name !== 'README.md') {
        const baseName = entry.name.slice(0, -3);
        const fullName = prefix ? `${prefix}:${baseName}` : baseName;
        files.push({ name: fullName, description: 'Custom skill' });
      }
    }
    const children = (await Promise.all(subdirPromises)).flat();
    return [...files, ...children];
  } catch {
    return [];
  }
}

const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: 'bug', description: 'Report a bug to Anthropic' },
  { name: 'clear', description: 'Clear conversation history' },
  { name: 'compact', description: 'Compact conversation to save context' },
  { name: 'cost', description: 'Show token usage and costs' },
  { name: 'doctor', description: 'Check Claude Code installation health' },
  { name: 'help', description: 'Get help with Claude Code' },
  { name: 'init', description: 'Initialize Claude Code in a new project' },
  { name: 'login', description: 'Switch Anthropic accounts' },
  { name: 'logout', description: 'Sign out from Anthropic' },
  { name: 'memory', description: 'Edit CLAUDE.md memory files' },
  { name: 'model', description: 'Set or view the AI model' },
  { name: 'pr_comments', description: 'View pull request comments' },
  { name: 'release-notes', description: 'View release notes' },
  { name: 'resume', description: 'Resume a previous conversation' },
  { name: 'review', description: 'Request a code review' },
  { name: 'simplify', description: 'Simplify selected code' },
  { name: 'status', description: 'View account and system status' },
  { name: 'terminal-setup', description: 'Install Shift+Enter key binding' },
  { name: 'vim', description: 'Toggle vim mode' },
];

async function loadCommands() {
  const cacheKey = props.workspacePath ?? '';
  if (commandCache.has(cacheKey)) {
    commands.value = commandCache.get(cacheKey)!;
    loading.value = false;
    return;
  }

  loading.value = true;
  try {
    if (!cachedHome) cachedHome = await homeDir();
    const [globalSkills, projectSkills] = await Promise.all([
      collectSkills(`${cachedHome}/.claude/commands`),
      props.workspacePath ? collectSkills(`${props.workspacePath}/.claude/commands`) : Promise.resolve([]),
    ]);

    // Merge: project skills > global skills > built-ins (deduplicate by name)
    const seen = new Set<string>();
    const all: SlashCommand[] = [];
    for (const cmd of [...projectSkills, ...globalSkills, ...BUILTIN_COMMANDS]) {
      if (!seen.has(cmd.name)) {
        seen.add(cmd.name);
        all.push(cmd);
      }
    }
    const sorted = all.sort((a, b) => a.name.localeCompare(b.name));
    commandCache.set(cacheKey, sorted);
    commands.value = sorted;
  } finally {
    loading.value = false;
  }
}

const filteredCommands = computed(() => {
  const q = props.query.toLowerCase();
  return q
    ? commands.value.filter((c) => c.name.toLowerCase().includes(q))
    : commands.value;
});

watch(
  () => filteredCommands.value.length,
  () => { selectedIndex.value = 0; },
);

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectedIndex.value = Math.min(selectedIndex.value + 1, filteredCommands.value.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (filteredCommands.value[selectedIndex.value]) {
      emit('select', filteredCommands.value[selectedIndex.value].name);
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    emit('close');
  }
}

function onClickOutside(e: MouseEvent) {
  if (popupEl.value && !popupEl.value.contains(e.target as Node)) {
    emit('close');
  }
}

watch(() => props.workspacePath, () => {
  loadCommands();
});

onMounted(() => {
  document.addEventListener('mousedown', onClickOutside);
  loadCommands();
});

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onClickOutside);
});

defineExpose({ onKeydown });
</script>
