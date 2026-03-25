<template>
  <button
    class="rounded-lg flex items-center gap-3 relative transition-all duration-150 ease-in-out"
    :class="[
      expanded ? 'w-full h-9 px-2' : 'w-10 h-10 justify-center',
      active
        ? 'text-ember-500'
        : disabled
          ? 'text-txt-muted opacity-40 cursor-not-allowed'
          : 'text-txt-muted hover:text-txt-secondary'
    ]"
    :disabled="disabled"
    :title="expanded ? undefined : label"
    @click="!disabled && $emit('click')"
  >
    <!-- Active indicator -->
    <div
      v-if="active"
      class="absolute left-0 top-[25%] bottom-[25%] w-[3px] rounded-r-[3px] bg-gradient-to-b from-[#f59e0b] to-[#ea580c]"
    ></div>

    <!-- Icon slot -->
    <span class="flex-shrink-0 flex items-center justify-center" :class="expanded ? 'w-5' : ''">
      <slot />
    </span>

    <!-- Label (only when expanded) -->
    <span
      v-if="expanded"
      class="text-[13px] font-medium truncate transition-opacity duration-150"
      :class="active ? 'text-ember-500' : disabled ? 'text-txt-muted' : 'text-txt-secondary'"
    >
      {{ label }}
    </span>
  </button>
</template>

<script setup lang="ts">
defineProps<{
  active: boolean
  expanded: boolean
  disabled?: boolean
  label: string
}>()

defineEmits<{
  click: []
}>()
</script>
