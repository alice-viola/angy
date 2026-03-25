<template>
  <div class="flex flex-col h-full w-full bg-[var(--bg-base)] absolute inset-0 z-50">
    <!-- 1. THE GLOBAL HEADER -->
    <header class="flex flex-col border-b border-[var(--border-subtle)] flex-shrink-0">
      <div class="h-12 flex items-center gap-3 px-4">
        <!-- Left: Back button -->
        <button
          class="flex items-center gap-1.5 text-[11px] font-medium text-txt-muted hover:text-txt-primary transition-colors"
          @click="$emit('close')"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Back
        </button>

        <div class="w-px h-4 bg-border-subtle mx-1" />

        <!-- Title Input (seamless) -->
        <input
          ref="titleInput"
          v-model="draft.title"
          type="text"
          class="flex-1 bg-transparent border-none outline-none text-sm font-medium text-txt-primary placeholder:text-txt-faint transition-colors hover:bg-white/[0.02] focus:bg-white/[0.04] px-2 py-1 rounded"
          placeholder="Epic title..."
        />

        <!-- Right: Action buttons -->
        <div class="flex items-center gap-2">
          <!-- Execution controls (in-progress) -->
          <template v-if="epic?.column === 'in-progress'">
            <button class="px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors border border-amber-500/40 text-amber-400 hover:bg-amber-500/10" @click="suspendEpic">Suspend</button>
            <button class="px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors border border-red-500/40 text-red-400 hover:bg-red-500/10" @click="stopEpic">Stop</button>
          </template>

          <!-- Resume control (suspended) -->
          <button v-if="epic?.suspendedAt && (epic?.column === 'todo' || epic?.column === 'backlog')"
            class="px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
            @click="resumeEpic"
          >Resume</button>

          <button v-if="!isNew && epic?.column !== 'in-progress'" @click="remove" class="text-[11px] text-txt-muted hover:text-red-400 transition-colors px-2 py-1 rounded hover:bg-red-500/10">Delete</button>

          <button v-if="epic?.column === 'done' && branchName"
            class="px-2.5 py-1 rounded-md text-[11px] font-medium text-white bg-ember-500 hover:bg-ember-600 transition whitespace-nowrap"
            :disabled="prLoading"
            @click="createPR(epic!.id, epic!.projectId)"
          >
            {{ prLoading ? 'Pushing...' : 'Create PR' }}
          </button>

          <button
            v-if="epic?.column !== 'in-progress'"
            class="px-3 py-1 rounded-md text-[11px] font-medium text-white bg-amber-500 hover:bg-amber-600 transition"
            @click="save"
          >
            {{ isNew ? 'Create' : 'Save' }}
          </button>
        </div>
      </div>
    </header>

    <div v-if="!epic" class="flex-1 flex items-center justify-center">
      <p class="text-[12px] text-[var(--text-muted)] italic">Loading epic...</p>
    </div>

    <!-- 3-Panel Layout -->
    <div v-else class="flex-1 flex min-h-0">

      <!-- PANEL 1: Specification (Name, Description, Acceptance Criteria) -->
      <div class="flex-1 border-r border-border-subtle flex flex-col">
        <div class="px-3 py-2.5 border-b border-border-subtle">
          <span class="text-[11px] font-semibold uppercase tracking-wider text-txt-muted">Specification</span>
        </div>
        <div class="flex-1 overflow-y-auto p-3 space-y-4 scroll-area">
          <!-- Status Badge -->
          <div class="flex items-center gap-2">
            <div
              class="flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wider"
              :style="columnBadgeStyle"
            >
              <span class="w-1.5 h-1.5 rounded-full flex-shrink-0" :style="{ background: columnBadge.color }"></span>
              {{ columnBadge.label }}
            </div>
            <div v-if="epic.suspendedAt && (epic.column === 'todo' || epic.column === 'backlog')"
                 class="px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wider bg-amber-500/10 text-amber-500">
              Suspended
            </div>
          </div>

          <!-- Description -->
          <div class="space-y-1.5">
            <label class="text-[10px] font-semibold text-txt-muted uppercase tracking-wider">Description</label>
            <textarea
              v-model="draft.description"
              class="field-input w-full resize-none min-h-[120px] text-[12px] leading-relaxed"
              placeholder="Explain what to build and why it matters."
            ></textarea>
          </div>

          <!-- Acceptance Criteria -->
          <div class="space-y-1.5">
            <label class="text-[10px] font-semibold text-txt-muted uppercase tracking-wider">Acceptance Criteria</label>
            <textarea
              v-model="draft.acceptanceCriteria"
              class="field-input w-full resize-none min-h-[100px] text-[12px] leading-relaxed"
              placeholder="List what must be true for this to be considered done."
            ></textarea>
          </div>

          <!-- Blocking reasons -->
          <div v-if="(epic.column === 'todo' || epic.column === 'backlog') && epicStore.getBlockingReasons(epic.id).length > 0" class="flex flex-wrap gap-1">
            <span v-for="reason in epicStore.getBlockingReasons(epic.id)" :key="reason.type + (reason.relatedEpicId ?? '')" :class="reasonClass(reason)">{{ reason.label }}</span>
          </div>
        </div>
      </div>

      <!-- PANEL 2: Configuration (Git & Scheduling) -->
      <div class="flex-1 border-r border-border-subtle flex flex-col">
        <div class="px-3 py-2.5 border-b border-border-subtle">
          <span class="text-[11px] font-semibold uppercase tracking-wider text-txt-muted">Configuration</span>
        </div>
        <div class="flex-1 overflow-y-auto p-3 space-y-4 scroll-area">
          <!-- Target Repos -->
          <div class="space-y-1.5">
            <div class="text-[10px] text-txt-muted uppercase tracking-wider font-semibold">Target Repos</div>
            <RepoScopeSelector
              :projectId="epic.projectId"
              v-model="draft.targetRepoIds"
            />
          </div>

          <!-- Git Mode -->
          <div class="space-y-1.5">
            <div class="text-[10px] text-txt-muted uppercase tracking-wider font-semibold">Git Mode</div>
            <div class="space-y-0.5">
              <label class="flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer transition-colors" :class="{ 'bg-ember-500/[0.06]': gitMode === 'none', 'opacity-40 cursor-not-allowed': draft.parallelAgentCount > 1 }">
                <input type="radio" value="none" :checked="gitMode === 'none'" :disabled="draft.parallelAgentCount > 1" @change="setGitMode('none')" class="sr-only" />
                <span class="git-radio-dot" :class="{ selected: gitMode === 'none' }"></span>
                <span class="text-[11px]" :class="gitMode === 'none' ? 'text-txt-primary' : 'text-txt-secondary'">None</span>
              </label>
              <label class="flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer transition-colors" :class="{ 'bg-ember-500/[0.06]': gitMode === 'branch', 'opacity-40 cursor-not-allowed': draft.parallelAgentCount > 1 }">
                <input type="radio" value="branch" :checked="gitMode === 'branch'" :disabled="draft.parallelAgentCount > 1" @change="setGitMode('branch')" class="sr-only" />
                <span class="git-radio-dot" :class="{ selected: gitMode === 'branch' }"></span>
                <span class="text-[11px]" :class="gitMode === 'branch' ? 'text-txt-primary' : 'text-txt-secondary'">Git Branch</span>
              </label>
              <label class="flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer transition-colors" :class="{ 'bg-ember-500/[0.06]': gitMode === 'worktree' }">
                <input type="radio" value="worktree" :checked="gitMode === 'worktree'" @change="setGitMode('worktree')" class="sr-only" />
                <span class="git-radio-dot" :class="{ selected: gitMode === 'worktree' }"></span>
                <span class="text-[11px]" :class="gitMode === 'worktree' ? 'text-txt-primary' : 'text-txt-secondary'">Worktree</span>
              </label>
            </div>
          </div>

          <div v-if="branchName && (gitMode === 'branch' || gitMode === 'worktree')" class="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-border-subtle">
            <svg class="w-3 h-3 text-teal flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>
            </svg>
            <span class="text-[11px] font-mono text-teal truncate select-all" :title="branchName">{{ branchName }}</span>
          </div>

          <div v-if="gitMode === 'branch' || gitMode === 'worktree'" class="space-y-1.5">
            <div class="text-[10px] text-txt-muted">Base Branch</div>
            <BranchPicker
              v-model="draft.baseBranch"
              :repoIds="epicRepoIds"
              :projectId="epic!.projectId"
              placeholder="Base branch..."
              :disabled="!!draft.runAfter"
            />
          </div>

          <!-- Parallel Agents (only for worktree mode) -->
          <div v-if="gitMode === 'worktree'" class="space-y-1.5">
            <div class="text-[10px] text-txt-muted uppercase tracking-wider font-semibold">Parallel Agents</div>
            <DotPicker
              :modelValue="draft.parallelAgentCount - 1"
              :labels="parallelLabels"
              @update:modelValue="draft.parallelAgentCount = $event + 1"
            />
            <p class="text-[9px] text-txt-faint">Run multiple agents in isolated worktrees</p>
          </div>

          <div class="w-full h-px bg-border-subtle" />

          <!-- Scheduling -->
          <div class="space-y-1.5">
            <div class="text-[10px] text-txt-muted uppercase tracking-wider font-semibold">Priority</div>
            <DotPicker
              :modelValue="priorityValues.indexOf(draft.priorityHint)"
              :labels="priorityLabels"
              @update:modelValue="draft.priorityHint = priorityValues[$event]"
            />
          </div>

          <div class="space-y-1.5">
            <div class="text-[10px] text-txt-muted uppercase tracking-wider font-semibold">Column</div>
            <select v-model="draft.column" class="field-input">
              <option v-for="col in columns" :key="col" :value="col">
                {{ col.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) }}
              </option>
            </select>
          </div>

          <div class="space-y-1.5">
            <div class="text-[10px] text-txt-muted uppercase tracking-wider font-semibold">Run After</div>
            <div v-if="draft.runAfter" class="dep-row">
              <svg class="w-3 h-3 text-ember-500 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13 5l7 7-7 7M5 12h15" />
              </svg>
              <span class="text-[11px] text-txt-secondary truncate">{{ runAfterTitle(draft.runAfter) }}</span>
              <button class="dep-remove" title="Remove" @click="clearRunAfter">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <select
              v-else-if="availableRunAfter.length > 0"
              class="field-input-dashed"
              @change="setRunAfter(($event.target as HTMLSelectElement).value); ($event.target as HTMLSelectElement).value = ''"
            >
              <option value="">Select epic...</option>
              <option v-for="e in availableRunAfter" :key="e.id" :value="e.id">{{ e.title }}</option>
            </select>
            <p v-else class="text-[10px] text-txt-faint italic">No other epics</p>
          </div>

          <div class="space-y-1.5">
            <div class="text-[10px] text-txt-muted uppercase tracking-wider font-semibold">Dependencies</div>
            <div v-for="depId in draft.dependsOn" :key="depId" class="dep-row">
              <span class="w-1.5 h-1.5 rounded-full bg-ember flex-shrink-0"></span>
              <span class="text-[11px] text-txt-secondary truncate">{{ depTitle(depId) }}</span>
              <button class="dep-remove" @click="removeDep(depId)">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
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

      <!-- PANEL 3: Agents (Pipeline Type + Vertical Agent List) -->
      <div class="flex-1 flex flex-col">
        <!-- Agent config header (hidden during execution/review/done) -->
        <div v-if="!isExecutionMode" class="px-3 py-2.5 border-b border-border-subtle flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-semibold uppercase tracking-wider text-txt-muted">Agents</span>
            <!-- Pipeline Type Selector -->
            <div class="flex items-center gap-3" :class="{ 'pipeline-pulse': pipelinePulse }">
              <button
                v-for="pt in pipelineTypes"
                :key="pt.value"
                class="px-1 pb-0.5 text-[10px] font-medium transition-all"
                :class="getPipelineTypeClass(pt.value)"
                @click="setPipelineType(pt.value)"
              >
                {{ pt.label }}
              </button>
            </div>
          </div>
          <!-- Set All models selector -->
          <div class="flex items-center gap-2">
            <span class="text-[10px] text-txt-faint">Set All:</span>
            <div class="relative flex-1">
              <select
                class="w-full text-[10px] bg-transparent border border-border-subtle rounded px-1.5 py-1 text-txt-secondary outline-none appearance-none cursor-pointer hover:border-border-standard transition-colors pr-5"
                @change="setAllModels(($event.target as HTMLSelectElement).value); ($event.target as HTMLSelectElement).value = ''"
              >
                <option value="">Choose model...</option>
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

        <!-- Agent List (Fleet-style vertical) or Execution View -->
        <div class="flex-1 overflow-y-auto">
          <template v-if="epic.column === 'in-progress'">
            <OrchestratorChat
              v-if="epic.rootSessionId"
              :sessionId="epic.rootSessionId"
              class="h-full"
              @stop="stopEpic"
            />
            <div v-else class="h-full flex flex-col items-center justify-center opacity-40">
              <div class="w-5 h-5 border-2 border-teal border-t-transparent rounded-full animate-spin mb-3"></div>
              <span class="text-xs font-medium text-txt-primary">Initializing Orchestrator</span>
              <span class="text-[11px] text-txt-muted mt-1">Starting up agents...</span>
            </div>
          </template>

          <template v-else-if="epic.column === 'review'">
            <div class="p-4 space-y-4">
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-amber-500" />
                <span class="text-[11px] font-semibold uppercase tracking-wider text-amber-400">Review Needed</span>
              </div>
              <p class="text-[11px] text-txt-muted">The pipeline has completed. Review the changes and approve or reject with feedback.</p>
              <textarea
                v-model="rejectionFeedback"
                rows="3"
                class="field-input w-full resize-none text-[12px]"
                placeholder="Feedback for rejection (optional)..."
              ></textarea>
              <div class="flex gap-2">
                <button
                  class="flex-1 px-3 py-2 rounded-md text-[11px] font-medium transition-colors border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                  @click="approve"
                >
                  Approve
                </button>
                <button
                  class="flex-1 px-3 py-2 rounded-md text-[11px] font-medium transition-colors border border-red-500/40 text-red-400 hover:bg-red-500/10"
                  @click="reject"
                >
                  Reject
                </button>
              </div>
            </div>
          </template>

          <template v-else-if="epic.column === 'done'">
            <div class="p-4 space-y-3">
              <div class="flex items-center gap-2">
                <svg class="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span class="text-[11px] font-semibold uppercase tracking-wider text-emerald-400">Completed</span>
              </div>
              <p class="text-[11px] text-txt-muted">The pipeline finished successfully. You can create a PR from the branch if needed.</p>
            </div>
          </template>

          <template v-else>
            <!-- Vertical Agent List (Fleet-style) -->
            <div class="p-2 space-y-1">
              <div
                v-for="node in pipelineNodes"
                :key="node.id"
                class="flex items-center gap-2.5 px-3 py-2 rounded-md transition-colors border-l-2 hover:bg-white/[0.03]"
                :class="getAgentRowClass(node)"
              >
                <!-- Role icon -->
                <div class="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0" :class="getRoleBgClass(node.role)">
                  <span class="text-white" v-html="getRoleIconSmall(node.role)"></span>
                </div>

                <!-- Info -->
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-1.5">
                    <span class="text-[11px] font-medium text-txt-primary">{{ formatRole(node) }}</span>
                    <span v-if="node.model === 'disabled'" class="text-[9px] px-1 py-0 rounded bg-txt-faint/20 text-txt-faint">skipped</span>
                  </div>
                  <div class="text-[10px] text-txt-faint truncate">{{ getModelLabel(node.model) }}</div>
                </div>

                <!-- Model selector -->
                <div class="relative flex-shrink-0">
                  <select
                    class="text-[10px] bg-transparent border border-border-subtle rounded px-1.5 py-1 text-txt-secondary outline-none appearance-none cursor-pointer hover:border-border-standard transition-colors pr-5 w-28"
                    :value="node.model"
                    @change="updateNodeModel(node.id, ($event.target as HTMLSelectElement).value)"
                  >
                    <option value="disabled">Skip</option>
                    <template v-for="group in MODEL_GROUPS" :key="group.category">
                      <optgroup :label="group.category">
                        <option v-for="m in group.items" :key="m.id" :value="m.id">{{ m.name }}</option>
                      </optgroup>
                    </template>
                  </select>
                  <svg class="absolute right-1 top-1.5 w-3 h-3 text-txt-faint pointer-events-none" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"></path></svg>
                </div>
              </div>

              <!-- Parallel agents info -->
              <div v-if="draft.parallelAgentCount > 1" class="flex items-center gap-2 px-3 py-2 mt-2 border border-dashed border-border-subtle rounded-md">
                <svg class="w-4 h-4 text-txt-faint" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                <span class="text-[10px] text-txt-muted">{{ draft.parallelAgentCount }} parallel agents will run</span>
              </div>
            </div>
          </template>
        </div>

      </div>

    </div>
  </div>
</template>
<script setup lang="ts">
import OrchestratorChat from '@/components/agents/OrchestratorChat.vue';
import { ref, computed, watch, nextTick } from 'vue';
import type { EpicColumn, EpicPipelineType, PriorityHint, ComplexityEstimate, PipelineConfig } from '@/engine/KosTypes';
import { useEpicStore } from '@/stores/epics';
import { useProjectsStore } from '@/stores/projects';
import { Scheduler } from '@/engine/Scheduler';
import { engineBus } from '@/engine/EventBus';
import { useCreatePR } from '@/composables/useCreatePR';
import RepoScopeSelector from './RepoScopeSelector.vue';
import BranchPicker from './BranchPicker.vue';
import DotPicker from './DotPicker.vue';
import type { AgentNode, BlockingReason } from '@/engine/KosTypes';
import { MODEL_GROUPS, DEFAULT_MODEL_ID } from '@/constants/models';

const props = defineProps<{ epicId: string; isNew?: boolean }>();
const emit = defineEmits<{ close: []; created: [] }>();


const epicStore = useEpicStore();
const { loading: prLoading, createPR } = useCreatePR();

const columns: EpicColumn[] = ['idea', 'backlog', 'todo', 'in-progress', 'review', 'done', 'discarded'];
const pipelineTypes: Array<{ value: EpicPipelineType; label: string }> = [
  { value: 'hybrid', label: 'Create' },
  { value: 'fix', label: 'Fix' },
  { value: 'investigate', label: 'Investigate' },
  { value: 'plan', label: 'Plan' },
];


const priorityLabels = ['None', 'Low', 'Medium', 'High', 'Critical']
const priorityValues: PriorityHint[] = ['none', 'low', 'medium', 'high', 'critical']
const parallelLabels = ['1', '2', '3', '4', '5']

const epic = computed(() => epicStore.epicById(props.epicId));
const branchName = computed(() => epicStore.epicBranchName(props.epicId));
const isExecutionMode = computed(() => {
  const col = epic.value?.column;
  return col === 'in-progress' || col === 'review' || col === 'done';
});

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

const titleInput = ref<HTMLInputElement | null>(null);
const gitMode = ref<'none' | 'branch' | 'worktree'>('none');
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
  pipelineConfig: undefined as PipelineConfig | undefined,
  useGitBranch: false,
  useWorktree: false,
  baseBranch: null as string | null,
  dependsOn: [] as string[],
  runAfter: null as string | null,
  parallelAgentCount: 1,
});

const DEFAULT_PIPELINES: Record<EpicPipelineType, AgentNode[]> = {
  hybrid: [
    { id: 'architect', role: 'architect', model: DEFAULT_MODEL_ID, dependsOn: [] },
    { id: 'counterpart', role: 'custom', model: DEFAULT_MODEL_ID, promptOverride: 'Counterpart', dependsOn: ['architect'] },
    { id: 'scaffold', role: 'builder-scaffold', model: DEFAULT_MODEL_ID, promptOverride: 'Scaffold', dependsOn: ['counterpart'] },
    { id: 'builder-fe', role: 'builder-frontend', model: DEFAULT_MODEL_ID, dependsOn: ['scaffold'] },
    { id: 'builder-be', role: 'builder-backend', model: DEFAULT_MODEL_ID, dependsOn: ['scaffold'] },
    { id: 'tester', role: 'tester', model: DEFAULT_MODEL_ID, dependsOn: ['builder-fe', 'builder-be'] }
  ],
  fix: [
    { id: 'architect', role: 'architect', model: DEFAULT_MODEL_ID, dependsOn: [] },
    { id: 'builder', role: 'custom', model: DEFAULT_MODEL_ID, promptOverride: 'Fixer', dependsOn: ['architect'] },
    { id: 'tester', role: 'tester', model: DEFAULT_MODEL_ID, dependsOn: ['builder'] }
  ],
  investigate: [
    { id: 'investigator', role: 'custom', model: DEFAULT_MODEL_ID, promptOverride: 'Investigator', dependsOn: [] }
  ],
  plan: [
    { id: 'architect', role: 'architect', model: DEFAULT_MODEL_ID, dependsOn: [] }
  ]
};

function setPipelineType(type: EpicPipelineType) {
  draft.value.pipelineType = type;
  pipelinePulse.value = true;
  setTimeout(() => { pipelinePulse.value = false; }, 600);
  
  // Set default pipeline config when type changes
  draft.value.pipelineConfig = { nodes: JSON.parse(JSON.stringify(DEFAULT_PIPELINES[type])) };
}

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
    pipelineConfig: e.pipelineConfig ? JSON.parse(JSON.stringify(e.pipelineConfig)) : { nodes: JSON.parse(JSON.stringify(DEFAULT_PIPELINES[e.pipelineType || 'hybrid'])) },
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
    pipelineConfig: d.pipelineConfig,
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
  const base = 'text-[9px] px-1 py-0 rounded inline-block';
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

// ── Agent List Helpers ──────────────────────────────────────────────────

const pipelineNodes = computed(() => draft.value.pipelineConfig?.nodes ?? []);

function getPipelineTypeClass(type: EpicPipelineType): string {
  const isActive = draft.value.pipelineType === type;
  return isActive
    ? 'text-amber-400 border-b border-amber-400'
    : 'text-txt-muted hover:text-txt-secondary border-b border-transparent';
}

function getAgentRowClass(node: AgentNode): string {
  if (node.model === 'disabled') return 'border-l-txt-faint/30 opacity-50';
  const roleColors: Record<string, string> = {
    architect: 'border-l-emerald-500/50',
    counterpart: 'border-l-cyan-500/50',
    scaffold: 'border-l-amber-500/50',
    frontend: 'border-l-teal/50',
    backend: 'border-l-teal/50',
    tester: 'border-l-purple-500/50',
    reviewer: 'border-l-orange-500/50',
  };
  return roleColors[node.role] || 'border-l-txt-muted/30';
}

function getRoleBgClass(role: string): string {
  const colors: Record<string, string> = {
    architect: 'bg-emerald-500/80',
    counterpart: 'bg-cyan-500/80',
    scaffold: 'bg-amber-500/80',
    frontend: 'bg-teal/80',
    backend: 'bg-teal/80',
    tester: 'bg-purple-500/80',
    reviewer: 'bg-orange-500/80',
  };
  return colors[role] || 'bg-txt-muted/50';
}

function getRoleIconSmall(role: string): string {
  const icons: Record<string, string> = {
    architect: '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path stroke-linecap="round" stroke-linejoin="round" d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>',
    counterpart: '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>',
    scaffold: '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>',
    frontend: '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>',
    backend: '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>',
    tester: '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>',
    reviewer: '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
  };
  return icons[role] || '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle></svg>';
}

function formatRole(node: AgentNode): string {
  // Use promptOverride for custom agents (like Counterpart, Scaffold, etc.)
  if (node.role === 'custom' && node.promptOverride) {
    return node.promptOverride;
  }
  return node.role.charAt(0).toUpperCase() + node.role.slice(1).replace(/-/g, ' ');
}

function getModelLabel(modelId: string): string {
  if (modelId === 'disabled') return 'Skipped';
  for (const group of MODEL_GROUPS) {
    const found = group.items.find(m => m.id === modelId);
    if (found) return found.name;
  }
  return modelId;
}

function updateNodeModel(nodeId: string, newModel: string) {
  if (!draft.value.pipelineConfig) return;
  const newNodes = draft.value.pipelineConfig.nodes.map(n =>
    n.id === nodeId ? { ...n, model: newModel } : n
  );
  draft.value.pipelineConfig = { nodes: newNodes };
}

function setAllModels(modelId: string) {
  if (!modelId || !draft.value.pipelineConfig) return;
  const newNodes = draft.value.pipelineConfig.nodes.map(n => ({ ...n, model: modelId }));
  draft.value.pipelineConfig = { nodes: newNodes };
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
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--border-subtle);
  background: transparent;
  color: var(--text-primary);
  outline: none;
  transition: border-color 0.15s, background 0.15s;
  font-family: 'Inter', sans-serif;
}
.field-input:hover { border-color: var(--border-standard); background: rgba(255,255,255,0.02); }
.field-input:focus { border-color: var(--accent-ember); background: rgba(255,255,255,0.03); }
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
  font-size: 10px;
  color: var(--text-faint);
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px dashed var(--border-subtle);
  background: transparent;
  outline: none;
  transition: border-color 0.15s, color 0.15s;
  font-family: 'Inter', sans-serif;
  color-scheme: dark;
  cursor: pointer;
}
.field-input-dashed:hover { border-color: rgba(245,158,11,0.25); color: var(--text-secondary); }
.field-input-dashed:focus { border-color: var(--accent-ember); outline: none; }

.git-radio-dot {
  width: 12px;
  height: 12px;
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
  gap: 6px;
  padding: 5px 10px;
  border-radius: 6px;
  background: transparent;
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
  padding: 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 6px;
  border: none;
  color: white;
  cursor: pointer;
  transition: all 0.15s;
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
