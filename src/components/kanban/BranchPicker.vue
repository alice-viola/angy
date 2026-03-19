<template>
  <div ref="triggerWrap" class="branch-picker">
    <button
      class="field-input trigger-btn"
      :class="{ disabled: disabled }"
      :disabled="disabled"
      @click="toggle"
    >
      <span :class="modelValue ? 'text-[var(--text-primary)]' : 'text-[var(--text-faint)]'">
        {{ modelValue || placeholder }}
      </span>
      <svg class="w-3 h-3 text-[var(--text-faint)] ml-auto flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        ref="dropdown"
        class="fixed z-[100] rounded-xl border border-[var(--border-standard)] shadow-2xl shadow-black/40 overflow-hidden"
        :style="dropdownStyle"
        style="backdrop-filter: blur(12px); background: var(--bg-surface)"
      >
        <!-- Search -->
        <div class="p-2">
          <input
            ref="searchInput"
            v-model="search"
            type="text"
            autocapitalize="none"
            autocomplete="new-password"
            autocorrect="off"
            spellcheck="false"
            class="w-full h-7 rounded-lg bg-white/[0.04] border border-white/[0.06] text-[11px] px-2 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-faint)]"
            placeholder="Search branches..."
            @keydown.escape="close"
          />
        </div>

        <!-- List -->
        <div class="max-h-64 overflow-y-auto branch-list">
          <!-- Loading -->
          <div v-if="loading" class="text-[11px] text-txt-faint text-center py-4">Loading branches...</div>

          <template v-else-if="filteredCommon.length > 0 || filteredPerRepo.length > 0">
            <!-- Common branches -->
            <template v-if="filteredCommon.length > 0">
              <div class="text-[10px] uppercase tracking-wider text-txt-faint px-2 py-1">Common</div>
              <button
                v-for="b in filteredCommon"
                :key="'common-' + b"
                class="w-full text-left text-[11px] px-3 py-1.5 hover:bg-white/[0.03] cursor-pointer transition-colors"
                :class="b === modelValue ? 'text-[var(--accent-teal)]' : 'text-[var(--text-primary)]'"
                @click="select(b)"
              >
                {{ b }}
              </button>
            </template>

            <!-- Per-repo sections -->
            <template v-for="section in filteredPerRepo" :key="section.repoId">
              <div class="text-[10px] uppercase tracking-wider text-txt-faint px-2 py-1 mt-1">{{ section.repoName }}</div>
              <button
                v-for="b in section.branches"
                :key="section.repoId + '-' + b"
                class="w-full text-left text-[11px] px-3 py-1.5 hover:bg-white/[0.03] cursor-pointer transition-colors"
                :class="b === modelValue ? 'text-[var(--accent-teal)]' : 'text-[var(--text-primary)]'"
                @click="select(b)"
              >
                {{ b }}
              </button>
            </template>
          </template>

          <!-- Empty -->
          <div v-else-if="!search" class="text-[11px] text-txt-faint text-center py-4">No branches found</div>

          <!-- No match -->
          <div v-else-if="!createOption" class="text-[11px] text-txt-faint text-center py-4">No matching branches</div>

          <!-- Create option -->
          <button
            v-if="createOption"
            class="w-full text-left text-[11px] px-3 py-1.5 hover:bg-white/[0.03] cursor-pointer transition-colors text-[var(--accent-teal)]"
            @click="select(search.trim())"
          >
            Create '{{ search.trim() }}'
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { useMultiRepoGit } from '@/composables/useMultiRepoGit';
import { useProjectsStore } from '@/stores/projects';

const props = withDefaults(defineProps<{
  modelValue: string | null;
  repoIds: string[];
  projectId: string;
  placeholder?: string;
  disabled?: boolean;
  allowCreate?: boolean;
}>(), {
  placeholder: 'Select branch...',
  disabled: false,
  allowCreate: true,
});

const emit = defineEmits<{
  'update:modelValue': [value: string | null];
}>();

const projectsStore = useProjectsStore();
const { repoBranches, loading, refreshAllBranches } = useMultiRepoGit();

const open = ref(false);
const search = ref('');
const triggerWrap = ref<HTMLElement | null>(null);
const dropdown = ref<HTMLElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const dropdownStyle = ref<Record<string, string>>({});

// Fetch branches when repoIds change
watch(() => [props.repoIds, props.projectId], async () => {
  if (props.repoIds.length === 0) return;
  const repos = projectsStore.reposByProjectId(props.projectId)
    .filter(r => props.repoIds.includes(r.id))
    .map(r => ({ id: r.id, name: r.name, path: r.path }));
  if (repos.length > 0) {
    await refreshAllBranches(repos);
  }
}, { immediate: true });

// Branch data per repo
const repoBranchData = computed(() => {
  const result: Array<{ repoId: string; repoName: string; branches: string[] }> = [];
  for (const repoId of props.repoIds) {
    const info = repoBranches.get(repoId);
    if (info) {
      result.push({ repoId, repoName: info.repoName, branches: info.branches });
    }
  }
  return result;
});

// Common branches = intersection of all repos
const commonBranches = computed(() => {
  const data = repoBranchData.value;
  if (data.length === 0) return [];
  if (data.length === 1) return [...data[0].branches];
  let common = new Set(data[0].branches);
  for (let i = 1; i < data.length; i++) {
    const set = new Set(data[i].branches);
    common = new Set([...common].filter(b => set.has(b)));
  }
  return [...common].sort();
});

// Per-repo branches (excluding common)
const perRepoBranches = computed(() => {
  const commonSet = new Set(commonBranches.value);
  return repoBranchData.value
    .map(r => ({
      repoId: r.repoId,
      repoName: r.repoName,
      branches: r.branches.filter(b => !commonSet.has(b)).sort(),
    }))
    .filter(r => r.branches.length > 0);
});

// Filtered by search
const filteredCommon = computed(() => {
  const q = search.value.toLowerCase().trim();
  if (!q) return commonBranches.value;
  return commonBranches.value.filter(b => b.toLowerCase().includes(q));
});

const filteredPerRepo = computed(() => {
  const q = search.value.toLowerCase().trim();
  if (!q) return perRepoBranches.value;
  return perRepoBranches.value
    .map(r => ({
      ...r,
      branches: r.branches.filter(b => b.toLowerCase().includes(q)),
    }))
    .filter(r => r.branches.length > 0);
});

const allFilteredBranches = computed(() => {
  const set = new Set(filteredCommon.value);
  for (const r of filteredPerRepo.value) {
    for (const b of r.branches) set.add(b);
  }
  return set;
});

const createOption = computed(() => {
  if (!props.allowCreate) return false;
  const q = search.value.trim();
  if (!q) return false;
  return !allFilteredBranches.value.has(q);
});

function toggle() {
  if (props.disabled) return;
  open.value ? close() : openDropdown();
}

function openDropdown() {
  open.value = true;
  search.value = '';
  updatePosition();
  nextTick(() => searchInput.value?.focus());
}

function close() {
  open.value = false;
}

function select(branch: string) {
  emit('update:modelValue', branch);
  close();
}

function updatePosition() {
  if (!triggerWrap.value) return;
  const rect = triggerWrap.value.getBoundingClientRect();
  dropdownStyle.value = {
    top: `${rect.bottom + 4}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
  };
}

function onOutsideClick(e: MouseEvent) {
  if (!open.value) return;
  const target = e.target as Node;
  if (triggerWrap.value?.contains(target)) return;
  if (dropdown.value?.contains(target)) return;
  close();
}

onMounted(() => document.addEventListener('mousedown', onOutsideClick));
onUnmounted(() => document.removeEventListener('mousedown', onOutsideClick));
</script>

<style scoped>
.trigger-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  text-align: left;
}
.trigger-btn.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.field-input {
  width: 100%;
  font-size: 13px;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-base);
  color: var(--text-primary);
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  font-family: 'Inter', sans-serif;
}
.field-input:hover:not(.disabled) { border-color: var(--border-standard); }
.field-input:focus:not(.disabled) { border-color: var(--accent-ember); box-shadow: 0 0 0 2px rgba(245,158,11,0.12); }

.branch-list::-webkit-scrollbar { width: 6px; }
.branch-list::-webkit-scrollbar-track { background: transparent; }
.branch-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }
.branch-list::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.14); }
</style>
