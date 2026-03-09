<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  text: string
  position?: 'top' | 'bottom' | 'left' | 'right'
}>()

const show = ref(false)
</script>

<template>
  <span
    class="inline-flex items-center ml-1 relative"
    @mouseenter="show = true"
    @mouseleave="show = false"
    @focusin="show = true"
    @focusout="show = false"
    tabindex="0"
  >
    <span class="text-[11px] text-[var(--text-faint)] hover:text-[var(--text-muted)] cursor-help select-none transition-colors">ⓘ</span>
    <Transition name="fade">
      <div
        v-if="show"
        role="tooltip"
        class="absolute z-50 max-w-[280px] text-[11px] leading-relaxed text-[var(--text-secondary)] bg-[var(--bg-raised)] border border-[var(--border)] rounded-lg shadow-lg px-3 py-2 pointer-events-none whitespace-normal"
        :class="{
          'bottom-full left-1/2 -translate-x-1/2 mb-1.5': position === 'top' || !position,
          'top-full left-1/2 -translate-x-1/2 mt-1.5': position === 'bottom',
          'right-full top-1/2 -translate-y-1/2 mr-1.5': position === 'left',
          'left-full top-1/2 -translate-y-1/2 ml-1.5': position === 'right',
        }"
      >
        {{ text }}
      </div>
    </Transition>
  </span>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
