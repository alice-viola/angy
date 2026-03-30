<template>
  <div
    ref="popupEl"
    class="absolute bottom-full left-4 mb-1 w-64 bg-[var(--bg-raised)] border border-[var(--border-standard)] rounded-[var(--radius-md)] shadow-[var(--shadow-md)] overflow-hidden z-50"
  >
    <div class="px-3 py-1.5 border-b border-[var(--border-subtle)]">
      <div class="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Save to memory</div>
    </div>
    <div
      v-for="(opt, i) in options"
      :key="opt.id"
      class="px-3 py-2 cursor-pointer hover:bg-white/[0.05] transition-colors"
      :class="i === selectedIndex ? 'bg-white/[0.05]' : ''"
      @click="$emit('select', opt)"
    >
      <div class="text-xs font-medium text-[var(--accent-teal)]">{{ opt.label }}</div>
      <div class="text-[10px] text-[var(--text-muted)] truncate">{{ opt.path }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';

export interface MemoryOption {
  id: string;
  label: string;
  path: string;
}

const props = defineProps<{
  options: MemoryOption[];
}>();

const emit = defineEmits<{
  select: [option: MemoryOption];
  close: [];
}>();

const popupEl = ref<HTMLElement | null>(null);
const selectedIndex = ref(0);

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectedIndex.value = Math.min(selectedIndex.value + 1, props.options.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (props.options[selectedIndex.value]) emit('select', props.options[selectedIndex.value]);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    emit('close');
  }
}

function onClickOutside(e: MouseEvent) {
  if (popupEl.value && !popupEl.value.contains(e.target as Node)) emit('close');
}

onMounted(() => document.addEventListener('mousedown', onClickOutside));
onBeforeUnmount(() => document.removeEventListener('mousedown', onClickOutside));

defineExpose({ onKeydown });
</script>
