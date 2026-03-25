<template>
  <div class="flex flex-col flex-1 min-w-0 bg-[var(--bg-base)]">
    <!-- Tab bar -->
    <div v-if="tabs.length > 0" class="h-9 flex items-center border-b border-[var(--border-subtle)] px-1 bg-[var(--bg-base)] overflow-x-auto">
      <div class="flex items-end flex-1 min-w-0 overflow-x-auto">
        <div
          v-for="tab in tabs"
          :key="tab.filePath"
          class="group flex items-center gap-1 px-3 py-1.5 text-[11px] cursor-pointer whitespace-nowrap select-none"
          :class="tab.filePath === activeFile
            ? 'text-txt-primary border-b-2 border-ember-500'
            : 'text-txt-muted hover:text-txt-secondary'"
          @click="codeViewerRef?.loadFile(tab.filePath)"
          @mousedown.middle.prevent="codeViewerRef?.closeFile(tab.filePath)"
        >
          <span class="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" v-if="tab.dirty" />
          <span>{{ fileName(tab.filePath) }}</span>
          <span
            @click.stop="codeViewerRef?.closeFile(tab.filePath)"
            @mousedown.prevent
            class="ml-1 text-txt-faint hover:text-txt-muted opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity"
          >&times;</span>
        </div>
      </div>
      <!-- Close all button -->
      <button
        v-if="tabs.length > 1"
        @click="codeViewerRef?.closeAllFiles()"
        class="ml-2 px-2 py-1 text-[10px] text-txt-faint hover:text-txt-muted transition-colors flex-shrink-0"
        title="Close all tabs"
      >Close All</button>
    </div>

    <!-- Breadcrumb bar -->
    <div v-if="activeFile" class="px-4 py-1 text-[10px] text-txt-faint border-b border-[var(--border-subtle)] flex items-center gap-1 overflow-hidden">
      <template v-for="(segment, i) in pathSegments" :key="i">
        <span v-if="i > 0" class="text-txt-faint">&rsaquo;</span>
        <span :class="i === pathSegments.length - 1 ? 'text-txt-muted' : 'text-txt-faint'">{{ segment }}</span>
      </template>
      <span class="flex-1" />
      <button
        v-if="isMarkdownFile"
        @click="toggleMarkdownPreview"
        class="px-2 py-0.5 text-[10px] rounded transition-colors flex-shrink-0"
        :class="markdownPreview
          ? 'bg-[var(--accent-mauve)] text-[var(--bg-base)]'
          : 'text-txt-muted hover:text-txt-primary hover:bg-[var(--bg-raised)]'"
        :title="markdownPreview ? 'Show code' : 'Preview markdown'"
      >{{ markdownPreview ? 'Code' : 'Preview' }}</button>
    </div>

    <!-- Editor -->
    <CodeViewer ref="codeViewerRef" :hideChrome="true" class="flex-1 min-h-0" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useUiStore } from '@/stores/ui';
import CodeViewer from '@/components/editor/CodeViewer.vue';

const ui = useUiStore();
const codeViewerRef = ref<InstanceType<typeof CodeViewer> | null>(null);

const tabs = computed(() => codeViewerRef.value?.tabs ?? []);
const activeFile = computed(() => codeViewerRef.value?.activeFile ?? '');

const pathSegments = computed(() => {
  if (!activeFile.value) return [];
  return activeFile.value.split('/').filter(Boolean);
});

const isMarkdownFile = computed(() => codeViewerRef.value?.isMarkdownFile ?? false);
const markdownPreview = computed(() => codeViewerRef.value?.markdownPreview ?? false);

function toggleMarkdownPreview() {
  if (codeViewerRef.value) {
    codeViewerRef.value.markdownPreview = !codeViewerRef.value.markdownPreview;
  }
}

function fileName(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}

watch(activeFile, (val) => {
  ui.currentFile = val;
});

function loadFile(filePath: string) { codeViewerRef.value?.loadFile(filePath); }
function closeFile(filePath: string) { codeViewerRef.value?.closeFile(filePath); }
function closeAllFiles() { codeViewerRef.value?.closeAllFiles(); }
function openFiles(): string[] { return codeViewerRef.value?.openFiles() ?? []; }

defineExpose({ loadFile, closeFile, closeAllFiles, openFiles });
</script>
