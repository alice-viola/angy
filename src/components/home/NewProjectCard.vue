<script setup lang="ts">
defineEmits<{
  click: [];
}>();
</script>

<template>
  <div
    class="flex items-center gap-2.5 px-3 py-2 rounded-md border border-dashed border-border-standard cursor-pointer hover:border-ember/30 hover:bg-white/[0.02] transition-colors"
    @click="$emit('click')"
  >
    <div class="w-7 h-7 rounded-md bg-white/[0.04] flex items-center justify-center flex-shrink-0">
      <svg class="w-3.5 h-3.5 text-txt-faint" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 4v16m8-8H4" />
      </svg>
    </div>
    <span class="text-[11px] text-txt-faint">New Project</span>
  </div>
</template>
