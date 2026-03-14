<template>
  <div class="h-full w-[440px] flex flex-col border-l border-border-subtle bg-window" style="box-shadow: -12px 0 40px -8px rgba(0,0,0,0.5)">
    <!-- Header -->
    <div class="flex items-center gap-2.5 px-5 h-11 border-b border-border-subtle shrink-0">
      <div class="w-1.5 h-1.5 rounded-full bg-mauve"></div>
      <span class="text-[11px] font-semibold text-mauve uppercase tracking-widest">
        {{ isNew ? 'New Epic' : 'Epic Details' }}
      </span>
      <span class="flex-1"></span>
      <button
        class="w-6 h-6 flex items-center justify-center rounded-md text-txt-faint hover:text-txt-primary hover:bg-raised transition-colors"
        @click="$emit('close')"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <div v-if="epic" class="flex-1 overflow-y-auto scroll-area">

      <!-- Blocking reasons -->
      <div
        v-if="(epic.column === 'todo' || epic.column === 'backlog') && epicStore.getBlockingReasons(epic.id).length > 0"
        class="px-5 pt-4 pb-2 flex flex-wrap gap-1.5"
      >
        <span
          v-for="reason in epicStore.getBlockingReasons(epic.id)"
          :key="reason.type + (reason.relatedEpicId ?? '')"
          :class="reasonClass(reason)"
        >{{ reason.label }}</span>
      </div>

      <!-- Definition -->
      <div class="px-5 pt-5 pb-5 space-y-5">

        <!-- Title (inline editing, no box) -->
        <input
          ref="titleInput"
          v-model="draft.title"
          type="text"
          class="w-full text-[16px] font-semibold text-txt-primary bg-transparent outline-none border-b-2 border-transparent
                 hover:border-border-standard focus:border-mauve pb-1.5 transition-colors placeholder:text-txt-faint placeholder:font-normal"
          placeholder="Epic title..."
        />

        <!-- Pipeline -->
        <div class="space-y-2">
          <span class="field-label">Pipeline</span>
          <div class="flex gap-1.5">
            <button
              v-for="pt in pipelineTypes"
              :key="pt.value"
              class="pipe-btn"
              :class="draft.pipelineType === pt.value ? `active-${pt.value === 'hybrid' ? 'create' : pt.value}` : ''"
              @click="draft.pipelineType = pt.value"
            >
              {{ pt.label }}
            </button>
          </div>
          <p class="text-[11px] text-txt-faint leading-relaxed">
            {{ pipelineDescriptions[draft.pipelineType] }}
          </p>
        </div>

        <!-- Complexity + Priority side-by-side -->
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1.5">
            <span class="field-label">Complexity</span>
            <select
              v-model="draft.complexity"
              :disabled="draft.pipelineType !== 'hybrid'"
              class="field-input"
            >
              <option value="trivial">Trivial</option>
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
              <option value="epic">Epic</option>
            </select>
          </div>
          <div class="space-y-1.5">
            <span class="field-label">Priority</span>
            <select v-model="draft.priorityHint" class="field-input">
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
              <option value="none">None</option>
            </select>
          </div>
        </div>

        <p v-if="draft.pipelineType === 'hybrid'" class="text-[11px] text-txt-faint leading-relaxed -mt-2">
          {{ complexityDescriptions[draft.complexity] }}
        </p>

        <!-- Description -->
        <div class="space-y-1.5">
          <span class="field-label">Description</span>
          <textarea
            v-model="draft.description"
            rows="4"
            class="field-input"
            placeholder="What should be built and why..."
          />
        </div>

        <!-- Acceptance Criteria -->
        <div class="space-y-1.5">
          <span class="field-label">Acceptance criteria</span>
          <textarea
            v-model="draft.acceptanceCriteria"
            rows="3"
            class="field-input"
            placeholder="What defines done..."
          />
        </div>
      </div>

      <!-- Configuration (collapsible, default expanded) -->
      <section class="border-t border-border-subtle">
        <button
          class="w-full flex items-center gap-2 px-5 h-10 hover:bg-white/[0.015] transition-colors"
          @click="configOpen = !configOpen"
        >
          <svg
            class="w-3 h-3 transition-transform duration-150 text-txt-faint"
            :class="configOpen ? 'rotate-90' : ''"
            fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span class="text-[11px] font-semibold text-txt-muted uppercase tracking-wider">Configuration</span>
        </button>
        <div v-show="configOpen" class="px-5 pb-5 pt-1 space-y-4">
          <!-- Model -->
          <div class="space-y-1.5">
            <span class="field-label">Model</span>
            <select v-model="draft.model" class="field-input">
              <option value="">Default (CLI default)</option>
              <option value="claude-sonnet-4-6">Sonnet 4.6</option>
              <option value="claude-opus-4-6">Opus 4.6</option>
              <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
            </select>
          </div>

          <!-- Target Repos -->
          <div class="space-y-2">
            <span class="field-label">Target repos</span>
            <RepoScopeSelector
              :projectId="epic.projectId"
              v-model="draft.targetRepoIds"
            />
          </div>

          <!-- Git branch -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="field-label">Git branch</span>
              <button
                class="panel-toggle"
                :class="draft.useGitBranch ? 'on' : 'off'"
                @click="draft.useGitBranch = !draft.useGitBranch"
              />
            </div>
            <p class="text-[11px] text-txt-faint leading-relaxed">
              {{ draft.useGitBranch ? 'Creates a branch for this epic, restores default when done' : 'Agents work on the current branch' }}
            </p>
            <div v-if="branchName" class="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-base border border-border-subtle">
              <svg class="w-3.5 h-3.5 text-teal flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>
              </svg>
              <span class="text-[12px] font-mono text-teal truncate select-all" :title="branchName">
                {{ branchName }}
              </span>
            </div>
          </div>

          <!-- Worktree mode -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="field-label">Worktree mode</span>
              <button
                class="panel-toggle"
                :class="draft.useWorktree ? 'on' : 'off'"
                @click="draft.useWorktree = !draft.useWorktree"
              />
            </div>
            <p class="text-[11px] text-txt-faint leading-relaxed">
              {{ draft.useWorktree ? 'Uses a separate git worktree — no branch switching in the main repo' : 'Agents work in the main repo checkout' }}
            </p>
            <div v-if="draft.useWorktree" class="space-y-1.5">
              <label class="field-label">Base branch</label>
              <BranchPicker
                v-model="draft.baseBranch"
                :repoIds="epicRepoIds"
                :projectId="epic!.projectId"
                placeholder="Base branch..."
                :disabled="!!draft.runAfter"
              />
              <p v-if="!!draft.runAfter" class="text-[11px] text-txt-faint">Inherited from predecessor</p>
            </div>
          </div>
        </div>
      </section>

      <!-- Scheduling (collapsible, default collapsed) -->
      <section class="border-t border-border-subtle">
        <button
          class="w-full flex items-center gap-2 px-5 h-10 hover:bg-white/[0.015] transition-colors"
          @click="schedOpen = !schedOpen"
        >
          <svg
            class="w-3 h-3 transition-transform duration-150 text-txt-faint"
            :class="schedOpen ? 'rotate-90' : ''"
            fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span class="text-[11px] font-semibold text-txt-muted uppercase tracking-wider">Scheduling</span>
        </button>
        <div v-show="schedOpen" class="px-5 pb-5 pt-1 space-y-4">
          <!-- Column -->
          <div class="space-y-1.5">
            <span class="field-label">Column</span>
            <select v-model="draft.column" class="field-input">
              <option v-for="col in columns" :key="col" :value="col">
                {{ col.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) }}
              </option>
            </select>
          </div>

          <!-- Run after -->
          <div class="space-y-1.5">
            <span class="field-label">Run after</span>
            <div v-if="draft.runAfter" class="dep-row">
              <svg class="w-3.5 h-3.5 text-mauve flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13 5l7 7-7 7M5 12h15" />
              </svg>
              <span class="text-[12px] text-txt-secondary truncate">{{ runAfterTitle(draft.runAfter) }}</span>
              <button class="dep-remove" title="Remove" @click="clearRunAfter">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <select
              v-else-if="availableRunAfter.length > 0"
              class="field-input-dashed"
              @change="setRunAfter(($event.target as HTMLSelectElement).value); ($event.target as HTMLSelectElement).value = ''"
            >
              <option value="">Run after...</option>
              <option v-for="e in availableRunAfter" :key="e.id" :value="e.id">{{ e.title }}</option>
            </select>
            <p v-else-if="availableRunAfter.length === 0 && !draft.runAfter" class="text-[11px] text-txt-faint italic">No other epics in project</p>
          </div>

          <!-- Dependencies -->
          <div class="space-y-2">
            <span class="field-label">Dependencies</span>
            <div class="space-y-1.5">
              <div v-for="depId in draft.dependsOn" :key="depId" class="dep-row">
                <span class="w-1.5 h-1.5 rounded-full bg-ember flex-shrink-0"></span>
                <span class="text-[12px] text-txt-secondary truncate">{{ depTitle(depId) }}</span>
                <button class="dep-remove" @click="removeDep(depId)">
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <select
                v-if="availableDeps.length > 0"
                class="field-input-dashed"
                @change="addDep(($event.target as HTMLSelectElement).value); ($event.target as HTMLSelectElement).value = ''"
              >
                <option value="">+ Add dependency...</option>
                <option v-for="dep in availableDeps" :key="dep.id" :value="dep.id">{{ dep.title }}</option>
              </select>
            </div>
          </div>
        </div>
      </section>

      <!-- Review actions (contextual) -->
      <div v-if="epic.column === 'review'" class="border-t border-border-subtle px-5 py-4 space-y-3">
        <div class="flex items-center gap-2.5">
          <span class="text-[11px] font-semibold text-txt-muted uppercase tracking-wider">Review</span>
          <span class="text-[10px] text-[var(--accent-peach)] bg-[rgba(250,179,135,0.08)] px-2 py-0.5 rounded-full font-medium border border-[rgba(250,179,135,0.12)]">needs review</span>
        </div>
        <textarea
          v-model="rejectionFeedback"
          rows="2"
          class="field-input"
          placeholder="Rejection feedback (optional)..."
        />
        <div class="flex gap-2">
          <button class="btn-primary flex-1" style="background: #10b981" @click="approve">
            Approve
          </button>
          <button class="btn-primary flex-1" style="background: #f38ba8; color: white" @click="reject">
            Reject
          </button>
        </div>
      </div>

      <!-- In-progress actions (contextual) -->
      <div v-if="epic.column === 'in-progress'" class="border-t border-border-subtle px-5 py-4">
        <div class="flex items-center gap-2">
          <button
            class="flex-1 py-2 text-[13px] font-medium rounded-lg border border-blue text-blue hover:bg-[rgba(137,180,250,0.08)] transition-colors"
            @click="ui.navigateToEpic(epic.id, epic.projectId)"
          >
            Open Workspace
          </button>
          <button
            class="py-2 px-4 text-[13px] font-medium rounded-lg border border-[rgba(249,115,22,0.3)] text-ember-400 hover:bg-[rgba(249,115,22,0.06)] transition-colors"
            @click="suspendEpic"
          >
            Suspend
          </button>
          <button
            class="py-2 px-4 text-[13px] font-medium rounded-lg border border-[rgba(243,139,168,0.3)] text-[var(--accent-red)] hover:bg-[rgba(243,139,168,0.06)] transition-colors"
            @click="stopEpic"
          >
            Stop
          </button>
        </div>
      </div>

      <!-- Suspended banner (contextual) -->
      <div
        v-if="epic.suspendedAt && (epic.column === 'todo' || epic.column === 'backlog')"
        class="mx-5 my-4 flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[rgba(249,115,22,0.06)] border border-[rgba(249,115,22,0.12)]"
      >
        <span class="text-[12px] text-ember-400 flex-1">This epic was suspended.</span>
        <button
          class="text-[12px] py-1 px-3 rounded-lg bg-[rgba(249,115,22,0.12)] text-ember-400 font-medium hover:bg-[rgba(249,115,22,0.18)] transition-colors"
          @click="resumeEpic"
        >
          Resume
        </button>
      </div>

      <!-- Done actions: Create PR (contextual) -->
      <div v-if="epic.column === 'done' && branchName" class="border-t border-border-subtle px-5 py-4 space-y-3">
        <div class="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-base border border-border-subtle">
          <svg class="w-3.5 h-3.5 text-teal flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>
          </svg>
          <span class="text-[12px] font-mono text-teal truncate" :title="branchName">
            {{ branchName }}
          </span>
        </div>
        <button
          class="btn-primary"
          style="background: #10b981"
          :disabled="prLoading"
          @click="createPR(epic.id, epic.projectId)"
        >
          {{ prLoading ? 'Pushing & Opening PR...' : 'Create Pull Request' }}
        </button>
        <p v-if="prError" class="text-[11px] text-[var(--accent-red)]">{{ prError }}</p>
      </div>

      <div class="h-2"></div>
    </div>

    <!-- Footer -->
    <div v-if="epic" class="px-5 py-3 border-t border-border-subtle shrink-0 bg-window flex items-center gap-2">
      <button class="btn-primary flex-1" style="background: #cba6f7" @click="save">
        {{ isNew ? 'Create' : 'Save' }}
      </button>
      <button
        v-if="!isNew"
        class="text-[13px] py-2.5 px-4 rounded-lg border border-[rgba(243,139,168,0.2)] text-[var(--accent-red)]
               hover:bg-[rgba(243,139,168,0.06)] transition-colors font-medium"
        @click="remove"
      >
        Delete
      </button>
    </div>

    <!-- Empty state -->
    <div v-if="!epic" class="flex-1 flex items-center justify-center">
      <p class="text-[12px] text-txt-muted italic">No epic selected</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import type { EpicColumn, EpicPipelineType, PriorityHint, ComplexityEstimate } from '@/engine/KosTypes';
import { useUiStore } from '@/stores/ui';
import { useEpicStore } from '@/stores/epics';
import { useProjectsStore } from '@/stores/projects';
import { Scheduler } from '@/engine/Scheduler';
import { engineBus } from '@/engine/EventBus';
import { useCreatePR } from '@/composables/useCreatePR';
import RepoScopeSelector from './RepoScopeSelector.vue';
import BranchPicker from './BranchPicker.vue';
import type { BlockingReason } from '@/engine/KosTypes';

const props = defineProps<{ epicId: string; isNew?: boolean }>();
const emit = defineEmits<{ close: []; created: [] }>();

const ui = useUiStore();
const epicStore = useEpicStore();
const { loading: prLoading, error: prError, createPR } = useCreatePR();

const columns: EpicColumn[] = ['idea', 'backlog', 'todo', 'in-progress', 'review', 'done', 'discarded'];
const pipelineTypes: Array<{ value: EpicPipelineType; label: string }> = [
  { value: 'hybrid', label: 'Create' },
  { value: 'fix', label: 'Fix' },
  { value: 'investigate', label: 'Investigate' },
  { value: 'plan', label: 'Plan' },
];

const pipelineDescriptions: Record<EpicPipelineType, string> = {
  hybrid: 'Plan → Incremental Build → Verify → Review → Test',
  fix: 'Diagnose → Debug → Fix → Test → Review',
  investigate: 'Analyze → Investigate → Report (read-only)',
  plan: 'Analyze → Design → Plan (read-only)',
};

const complexityDescriptions: Record<ComplexityEstimate, string> = {
  trivial: 'Single builder, no architect. For typo fixes and one-line changes.',
  small: 'Light architect, one builder pass. For small features or bug fixes.',
  medium: 'Full architect + scoped builders. For features spanning backend or frontend.',
  large: 'Multi-turn architect + design system + scoped builders. For large features.',
  epic: 'Full pipeline with verification protocol + integration testing. For new projects.',
};

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
  pipelineType: 'hybrid' as EpicPipelineType,
  useGitBranch: false,
  useWorktree: false,
  baseBranch: null as string | null,
  dependsOn: [] as string[],
  runAfter: null as string | null,
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
    pipelineType: e.pipelineType || 'hybrid',
    useGitBranch: e.useGitBranch ?? true,
    useWorktree: e.useWorktree ?? false,
    baseBranch: e.baseBranch ?? null,
    dependsOn: [...e.dependsOn],
    runAfter: e.runAfter ?? null,
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

const availableRunAfter = computed(() => {
  if (!epic.value) return [];
  return epicStore.epicsByProject(epic.value.projectId)
    .filter(e =>
      e.id !== props.epicId &&
      !epicStore.wouldCreateRunAfterCycle(props.epicId, e.id),
    );
});

function runAfterTitle(id: string) {
  return epicStore.epicById(id)?.title ?? id.slice(0, 12);
}

function setRunAfter(id: string) {
  draft.value.runAfter = id || null;
}

function clearRunAfter() {
  draft.value.runAfter = null;
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
    useWorktree: d.useWorktree,
    baseBranch: d.baseBranch,
    dependsOn: d.dependsOn,
    runAfter: d.runAfter,
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

function suspendEpic() {
  engineBus.emit('epic:requestSuspend', { epicId: props.epicId });
  loadDraft();
}

function resumeEpic() {
  engineBus.emit('epic:requestStart', { epicId: props.epicId });
}

const epicRepoIds = computed(() => {
  if (!epic.value) return [];
  if (draft.value.targetRepoIds.length > 0) return draft.value.targetRepoIds;
  const projectsStore = useProjectsStore();
  return projectsStore.reposByProjectId(epic.value.projectId).map(r => r.id);
});

function reasonClass(reason: BlockingReason): string {
  const base = 'text-[10px] px-1.5 py-0.5 rounded-full inline-block';
  if (reason.type === 'runAfter' || reason.type === 'dependency')
    return `${base} bg-amber-500/10 text-amber-400`;
  if (reason.type === 'repoLock')
    return `${base} bg-red-500/10 text-red-400`;
  if (reason.type === 'concurrency' || reason.type === 'projectConcurrency')
    return `${base} bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]`;
  return `${base} bg-[var(--accent-yellow)]/10 text-[var(--accent-yellow)]`;
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

<style scoped>
.scroll-area::-webkit-scrollbar { width: 5px; }
.scroll-area::-webkit-scrollbar-track { background: transparent; }
.scroll-area::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.25); border-radius: 3px; }
.scroll-area::-webkit-scrollbar-thumb:hover { background: rgba(100,116,139,0.4); }

.field-label {
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 0.02em;
  line-height: 1;
  display: block;
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
.field-input:hover { border-color: var(--border-standard); }
.field-input:focus { border-color: var(--accent-mauve); box-shadow: 0 0 0 2px rgba(203,166,247,0.12); }
.field-input::placeholder { color: var(--text-faint); }
.field-input:disabled { opacity: 0.4; cursor: not-allowed; }

select.field-input {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%2364748b' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  padding-right: 28px;
  color-scheme: dark;
}

textarea.field-input {
  resize: vertical;
  line-height: 1.6;
}

.field-input-dashed {
  width: 100%;
  font-size: 11px;
  color: var(--text-faint);
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px dashed var(--border-standard);
  background: var(--bg-base);
  outline: none;
  transition: border-color 0.15s, color 0.15s;
  font-family: 'Inter', sans-serif;
  color-scheme: dark;
  cursor: pointer;
}
.field-input-dashed:hover { border-color: rgba(203,166,247,0.25); color: var(--text-secondary); }
.field-input-dashed:focus { border-color: var(--accent-mauve); outline: none; }

.pipe-btn {
  flex: 1;
  padding: 7px 0;
  font-size: 12px;
  font-weight: 500;
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-window);
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;
  text-align: center;
}
.pipe-btn:hover {
  color: var(--text-secondary);
  border-color: var(--border-standard);
  background: var(--bg-surface);
}
.pipe-btn.active-create {
  color: var(--accent-green);
  background: rgba(166,227,161,0.06);
  border-color: rgba(166,227,161,0.20);
  box-shadow: inset 0 0 20px -10px rgba(166,227,161,0.12);
}
.pipe-btn.active-fix {
  color: var(--accent-peach);
  background: rgba(250,179,135,0.06);
  border-color: rgba(250,179,135,0.20);
  box-shadow: inset 0 0 20px -10px rgba(250,179,135,0.12);
}
.pipe-btn.active-investigate {
  color: var(--accent-blue);
  background: rgba(137,180,250,0.06);
  border-color: rgba(137,180,250,0.20);
  box-shadow: inset 0 0 20px -10px rgba(137,180,250,0.12);
}
.pipe-btn.active-plan {
  color: #b4befe;
  background: rgba(180,190,254,0.06);
  border-color: rgba(180,190,254,0.20);
  box-shadow: inset 0 0 20px -10px rgba(180,190,254,0.12);
}

.panel-toggle {
  position: relative;
  width: 34px;
  height: 20px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.2s;
  border: none;
  outline: none;
  flex-shrink: 0;
}
.panel-toggle::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--text-primary);
  transition: transform 0.2s ease;
  box-shadow: 0 1px 3px rgba(0,0,0,0.4);
}
.panel-toggle.on { background: var(--accent-teal); }
.panel-toggle.on::after { transform: translateX(14px); }
.panel-toggle.off { background: var(--text-faint); }

.dep-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border-radius: 8px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
}

.dep-remove {
  color: var(--text-faint);
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
  display: flex;
  margin-left: auto;
  flex-shrink: 0;
  transition: color 0.15s;
}
.dep-remove:hover { color: var(--accent-red); }

.btn-primary {
  width: 100%;
  padding: 10px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 8px;
  border: none;
  color: var(--bg-base);
  cursor: pointer;
  transition: all 0.15s;
  letter-spacing: 0.01em;
}
.btn-primary:hover { filter: brightness(1.1); }
.btn-primary:active { transform: scale(0.99); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; filter: none; }
</style>
