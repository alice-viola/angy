// ── Epic Orchestration Type Definitions ──────────────────────────────────────

// ── Column & Enum Types ─────────────────────────────────────────────────────

export type EpicColumn =
  | 'idea'
  | 'backlog'
  | 'todo'
  | 'in-progress'
  | 'review'
  | 'done'
  | 'discarded';

export type EpicPipelineType = 'create' | 'fix' | 'investigate' | 'plan';

export type PriorityHint =
  | 'critical'
  | 'high'
  | 'medium'
  | 'low'
  | 'none';

export type ComplexityEstimate =
  | 'trivial'
  | 'small'
  | 'medium'
  | 'large'
  | 'epic';

// ── Project & Repo ──────────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRepo {
  id: string;
  projectId: string;
  path: string;
  name: string;
  defaultBranch: string;
}

// ── Epic ─────────────────────────────────────────────────────────────────────

export interface Epic {
  id: string;
  projectId: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  column: EpicColumn;
  priorityHint: PriorityHint;
  complexity: ComplexityEstimate;
  model: string;
  targetRepoIds: string[];
  pipelineType: EpicPipelineType;
  useGitBranch: boolean;
  dependsOn: string[];
  rejectionCount: number;
  rejectionFeedback: string;
  lastAttemptFiles: string[];
  lastValidationResults: Array<{ command: string; passed: boolean; output: string }>;
  lastArchitectPlan: string;
  computedScore: number;
  rootSessionId: string | null;
  costTotal: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

// ── Epic Branch & Repo Lock ─────────────────────────────────────────────────

export interface EpicBranch {
  id: string;
  epicId: string;
  repoId: string;
  branchName: string;
  baseBranch: string;
  status: 'active' | 'merged' | 'deleted' | 'tracking';
}

export interface RepoLock {
  repoId: string;
  epicId: string;
  acquiredAt: string;
}

// ── Scheduler ───────────────────────────────────────────────────────────────

export interface SchedulerConfig {
  enabled: boolean;
  tickIntervalMs: number;
  maxConcurrentEpics: number;
  maxConcurrentPerProject?: number;
  dailyCostBudget: number;
  maxOrchestratorDepth?: number;        // max depth for spawn_orchestrator (default 3)
  maxConcurrentChildren?: number;       // max concurrent sub-orchestrators per parent (default 3)
  subOrchestratorTimeoutMs?: number;    // timeout for sub-orchestrators (default 30 min)
  weights: {
    manualHint: number;
    dependencyDepth: number;
    age: number;
    complexity: number;
    rejectionPenalty: number;
  };
}

export interface SchedulerAction {
  type: 'start' | 'to-review' | 'approve' | 'reject' | 'error' | 'recovered';
  epicId: string;
  timestamp: string;
  details: string;
}

// ── Orchestrator ────────────────────────────────────────────────────────────

export interface OrchestratorOptions {
  epicId: string;
  projectId: string;
  repoPaths: Record<string, string>;
  depth: number;
  maxDepth: number;
  parentSessionId: string | null;
  budgetRemaining: number | null;
  maxConcurrentChildren?: number;  // max concurrent sub-orchestrators per parent (default 3)
  subOrchestratorTimeoutMs?: number;  // timeout for sub-orchestrators (default 30 min)
}
