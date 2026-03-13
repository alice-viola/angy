<script setup lang="ts">
defineEmits<{
  click: [];
}>();
</script>

<template>
  <div
    class="border-2 border-dashed border-border-standard rounded-2xl p-5 min-h-[200px] flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-ember/30 transition-colors"
    @click="$emit('click')"
  >
    <div class="w-10 h-10 rounded-xl bg-white/[0.04] flex items-center justify-center">
      <svg class="w-5 h-5 text-txt-faint" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 4v16m8-8H4" />
      </svg>
    </div>
    <span class="text-xs text-txt-faint">New Project</span>
  </div>
</template>
