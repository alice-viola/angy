<template>
  <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2 border-t border-[var(--border-subtle)] bg-[var(--bg-window)]/50">
    <template v-for="[branchName, color] in branchColors" :key="branchName">
      <div class="flex items-center gap-1.5">
        <span
          class="rounded-full w-2.5 h-2.5 flex-shrink-0"
          :style="{ backgroundColor: color }"
        />
        <span class="text-[10px] font-medium text-[var(--text-muted)] font-mono whitespace-nowrap">
          {{ branchName }}
        </span>
        <span
          v-if="epicForBranch(branchName)"
          class="text-[10px] text-[var(--text-faint)] truncate max-w-[120px]"
        >
          ({{ epicForBranch(branchName) }})
        </span>
      </div>
    </template>
    <span v-if="branchColors.size === 0" class="text-[10px] text-[var(--text-faint)]">No branches</span>
  </div>
</template>

<script setup lang="ts">
import type { EpicBranch } from '@/engine/KosTypes';
import { useEpicStore } from '@/stores/epics';

const props = defineProps<{
  branchColors: Map<string, string>;
  epicBranches: Map<string, EpicBranch[]>;
}>();

const epicStore = useEpicStore();

function epicForBranch(branchName: string): string | null {
  for (const [, branches] of props.epicBranches) {
    for (const eb of branches) {
      if (eb.branchName === branchName) {
        return epicStore.epicById(eb.epicId)?.title ?? eb.epicId;
      }
    }
  }
  return null;
}
</script>
