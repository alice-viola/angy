<template>
  <div class="pipeline-map-builder mt-4">
    <!-- Global Model Selector -->
    <div class="flex items-center justify-between mb-3 px-1">
      <span class="text-[11px] text-[var(--text-muted)] font-medium uppercase tracking-wider">Agents</span>
      <div class="flex items-center gap-2">
        <span class="text-[10px] text-txt-faint uppercase tracking-wider">Set All:</span>
        <div class="relative">
          <select
            class="text-[10px] bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded px-1.5 py-1 text-[var(--text-secondary)] outline-none appearance-none cursor-pointer hover:border-[var(--accent-ember)] transition-colors pr-6"
            @change="setAllModels(($event.target as HTMLSelectElement).value); ($event.target as HTMLSelectElement).value = ''"
          >
            <option value="" disabled selected>Choose default...</option>
            <template v-for="group in MODEL_GROUPS" :key="group.category">
              <optgroup :label="group.category">
                <option v-for="m in group.items" :key="m.id" :value="m.id">{{ m.name }}</option>
              </optgroup>
            </template>
          </select>
          <svg class="absolute right-1.5 top-1.5 w-3 h-3 text-txt-faint pointer-events-none" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"></path></svg>
        </div>
      </div>
    </div>

    <!-- Subway Map Wrapper -->
    <div class="relative flex flex-col gap-4 overflow-x-auto pb-4 custom-scroll min-h-[220px] items-start pt-2">
      <!-- The dynamic columns (based on dependency depth) -->
      <div class="flex items-stretch gap-6 min-w-max relative px-2 flex-1">
        <!-- Background connector line -->
        <div class="absolute top-1/2 left-2 right-2 h-[2px] -translate-y-1/2 bg-[var(--border-subtle)] z-0 rounded-full"></div>

        <div
          v-for="(levelNodes, levelIndex) in levels"
          :key="levelIndex"
          class="flex flex-col justify-center gap-4 relative z-10"
        >
            <div
              v-for="node in levelNodes"
              :key="node.id"
              class="agent-card group flex flex-col bg-surface border border-border-standard rounded-lg overflow-hidden transition-all w-44 hover:border-border-strong"
              :class="{ 'opacity-40': isSkipped(node.id) }"
            >
              <div class="h-1 w-full" :class="getRoleBgColor(node.role)"></div>
              <div class="p-3 pb-2 relative flex-1 flex flex-col">
                <!-- Skip Toggle -->
                <button
                  class="skip-toggle absolute top-2 right-2 w-5 h-5 rounded-md flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100"
                  :class="isSkipped(node.id) ? 'text-txt-faint hover:bg-raised opacity-100' : 'text-txt-muted hover:bg-red-500/10 hover:text-red-400'"
                  @click.stop="toggleSkip(node.id)"
                  :title="isSkipped(node.id) ? 'Enable Agent' : 'Skip Agent'"
                >
                  <svg v-if="!isSkipped(node.id)" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path></svg>
                  <svg v-else class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>
                </button>

                <!-- Role Badge & Icon -->
                <div class="flex items-center gap-1.5 mb-3 pr-5">
                  <span class="text-txt-muted flex-shrink-0" v-html="getRoleIcon(node.role)"></span>
                  <span class="text-[10px] font-bold tracking-wide uppercase text-txt-secondary truncate" :title="formatRole(node)">
                    {{ formatRole(node) }}
                  </span>
                </div>
                
                <!-- Model Selection Dropdown -->
                <div class="relative w-full mt-auto">
                  <select
                    class="w-full text-[10px] bg-raised border border-border-subtle rounded px-1.5 py-1 text-txt-muted outline-none appearance-none cursor-pointer hover:border-accent-ember transition-colors pr-5"
                    :value="node.model"
                    @change="updateModel(node.id, ($event.target as HTMLSelectElement).value)"
                    :disabled="isSkipped(node.id)"
                  >
                    <template v-for="group in MODEL_GROUPS" :key="group.category">
                      <optgroup :label="group.category">
                        <option v-for="m in group.items" :key="m.id" :value="m.id">{{ m.name }}</option>
                      </optgroup>
                    </template>
                  </select>
                  <svg class="absolute right-1 top-1.5 w-3 h-3 text-txt-faint pointer-events-none" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"></path></svg>
                </div>
              </div>
            </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { AgentNode, PipelineConfig } from '@/engine/KosTypes';
import { MODEL_GROUPS } from '@/constants/models';

const props = defineProps<{
  modelValue: PipelineConfig;
}>();

const emit = defineEmits<{
  'update:modelValue': [config: PipelineConfig];
}>();

// Extract flat nodes map
const nodes = computed(() => props.modelValue.nodes);

// Group nodes by dependency level (Topological Sort / BFS)
const levels = computed(() => {
  const result: AgentNode[][] = [];
  const placed = new Set<string>();
  const remaining = [...nodes.value];
  
  // Also handle "skipped" nodes which are effectively "disabled" but remain in config
  
  while (remaining.length > 0) {
    const currentLevel = remaining.filter(n => 
      n.dependsOn.length === 0 || n.dependsOn.every(dep => placed.has(dep))
    );
    
    if (currentLevel.length === 0) {
      // Cycle detected or missing deps! Just push the rest to the last level
      result.push([...remaining]);
      break;
    }
    
    result.push(currentLevel);
    currentLevel.forEach(n => placed.add(n.id));
    
    // Remove placed nodes from remaining
    const currentIds = new Set(currentLevel.map(n => n.id));
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (currentIds.has(remaining[i].id)) {
        remaining.splice(i, 1);
      }
    }
  }
  
  return result;
});

function setAllModels(newModel: string) {
  if (!newModel) return;
  const newNodes = nodes.value.map(n => n.model === 'disabled' ? n : { ...n, model: newModel });
  emit('update:modelValue', { nodes: newNodes });
}
// To stick to `AgentNode`, we can set `model: 'disabled'` to indicate it's skipped.
function isSkipped(nodeId: string) {
  const node = nodes.value.find(n => n.id === nodeId);
  return node?.model === 'disabled';
}

function toggleSkip(nodeId: string) {
  const newNodes = nodes.value.map(n => {
    if (n.id === nodeId) {
      // Restore to a default model if un-skipping, otherwise set to 'disabled'
      return { ...n, model: n.model === 'disabled' ? 'claude-3-5-sonnet-20241022' : 'disabled' };
    }
    return n;
  });
  emit('update:modelValue', { nodes: newNodes });
}

function updateModel(nodeId: string, newModel: string) {
  const newNodes = nodes.value.map(n => n.id === nodeId ? { ...n, model: newModel } : n);
  emit('update:modelValue', { nodes: newNodes });
}

function formatRole(node: AgentNode) {
  if (node.role === 'custom' && node.promptOverride) return node.promptOverride;
  return node.role.replace('builder-', '').replace('-', ' ');
}

function getRoleBgColor(role: string) {
  if (role.includes('architect')) return 'bg-[var(--accent-purple)]';
  if (role.includes('counterpart')) return 'bg-[var(--accent-peach)]';
  if (role.includes('tester')) return 'bg-[var(--accent-peach)]';
  if (role.includes('builder')) return 'bg-[var(--accent-teal)]';
  return 'bg-[var(--accent-blue)]';
}

function getRoleIcon(role: string) {
  if (role.includes('architect')) {
    return `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path stroke-linecap="round" stroke-linejoin="round" d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`;
  }
  if (role.includes('builder') || role.includes('scaffold')) {
    return `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>`;
  }
  if (role.includes('tester') || role.includes('counterpart')) {
    return `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
  }
  return `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle></svg>`;
}
</script>

<style scoped>
.pipeline-map-builder {
  width: 100%;
}
.agent-card {
  position: relative;
  background: var(--bg-window);
}
.agent-card:hover {
  transform: translateY(-2px);
  border-color: var(--border-hover);
  z-index: 20;
}
.custom-scroll::-webkit-scrollbar {
  height: 6px;
}
.custom-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scroll::-webkit-scrollbar-thumb {
  background: var(--border-subtle);
  border-radius: 3px;
}
</style>