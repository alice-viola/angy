<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      @click.self="onClose"
    >
      <div class="w-[480px] max-w-[480px] max-h-[85vh] bg-[var(--bg-window)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] flex flex-col overflow-hidden" style="box-shadow: var(--shadow-lg)">
        <!-- Header -->
        <div class="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
          <div class="flex items-center gap-2">
            <svg class="w-4 h-4 text-[var(--accent-teal)]" viewBox="0 0 16 16" fill="currentColor">
              <path fill-rule="evenodd" d="M5.22 14.78a.75.75 0 001.06-.22l.22-.36a1.5 1.5 0 012.5 0l.22.36a.75.75 0 001.06.22l.36-.22a.75.75 0 00.22-1.06l-.22-.36a1.5 1.5 0 010-2.5l.36-.22a.75.75 0 00.22-1.06l-.22-.36a1.5 1.5 0 01-2.5 0l-.22-.36a.75.75 0 00-1.06-.22l-.36.22a.75.75 0 00-.22 1.06l.22.36a1.5 1.5 0 010 2.5l-.36.22a.75.75 0 00-.22 1.06l.22.36z"/>
            </svg>
            <h2 class="text-sm font-semibold text-[var(--text-primary)]">Merge Epic Branches</h2>
          </div>
          <button
            class="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            @click="onClose"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <!-- Body -->
        <div class="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <!-- Setup phase -->
          <template v-if="phase === 'setup'">
            <!-- Selected epics list -->
            <div>
              <h3 class="text-xs font-semibold text-[var(--text-secondary)] mb-2">Selected Epics ({{ selectedEpics.length }})</h3>
              <div class="space-y-1.5">
                <div
                  v-for="info in epicBranchInfos"
                  :key="info.epicId"
                  class="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--bg-surface)] border border-[var(--border-subtle)]"
                >
                  <span class="text-xs text-[var(--text-primary)] flex-1 truncate">{{ info.epicName }}</span>
                  <span class="text-[9px] px-1.5 py-0.5 rounded bg-[var(--bg-raised)] text-[var(--accent-green)] font-mono truncate max-w-[200px]">
                    {{ info.branchName }}
                  </span>
                  <span class="text-[9px] text-[var(--text-muted)]">
                    {{ info.repoCount }} repo{{ info.repoCount !== 1 ? 's' : '' }}
                  </span>
                </div>
              </div>
            </div>

            <!-- Per-repo breakdown -->
            <div v-if="repoBreakdown.length > 0">
              <h3 class="text-xs font-semibold text-[var(--text-secondary)] mb-2">Per-Repo Breakdown</h3>
              <div class="space-y-1.5">
                <div
                  v-for="repo in repoBreakdown"
                  :key="repo.repoId"
                  class="px-3 py-2 rounded-[var(--radius-md)] bg-[var(--bg-surface)] border border-[var(--border-subtle)]"
                >
                  <div class="text-xs font-medium text-[var(--text-primary)] mb-1">{{ repo.repoName }}</div>
                  <div class="flex flex-wrap gap-1">
                    <span
                      v-for="branch in repo.branches"
                      :key="branch"
                      class="text-[9px] px-1.5 py-0.5 rounded bg-[var(--bg-raised)] text-[var(--accent-teal)] font-mono"
                    >
                      {{ branch }}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Target branch input -->
            <div>
              <label class="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Target Branch Name</label>
              <input
                v-model="targetBranch"
                type="text"
                placeholder="e.g. merge/sprint-42"
                class="w-full px-3 py-2 text-xs rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-teal)] transition-colors"
              />
            </div>

            <!-- Base branch selector -->
            <div>
              <label class="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Base Branch</label>
              <BranchPicker
                v-model="baseBranch"
                :repoIds="repoIdsForPicker"
                :projectId="selectedEpics[0]?.projectId ?? props.projectId"
                placeholder="Select base branch..."
                :allowCreate="false"
              />
            </div>
          </template>

          <!-- Results phase -->
          <template v-if="phase === 'merging' || phase === 'done'">
            <div v-if="phase === 'merging'" class="flex items-center gap-2 py-2">
              <span class="inline-block w-2 h-2 rounded-full bg-[var(--accent-blue)] animate-pulse" />
              <span class="text-xs text-[var(--text-secondary)]">Merging branches...</span>
            </div>

            <div v-if="mergeResults.length > 0" class="space-y-2">
              <h3 class="text-xs font-semibold text-[var(--text-secondary)]">Results</h3>
              <div
                v-for="(result, idx) in mergeResults"
                :key="idx"
                class="flex items-start gap-2 px-3 py-2 rounded-[var(--radius-md)] border"
                :class="resultRowClass(result)"
              >
                <!-- Status icon -->
                <div class="flex-shrink-0 mt-0.5">
                  <svg v-if="result.success" class="w-3.5 h-3.5 text-[var(--accent-green)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <svg v-else-if="result.conflicted" class="w-3.5 h-3.5 text-[var(--accent-red,#ef4444)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <svg v-else class="w-3.5 h-3.5 text-[var(--text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                </div>
                <!-- Info -->
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-1.5">
                    <span class="text-xs font-medium text-[var(--text-primary)]">{{ result.epicName }}</span>
                    <span class="text-[9px] text-[var(--text-muted)]">in</span>
                    <span class="text-[9px] font-medium text-[var(--text-secondary)]">{{ result.repoName }}</span>
                  </div>
                  <div class="text-[9px] font-mono text-[var(--text-muted)] truncate mt-0.5">{{ result.branchName }}</div>
                  <div v-if="!result.success && result.output" class="text-[9px] text-[var(--accent-red,#ef4444)] mt-1 whitespace-pre-wrap break-all max-h-20 overflow-y-auto">
                    {{ result.output }}
                  </div>
                </div>
              </div>
            </div>

            <!-- Summary -->
            <div v-if="phase === 'done'" class="px-3 py-2 rounded-[var(--radius-md)] bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
              <div class="flex items-center gap-2">
                <span class="text-xs text-[var(--text-secondary)]">
                  {{ successCount }} succeeded, {{ conflictCount }} conflicts, {{ failedCount }} failed
                </span>
              </div>
            </div>
          </template>
        </div>

        <!-- Footer -->
        <div class="flex items-center justify-end gap-2 px-6 py-4 border-t border-[var(--border-subtle)]">
          <template v-if="phase === 'setup'">
            <button
              class="px-3 py-1.5 text-xs rounded-[var(--radius-md)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              @click="onClose"
            >
              Cancel
            </button>
            <button
              :disabled="!canMerge"
              class="px-3 py-1.5 text-xs rounded-[var(--radius-md)] font-medium transition-colors"
              :class="canMerge
                ? 'bg-[var(--accent-teal)] text-white hover:opacity-90'
                : 'bg-[var(--bg-raised)] text-[var(--text-muted)] cursor-not-allowed'"
              @click="startMerge"
            >
              Start Merge
            </button>
          </template>
          <template v-else>
            <button
              class="px-3 py-1.5 text-xs rounded-[var(--radius-md)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              :disabled="phase === 'merging'"
              @click="onClose"
            >
              Close
            </button>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import type { MergeResult } from '@/composables/useMultiRepoGit';
import { useMultiRepoGit } from '@/composables/useMultiRepoGit';
import { useEpicStore } from '@/stores/epics';
import { useProjectsStore } from '@/stores/projects';
import BranchPicker from './BranchPicker.vue';

const props = defineProps<{
  visible: boolean;
  selectedEpicIds: string[];
  projectId: string;
}>();

const emit = defineEmits<{
  'update:visible': [value: boolean];
  close: [];
}>();

const epicStore = useEpicStore();
const projectsStore = useProjectsStore();
const { mergeEpicBranches } = useMultiRepoGit();

// ── State ──────────────────────────────────────────────────────────

type Phase = 'setup' | 'merging' | 'done';
const phase = ref<Phase>('setup');
const targetBranch = ref('');
const baseBranch = ref('master');
const mergeResults = ref<MergeResult[]>([]);

// ── Computed ───────────────────────────────────────────────────────

const selectedEpics = computed(() =>
  props.selectedEpicIds
    .map((id) => epicStore.epicById(id))
    .filter((e): e is NonNullable<typeof e> => !!e),
);

const epicBranchInfos = computed(() =>
  selectedEpics.value.map((epic) => {
    const branches = epicStore.epicBranches.get(epic.id) ?? [];
    return {
      epicId: epic.id,
      epicName: epic.title,
      branchName: epicStore.epicBranchName(epic.id) ?? '—',
      repoCount: branches.length,
      branches,
    };
  }),
);

const repoBreakdown = computed(() => {
  const repos = projectsStore.reposByProjectId(props.projectId);
  const repoMap = new Map<string, { repoId: string; repoName: string; branches: string[] }>();

  for (const info of epicBranchInfos.value) {
    for (const branch of info.branches) {
      if (!repoMap.has(branch.repoId)) {
        const repo = repos.find((r) => r.id === branch.repoId);
        repoMap.set(branch.repoId, {
          repoId: branch.repoId,
          repoName: repo?.name ?? branch.repoId.slice(0, 8),
          branches: [],
        });
      }
      repoMap.get(branch.repoId)!.branches.push(branch.branchName);
    }
  }

  return Array.from(repoMap.values());
});

const repoIdsForPicker = computed(() => {
  const ids = new Set<string>();
  for (const info of epicBranchInfos.value) {
    for (const branch of info.branches) {
      ids.add(branch.repoId);
    }
  }
  return [...ids];
});

const canMerge = computed(() =>
  targetBranch.value.trim().length > 0
  && baseBranch.value.trim().length > 0
  && selectedEpics.value.length > 0,
);

const successCount = computed(() => mergeResults.value.filter((r) => r.success).length);
const conflictCount = computed(() => mergeResults.value.filter((r) => r.conflicted).length);
const failedCount = computed(() => mergeResults.value.filter((r) => !r.success && !r.conflicted).length);

// ── Actions ────────────────────────────────────────────────────────

function onClose() {
  if (phase.value === 'merging') return;
  emit('update:visible', false);
  emit('close');
}

async function startMerge() {
  if (!canMerge.value) return;

  phase.value = 'merging';
  mergeResults.value = [];

  const repos = projectsStore.reposByProjectId(props.projectId).map((r) => ({
    id: r.id,
    name: r.name,
    path: r.path,
  }));

  const epicBranches = epicBranchInfos.value
    .map((info) => {
      const repoBranchMap = new Map<string, string>();
      for (const branch of info.branches) {
        repoBranchMap.set(branch.repoId, branch.branchName);
      }
      return {
        epicId: info.epicId,
        epicName: info.epicName,
        repoBranches: repoBranchMap,
      };
    })
    .filter((eb) => eb.repoBranches.size > 0);

  try {
    const { results } = await mergeEpicBranches(
      epicBranches,
      repos,
      targetBranch.value.trim(),
      baseBranch.value.trim(),
    );
    mergeResults.value = results;
  } catch (err) {
    console.error('[MergeEpicsDialog] Merge failed:', err);
  } finally {
    phase.value = 'done';
  }
}

function resultRowClass(result: MergeResult): string {
  if (result.success) {
    return 'border-[var(--accent-green)]/30 bg-[var(--accent-green)]/5';
  }
  if (result.conflicted) {
    return 'border-red-500/30 bg-red-500/5';
  }
  return 'border-[var(--border-subtle)] bg-[var(--bg-surface)]';
}

// ── Reset on open ──────────────────────────────────────────────────

watch(() => props.visible, (v) => {
  if (v) {
    phase.value = 'setup';
    targetBranch.value = '';
    baseBranch.value = 'master';
    mergeResults.value = [];
  }
});

// ── Keyboard ───────────────────────────────────────────────────────

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.visible) {
    onClose();
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => window.removeEventListener('keydown', onKeydown));
</script>
