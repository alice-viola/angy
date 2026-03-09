<template>
  <Teleport to="body">
    <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div class="bg-[var(--bg-window)] border border-[var(--border-standard)] rounded-xl w-[480px] shadow-2xl">
        <div class="flex items-center justify-between px-5 py-4 border-b border-[var(--border-subtle)]">
          <h2 class="text-sm font-semibold text-[var(--text-primary)]">Start Orchestration</h2>
          <button @click="$emit('close')" class="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M3 3L11 11M11 3L3 11" />
            </svg>
          </button>
        </div>
        <div class="p-5">
          <label class="block text-xs text-[var(--text-muted)] mb-1.5">Goal</label>
          <textarea
            ref="goalInput"
            v-model="goal"
            rows="4"
            class="w-full bg-[var(--bg-raised)] text-[var(--text-primary)] text-sm px-3 py-2 rounded-lg border border-[var(--border-standard)] outline-none focus:border-[var(--accent-mauve)] resize-none placeholder:text-[var(--text-faint)]"
            placeholder="Describe the task for the orchestrator..."
            @keydown.meta.enter="onStart"
          />
          <p class="text-[11px] text-[var(--text-muted)] mt-1.5">Describe what you want built or fixed. The orchestrator will break this into tasks and delegate to specialist agents (architect, implementer, tester, reviewer).</p>
        </div>
        <div class="flex justify-end gap-2 px-5 py-3 border-t border-[var(--border-subtle)]">
          <button
            @click="$emit('close')"
            class="px-4 py-1.5 text-xs text-[var(--text-muted)] rounded-md hover:bg-[var(--bg-raised)] transition-colors"
          >
            Cancel
          </button>
          <button
            @click="onStart"
            :disabled="!goal.trim()"
            class="px-4 py-1.5 text-xs rounded-md font-medium transition-colors"
            :class="goal.trim()
              ? 'bg-[var(--accent-mauve)] text-[var(--bg-base)] hover:opacity-90'
              : 'bg-[var(--bg-raised)] text-[var(--text-faint)] cursor-not-allowed'"
          >
            Start
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  close: [];
  start: [goal: string];
}>();

const goal = ref('');
const goalInput = ref<HTMLTextAreaElement | null>(null);

watch(() => props.visible, (isVisible) => {
  if (isVisible) {
    nextTick(() => goalInput.value?.focus());
  }
});

function onStart() {
  const trimmed = goal.value.trim();
  if (!trimmed) return;
  emit('start', trimmed);
  goal.value = '';
}
</script>
