<template>
  <div class="h-full flex flex-col p-4 bg-[var(--bg-raised)]/30 rounded-xl border border-[var(--border-subtle)] overflow-y-auto">
    <h2 class="text-sm font-semibold text-txt-primary mb-4 shrink-0 flex items-center gap-2">
      <div class="w-2 h-2 rounded-full bg-ember anim-breathe" />
      Live Execution
      <span class="text-xs font-normal text-txt-muted ml-auto">{{ activeEpics.length }} active</span>
    </h2>

    <div v-if="activeEpics.length === 0" class="flex-1 flex items-center justify-center text-xs text-txt-muted italic">
      No epics currently in progress.
    </div>

    <div class="flex flex-col gap-6">
      <div
        v-for="epic in activeEpics"
        :key="epic.id"
        class="bg-surface border border-border-subtle rounded-xl p-5 shadow-sm cursor-pointer hover:border-border-standard transition-colors"
        @click="$emit('epic-select', epic.id)"
      >
        <div class="flex items-center justify-between mb-6">
          <h3 class="text-sm font-semibold text-txt-primary">{{ epic.title }}</h3>
          <span class="text-[10px] px-2 py-0.5 rounded-full bg-ember/10 text-ember-400 font-medium tracking-wide uppercase">
            {{ getPhaseLabel(epic.id) }}
          </span>
        </div>

        <!-- Hardcoded Subway Map -->
        <div class="relative px-8">
          <!-- Connecting Line -->
          <div class="absolute top-1/2 left-10 right-10 h-1 -translate-y-1/2 bg-[var(--bg-base)] rounded-full overflow-hidden">
             <!-- Progress Fill -->
             <div class="h-full bg-[var(--accent-teal)] transition-all duration-500 ease-out"
                  :style="{ width: getProgressWidth(epic.id) }" />
          </div>
          
          <div class="flex justify-between relative z-10">
            <!-- Architect Node -->
            <div class="flex flex-col items-center gap-2">
              <div
                class="w-10 h-10 rounded-full flex items-center justify-center border-[3px] transition-colors"
                :class="getNodeClasses(epic.id, 'architect')"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path stroke-linecap="round" stroke-linejoin="round" d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              </div>
              <span class="text-[10px] font-medium text-txt-muted">Architect</span>
              <div v-if="isActiveNode(epic.id, 'architect')" class="flex -space-x-1.5 mt-1">
                <div v-for="(av, i) in getEpicAgents(epic.id)" :key="i" class="w-5 h-5 rounded-md border border-base flex items-center justify-center" :style="{ background: av.gradient }" :title="av.title">
                  <span class="text-[8px] font-bold" :style="{ color: av.textColor }">{{ av.initial }}</span>
                </div>
              </div>
            </div>

            <!-- Builder Node -->
            <div class="flex flex-col items-center gap-2">
              <div
                class="w-10 h-10 rounded-full flex items-center justify-center border-[3px] transition-colors"
                :class="getNodeClasses(epic.id, 'builder')"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
              </div>
              <span class="text-[10px] font-medium text-txt-muted">Builder</span>
              <div v-if="isActiveNode(epic.id, 'builder')" class="flex -space-x-1.5 mt-1">
                <div v-for="(av, i) in getEpicAgents(epic.id)" :key="i" class="w-5 h-5 rounded-md border border-base flex items-center justify-center" :style="{ background: av.gradient }" :title="av.title">
                  <span class="text-[8px] font-bold" :style="{ color: av.textColor }">{{ av.initial }}</span>
                </div>
              </div>
            </div>

            <!-- Reviewer Node -->
            <div class="flex flex-col items-center gap-2">
              <div
                class="w-10 h-10 rounded-full flex items-center justify-center border-[3px] transition-colors"
                :class="getNodeClasses(epic.id, 'reviewer')"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
              </div>
              <span class="text-[10px] font-medium text-txt-muted">Reviewer</span>
              <div v-if="isActiveNode(epic.id, 'reviewer')" class="flex -space-x-1.5 mt-1">
                <div v-for="(av, i) in getEpicAgents(epic.id)" :key="i" class="w-5 h-5 rounded-md border border-base flex items-center justify-center" :style="{ background: av.gradient }" :title="av.title">
                  <span class="text-[8px] font-bold" :style="{ color: av.textColor }">{{ av.initial }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { useEpicStore } from '@/stores/epics';
import { useSessionsStore } from '@/stores/sessions';
import { engineBus } from '@/engine/EventBus';

const props = defineProps<{
  projectId: string;
}>();

defineEmits<{
  'epic-select': [epicId: string];
}>();

const epicStore = useEpicStore();
const sessionsStore = useSessionsStore();

const AVATAR_GRADIENTS = [
  { gradient: 'linear-gradient(135deg, rgba(245,158,11,0.4), rgba(234,88,12,0.4))', textColor: '#fb923c' },
  { gradient: 'linear-gradient(135deg, rgba(16,185,129,0.4), rgba(5,150,105,0.4))', textColor: '#10b981' },
  { gradient: 'linear-gradient(135deg, rgba(251,191,36,0.4), rgba(217,119,6,0.4))', textColor: '#fbbf24' },
  { gradient: 'linear-gradient(135deg, rgba(168,85,247,0.4), rgba(124,58,237,0.4))', textColor: '#a855f6' },
];

function getEpicAgents(epicId: string) {
  const epic = epicStore.epicById(epicId);
  if (!epic || !epic.rootSessionId) return [];
  const rootId = epic.rootSessionId;
  const avatars: { initial: string; gradient: string; textColor: string; title: string }[] = [];
  
  for (const info of sessionsStore.sessions.values()) {
    if (info.sessionId === rootId || info.parentSessionId === rootId) {
      const title = info.title || 'Agent';
      const initial = title.charAt(0).toUpperCase();
      const style = AVATAR_GRADIENTS[avatars.length % AVATAR_GRADIENTS.length];
      avatars.push({ initial, title, ...style });
      if (avatars.length >= 5) break;
    }
  }
  return avatars;
}

const activeEpics = computed(() =>
  epicStore.epicsByColumn(props.projectId, 'in-progress')
);

// Map of epicId -> phase name
const epicPhases = ref<Record<string, string>>({});

// Map of epicId -> pulsing state
const epicPulsing = ref<Record<string, boolean>>({});

function getPhaseLabel(epicId: string) {
  const phase = epicPhases.value[epicId] || 'architecting';
  return phase.replace(/([A-Z])/g, ' $1').trim();
}

function getProgressWidth(epicId: string) {
  const phase = epicPhases.value[epicId] || 'architecting';
  if (phase === 'architecting') return '0%';
  if (phase === 'building' || phase === 'building_frontend' || phase === 'building_backend') return '50%';
  if (phase === 'verifying' || phase === 'reviewing') return '100%';
  return '0%';
}

function isActiveNode(epicId: string, nodeName: string) {
  const phase = epicPhases.value[epicId] || 'architecting';
  if (nodeName === 'architect') return phase === 'architecting';
  if (nodeName === 'builder') return phase === 'building' || phase === 'building_frontend' || phase === 'building_backend';
  if (nodeName === 'reviewer') return phase === 'verifying' || phase === 'reviewing';
  return false;
}

function getNodeClasses(epicId: string, nodeName: string) {
  const phase = epicPhases.value[epicId] || 'architecting';
  const isPulsing = epicPulsing.value[epicId];

  let isActive = isActiveNode(epicId, nodeName);
  let isDone = false;

  if (nodeName === 'architect') {
    if (!isActive) isDone = true;
  } else if (nodeName === 'builder') {
    if (phase === 'verifying' || phase === 'reviewing') isDone = true;
  }

  const classes = [];
  
  if (isActive) {
    classes.push('border-[var(--accent-teal)] bg-surface text-white');
    if (isPulsing) classes.push('anim-breathe shadow-[0_0_15px_var(--accent-teal)]');
  } else if (isDone) {
    classes.push('border-[var(--accent-teal)] bg-[var(--accent-teal)]/20');
  } else {
    classes.push('border-border-standard bg-base text-txt-faint');
  }

  return classes.join(' ');
}

let pulseTimeoutMap: Record<string, NodeJS.Timeout> = {};

function onPhaseChanged(evt: { epicId: string; phase: string }) {
  epicPhases.value[evt.epicId] = evt.phase;
}

function onInternalCall(evt: { epicId: string }) {
  epicPulsing.value[evt.epicId] = true;
  
  if (pulseTimeoutMap[evt.epicId]) {
    clearTimeout(pulseTimeoutMap[evt.epicId]);
  }
  
  pulseTimeoutMap[evt.epicId] = setTimeout(() => {
    epicPulsing.value[evt.epicId] = false;
  }, 1000); // Stop pulsing after 1s of inactivity
}

onMounted(() => {
  engineBus.on('epic:phaseChanged', onPhaseChanged);
  engineBus.on('pipeline:internalCall', onInternalCall);
});

onUnmounted(() => {
  engineBus.off('epic:phaseChanged', onPhaseChanged);
  engineBus.off('pipeline:internalCall', onInternalCall);
  for (const t of Object.values(pulseTimeoutMap)) {
    clearTimeout(t);
  }
});
</script>
