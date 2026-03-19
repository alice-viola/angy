<template>
  <div class="flex flex-col h-full w-[480px] bg-surface border-l border-border-standard">
    <!-- Header (48px) -->
    <div class="flex items-center justify-between px-5 h-12 flex-shrink-0 border-b border-border-subtle">
      <!-- Column badge pill -->
      <div
        v-if="epic"
        class="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider"
        :style="columnBadgeStyle"
      >
        <span class="w-1.5 h-1.5 rounded-full flex-shrink-0" :style="{ background: columnBadge.color }"></span>
        {{ columnBadge.label }}
      </div>
      <div v-else></div>
      <!-- Panel title -->
      <span class="text-[11px] font-semibold text-ember-500 uppercase tracking-widest">
        {{ isNew ? 'New Epic' : 'Epic Details' }}
      </span>
      <!-- Close button -->
      <button
        class="w-6 h-6 flex items-center justify-center rounded-md text-txt-faint hover:text-txt-primary hover:bg-raised transition-colors"
        @click="$emit('close')"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <!-- Body (scrollable) -->
    <div v-if="epic" class="flex-1 overflow-y-auto px-5 pt-5 pb-2 space-y-5 scroll-area">

      <!-- Blocking reasons -->
      <div
        v-if="(epic.column === 'todo' || epic.column === 'backlog') && epicStore.getBlockingReasons(epic.id).length > 0"
        class="flex flex-wrap gap-1.5 -mt-1"
      >
        <span
          v-for="reason in epicStore.getBlockingReasons(epic.id)"
          :key="reason.type + (reason.relatedEpicId ?? '')"
          :class="reasonClass(reason)"
        >{{ reason.label }}</span>
      </div>

      <!-- GROUP 1 — Title -->
      <input
        ref="titleInput"
        v-model="draft.title"
        type="text"
        class="title-input w-full"
        placeholder="Epic title..."
      />

      <!-- GROUP 2 — HOW IT RUNS -->
      <div class="bg-raised rounded-xl p-4 space-y-3">
        <div class="text-[11px] font-semibold text-txt-muted uppercase tracking-wider">How It Runs</div>

        <!-- Complexity DotPicker -->
        <div>
          <div class="text-[11px] text-txt-muted mb-1.5">Complexity</div>
          <DotPicker
            :modelValue="complexityValues.indexOf(draft.complexity)"
            :labels="complexityLabels"
            :disabled="draft.pipelineType !== 'hybrid'"
            @update:modelValue="draft.complexity = complexityValues[$event]"
          />
        </div>

        <p v-if="draft.pipelineType === 'hybrid'" class="text-[11px] text-txt-faint leading-relaxed">
          {{ complexityDescriptions[draft.complexity] }}
        </p>

        <!-- Pipeline pill tabs -->
        <div>
          <div class="text-[11px] text-txt-muted mb-1.5">Pipeline</div>
          <div class="flex gap-1.5" :class="{ 'pipeline-pulse': pipelinePulse }">
            <button
              v-for="pt in pipelineTypes"
              :key="pt.value"
              class="pipe-btn"
              :class="[
                draft.pipelineType === pt.value ? `active-${pt.value === 'hybrid' ? 'create' : pt.value}` : '',
                { 'suggested-ring': suggestedPipeline === (pt.value === 'hybrid' ? 'hybrid' : pt.value) && draft.pipelineType !== pt.value }
              ]"
              @click="draft.pipelineType = pt.value"
            >
              {{ pt.label }}
            </button>
          </div>
          <p class="text-[11px] text-txt-faint leading-relaxed mt-1.5">
            {{ pipelineDescriptions[draft.pipelineType] }}
          </p>
        </div>

        <!-- Model dropdown -->
        <div>
          <div class="text-[11px] text-txt-muted mb-1.5">Model</div>
          <select v-model="draft.model" class="field-input w-full">
            <option value="">Default (CLI default)</option>
            <option value="claude-sonnet-4-6">Sonnet 4.6</option>
            <option value="claude-opus-4-6">Opus 4.6</option>
            <option value="claude-opus-4-5">Opus 4.5</option>
            <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
          </select>
        </div>
      </div>

      <!-- GROUP 3 — WHERE IT RUNS (collapsible) -->
      <div class="bg-raised rounded-xl p-4">
        <button
          @click="whereOpen = !whereOpen"
          class="flex items-center justify-between w-full"
        >
          <span class="text-[11px] font-semibold text-txt-muted uppercase tracking-wider">Where It Runs</span>
          <svg
            class="w-3 h-3 text-txt-faint transition-transform duration-150"
            :class="{ 'rotate-90': whereOpen }"
            fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <div v-if="whereOpen" class="space-y-3 mt-3">
          <!-- Repos -->
          <div>
            <div class="text-[11px] text-txt-muted mb-1.5">Target Repos</div>
            <RepoScopeSelector
              :projectId="epic.projectId"
              v-model="draft.targetRepoIds"
            />
          </div>

          <!-- Git radio group -->
          <div>
            <div class="text-[11px] text-txt-muted mb-1.5">Git Mode</div>
            <div class="space-y-1">
              <label
                class="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors"
                :class="{ 'bg-[rgba(245,158,11,0.06)]': gitMode === 'none', 'opacity-40 cursor-not-allowed': draft.parallelAgentCount > 1 }"
              >
                <input type="radio" value="none" :checked="gitMode === 'none'"
                       :disabled="draft.parallelAgentCount > 1"
                       @change="setGitMode('none')" class="sr-only" />
                <span class="git-radio-dot" :class="{ selected: gitMode === 'none' }"></span>
                <span class="text-[12px]" :class="gitMode === 'none' ? 'text-txt-primary' : 'text-txt-secondary'">None</span>
              </label>
              <label
                class="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors"
                :class="{ 'bg-[rgba(245,158,11,0.06)]': gitMode === 'branch', 'opacity-40 cursor-not-allowed': draft.parallelAgentCount > 1 }"
              >
                <input type="radio" value="branch" :checked="gitMode === 'branch'"
                       :disabled="draft.parallelAgentCount > 1"
                       @change="setGitMode('branch')" class="sr-only" />
                <span class="git-radio-dot" :class="{ selected: gitMode === 'branch' }"></span>
                <span class="text-[12px]" :class="gitMode === 'branch' ? 'text-txt-primary' : 'text-txt-secondary'">Git Branch</span>
              </label>
              <label
                class="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors"
                :class="{ 'bg-[rgba(245,158,11,0.06)]': gitMode === 'worktree' }"
              >
                <input type="radio" value="worktree" :checked="gitMode === 'worktree'"
                       @change="setGitMode('worktree')" class="sr-only" />
                <span class="git-radio-dot" :class="{ selected: gitMode === 'worktree' }"></span>
                <span class="text-[12px]" :class="gitMode === 'worktree' ? 'text-txt-primary' : 'text-txt-secondary'">Worktree</span>
              </label>
            </div>
          </div>

          <!-- Branch name display -->
          <div v-if="branchName && (gitMode === 'branch' || gitMode === 'worktree')" class="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-base border border-border-subtle">
            <svg class="w-3.5 h-3.5 text-teal flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>
            </svg>
            <span class="text-[12px] font-mono text-teal truncate select-all" :title="branchName">
              {{ branchName }}
            </span>
          </div>

          <!-- BranchPicker (branch or worktree) -->
          <div v-if="gitMode === 'branch' || gitMode === 'worktree'" class="space-y-1.5">
            <div class="text-[11px] text-txt-muted">Base Branch</div>
            <BranchPicker
              v-model="draft.baseBranch"
              :repoIds="epicRepoIds"
              :projectId="epic!.projectId"
              placeholder="Base branch..."
              :disabled="!!draft.runAfter"
            />
            <p v-if="!!draft.runAfter" class="text-[11px] text-txt-faint">Inherited from predecessor</p>
          </div>

          <!-- Agents DotPicker -->
          <div>
            <div class="text-[11px] text-txt-muted mb-1.5">Parallel Agents</div>
            <DotPicker
              :modelValue="draft.parallelAgentCount - 1"
              :labels="agentLabels"
              @update:modelValue="setParallelCount($event + 1)"
            />
            <p class="text-[11px] text-txt-faint leading-relaxed mt-1.5">
              {{ draft.parallelAgentCount > 1
                ? `On start, creates ${draft.parallelAgentCount} independent copies (X1–X${draft.parallelAgentCount}), each in its own worktree. Pick the best result.`
                : 'Runs a single agent for this epic.' }}
            </p>
          </div>
        </div>
      </div>

      <!-- GROUP 4 — Description & Acceptance Criteria -->
      <div class="space-y-3">
        <div>
          <div class="text-[11px] text-txt-muted mb-1.5">Description</div>
          <textarea
            v-model="draft.description"
            class="field-input w-full"
            rows="3"
            placeholder="Explain what to build and why it matters."
          ></textarea>
        </div>
        <div>
          <div class="text-[11px] text-txt-muted mb-1.5">Acceptance Criteria</div>
          <textarea
            v-model="draft.acceptanceCriteria"
            class="field-input w-full"
            rows="3"
            placeholder="List what must be true for this to be considered done."
          ></textarea>
        </div>
      </div>

      <!-- GROUP 5 — SCHEDULING (collapsible) -->
      <section class="border-t border-border-subtle pt-1">
        <button
          class="w-full flex items-center gap-2 py-2 hover:bg-white/[0.015] transition-colors"
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
        <div v-show="schedOpen" class="pb-3 pt-1 space-y-4">
          <!-- Priority DotPicker -->
          <div>
            <div class="text-[11px] text-txt-muted mb-1.5">Priority</div>
            <DotPicker
              :modelValue="priorityValues.indexOf(draft.priorityHint)"
              :labels="priorityLabels"
              @update:modelValue="draft.priorityHint = priorityValues[$event]"
            />
          </div>

          <!-- Column -->
          <div class="space-y-1.5">
            <div class="text-[11px] text-txt-muted">Column</div>
            <select v-model="draft.column" class="field-input">
              <option v-for="col in columns" :key="col" :value="col">
                {{ col.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) }}
              </option>
            </select>
          </div>

          <!-- Run after -->
          <div class="space-y-1.5">
            <div class="text-[11px] text-txt-muted">Run after</div>
            <div v-if="draft.runAfter" class="dep-row">
              <svg class="w-3.5 h-3.5 text-ember-500 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
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
            <div class="text-[11px] text-txt-muted">Dependencies</div>
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

      <!-- ACTION ZONE (contextual) -->
      <!-- Review -->
      <template v-if="epic.column === 'review'">
        <div class="border-t border-border-standard my-1"></div>
        <div class="space-y-3">
          <div class="flex items-center gap-2.5">
            <span class="text-[11px] font-semibold uppercase tracking-wider" style="color: var(--accent-peach)">Review Needed</span>
            <span class="text-[10px] px-2 py-0.5 rounded-full font-medium border" style="color: var(--accent-peach); background: rgba(250,179,135,0.08); border-color: rgba(250,179,135,0.12)">needs review</span>
          </div>
          <textarea
            v-model="rejectionFeedback"
            rows="2"
            class="field-input w-full"
            placeholder="Feedback for rejection (optional)..."
          ></textarea>
          <div class="flex gap-2">
            <button class="btn-primary flex-1" style="background: var(--accent-green)" @click="approve">Approve</button>
            <button class="btn-primary flex-1" style="background: var(--accent-red)" @click="reject">Reject</button>
          </div>
        </div>
      </template>

      <!-- In-progress -->
      <template v-else-if="epic.column === 'in-progress'">
        <div class="border-t border-border-standard my-1"></div>
        <div class="space-y-2">
          <div class="text-[11px] font-semibold uppercase tracking-wider" style="color: var(--accent-teal)">Running</div>
          <div class="flex gap-2">
            <button
              class="flex-1 py-2 px-3 rounded-lg text-[13px] font-medium transition-colors"
              style="border: 1px solid rgba(137,180,250,0.3); color: var(--accent-blue)"
              @click="ui.navigateToEpic(epic.id, epic.projectId)"
            >Open Workspace</button>
            <button
              class="flex-1 py-2 px-3 rounded-lg text-[13px] font-medium transition-colors"
              style="border: 1px solid rgba(245,158,11,0.3); color: var(--accent-ember)"
              @click="suspendEpic"
            >Suspend</button>
            <button
              class="flex-1 py-2 px-3 rounded-lg text-[13px] font-medium transition-colors"
              style="border: 1px solid rgba(243,139,168,0.3); color: var(--accent-red)"
              @click="stopEpic"
            >Stop</button>
          </div>
        </div>
      </template>

      <!-- Done with branch -->
      <template v-else-if="epic.column === 'done' && branchName">
        <div class="border-t border-border-standard my-1"></div>
        <div class="space-y-2">
          <div class="text-[11px] font-semibold uppercase tracking-wider" style="color: var(--accent-green)">Completed</div>
          <div class="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-base border border-border-subtle">
            <svg class="w-3.5 h-3.5 text-teal flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>
            </svg>
            <span class="text-[12px] font-mono text-teal truncate" :title="branchName">
              {{ branchName }}
            </span>
          </div>
          <button
            class="btn-primary w-full"
            style="background: linear-gradient(to right, var(--accent-ember), var(--accent-ember-600))"
            :disabled="prLoading"
            @click="createPR(epic.id, epic.projectId)"
          >
            {{ prLoading ? 'Pushing & Opening PR...' : 'Create Pull Request' }}
          </button>
          <p v-if="prError" class="text-[11px]" style="color: var(--accent-red)">{{ prError }}</p>
        </div>
      </template>

      <!-- Suspended -->
      <template v-else-if="epic.suspendedAt && (epic.column === 'todo' || epic.column === 'backlog')">
        <div class="border-t border-border-standard my-1"></div>
        <div class="space-y-2">
          <div class="text-[11px] font-semibold uppercase tracking-wider" style="color: var(--accent-yellow)">Suspended</div>
          <button
            class="w-full py-2 px-4 rounded-lg text-[13px] font-medium transition-colors"
            style="border: 1px solid rgba(245,158,11,0.3); color: var(--accent-ember)"
            @click="resumeEpic"
          >Resume</button>
        </div>
      </template>

      <div class="h-2"></div>
    </div>

    <!-- Footer (52px) -->
    <div v-if="epic" class="flex items-center px-5 h-[52px] flex-shrink-0 border-t border-border-subtle bg-surface gap-3">
      <button v-if="!isNew" @click="remove" class="delete-btn text-sm text-txt-muted">Delete</button>
      <div class="flex-1"></div>
      <button @click="save" class="btn-primary" style="background: linear-gradient(to right, var(--accent-ember), var(--accent-ember-600)); min-width: 100px">
        {{ isNew ? 'Create' : 'Save' }}
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
import DotPicker from './DotPicker.vue';
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

const complexityLabels = ['Trivial', 'Small', 'Medium', 'Large', 'Epic']
const complexityValues: ComplexityEstimate[] = ['trivial', 'small', 'medium', 'large', 'epic']
const priorityLabels = ['None', 'Low', 'Medium', 'High', 'Critical']
const priorityValues: PriorityHint[] = ['none', 'low', 'medium', 'high', 'critical']
const agentLabels = ['1', '2', '3', '4']

const epic = computed(() => epicStore.epicById(props.epicId));
const branchName = computed(() => epicStore.epicBranchName(props.epicId));

const columnBadge = computed(() => {
  const col = epic.value?.column
  const map: Record<string, { label: string; color: string }> = {
    idea:          { label: 'Idea',        color: 'var(--accent-mauve)' },
    backlog:       { label: 'Backlog',     color: 'var(--text-muted)' },
    todo:          { label: 'Todo',        color: 'var(--accent-blue)' },
    'in-progress': { label: 'In Progress', color: 'var(--accent-teal)' },
    review:        { label: 'Review',      color: 'var(--accent-peach)' },
    done:          { label: 'Done',        color: 'var(--accent-green)' },
    discarded:     { label: 'Discarded',   color: 'var(--text-faint)' },
  }
  return map[col ?? ''] ?? { label: col ?? '', color: 'var(--text-muted)' }
})

const columnBadgeStyle = computed(() => {
  const accent = columnBadge.value.color
  return {
    background: `color-mix(in srgb, ${accent} 8%, transparent)`,
    border: `1px solid color-mix(in srgb, ${accent} 12%, transparent)`,
    color: accent
  }
})

const suggestedPipeline = computed(() => {
  const c = draft.value?.complexity
  if (!c) return null
  if (c === 'trivial' || c === 'small') return 'fix'
  if (c === 'medium') return 'hybrid'
  return 'hybrid'
})

const schedOpen = ref(false);
const titleInput = ref<HTMLInputElement | null>(null);
const gitMode = ref<'none' | 'branch' | 'worktree'>('none');
const whereOpen = ref(!props.isNew);
const pipelinePulse = ref(false);

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
  parallelAgentCount: 1,
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

watch(() => draft.value?.complexity, () => {
  pipelinePulse.value = true
  setTimeout(() => { pipelinePulse.value = false }, 600)
})

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
    parallelAgentCount: e.parallelAgentCount ?? 1,
  };
  const d = draft.value
  gitMode.value = d.useWorktree ? 'worktree' : d.useGitBranch ? 'branch' : 'none'
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

function setGitMode(mode: 'none' | 'branch' | 'worktree') {
  gitMode.value = mode
  draft.value.useGitBranch = mode !== 'none'
  draft.value.useWorktree = mode === 'worktree'
  if (mode !== 'worktree' && draft.value.parallelAgentCount > 1) {
    draft.value.parallelAgentCount = 1
  }
}

function setParallelCount(n: number) {
  draft.value.parallelAgentCount = n;
  if (n > 1) {
    draft.value.useWorktree = true;
    gitMode.value = 'worktree';
  }
}

async function save() {
  const d = draft.value;
  const originalColumn = epic.value?.column;
  const columnChanged = d.column !== originalColumn;
  const isStartRequest = columnChanged && d.column === 'in-progress';

  // Save epic data FIRST (so baseBranch etc. are persisted before start)
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
    parallelAgentCount: d.parallelAgentCount,
  });

  // Then handle column changes
  if (columnChanged) {
    if (isStartRequest) {
      console.log(`[EpicDetailPanel] Requesting start for epic: ${props.epicId}`);
      engineBus.emit('epic:requestStart', { epicId: props.epicId });
    } else {
      await epicStore.moveEpic(props.epicId, d.column);
    }
  }

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

.title-input {
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 600;
  padding-bottom: 6px;
  outline: none;
  transition: border-color 150ms;
}
.title-input::placeholder { color: var(--text-faint); font-weight: 400; }
.title-input:hover { border-bottom-color: var(--border-standard); }
.title-input:focus { border-bottom-color: var(--accent-ember); }

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
.field-input:focus { border-color: var(--accent-ember); box-shadow: 0 0 0 2px rgba(245,158,11,0.12); }
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
.field-input-dashed:hover { border-color: rgba(245,158,11,0.25); color: var(--text-secondary); }
.field-input-dashed:focus { border-color: var(--accent-ember); outline: none; }

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
.pipe-btn.suggested-ring {
  box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.25);
}

.git-radio-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid var(--border-standard);
  flex-shrink: 0;
  transition: border-color 150ms, background 150ms;
}
.git-radio-dot.selected {
  border-color: var(--accent-ember);
  background: var(--accent-ember);
}

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

.delete-btn {
  background: none;
  border: none;
  cursor: pointer;
  transition: color 150ms;
}
.delete-btn:hover { color: var(--accent-red); }

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

@keyframes pulse-hint {
  0%   { opacity: 0.4; }
  100% { opacity: 1; }
}
.pipeline-pulse { animation: pulse-hint 0.6s ease-in-out; }
</style>
