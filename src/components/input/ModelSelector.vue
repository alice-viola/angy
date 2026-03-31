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
        class="fixed bg-[var(--bg-raised)] border border-[var(--border-standard)] rounded-[var(--radius-md)] shadow-[var(--shadow-md)] overflow-hidden z-[200] max-h-96 overflow-y-auto"
      >
        <template v-for="(group, gIdx) in modelGroups" :key="gIdx">
          <div class="px-3 pt-2 pb-1 text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider bg-[var(--bg-surface)] sticky top-0 z-10 border-b border-[var(--border-subtle)] shadow-sm">
            {{ group.category }}
          </div>
          <div
            v-for="model in group.items"
            :key="model.id"
            :title="isDisabled(model) ? disabledReason(model) : undefined"
            @click="!isDisabled(model) && select(model.id)"
            class="flex items-center gap-2 px-3 py-1.5 whitespace-nowrap"
            :class="[
              isDisabled(model) ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-white/[0.05]',
              model.id === props.modelValue ? 'text-[var(--accent-mauve)]' : ''
            ]"
          >
            <div>
              <div class="text-xs text-[var(--text-primary)]">{{ model.name }}</div>
              <div class="text-[var(--text-xs)] text-[var(--text-faint)]">{{ model.desc }}</div>
            </div>
          </div>
        </template>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useUiStore } from '@/stores/ui';
import { MODEL_GROUPS, ALL_MODELS, type ModelEntry } from '@/constants/models';

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

const modelGroups = MODEL_GROUPS;

const shortName = computed(() => ALL_MODELS.find((m) => m.id === props.modelValue)?.name || props.modelValue);

function toggleOpen() {
  if (!open.value) updateDropdownPosition();
  open.value = !open.value;
}

function isDisabled(model: ModelEntry): boolean {
  if (model.provider === 'gemini') return !ui.geminiApiKey;
  if (model.provider === 'claude') return !ui.anthropicApiKey;
  return false;
}

function disabledReason(model: ModelEntry): string | undefined {
  if (model.provider === 'gemini') return 'Add your Gemini API key in Settings to enable';
  if (model.provider === 'claude') return 'Add your Anthropic API key in Settings to enable';
  return undefined;
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
