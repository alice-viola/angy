<template>
  <div class="flex flex-col items-center justify-center h-full text-center px-8">
    <div class="text-lg font-semibold text-[var(--text-primary)] mb-6">New chat</div>

    <!-- Keyboard hints -->
    <div class="grid grid-cols-2 gap-x-6 gap-y-2 text-[11px] text-[var(--text-muted)]">
      <div class="flex items-center gap-2">
        <kbd class="px-1.5 py-0.5 rounded bg-[var(--bg-raised)] text-[var(--text-faint)] text-[10px] font-mono border border-[var(--border-subtle)]">⌘N</kbd>
        <span>New agent</span>
      </div>
      <div class="flex items-center gap-2">
        <kbd class="px-1.5 py-0.5 rounded bg-[var(--bg-raised)] text-[var(--text-faint)] text-[10px] font-mono border border-[var(--border-subtle)]">⌘E</kbd>
        <span>Toggle editor</span>
      </div>
      <div class="flex items-center gap-2">
        <kbd class="px-1.5 py-0.5 rounded bg-[var(--bg-raised)] text-[var(--text-faint)] text-[10px] font-mono border border-[var(--border-subtle)]">@</kbd>
        <span>Mention file</span>
      </div>
      <div class="flex items-center gap-2">
        <kbd class="px-1.5 py-0.5 rounded bg-[var(--bg-raised)] text-[var(--text-faint)] text-[10px] font-mono border border-[var(--border-subtle)]">/</kbd>
        <span>Commands</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
</script>
