<template>
  <div class="h-full w-[320px] flex flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-window)]">
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)]">
      <span class="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Epic Details</span>
      <button
        class="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        @click="$emit('close')"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <div v-if="epic" class="flex-1 overflow-y-auto px-4 py-3 space-y-4">
      <!-- Title -->
      <div>
        <label class="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Title</label>
        <input
          v-model="draft.title"
          class="mt-1 w-full text-sm px-2 py-1.5 rounded border border-[var(--border-subtle)]
                 bg-[var(--bg-base)] text-[var(--text-primary)]
                 focus:outline-none focus:border-[var(--accent-mauve)] transition-colors"
        />
      </div>

      <!-- Column -->
      <div>
        <label class="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Column</label>
        <select
          v-model="draft.column"
          class="mt-1 w-full text-sm px-2 py-1.5 rounded border border-[var(--border-subtle)]
                 bg-[var(--bg-base)] text-[var(--text-primary)]
                 focus:outline-none focus:border-[var(--accent-mauve)] transition-colors"
        >
          <option v-for="col in columns" :key="col" :value="col">
            {{ col.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) }}
          </option>
        </select>
      </div>

      <!-- Description -->
      <div>
        <label class="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Description</label>
        <textarea
          v-model="draft.description"
          rows="4"
          class="mt-1 w-full text-sm px-2 py-1.5 rounded border border-[var(--border-subtle)]
                 bg-[var(--bg-base)] text-[var(--text-primary)] resize-y
                 focus:outline-none focus:border-[var(--accent-mauve)] transition-colors"
          placeholder="Markdown description..."
        />
      </div>

      <!-- Acceptance Criteria -->
      <div>
        <label class="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Acceptance Criteria</label>
        <textarea
          v-model="draft.acceptanceCriteria"
          rows="3"
          class="mt-1 w-full text-sm px-2 py-1.5 rounded border border-[var(--border-subtle)]
                 bg-[var(--bg-base)] text-[var(--text-primary)] resize-y
                 focus:outline-none focus:border-[var(--accent-mauve)] transition-colors"
          placeholder="What defines done..."
        />
      </div>

      <!-- Pipeline Type -->
      <div>
        <label class="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Pipeline</label>
        <div class="mt-1 flex items-center gap-1">
          <button
            v-for="pt in pipelineTypes"
            :key="pt.value"
            class="flex-1 text-[10px] py-1.5 rounded border font-medium transition-colors"
            :class="draft.pipelineType === pt.value
              ? pt.value === 'create'
                ? 'text-[var(--accent-green)] bg-[color-mix(in_srgb,var(--accent-green)_12%,transparent)] border-[color-mix(in_srgb,var(--accent-green)_30%,transparent)]'
                : 'text-[var(--accent-peach)] bg-[color-mix(in_srgb,var(--accent-peach)_12%,transparent)] border-[color-mix(in_srgb,var(--accent-peach)_30%,transparent)]'
              : 'text-[var(--text-muted)] bg-[var(--bg-base)] border-[var(--border-subtle)] hover:text-[var(--text-secondary)]'"
            @click="draft.pipelineType = pt.value"
          >
            {{ pt.label }}
          </button>
        </div>
        <p class="mt-1 text-[9px] text-[var(--text-muted)]">
          {{ draft.pipelineType === 'create' ? 'Architect → Implement → Validate → Review' : 'Diagnose → Debug → Fix → Validate → Review' }}
        </p>
      </div>

      <!-- Priority & Complexity row -->
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Priority</label>
          <select
            v-model="draft.priorityHint"
            class="mt-1 w-full text-sm px-2 py-1.5 rounded border border-[var(--border-subtle)]
                   bg-[var(--bg-base)] text-[var(--text-primary)]
                   focus:outline-none focus:border-[var(--accent-mauve)] transition-colors"
          >
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="none">None</option>
          </select>
        </div>
        <div>
          <label class="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Complexity</label>
          <select
            v-model="draft.complexity"
            class="mt-1 w-full text-sm px-2 py-1.5 rounded border border-[var(--border-subtle)]
                   bg-[var(--bg-base)] text-[var(--text-primary)]
                   focus:outline-none focus:border-[var(--accent-mauve)] transition-colors"
          >
            <option value="trivial">Trivial</option>
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
            <option value="epic">Epic</option>
          </select>
        </div>
      </div>

      <!-- Model -->
      <div>
        <label class="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Model</label>
        <select
          v-model="draft.model"
          class="mt-1 w-full text-sm px-2 py-1.5 rounded border border-[var(--border-subtle)]
                 bg-[var(--bg-base)] text-[var(--text-primary)]
                 focus:outline-none focus:border-[var(--accent-mauve)] transition-colors"
        >
          <option value="">Default (CLI default)</option>
          <option value="claude-sonnet-4-6">Sonnet 4.6</option>
          <option value="claude-opus-4-6">Opus 4.6</option>
          <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
        </select>
      </div>

      <!-- Target Repos -->
      <div>
        <label class="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Target Repos</label>
        <div class="mt-1">
          <RepoScopeSelector
            :projectId="epic.projectId"
            v-model="draft.targetRepoIds"
          />
        </div>
      </div>

      <!-- Use git branch -->
      <div class="flex items-center justify-between">
        <label class="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Use git branch</label>
        <button
          class="relative w-7 h-4 rounded-full transition-colors"
          :class="draft.useGitBranch ? 'bg-[var(--accent-green)]' : 'bg-[var(--bg-raised)]'"
          @click="draft.useGitBranch = !draft.useGitBranch"
        >
          <span
            class="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform"
            :class="draft.useGitBranch ? 'left-3.5' : 'left-0.5'"
          />
        </button>
      </div>

      <!-- Active branch -->
      <div v-if="branchName" class="flex items-center gap-2 mt-2">
        <label class="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Branch</label>
        <span class="text-xs font-mono text-[var(--accent-green)] bg-[var(--bg-raised)] px-2 py-0.5 rounded select-all" :title="branchName">
          {{ branchName }}
        </span>
      </div>

      <!-- Dependencies -->
      <div>
        <label class="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Dependencies</label>
        <div class="mt-1 space-y-1">
          <div
            v-for="depId in draft.dependsOn"
            :key="depId"
            class="flex items-center justify-between px-2 py-1 rounded text-sm bg-[var(--bg-raised)]"
          >
            <span class="text-[var(--text-secondary)] truncate">{{ depTitle(depId) }}</span>
            <button
              class="text-[var(--text-muted)] hover:text-red-400 transition-colors ml-2 shrink-0"
              @click="removeDep(depId)"
            >
              <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <!-- Add dependency -->
          <select
            v-if="availableDeps.length > 0"
            class="w-full text-xs px-2 py-1 rounded border border-dashed border-[var(--border-subtle)]
                   bg-[var(--bg-base)] text-[var(--text-muted)]
                   focus:outline-none focus:border-[var(--accent-mauve)] transition-colors"
            @change="addDep(($event.target as HTMLSelectElement).value); ($event.target as HTMLSelectElement).value = ''"
          >
            <option value="">+ Add dependency...</option>
            <option v-for="dep in availableDeps" :key="dep.id" :value="dep.id">{{ dep.title }}</option>
          </select>
        </div>
      </div>

      <!-- Review actions -->
      <div v-if="epic.column === 'review'" class="space-y-2">
        <textarea
          v-model="rejectionFeedback"
          rows="2"
          class="w-full text-xs px-2 py-1.5 rounded border border-[var(--border-subtle)]
                 bg-[var(--bg-base)] text-[var(--text-primary)] resize-y
                 focus:outline-none focus:border-[var(--accent-mauve)] transition-colors"
          placeholder="Rejection feedback (optional)..."
        />
        <div class="flex items-center gap-2">
          <button
            class="flex-1 text-xs py-1.5 rounded bg-[var(--accent-green)] text-[var(--bg-base)] font-medium
                   hover:opacity-90 transition-opacity"
            @click="approve"
          >
            Approve
          </button>
          <button
            class="flex-1 text-xs py-1.5 rounded bg-[var(--accent-red)] text-white font-medium
                   hover:opacity-90 transition-opacity"
            @click="reject"
          >
            Reject
          </button>
        </div>
      </div>

      <!-- In-progress actions -->
      <div v-if="epic.column === 'in-progress'" class="flex items-center gap-2">
        <button
          class="flex-1 text-xs py-1.5 rounded border border-[var(--accent-blue)]
                 text-[var(--accent-blue)] font-medium hover:bg-[var(--accent-blue)]
                 hover:text-[var(--bg-base)] transition-colors"
          @click="ui.navigateToEpic(epic.id, epic.projectId)"
        >
          Open Workspace
        </button>
        <button
          class="text-xs py-1.5 px-3 rounded border border-red-500/50
                 text-red-400 font-medium hover:bg-red-500/10 transition-colors"
          @click="stopEpic"
        >
          Stop
        </button>
      </div>
    </div>

    <!-- Footer actions -->
    <div v-if="epic" class="flex items-center gap-2 px-4 py-3 border-t border-[var(--border-subtle)]">
      <button
        class="flex-1 text-xs py-1.5 rounded bg-[var(--accent-mauve)] text-[var(--bg-base)] font-medium
               hover:opacity-90 transition-opacity"
        @click="save"
      >
        Save
      </button>
      <button
        class="text-xs py-1.5 px-3 rounded border border-red-500/30 text-red-400
               hover:bg-red-500/10 transition-colors"
        @click="remove"
      >
        Delete
      </button>
    </div>

    <!-- Empty state -->
    <div v-if="!epic" class="flex-1 flex items-center justify-center">
      <p class="text-xs text-[var(--text-muted)] italic">No epic selected</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { EpicColumn, EpicPipelineType, PriorityHint, ComplexityEstimate } from '@/engine/KosTypes';
import { useUiStore } from '@/stores/ui';
import { useEpicStore } from '@/stores/epics';
import { Scheduler } from '@/engine/Scheduler';
import { engineBus } from '@/engine/EventBus';
import RepoScopeSelector from './RepoScopeSelector.vue';

const props = defineProps<{ epicId: string }>();
const emit = defineEmits<{ close: [] }>();

const ui = useUiStore();
const epicStore = useEpicStore();

const columns: EpicColumn[] = ['idea', 'backlog', 'todo', 'in-progress', 'review', 'done'];
const pipelineTypes: Array<{ value: EpicPipelineType; label: string }> = [
  { value: 'create', label: 'Create' },
  { value: 'fix', label: 'Fix' },
];

const epic = computed(() => epicStore.epicById(props.epicId));
const branchName = computed(() => epicStore.epicBranchName(props.epicId));

const draft = ref({
  title: '',
  column: 'idea' as EpicColumn,
  description: '',
  acceptanceCriteria: '',
  priorityHint: 'medium' as PriorityHint,
  complexity: 'medium' as ComplexityEstimate,
  model: '',
  targetRepoIds: [] as string[],
  pipelineType: 'create' as EpicPipelineType,
  useGitBranch: true,
  dependsOn: [] as string[],
});

watch(() => props.epicId, loadDraft, { immediate: true });

function loadDraft() {
  const e = epicStore.epicById(props.epicId);
  if (!e) return;
  draft.value = {
    title: e.title,
    column: e.column,
    description: e.description,
    acceptanceCriteria: e.acceptanceCriteria,
    priorityHint: e.priorityHint,
    complexity: e.complexity,
    model: e.model || '',
    targetRepoIds: [...e.targetRepoIds],
    pipelineType: e.pipelineType || 'create',
    useGitBranch: e.useGitBranch ?? true,
    dependsOn: [...e.dependsOn],
  };
}

function depTitle(id: string) {
  return epicStore.epicById(id)?.title ?? id.slice(0, 12);
}

const availableDeps = computed(() => {
  if (!epic.value) return [];
  return epicStore.epicsByProject(epic.value.projectId)
    .filter((e) => e.id !== props.epicId && !draft.value.dependsOn.includes(e.id));
});

function addDep(id: string) {
  if (id && !draft.value.dependsOn.includes(id)) {
    draft.value.dependsOn.push(id);
  }
}

function removeDep(id: string) {
  draft.value.dependsOn = draft.value.dependsOn.filter((d) => d !== id);
}

async function save() {
  const d = draft.value;
  if (d.column !== epic.value?.column) {
    if (d.column === 'in-progress') {
      // Route through scheduler so an orchestrator is spawned
      console.log(`[EpicDetailPanel] Requesting start for epic: ${props.epicId}`);
      engineBus.emit('epic:requestStart', { epicId: props.epicId });
    } else {
      await epicStore.moveEpic(props.epicId, d.column);
    }
  }
  await epicStore.updateEpic(props.epicId, {
    title: d.title,
    description: d.description,
    acceptanceCriteria: d.acceptanceCriteria,
    priorityHint: d.priorityHint,
    complexity: d.complexity,
    model: d.model,
    targetRepoIds: d.targetRepoIds,
    pipelineType: d.pipelineType,
    useGitBranch: d.useGitBranch,
    dependsOn: d.dependsOn,
  });
}

async function remove() {
  await epicStore.deleteEpic(props.epicId);
  emit('close');
}

function stopEpic() {
  engineBus.emit('epic:requestStop', { epicId: props.epicId });
  loadDraft();
}

const rejectionFeedback = ref('');

async function approve() {
  await Scheduler.getInstance().approveEpic(props.epicId);
  loadDraft();
}

async function reject() {
  const feedback = rejectionFeedback.value || 'Changes requested';
  await Scheduler.getInstance().rejectEpic(props.epicId, feedback);
  rejectionFeedback.value = '';
  loadDraft();
}
</script>
