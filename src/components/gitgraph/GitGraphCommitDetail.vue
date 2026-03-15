<template>
  <div
    class="w-80 flex-shrink-0 border-l border-[var(--border-standard)] bg-[var(--bg-surface)] flex flex-col h-full"
    :style="{ transform: commit ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 0.2s ease' }"
  >
    <template v-if="commit">
      <!-- Header -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)]">
        <span class="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Commit Detail</span>
        <button
          class="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          @click="$emit('close')"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <!-- Body -->
      <div class="flex-1 overflow-y-auto p-4 space-y-4">
        <!-- Commit message -->
        <div>
          <p class="text-xs text-[var(--text-primary)] leading-relaxed">{{ commit.commit.subject }}</p>
        </div>

        <!-- Short hash -->
        <div class="flex items-center gap-2">
          <svg class="w-3.5 h-3.5 text-[var(--text-faint)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="4"/>
            <path d="M16 12h6M2 12h6M12 2v6M12 16v6"/>
          </svg>
          <span class="font-mono text-[10px] text-[var(--text-faint)]">{{ commit.commit.hash }}</span>
        </div>

        <!-- Author -->
        <div class="flex items-center gap-2">
          <!-- Person icon -->
          <svg class="w-3.5 h-3.5 text-[var(--text-faint)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
          <span class="text-xs text-[var(--text-secondary)]">{{ commit.commit.author }}</span>
        </div>

        <!-- Date -->
        <div class="flex items-center gap-2">
          <!-- Clock icon -->
          <svg class="w-3.5 h-3.5 text-[var(--text-faint)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          <span class="text-xs text-[var(--text-secondary)]">{{ formattedDate }}</span>
          <span class="text-[10px] text-[var(--text-faint)]">{{ commit.commit.relativeDate }}</span>
        </div>

        <!-- Branch refs -->
        <div v-if="commit.commit.refs.length > 0" class="space-y-1.5">
          <div class="flex items-center gap-1.5">
            <!-- Branch icon -->
            <svg class="w-3.5 h-3.5 text-[var(--text-faint)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="6" y1="3" x2="6" y2="15"/>
              <circle cx="18" cy="6" r="3"/>
              <circle cx="6" cy="18" r="3"/>
              <path d="M18 9a9 9 0 0 1-9 9"/>
            </svg>
            <span class="text-[11px] text-[var(--text-muted)]">Branches</span>
          </div>
          <div class="flex flex-wrap gap-1.5 ml-5">
            <span
              v-for="r in commit.commit.refs"
              :key="r"
              class="text-[10px] px-1.5 py-0.5 rounded-full border"
              :style="{ borderColor: commit.color, color: commit.color, backgroundColor: 'var(--bg-raised)' }"
            >
              {{ formatRef(r) }}
            </span>
          </div>
        </div>

        <!-- Parents -->
        <div v-if="commit.commit.parents.length > 0" class="space-y-1">
          <span class="text-[11px] text-[var(--text-muted)]">
            {{ commit.commit.parents.length > 1 ? 'Parents (merge)' : 'Parent' }}
          </span>
          <div class="flex flex-wrap gap-1 ml-5">
            <span
              v-for="p in commit.commit.parents"
              :key="p"
              class="font-mono text-[10px] text-[var(--text-faint)] bg-[var(--bg-raised)] px-1.5 py-0.5 rounded"
            >
              {{ p.slice(0, 7) }}
            </span>
          </div>
        </div>

        <!-- Epic link -->
        <div v-if="commit.epicId" class="pt-2 border-t border-[var(--border-subtle)]">
          <button
            class="flex items-center gap-2 py-1.5 px-2.5 rounded-lg text-[11px] font-medium transition-colors
                   border hover:bg-[var(--bg-raised)]"
            :style="{ borderColor: 'rgba(203, 166, 247, 0.3)', color: 'var(--accent-mauve)' }"
            @click="$emit('navigate-epic', commit.epicId!)"
          >
            <!-- Link icon -->
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
            <span>{{ commit.epicTitle || commit.epicId }}</span>
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { GitGraphNode } from '@/composables/useGitGraph';

const props = defineProps<{
  commit: GitGraphNode | null;
}>();

defineEmits<{
  'navigate-epic': [epicId: string];
  'close': [];
}>();

const formattedDate = computed(() => {
  if (!props.commit?.commit.authorDate) return '';
  try {
    return new Date(props.commit.commit.authorDate).toLocaleString();
  } catch {
    return props.commit.commit.authorDate;
  }
});

function formatRef(r: string): string {
  return r.trim()
    .replace(/^HEAD\s*->\s*/, '')
    .replace(/^origin\//, '');
}
</script>
