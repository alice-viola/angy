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

export type EpicPipelineType = 'hybrid' | 'fix' | 'investigate' | 'plan';

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
  color: string;
  createdAt: string;
  updatedAt: string;
}

// ── Predefined project colors ──────────────────────────────────────────────

export const PROJECT_COLORS = [
  '#cba6f7', // mauve
  '#89b4fa', // blue
  '#a6e3a1', // green
  '#f9e2af', // yellow
  '#fab387', // peach
  '#f38ba8', // red
  '#94e2d5', // teal
  '#f5c2e7', // pink
  '#74c7ec', // sapphire
  '#b4befe', // lavender
] as const;

// ── Activity Log ───────────────────────────────────────────────────────────

export type ActivityLogLevel = 'info' | 'success' | 'warning' | 'error';

export interface ActivityLogEntry {
  id: number;
  projectId: string;
  epicId: string | null;
  sessionId: string | null;
  level: ActivityLogLevel;
  message: string;
  timestamp: string;
}

export interface ProjectRepo {
  id: string;
  projectId: string;
  path: string;
  name: string;
  defaultBranch: string;
}

// ── Epic ─────────────────────────────────────────────────────────────────────

export type AgentRole = 'architect' | 'builder-frontend' | 'builder-backend' | 'builder-scaffold' | 'tester' | 'custom';

export interface AgentNode {
  id: string;
  role: AgentRole;
  model: string;
  promptOverride?: string;
  dependsOn: string[];
}

export interface PipelineConfig {
  nodes: AgentNode[];
}

export interface Epic {
  id: string;
  projectId: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  column: EpicColumn;
  priorityHint: PriorityHint;
  /** @deprecated Replaced by pipelineConfig driving the orchestrator */
  complexity: ComplexityEstimate;
  pipelineConfig?: PipelineConfig;
  model: string;
  targetRepoIds: string[];
  pipelineType: EpicPipelineType;
  useGitBranch: boolean;
  useWorktree: boolean;
  baseBranch: string | null;
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
  suspendedAt: string | null;
  runAfter: string | null;
  parallelAgentCount?: number;  // 1–4; when > 1 the scheduler duplicates this epic N times on start
  progress?: number;  // 0-1 float, used by ActiveCard progress ring
}

// ── Epic Branch & Repo Lock ─────────────────────────────────────────────────

export interface EpicBranch {
  id: string;
  epicId: string;
  repoId: string;
  branchName: string;
  baseBranch: string;
  status: 'active' | 'merged' | 'deleted' | 'tracking';
  worktreePath: string | null;
}

export interface RepoLock {
  repoId: string;
  epicId: string;
  acquiredAt: string;
}

export type BlockingReasonType = 'runAfter' | 'dependency' | 'repoLock' | 'concurrency' | 'projectConcurrency' | 'budget';

export interface BlockingReason {
  type: BlockingReasonType;
  label: string;           // Human-readable, e.g. "Waiting for 'Auth Refactor' to finish"
  relatedEpicId?: string;  // For runAfter, dependency, repoLock
  relatedRepoId?: string;  // For repoLock only
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
