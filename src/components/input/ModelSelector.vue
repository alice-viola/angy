<template>
  <div class="relative" ref="root">
    <button
      @click="toggleOpen"
      class="flex items-center gap-1 text-[var(--text-xs)] px-2 py-1 rounded bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] border border-[var(--border-subtle)]"
    >
      <span>{{ shortName }}</span>
      <svg class="w-2.5 h-2.5 opacity-50" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2.5 4L5 6.5L7.5 4"/></svg>
    </button>
    <Teleport to="body">
      <div
        v-if="open"
        :style="dropdownStyle"
        class="fixed bg-[var(--bg-raised)] border border-[var(--border-standard)] rounded-[var(--radius-md)] shadow-[var(--shadow-md)] overflow-hidden z-[200]"
      >
        <div
          v-for="model in models"
          :key="model.id"
          :title="isGeminiDisabled(model) ? 'Add your Gemini API key in Settings to enable' : undefined"
          @click="!isGeminiDisabled(model) && select(model.id)"
          class="flex items-center gap-2 px-3 py-1.5 whitespace-nowrap"
          :class="[
            isGeminiDisabled(model) ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-white/[0.05]',
            model.id === props.modelValue ? 'text-[var(--accent-mauve)]' : ''
          ]"
        >
          <div>
            <div class="text-xs text-[var(--text-primary)]">{{ model.name }}</div>
            <div class="text-[var(--text-xs)] text-[var(--text-faint)]">{{ model.desc }}</div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useUiStore } from '@/stores/ui';

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const ui = useUiStore();
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const dropdownStyle = ref<Record<string, string>>({});

function updateDropdownPosition() {
  if (!root.value) return;
  const rect = root.value.getBoundingClientRect();
  dropdownStyle.value = {
    left: rect.left + 'px',
    bottom: (window.innerHeight - rect.top + 4) + 'px',
  };
}

interface Model {
  id: string;
  name: string;
  desc: string;
  provider?: string;
}

const models: Model[] = [
  { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6', desc: 'Fast & capable' },
  { id: 'claude-opus-4-6', name: 'Opus 4.6', desc: 'Most powerful' },
  { id: 'claude-opus-4-5', name: 'Opus 4.5', desc: 'Powerful' },
  { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', desc: 'Fastest' },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', desc: 'Google · Fast', provider: 'gemini' },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', desc: 'Google · Powerful', provider: 'gemini' },
];

const shortName = computed(() => models.find((m) => m.id === props.modelValue)?.name || props.modelValue);

function toggleOpen() {
  if (!open.value) updateDropdownPosition();
  open.value = !open.value;
}

function isGeminiDisabled(model: Model): boolean {
  return model.provider === 'gemini' && !ui.geminiApiKey;
}

function select(id: string) {
  emit('update:modelValue', id);
  open.value = false;
}

function onClickOutside(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) {
    open.value = false;
  }
}

onMounted(() => document.addEventListener('click', onClickOutside));
onUnmounted(() => document.removeEventListener('click', onClickOutside));
</script>
