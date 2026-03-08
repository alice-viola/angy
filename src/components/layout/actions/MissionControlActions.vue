<template>
  <button
    @click="$emit('exit-mission-control')"
    class="text-xs px-2.5 py-1 rounded border border-[var(--border-subtle)]
           text-[var(--text-secondary)] hover:text-[var(--text-primary)]
           hover:border-[var(--border-standard)] transition-colors"
  >
    Exit Mission Control
  </button>
</template>

<script setup lang="ts">
defineEmits<{
  'exit-mission-control': [];
}>();
</script>
