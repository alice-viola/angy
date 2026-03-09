<template>
  <div class="h-full w-[480px] flex flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-window)]">
    <!-- Header -->
    <div class="flex items-center justify-between px-5 py-3 border-b border-[var(--border-subtle)]">
      <span class="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
        {{ isNew ? 'New Epic' : 'Epic Details' }}
      </span>
      <button
        class="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        @click="$emit('close')"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <div v-if="epic" class="flex-1 overflow-y-auto px-5 py-4 space-y-5">

      <!-- SECTION 1: Definition (always open, no collapse) -->
      <section class="space-y-3">
        <h3 class="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Definition</h3>
          <!-- Title -->
          <div>
            <label class="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Title</label>
            <input
              ref="titleInput"
              v-model="draft.title"
              class="mt-1 w-full text-sm px-2 py-1.5 rounded border border-[var(--border-subtle)]
                     bg-[var(--bg-base)] text-[var(--text-primary)]
                     focus:outline-none focus:border-[var(--accent-mauve)] transition-colors"
            />
          </div>

          <!-- Pipeline Type -->
          <div>
            <label class="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Pipeline</label>
            <div class="mt-1 flex items-center gap-1">
              <button
                v-for="pt in pipelineTypes"
                :key="pt.value"
                class="flex-1 text-[10px] py-1.5 rounded border font-medium transition-colors"
                :class="draft.pipelineType !== pt.value
                  ? 'text-[var(--text-muted)] bg-[var(--bg-base)] border-[var(--border-subtle)] hover:text-[var(--text-secondary)]'
                  : ''"
                :style="pipelineButtonStyle(pt.value)"
                @click="draft.pipelineType = pt.value"
              >
                {{ pt.label }}
              </button>
            </div>
            <p class="mt-1 text-[10px] text-[var(--text-muted)]">
              {{ pipelineDescriptions[draft.pipelineType] }}
            </p>
          </div>

          <!-- Description -->
          <div>
            <label class="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Description</label>
            <textarea
              v-model="draft.description"
              rows="6"
              class="mt-1 w-full text-sm px-2 py-1.5 rounded border border-[var(--border-subtle)]
                     bg-[var(--bg-base)] text-[var(--text-primary)] resize-y
                     focus:outline-none focus:border-[var(--accent-mauve)] transition-colors"
              placeholder="Markdown description..."
            />
          </div>

          <!-- Acceptance Criteria -->
          <div>
            <label class="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Acceptance Criteria</label>
            <textarea
              v-model="draft.acceptanceCriteria"
              rows="4"
              class="mt-1 w-full text-sm px-2 py-1.5 rounded border border-[var(--border-subtle)]
                     bg-[var(--bg-base)] text-[var(--text-primary)] resize-y
                     focus:outline-none focus:border-[var(--accent-mauve)] transition-colors"
              placeholder="What defines done..."
            />
          </div>
      </section>

      <!-- SECTION 2: Configuration (collapsible, default expanded) -->
      <section class="border-t border-[var(--border-subtle)] pt-4 space-y-3">
        <button
          class="w-full flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider hover:text-[var(--text-secondary)] transition-colors"
          @click="configOpen = !configOpen"
        >
          <svg
            class="w-3 h-3 transition-transform duration-150"
            :class="configOpen ? 'rotate-90' : ''"
            fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          Configuration
        </button>
        <div v-show="configOpen" class="space-y-3">
          <!-- Priority & Complexity row -->
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Priority</label>
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
              <label class="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Complexity</label>
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
            <label class="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Model</label>
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
            <label class="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Target Repos</label>
            <div class="mt-1">
              <RepoScopeSelector
                :projectId="epic.projectId"
                v-model="draft.targetRepoIds"
              />
            </div>
          </div>

          <!-- Auto branch -->
          <div>
            <div class="flex items-center justify-between">
              <label class="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Auto branch</label>
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
            <p class="text-[10px] text-[var(--text-muted)] mt-1">
              {{ draft.useGitBranch ? 'Creates a branch for this epic, restores default when done' : 'Agents work on the current branch' }}
            </p>
          </div>

          <!-- Working branch -->
          <div v-if="branchName" class="flex items-center gap-2">
            <label class="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Branch</label>
            <span class="text-xs font-mono text-[var(--accent-green)] bg-[var(--bg-raised)] px-2 py-0.5 rounded select-all" :title="branchName">
              {{ branchName }}
            </span>
          </div>
        </div>
      </section>

      <!-- SECTION 3: Scheduling (collapsible, default collapsed) -->
      <section class="border-t border-[var(--border-subtle)] pt-4 space-y-3">
        <button
          class="w-full flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider hover:text-[var(--text-secondary)] transition-colors"
          @click="schedOpen = !schedOpen"
        >
          <svg
            class="w-3 h-3 transition-transform duration-150"
            :class="schedOpen ? 'rotate-90' : ''"
            fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          Scheduling
        </button>
        <div v-show="schedOpen" class="space-y-3">
          <!-- Column -->
          <div>
            <label class="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Column</label>
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

          <!-- Dependencies -->
          <div>
            <label class="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Dependencies</label>
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
        </div>
      </section>

      <!-- Review actions -->
      <div v-if="epic.column === 'review'" class="space-y-2 pt-2">
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
      <div v-if="epic.column === 'in-progress'" class="flex items-center gap-2 pt-2">
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
    <div v-if="epic" class="flex items-center gap-2 px-5 py-3 border-t border-[var(--border-subtle)]">
      <button
        class="flex-1 text-xs py-1.5 rounded bg-[var(--accent-mauve)] text-[var(--bg-base)] font-medium
               hover:opacity-90 transition-opacity"
        @click="save"
      >
        {{ isNew ? 'Create' : 'Save' }}
      </button>
      <button
        v-if="!isNew"
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
import { ref, computed, watch, nextTick } from 'vue';
import type { EpicColumn, EpicPipelineType, PriorityHint, ComplexityEstimate } from '@/engine/KosTypes';
import { useUiStore } from '@/stores/ui';
import { useEpicStore } from '@/stores/epics';
import { Scheduler } from '@/engine/Scheduler';
import { engineBus } from '@/engine/EventBus';
import RepoScopeSelector from './RepoScopeSelector.vue';

const props = defineProps<{ epicId: string; isNew?: boolean }>();
const emit = defineEmits<{ close: []; created: [] }>();

const ui = useUiStore();
const epicStore = useEpicStore();

const columns: EpicColumn[] = ['idea', 'backlog', 'todo', 'in-progress', 'review', 'done', 'discarded'];
const pipelineTypes: Array<{ value: EpicPipelineType; label: string }> = [
  { value: 'create', label: 'Create' },
  { value: 'fix', label: 'Fix' },
  { value: 'investigate', label: 'Investigate' },
  { value: 'plan', label: 'Plan' },
];

const pipelineColors: Record<EpicPipelineType, string> = {
  create: 'var(--accent-green)',
  fix: 'var(--accent-peach)',
  investigate: 'var(--accent-blue)',
  plan: 'var(--accent-lavender)',
};

const pipelineDescriptions: Record<EpicPipelineType, string> = {
  create: 'Architect → Implement → Test → Review',
  fix: 'Diagnose → Debug → Fix → Test → Review',
  investigate: 'Analyze → Investigate → Report (read-only)',
  plan: 'Analyze → Design → Plan (read-only)',
};

function pipelineButtonStyle(ptValue: EpicPipelineType) {
  if (draft.value.pipelineType !== ptValue) return {};
  const color = pipelineColors[ptValue];
  return {
    color: color,
    backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
    borderColor: `color-mix(in srgb, ${color} 30%, transparent)`,
  };
}

const epic = computed(() => epicStore.epicById(props.epicId));
const branchName = computed(() => epicStore.epicBranchName(props.epicId));

const configOpen = ref(true);
const schedOpen = ref(false);
const titleInput = ref<HTMLInputElement | null>(null);

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
  useGitBranch: false,
  dependsOn: [] as string[],
});

watch(() => props.epicId, loadDraft, { immediate: true });

watch(() => props.isNew, (val) => {
  if (val) {
    nextTick(() => {
      titleInput.value?.focus();
      titleInput.value?.select();
    });
  }
}, { immediate: true });

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
  if (props.isNew) {
    emit('created');
  }
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
