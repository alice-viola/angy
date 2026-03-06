import { defineStore } from 'pinia';
import { ref } from 'vue';

export interface SavedTab {
  filePath: string;
  dirty: boolean;
  cursorLine: number;
  cursorColumn: number;
  scrollTop: number;
  scrollLeft: number;
  content?: string;
}

export const useEditorStore = defineStore('editor', () => {
  const savedTabs = ref<SavedTab[]>([]);
  const savedActiveFile = ref('');
  const expandedDirs = ref<Set<string>>(new Set());

  function saveTabs(tabs: SavedTab[], activeFile: string) {
    savedTabs.value = tabs;
    savedActiveFile.value = activeFile;
  }

  function clearTabs() {
    savedTabs.value = [];
    savedActiveFile.value = '';
  }

  function saveExpandedDir(path: string) {
    expandedDirs.value.add(path);
  }

  function removeExpandedDir(path: string) {
    expandedDirs.value.delete(path);
  }

  function isExpanded(path: string): boolean {
    return expandedDirs.value.has(path);
  }

  return {
    savedTabs, savedActiveFile, expandedDirs,
    saveTabs, clearTabs,
    saveExpandedDir, removeExpandedDir, isExpanded,
  };
});
