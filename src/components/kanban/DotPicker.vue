<template>
  <div class="flex items-center">
    <div class="flex items-center flex-1">
      <template v-for="(_label, index) in labels" :key="index">
        <div
          v-if="(index as number) > 0"
          class="h-px flex-1 bg-border-standard"
        />
        <div
          class="dot"
          :class="[
            index <= modelValue ? 'bg-ember-500' : 'bg-raised-hover dot-empty',
            isDotDisabled(index) ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer',
            disabled ? 'opacity-30 cursor-not-allowed' : ''
          ]"
          :title="isDotDisabled(index) && disabledTooltip ? disabledTooltip : undefined"
          @click="handleClick(index)"
        />
      </template>
    </div>
    <span class="text-[12px] text-txt-secondary font-medium ml-3">
      {{ labels[modelValue] ?? '' }}
    </span>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  modelValue: number
  labels: string[]
  disabled?: boolean
  disabledMax?: number
  disabledTooltip?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

function isDotDisabled(index: number): boolean {
  if (props.disabled) return true
  if (props.disabledMax !== undefined && index > props.disabledMax) return true
  return false
}

function handleClick(index: number) {
  if (isDotDisabled(index)) return
  emit('update:modelValue', index)
}
</script>

<style scoped>
.dot {
  width: 10px;
  height: 10px;
  border-radius: 9999px;
  flex-shrink: 0;
  transition: background-color 150ms;
}

.dot.dot-empty:not(.opacity-30):hover {
  background-color: rgba(245, 158, 11, 0.3);
}
</style>
