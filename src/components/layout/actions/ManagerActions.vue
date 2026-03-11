<template>
  <div class="flex gap-0.5">
    <!-- New Agent -->
    <button
      @click="$emit('new-agent')"
      class="w-[26px] h-[26px] flex items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] transition-colors"
      title="New Agent (Ctrl+N)"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M7 2V12M2 7H12" />
      </svg>
    </button>

    <!-- Mission Control -->
    <button
      @click="$emit('enter-mission-control')"
      class="w-[26px] h-[26px] flex items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--accent-teal)] transition-colors"
      title="Mission Control"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3">
        <rect x="1" y="1" width="12" height="12" rx="2" />
        <circle cx="5" cy="5" r="1.5" />
        <circle cx="9" cy="5" r="1.5" />
        <circle cx="7" cy="10" r="1.5" />
        <path d="M5 6.5L7 8.5M9 6.5L7 8.5" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
defineEmits<{
  'new-agent': [];
  'enter-mission-control': [];
}>();
</script>
