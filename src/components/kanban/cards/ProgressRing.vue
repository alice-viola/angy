<template>
  <svg :width="size" :height="size" :viewBox="`0 0 ${size} ${size}`">
    <circle
      :cx="center"
      :cy="center"
      :r="radius"
      fill="none"
      stroke="rgba(255,255,255,0.08)"
      :stroke-width="strokeWidth"
    />
    <circle
      :cx="center"
      :cy="center"
      :r="radius"
      fill="none"
      stroke="var(--accent-teal)"
      :stroke-width="strokeWidth"
      stroke-linecap="round"
      :stroke-dasharray="circumference"
      :stroke-dashoffset="dashOffset"
      :transform="`rotate(-90 ${center} ${center})`"
    />
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  progress: number;
  size?: number;
}>(), {
  size: 28,
});

const strokeWidth = 2.5;
const center = computed(() => props.size / 2);
const radius = computed(() => props.size / 2 - 2);
const circumference = computed(() => 2 * Math.PI * radius.value);
const dashOffset = computed(() => circumference.value * (1 - Math.max(0, Math.min(1, props.progress))));
</script>
