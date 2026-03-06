<template>
  <div>
    <div class="flex items-center gap-1 py-0.5 cursor-pointer hover:bg-white/[0.03] text-xs"
         :style="{ paddingLeft: `${8 + depth * 12}px`, paddingRight: '8px' }"
         @click="onClick"
         @dblclick="onDblClick">
      <!-- Expand arrow for directories -->
      <span v-if="node.isDir" class="w-3 text-[var(--text-faint)] text-[10px] select-none">
        {{ expanded ? '&#x25be;' : '&#x25b8;' }}
      </span>
      <span v-else class="w-3"></span>

      <!-- Icon -->
      <span class="text-xs shrink-0">{{ node.isDir ? '\uD83D\uDCC1' : fileIcon }}</span>

      <!-- Name -->
      <span class="flex-1 truncate" :class="nameClass">{{ node.name }}</span>

      <!-- Git status badge -->
      <span v-if="gitStatus" class="text-[10px] font-bold shrink-0" :class="gitStatusColor">{{ gitStatus }}</span>

      <!-- Change badge from DiffEngine -->
      <span v-if="changeType" class="text-[10px] font-bold px-1 rounded shrink-0" :class="changeBadgeClass">{{ changeType }}</span>
    </div>

    <!-- Children (lazy loaded) -->
    <template v-if="node.isDir && expanded">
      <TreeNode v-for="child in children" :key="child.path" :node="child" :depth="depth + 1"
                :gitEntries="gitEntries" :changedFiles="changedFiles"
                @file-selected="(p: string) => emit('file-selected', p)" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { readDir } from '@tauri-apps/plugin-fs';
import type { GitFileEntry } from '../../engine/GitManager';
import { useEditorStore } from '../../stores/editor';

export interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
}

const props = defineProps<{
  node: FileNode;
  depth: number;
  gitEntries?: GitFileEntry[];
  changedFiles?: Map<string, string>;
}>();

const emit = defineEmits<{
  'file-selected': [filePath: string];
}>();

const editorStore = useEditorStore();

const expanded = ref(props.node.isDir && editorStore.isExpanded(props.node.path));
const children = ref<FileNode[]>([]);

// Git status for this file
const gitStatus = computed(() => {
  if (!props.gitEntries || props.node.isDir) return null;
  const entry = props.gitEntries.find(e => props.node.path.endsWith(e.path));
  if (!entry) return null;
  return entry.workTreeStatus !== ' ' ? entry.workTreeStatus : entry.indexStatus;
});

const gitStatusColor = computed(() => {
  switch (gitStatus.value) {
    case 'M': return 'text-[var(--accent-yellow)]';
    case 'A': case '?': return 'text-[var(--accent-green)]';
    case 'D': return 'text-[var(--accent-red)]';
    default: return 'text-[var(--text-faint)]';
  }
});

// Change markers from DiffEngine
const changeType = computed(() => {
  if (!props.changedFiles) return null;
  return props.changedFiles.get(props.node.path) || null;
});

const changeBadgeClass = computed(() => {
  switch (changeType.value) {
    case 'M': return 'bg-[color-mix(in_srgb,var(--accent-yellow)_15%,transparent)] text-[var(--accent-yellow)]';
    case 'C': return 'bg-[color-mix(in_srgb,var(--accent-green)_15%,transparent)] text-[var(--accent-green)]';
    case 'D': return 'bg-[color-mix(in_srgb,var(--accent-red)_15%,transparent)] text-[var(--accent-red)]';
    default: return '';
  }
});

const nameClass = computed(() => {
  if (gitStatus.value === 'D') return 'text-[var(--text-faint)] line-through';
  if (gitStatus.value === '?' || gitStatus.value === 'A') return 'text-[var(--accent-green)]';
  if (gitStatus.value === 'M') return 'text-[var(--accent-yellow)]';
  return 'text-[var(--text-primary)]';
});

const fileIcon = computed(() => {
  const ext = props.node.name.split('.').pop()?.toLowerCase();
  const iconMap: Record<string, string> = {
    ts: '\uD83D\uDD37', tsx: '\uD83D\uDD37', js: '\uD83D\uDFE1', jsx: '\uD83D\uDFE1',
    vue: '\uD83D\uDC9A', py: '\uD83D\uDC0D', rs: '\uD83E\uDD80', go: '\uD83D\uDD35',
    json: '\uD83D\uDCCB', md: '\uD83D\uDCDD', css: '\uD83C\uDFA8', html: '\uD83C\uDF10',
    sh: '\u2699\uFE0F', yml: '\u2699\uFE0F', yaml: '\u2699\uFE0F', toml: '\u2699\uFE0F',
  };
  return iconMap[ext || ''] || '\uD83D\uDCC4';
});

const SKIP_DIRS = new Set(['node_modules', 'target', 'build', 'dist', '.git', '__pycache__']);

async function onClick() {
  if (props.node.isDir) {
    expanded.value = !expanded.value;
    if (expanded.value) {
      editorStore.saveExpandedDir(props.node.path);
      if (children.value.length === 0) {
        await loadChildren();
      }
    } else {
      editorStore.removeExpandedDir(props.node.path);
    }
  }
}

function onDblClick() {
  if (!props.node.isDir) {
    emit('file-selected', props.node.path);
  }
}

onMounted(async () => {
  if (expanded.value && props.node.isDir && children.value.length === 0) {
    await loadChildren();
  }
});

async function loadChildren() {
  try {
    const entries = await readDir(props.node.path);
    children.value = entries
      .filter(e => e.name != null && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name))
      .map(e => ({
        name: e.name || '',
        path: `${props.node.path}/${e.name}`,
        isDir: e.isDirectory,
      }))
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  } catch {
    children.value = [];
  }
}
</script>
