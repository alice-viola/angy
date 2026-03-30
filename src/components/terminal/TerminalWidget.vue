<template>
  <div ref="terminalEl" class="h-full w-full bg-[var(--bg-base)]"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getPlatformInfo } from '@/engine/platform';
import type { UnlistenFn } from '@tauri-apps/api/event';
import '@xterm/xterm/css/xterm.css';

const props = defineProps<{
  workingDirectory: string;
  initialCommand?: string;
}>();

const emit = defineEmits<{
  titleChanged: [title: string];
  shellFinished: [exitCode: number];
}>();

const terminalEl = ref<HTMLDivElement>();
let terminal: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let ptyId: number | null = null;
let unlistenData: UnlistenFn | null = null;
let unlistenExit: UnlistenFn | null = null;
let resizeObserver: ResizeObserver | null = null;
let destroyed = false;

onMounted(async () => {
  if (!terminalEl.value) return;

  terminal = new Terminal({
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    fontSize: 13,
    theme: {
      background: '#0e0e0e',
      foreground: '#cdd6f4',
      cursor: '#cba6f7',
      selectionBackground: '#45475a',
      black: '#45475a',
      red: '#f38ba8',
      green: '#a6e3a1',
      yellow: '#f9e2af',
      blue: '#89b4fa',
      magenta: '#cba6f7',
      cyan: '#94e2d5',
      white: '#bac2de',
      brightBlack: '#585b70',
      brightRed: '#f38ba8',
      brightGreen: '#a6e3a1',
      brightYellow: '#f9e2af',
      brightBlue: '#89b4fa',
      brightMagenta: '#cba6f7',
      brightCyan: '#94e2d5',
      brightWhite: '#a6adc8',
    },
    cursorBlink: true,
    scrollback: 10000,
    allowProposedApi: true,
  });

  fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(new WebLinksAddon());

  terminal.open(terminalEl.value);
  fitAddon.fit();

  // Spawn PTY with default shell
  const { defaultShell } = await getPlatformInfo();
  const shell = defaultShell;
  const { cols, rows } = terminal;

  ptyId = await invoke<number>('pty_spawn', {
    shell,
    cwd: props.workingDirectory,
    cols,
    rows,
  });

  // Listen for PTY data — send initialCommand after shell is ready
  let pendingCommand = props.initialCommand ?? null;
  unlistenData = await listen<string>(`pty-data-${ptyId}`, (event) => {
    terminal?.write(event.payload);
    if (pendingCommand !== null) {
      const cmd = pendingCommand;
      pendingCommand = null;
      // Defer slightly so the shell's readline is ready to receive input
      setTimeout(() => {
        if (!destroyed) invoke('pty_write', { id: ptyId, data: cmd + '\r' }).catch(console.error);
      }, 200);
    }
  });

  // Listen for PTY exit
  unlistenExit = await listen<void>(`pty-exit-${ptyId}`, () => {
    emit('shellFinished', 0);
  });

  // Forward keyboard input to PTY
  terminal.onData((data) => {
    if (ptyId !== null) {
      invoke('pty_write', { id: ptyId, data });
    }
  });

  // Handle title changes
  terminal.onTitleChange((title) => {
    emit('titleChanged', title);
  });

  // Resize PTY when terminal resizes
  terminal.onResize(({ cols, rows }) => {
    if (ptyId !== null) {
      invoke('pty_resize', { id: ptyId, cols, rows });
    }
  });

  // Watch container size changes
  resizeObserver = new ResizeObserver(() => {
    fitAddon?.fit();
  });
  resizeObserver.observe(terminalEl.value);
});

onUnmounted(() => {
  destroyed = true;
  resizeObserver?.disconnect();
  unlistenData?.();
  unlistenExit?.();
  if (ptyId !== null) {
    invoke('pty_kill', { id: ptyId });
  }
  terminal?.dispose();
});

defineExpose({
  focus: () => terminal?.focus(),
  clear: () => terminal?.clear(),
});
</script>
