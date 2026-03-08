<template>
  <div class="h-screen w-screen flex flex-col bg-[var(--bg-surface)] text-[var(--text-primary)]">
    <GlobalTopBar>
      <template #actions>
        <slot name="actions" />
      </template>
    </GlobalTopBar>
    <div class="flex-1 min-h-0 overflow-hidden">
      <slot />
    </div>
    <StatusBar />
  </div>
</template>

<script setup lang="ts">
import GlobalTopBar from './GlobalTopBar.vue';
import StatusBar from './StatusBar.vue';
</script>
