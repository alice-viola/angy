<template>
  <button
    @click="$emit('open-workspace')"
    class="flex items-center gap-3 px-4 py-2.5 text-xs text-[var(--text-secondary)] bg-[var(--bg-surface)] border border-[var(--border-standard)] rounded-lg hover:border-[var(--accent-teal)] hover:brightness-110 transition-all"
  >
    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
    <div class="text-left">
      <div class="font-medium">Open Workspace</div>
      <div class="text-[10px] text-[var(--text-muted)]">Agent fleet without a project</div>
    </div>
  </button>
</template>

<script setup lang="ts">
defineEmits<{
  'open-workspace': [];
}>();
</script>
