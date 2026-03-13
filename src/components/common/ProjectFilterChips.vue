<template>
  <div class="flex items-center gap-1.5 overflow-hidden">
    <!-- Prefix label -->
    <span class="text-[10px] text-txt-faint uppercase tracking-wider mr-1 flex-shrink-0">Projects:</span>

    <!-- Visible chips -->
    <template v-for="project in visibleProjects" :key="project.id">
      <!-- Selected chip -->
      <button
        v-if="selectedIds.includes(project.id)"
        class="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors flex-shrink-0"
        :style="selectedChipStyle(project.color)"
        @click="onToggle(project.id)"
      >
        <span
          class="w-1.5 h-1.5 rounded-full flex-shrink-0"
          :style="{ backgroundColor: project.color || 'var(--accent-ember)' }"
        />
        {{ project.name }}
        <span
          class="ml-0.5 leading-none opacity-60 hover:opacity-100"
          @click.stop="onRemove(project.id)"
        >&times;</span>
      </button>

      <!-- Unselected chip -->
      <button
        v-else
        class="px-2 py-0.5 rounded-full border border-border-standard text-txt-faint text-[10px] hover:border-txt-faint hover:text-txt-muted transition-colors flex-shrink-0"
        @click="onToggle(project.id)"
      >
        {{ project.name }}
      </button>
    </template>

    <!-- Overflow button -->
    <button
      v-if="overflowCount > 0"
      ref="overflowBtnEl"
      class="px-2 py-0.5 rounded-full border border-border-standard text-txt-faint text-[10px] hover:border-txt-faint hover:text-txt-muted transition-colors flex-shrink-0"
      @click="togglePopover"
    >
      +{{ overflowCount }} more
    </button>

    <!-- Popover -->
    <PopoverPanel
      v-if="popoverOpen"
      :id="popoverId"
      mode="multi"
      :groups="popoverGroups"
      :selected-ids="selectedIds"
      :footer-text="selectedIds.length + ' of ' + projects.length + ' selected'"
      :panel-style="popoverStyle"
      @toggle="onToggle"
      @close="popoverOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';
import PopoverPanel from './PopoverPanel.vue';

interface ProjectItem {
  id: string;
  name: string;
  color?: string;
}

const props = withDefaults(defineProps<{
  selectedIds: string[];
  projects: ProjectItem[];
  pinnedCount?: number;
  showAgentCounts?: boolean;
  popoverId: string;
}>(), {
  pinnedCount: 3,
  showAgentCounts: false,
});

const emit = defineEmits<{
  toggle: [projectId: string];
  remove: [projectId: string];
}>();

const popoverOpen = ref(false);
const overflowBtnEl = ref<HTMLElement | null>(null);
const popoverStyle = ref<Record<string, string>>({});

const visibleProjects = computed(() => props.projects.slice(0, props.pinnedCount));
const overflowCount = computed(() => Math.max(0, props.projects.length - props.pinnedCount));

const popoverGroups = computed(() => [{
  label: '',
  items: props.projects.map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
  })),
}]);

function selectedChipStyle(color?: string) {
  const c = color || 'var(--accent-ember)';
  return {
    backgroundColor: `color-mix(in srgb, ${c} 15%, transparent)`,
    color: c,
    borderColor: `color-mix(in srgb, ${c} 25%, transparent)`,
  };
}

function onToggle(projectId: string) {
  emit('toggle', projectId);
}

function onRemove(projectId: string) {
  emit('remove', projectId);
}

async function togglePopover() {
  if (popoverOpen.value) {
    popoverOpen.value = false;
    return;
  }
  // Compute position from overflow button
  if (overflowBtnEl.value) {
    const rect = overflowBtnEl.value.getBoundingClientRect();
    popoverStyle.value = {
      top: `${rect.bottom + 4}px`,
      left: `${rect.left}px`,
    };
  }
  popoverOpen.value = true;
  await nextTick();
}
</script>
