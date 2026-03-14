<template>
  <div
    :draggable="actions.cardDraggable.value"
    class="group relative rounded-xl p-4 cursor-pointer transition-all anim-shimmer"
    :class="cardClasses"
    style="box-shadow: 0 0 24px -6px rgba(16,185,129,0.10)"
    @click="actions.onSingleClick"
    @dblclick="actions.onDoubleClick"
    @dragstart="actions.onDragStart"
    @dragend="actions.onDragEnd"
  >
    <div class="absolute left-0 top-2 bottom-2 w-[3px] rounded-r" :style="{ backgroundColor: projectColor }" />

    <div class="pl-3">
      <!-- Top row: Epic ID + project dot + project name + priority | progress ring -->
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2">
          <span class="w-1.5 h-1.5 rounded-full" :style="{ backgroundColor: projectColor }" />
          <span class="text-[10px] text-txt-faint">{{ projectName }}</span>
          <PriorityBadge :priority="epic.priorityHint" />
        </div>
        <ProgressRing :progress="epic.progress ?? 0" :size="28" class="flex-shrink-0" />
      </div>

      <!-- Title -->
      <p class="text-sm text-txt-primary font-semibold leading-snug mb-1.5">{{ epic.title }}</p>

      <!-- Description -->
      <p v-if="epic.description" class="text-[11px] text-txt-muted leading-relaxed mb-2">{{ epic.description.length > 200 ? epic.description.slice(0, 200) + '…' : epic.description }}</p>

      <!-- Branch -->
      <div v-if="actions.branchName.value" class="flex items-center gap-1 mb-3">
        <svg class="w-3 h-3 text-teal flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
        <span class="text-[10px] text-teal font-mono truncate">{{ actions.branchName.value }}</span>
      </div>

      <!-- Agent activity strip -->
      <div class="flex items-center gap-2 pt-2.5 border-t border-border-subtle">
        <!-- Agent avatars -->
        <div v-if="agentAvatars.length > 0" class="flex -space-x-1.5">
          <div
            v-for="(av, i) in agentAvatars"
            :key="i"
            class="w-5 h-5 rounded-md border border-base flex items-center justify-center"
            :style="{ background: av.gradient }"
          >
            <span class="text-[8px] font-bold" :style="{ color: av.textColor }">{{ av.initial }}</span>
          </div>
        </div>

        <!-- Wave bars -->
        <div class="flex items-end gap-[3px] h-4">
          <div class="wave-bar wave-bar-teal" style="height:8px;width:2px" />
          <div class="wave-bar wave-bar-teal" style="height:12px;width:2px" />
          <div class="wave-bar wave-bar-teal" style="height:6px;width:2px" />
          <div class="wave-bar wave-bar-teal" style="height:10px;width:2px" />
        </div>

        <span class="text-[10px] text-teal truncate ml-0.5">
          {{ actions.agentCount.value }} agent{{ actions.agentCount.value !== 1 ? 's' : '' }} running
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
    return 'border border-[var(--accent-teal)] bg-[var(--accent-teal)]/5 cursor-pointer';
  }
  return 'border border-teal/25 bg-surface';
});
</script>
