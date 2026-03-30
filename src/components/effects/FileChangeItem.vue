<template>
  <div
    class="flex items-center gap-2 px-3 py-1.5 cursor-pointer rounded hover:bg-white/[0.03] transition-colors"
    @click="$emit('diff-requested', change.filePath)"
  >
    <!-- File icon badge -->
    <div
      class="shrink-0 w-[18px] h-[18px] rounded-[3px] flex items-center justify-center text-[7px] font-bold font-mono leading-none opacity-55"
      :style="{ background: fileIconDef.color, color: 'rgba(255,255,255,0.8)' }"
    >
      {{ fileIconDef.glyph }}
    </div>

    <!-- File info -->
    <div class="flex-1 min-w-0">
      <div class="text-[11px] font-medium text-[var(--text-primary)] truncate">{{ fileName }}</div>
      <div v-if="dirPath" class="text-[10px] text-[var(--text-muted)] truncate">{{ dirPath }}</div>
    </div>

    <!-- Badge (M/A/D) -->
    <span
      class="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0"
      :class="badgeClass"
    >
      {{ badgeLetter }}
    </span>

    <!-- Open file button -->
    <button
      @click.stop="$emit('click', change.filePath)"
      class="shrink-0 p-0.5 rounded text-[var(--text-faint)] hover:text-[var(--accent-mauve)] hover:bg-white/[0.05] transition-colors"
      title="Open file"
    >
      <svg class="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M10 2H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5l-3-3z"/><path d="M10 2v3h3"/>
      </svg>
    </button>

    <!-- Line delta -->
    <div class="flex gap-1 text-[10px] shrink-0">
      <span v-if="change.linesAdded > 0" class="text-[var(--accent-green)]">+{{ change.linesAdded }}</span>
      <span v-if="change.linesRemoved > 0" class="text-[var(--accent-red)]">-{{ change.linesRemoved }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { FileChange } from '../../engine/types';

const props = defineProps<{
  change: FileChange;
  rootPath: string;
}>();

defineEmits<{
  click: [filePath: string];
  'diff-requested': [filePath: string];
}>();

const fileName = computed(() => {
  const parts = relativePath.value.split('/');
  return parts[parts.length - 1] || relativePath.value;
});

const dirPath = computed(() => {
  const parts = relativePath.value.split('/');
  if (parts.length <= 1) return '';
  return parts.slice(0, -1).join('/');
});

const relativePath = computed(() => {
  const fp = props.change.filePath;
  if (props.rootPath && fp.startsWith(props.rootPath)) {
    const rel = fp.slice(props.rootPath.length);
    return rel.startsWith('/') ? rel.slice(1) : rel;
  }
  return fp;
});

const badgeLetter = computed(() => {
  switch (props.change.changeType) {
    case 'created': return 'A';
    case 'deleted': return 'D';
    default: return 'M';
  }
});

const badgeClass = computed(() => {
  switch (props.change.changeType) {
    case 'created': return 'text-[var(--accent-green)] bg-[color-mix(in_srgb,var(--accent-green)_15%,transparent)]';
    case 'deleted': return 'text-[var(--accent-red)] bg-[color-mix(in_srgb,var(--accent-red)_15%,transparent)]';
    default: return 'text-[var(--accent-yellow)] bg-[color-mix(in_srgb,var(--accent-yellow)_15%,transparent)]';
  }
});

interface FileIconDef { color: string; glyph: string }

const FILE_TYPE_MAP: Record<string, FileIconDef> = {
  ts:    { color: '#3178c6', glyph: 'TS' },
  tsx:   { color: '#3178c6', glyph: 'Tx' },
  js:    { color: '#f1c04e', glyph: 'JS' },
  jsx:   { color: '#61dafb', glyph: 'Jx' },
  vue:   { color: '#41b883', glyph: 'V' },
  py:    { color: '#f1c04e', glyph: 'Py' },
  rs:    { color: '#dea584', glyph: 'Rs' },
  go:    { color: '#519aba', glyph: 'Go' },
  css:   { color: '#563d7c', glyph: '#' },
  scss:  { color: '#c6538c', glyph: 'S#' },
  html:  { color: '#e44d26', glyph: '<>' },
  json:  { color: '#f1c04e', glyph: '{}' },
  yaml:  { color: '#cb171e', glyph: 'Y' },
  yml:   { color: '#cb171e', glyph: 'Y' },
  toml:  { color: '#9c4221', glyph: 'T' },
  md:    { color: '#519aba', glyph: 'Md' },
  txt:   { color: '#909090', glyph: 'Tx' },
  cpp:   { color: '#519aba', glyph: 'C+' },
  h:     { color: '#519aba', glyph: 'H' },
  c:     { color: '#519aba', glyph: 'C' },
  rb:    { color: '#cc342d', glyph: 'Rb' },
  java:  { color: '#b07219', glyph: 'Jv' },
  kt:    { color: '#a97bff', glyph: 'Kt' },
  swift: { color: '#f05138', glyph: 'Sw' },
  sh:    { color: '#4eaa25', glyph: '$' },
  sql:   { color: '#e38c00', glyph: 'Sq' },
};
const DEFAULT_ICON: FileIconDef = { color: '#909090', glyph: '·' };

const fileIconDef = computed((): FileIconDef => {
  const ext = fileName.value.split('.').pop()?.toLowerCase() ?? '';
  return FILE_TYPE_MAP[ext] ?? DEFAULT_ICON;
});
</script>
