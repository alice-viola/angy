<template>
  <span
    class="text-[10px] px-1.5 py-0.5 rounded-full"
    :class="badgeClass"
  >
    {{ priority }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PriorityHint } from '@/engine/KosTypes';

const props = defineProps<{
  priority: PriorityHint;
}>();

const badgeClass = computed(() => {
  switch (props.priority) {
    case 'critical': return 'bg-red-500/20 text-red-400 font-semibold';
    case 'high': return 'bg-red-500/10 text-red-400 font-medium';
    case 'medium': return 'bg-ember-500/10 text-ember-400';
    case 'low': return 'bg-gray-500/20 text-gray-400';
    default: return 'bg-gray-500/20 text-gray-500';
  }
});
</script>
