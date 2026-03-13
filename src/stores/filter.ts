import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useFilterStore = defineStore('filter', () => {
  const selectedProjectIds = ref<string[]>([]);
  const pinnedProjectIds = ref<string[]>([]);
  const activePreset = ref<string>('active'); // 'active' | 'all' | 'none'

  function toggleProject(projectId: string): void {
    const idx = selectedProjectIds.value.indexOf(projectId);
    if (idx === -1) {
      selectedProjectIds.value.push(projectId);
    } else if (selectedProjectIds.value.length > 1) {
      selectedProjectIds.value.splice(idx, 1);
    }
  }
  function applySelection(ids: string[]): void {
    selectedProjectIds.value = [...ids];
  }
  function applyPreset(preset: string): void {
    activePreset.value = preset;
    if (preset === 'none') selectedProjectIds.value = [];
  }

  return { selectedProjectIds, pinnedProjectIds, activePreset, toggleProject, applySelection, applyPreset };
});
