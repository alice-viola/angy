<template>
  <div class="h-screen w-screen flex flex-row bg-[var(--bg-surface)] text-[var(--text-primary)]">
    <NavRail />
    <div class="flex-1 flex flex-col min-w-0">
      <GlobalTopBar>
        <template #actions>
          <slot name="actions" />
        </template>
      </GlobalTopBar>
      <div class="flex-1 min-h-0 overflow-hidden pb-7">
        <slot />
      </div>
      <StatusTicker />
    </div>
  </div>
</template>

<script setup lang="ts">
import NavRail from './NavRail.vue';
import GlobalTopBar from './GlobalTopBar.vue';
import StatusTicker from '@/components/layout/StatusTicker.vue';
</script>
