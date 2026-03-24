<template>
  <div class="h-screen w-screen flex flex-row bg-[var(--bg-base)] text-[var(--text-primary)]">
    <NavRail />
    <div class="flex-1 flex flex-col min-w-0">
      <ProjectTabsBar v-if="ui.viewMode !== 'home' && ui.viewMode !== 'analytics' && ui.openProjectIds.length > 0" />
      <div class="flex-1 min-h-0 overflow-hidden pb-7">
        <slot />
      </div>
      <StatusTicker />
    </div>
  </div>
</template>

<script setup lang="ts">
import NavRail from './NavRail.vue';
import StatusTicker from '@/components/layout/StatusTicker.vue';
import ProjectTabsBar from '@/components/layout/ProjectTabsBar.vue';
import { useUiStore } from '@/stores/ui';

const ui = useUiStore();
</script>
