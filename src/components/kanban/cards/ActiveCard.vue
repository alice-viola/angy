<template>
  <div
    class="group relative rounded-lg border p-3 cursor-pointer transition-all select-none"
    :class="cardClasses"
    @click="actions.onSingleClick"
    @dblclick="actions.onDoubleClick"
    @pointerdown="actions.onPointerDown"
  >
    <div class="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-teal" />

    <div class="pl-2.5">
      <!-- Top row: project dot + project name + priority | progress ring -->
      <div class="flex items-center justify-between mb-1.5">
        <div class="flex items-center gap-2">
          <span class="w-1.5 h-1.5 rounded-full" :style="{ backgroundColor: projectColor }" />
          <span class="text-[10px] text-txt-faint">{{ projectName }}</span>
          <PriorityBadge v-if="epic.priorityHint !== 'none'" :priority="epic.priorityHint" />
        </div>
        <ProgressRing :progress="epic.progress ?? 0" :size="24" class="flex-shrink-0" />
      </div>

      <!-- Title -->
      <p class="text-xs text-txt-primary font-medium leading-snug">{{ epic.title }}</p>

      <!-- Agent activity strip -->
      <div class="flex items-center gap-2 mt-2">
        <!-- Agent avatars -->
        <div v-if="agentAvatars.length > 0" class="flex -space-x-1.5">
          <div
            v-for="(av, i) in agentAvatars"
            :key="i"
            class="w-4 h-4 rounded border border-base flex items-center justify-center"
            :style="{ background: av.gradient }"
          >
            <span class="text-[7px] font-bold" :style="{ color: av.textColor }">{{ av.initial }}</span>
          </div>
        </div>

        <!-- Wave bars -->
        <div class="flex items-end gap-[2px] h-3">
          <div class="wave-bar wave-bar-teal" style="height:6px;width:2px" />
          <div class="wave-bar wave-bar-teal" style="height:10px;width:2px" />
          <div class="wave-bar wave-bar-teal" style="height:5px;width:2px" />
          <div class="wave-bar wave-bar-teal" style="height:8px;width:2px" />
        </div>

        <span class="text-[10px] text-teal truncate">
          {{ actions.agentCount.value }} running
        </span>
        <span class="text-[10px] text-txt-faint ml-auto">${{ epic.costTotal?.toFixed(2) ?? '0.00' }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, toRef } from 'vue';
import type { Epic } from '@/engine/KosTypes';
import { useProjectsStore } from '@/stores/projects';
import { useSessionsStore } from '@/stores/sessions';
import { useEpicCardActions } from '@/composables/useEpicCardActions';
import PriorityBadge from './PriorityBadge.vue';
import ProgressRing from './ProgressRing.vue';

const ACCENT_COLORS = ['#f59e0b', '#22d3ee', '#10b981', '#FF6B8A', '#cba6f7', '#89b4fa'];
const AVATAR_GRADIENTS = [
  { gradient: 'linear-gradient(135deg, rgba(245,158,11,0.4), rgba(234,88,12,0.4))', textColor: '#fb923c' },
  { gradient: 'linear-gradient(135deg, rgba(16,185,129,0.4), rgba(5,150,105,0.4))', textColor: '#10b981' },
  { gradient: 'linear-gradient(135deg, rgba(251,191,36,0.4), rgba(217,119,6,0.4))', textColor: '#fbbf24' },
  { gradient: 'linear-gradient(135deg, rgba(168,85,247,0.4), rgba(124,58,237,0.4))', textColor: '#a855f6' },
];

const props = withDefaults(defineProps<{
  epic: Epic;
  selectable?: boolean;
  selected?: boolean;
}>(), {
  selectable: false,
  selected: false,
});

const emit = defineEmits<{
  select: [id: string];
  'toggle-select': [id: string];
}>();

const projectsStore = useProjectsStore();
const sessionsStore = useSessionsStore();

const actions = useEpicCardActions({
  epic: toRef(props, 'epic'),
  selectable: toRef(props, 'selectable'),
  selected: toRef(props, 'selected'),
  emit,
});

const projectName = computed(() => {
  const p = projectsStore.projects.find(p => p.id === props.epic.projectId);
  return p?.name ?? props.epic.projectId.slice(0, 8);
});

const projectColor = computed(() => {
  const idx = projectsStore.projects.findIndex(p => p.id === props.epic.projectId);
  return ACCENT_COLORS[Math.max(0, idx) % ACCENT_COLORS.length];
});

const agentAvatars = computed(() => {
  const rootId = props.epic.rootSessionId;
  if (!rootId) return [];
  const avatars: { initial: string; gradient: string; textColor: string }[] = [];
  for (const info of sessionsStore.sessions.values()) {
    if (info.sessionId === rootId || info.parentSessionId === rootId) {
      const title = info.title || 'A';
      const initial = title.charAt(0).toUpperCase();
      const style = AVATAR_GRADIENTS[avatars.length % AVATAR_GRADIENTS.length];
      avatars.push({ initial, ...style });
      if (avatars.length >= 4) break;
    }
  }
  return avatars;
});

const cardClasses = computed(() => {
  if (props.selectable && props.selected) {
    return 'border-[var(--accent-teal)] bg-[var(--accent-teal)]/5 cursor-pointer';
  }
  return 'border-teal/20 bg-white/[0.02] hover:bg-white/[0.04]';
});
</script>
