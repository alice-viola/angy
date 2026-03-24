<template>
  <div class="h-full flex flex-col p-4 overflow-y-auto">
    <h2 class="text-[11px] font-semibold uppercase tracking-wider text-txt-muted mb-4 shrink-0 flex items-center gap-2">
      <div class="w-2 h-2 rounded-full bg-ember anim-breathe" />
      Live Execution
      <span class="text-[10px] font-normal text-txt-faint ml-auto">{{ activeEpics.length }} active</span>
    </h2>

    <div v-if="activeEpics.length === 0" class="flex-1 flex items-center justify-center text-xs text-txt-muted italic">
      No epics currently in progress.
    </div>

    <div class="flex flex-col gap-3">
      <div
        v-for="epic in activeEpics"
        :key="epic.id"
        class="border border-border-subtle rounded-lg p-3 cursor-pointer hover:bg-white/[0.02] transition-colors"
        @click="$emit('epic-select', epic.id)"
      >
        <!-- Epic header -->
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-xs font-medium text-txt-primary truncate">{{ epic.title }}</h3>
          <span class="text-[9px] px-1.5 py-0.5 rounded bg-ember-500/15 text-ember-400 font-medium tracking-wide uppercase flex-shrink-0">
            {{ getPhaseLabel(epic.id) }}
          </span>
        </div>

        <!-- Real agent list -->
        <div class="space-y-1">
          <div
            v-for="agent in getEpicAgents(epic.id)"
            :key="agent.sessionId"
            class="flex items-center gap-2 px-2 py-1.5 rounded-md border-l-2 transition-colors"
            :class="agent.isActive ? 'border-l-teal bg-teal/5' : 'border-l-txt-faint/30'"
          >
            <!-- Avatar -->
            <div
              class="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 text-[9px] font-semibold"
              :style="{ background: agent.gradient, color: agent.textColor }"
            >
              {{ agent.initial }}
            </div>
            <!-- Info -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5">
                <span class="text-[10px] font-medium text-txt-primary truncate">{{ agent.title }}</span>
                <span v-if="agent.isActive" class="w-1.5 h-1.5 rounded-full bg-teal flex-shrink-0" />
              </div>
              <div v-if="agent.activity" class="text-[9px] text-txt-faint truncate">{{ agent.activity }}</div>
            </div>
            <!-- Status -->
            <span v-if="agent.isActive" class="text-[9px] text-teal flex-shrink-0">running</span>
            <span v-else-if="agent.status === 'done'" class="text-[9px] text-txt-faint flex-shrink-0">done</span>
          </div>

          <div v-if="getEpicAgents(epic.id).length === 0" class="text-[10px] text-txt-faint italic px-2 py-1">
            Initializing agents...
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { useEpicStore } from '@/stores/epics';
import { useFleetStore } from '@/stores/fleet';
import { engineBus } from '@/engine/EventBus';

const props = defineProps<{
  projectId: string;
}>();

defineEmits<{
  'epic-select': [epicId: string];
}>();

const epicStore = useEpicStore();
const fleetStore = useFleetStore();

const AVATAR_GRADIENTS = [
  { gradient: 'linear-gradient(135deg, rgba(245,158,11,0.5), rgba(234,88,12,0.5))', textColor: '#fff' },
  { gradient: 'linear-gradient(135deg, rgba(16,185,129,0.5), rgba(5,150,105,0.5))', textColor: '#fff' },
  { gradient: 'linear-gradient(135deg, rgba(34,211,238,0.5), rgba(8,145,178,0.5))', textColor: '#fff' },
  { gradient: 'linear-gradient(135deg, rgba(168,85,247,0.5), rgba(124,58,237,0.5))', textColor: '#fff' },
];

interface AgentDisplay {
  sessionId: string;
  title: string;
  initial: string;
  gradient: string;
  textColor: string;
  isActive: boolean;
  status: string;
  activity?: string;
}

function getEpicAgents(epicId: string): AgentDisplay[] {
  const epic = epicStore.epicById(epicId);
  if (!epic || !epic.rootSessionId) return [];

  const rootId = epic.rootSessionId;
  const agents: AgentDisplay[] = [];
  let idx = 0;

  // Get all agents from fleet store
  for (const agent of fleetStore.agents) {
    // Include root orchestrator and its children
    if (agent.sessionId === rootId || agent.parentSessionId === rootId) {
      const title = agent.title || (agent.sessionId === rootId ? 'Orchestrator' : 'Agent');
      const initial = title.charAt(0).toUpperCase();
      const style = AVATAR_GRADIENTS[idx % AVATAR_GRADIENTS.length];
      const isActive = agent.status !== 'idle' && agent.status !== 'done' && agent.status !== 'error';

      agents.push({
        sessionId: agent.sessionId,
        title,
        initial,
        gradient: style.gradient,
        textColor: style.textColor,
        isActive,
        status: agent.status,
        activity: agent.activity,
      });
      idx++;
    }
  }

  return agents;
}

const activeEpics = computed(() =>
  epicStore.epicsByColumn(props.projectId, 'in-progress')
);

// Map of epicId -> phase name
const epicPhases = ref<Record<string, string>>({});

function getPhaseLabel(epicId: string) {
  const phase = epicPhases.value[epicId] || 'starting';
  return phase.replace(/([A-Z])/g, ' $1').trim();
}

function onPhaseChanged({ epicId, phase }: { epicId: string; phase: string }) {
  epicPhases.value[epicId] = phase;
}

onMounted(() => {
  engineBus.on('epic:phaseChanged', onPhaseChanged);
});

onUnmounted(() => {
  engineBus.off('epic:phaseChanged', onPhaseChanged);
});
</script>
