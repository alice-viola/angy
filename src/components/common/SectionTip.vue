<script setup lang="ts">
import { ref, onMounted } from 'vue'

const props = defineProps<{
  tipId: string
  title?: string
  icon?: string
}>()

const dismissed = ref(true) // start hidden to prevent flash

onMounted(() => {
  dismissed.value = localStorage.getItem(`angy:tip:dismissed:${props.tipId}`) === 'true'
})

function dismiss() {
  dismissed.value = true
  localStorage.setItem(`angy:tip:dismissed:${props.tipId}`, 'true')
}
</script>

<template>
  <div
    v-if="!dismissed"
    class="flex items-start gap-2 mx-2 my-2 px-3 py-2 rounded-lg border bg-[color-mix(in_srgb,var(--accent-blue)_8%,transparent)] border-[color-mix(in_srgb,var(--accent-blue)_20%,transparent)] text-[11px] leading-relaxed"
  >
    <span class="shrink-0 mt-px">{{ icon || 'ℹ️' }}</span>
    <div class="flex-1 min-w-0">
      <span v-if="title" class="font-semibold text-[var(--text-primary)] mr-1">{{ title }}</span>
      <span class="text-[var(--text-muted)]"><slot /></span>
    </div>
    <button
      @click="dismiss"
      class="shrink-0 text-[var(--text-faint)] hover:text-[var(--text-muted)] transition-colors ml-1 text-[13px] leading-none cursor-pointer"
      aria-label="Dismiss tip"
    >
      ×
    </button>
  </div>
</template>
