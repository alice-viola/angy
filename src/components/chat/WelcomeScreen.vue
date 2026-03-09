<template>
  <div class="flex flex-col items-center justify-center h-full text-center px-8">
    <div class="text-lg font-semibold text-[var(--text-primary)] mb-1">Start a conversation</div>
    <p class="text-[12px] text-[var(--text-muted)] mb-6 max-w-[400px]">Ask your agent to write code, fix bugs, refactor, or explain anything in your workspace.</p>

    <!-- Quick-start suggestions -->
    <div class="flex flex-wrap justify-center gap-2 mb-6 max-w-[420px]">
      <span class="px-3 py-1.5 text-[11px] rounded-full border border-[var(--border-subtle)] text-[var(--text-muted)] bg-[var(--bg-raised)]">Write a feature</span>
      <span class="px-3 py-1.5 text-[11px] rounded-full border border-[var(--border-subtle)] text-[var(--text-muted)] bg-[var(--bg-raised)]">Fix a bug</span>
      <span class="px-3 py-1.5 text-[11px] rounded-full border border-[var(--border-subtle)] text-[var(--text-muted)] bg-[var(--bg-raised)]">Explain code</span>
      <span class="px-3 py-1.5 text-[11px] rounded-full border border-[var(--border-subtle)] text-[var(--text-muted)] bg-[var(--bg-raised)]">Refactor</span>
    </div>

    <!-- Keyboard hints -->
    <div class="grid grid-cols-2 gap-x-6 gap-y-2 text-[11px] text-[var(--text-muted)] mb-5">
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

    <!-- Orchestrate tip -->
    <SectionTip tipId="welcome-orchestrate" icon="💡" class="max-w-[420px]">
      Use <strong class="text-[var(--text-primary)]">Orchestrate</strong> mode in the input bar below to delegate complex tasks to a team of specialist agents.
    </SectionTip>
  </div>
</template>

<script setup lang="ts">
import SectionTip from '@/components/common/SectionTip.vue';
</script>
