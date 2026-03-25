export interface RunConfig {
  adapter: 'agentloop' | 'claudecode';
  model: string;
  provider?: string;          // for agentloop: 'gemini' | 'anthropic'
  apiKey?: string;            // for agentloop (required if adapter is agentloop)
  serverBaseUrl?: string;     // for agentloop, e.g. 'http://127.0.0.1:3000'
  maxTurns?: number;          // override task default
  timeoutMs?: number;         // override task.maxTimeSeconds * 1000
  keep?: boolean;             // don't delete temp dir
  workDir?: string;            // pre-cloned working directory for the adapter to use
}

export interface RawTrace {
  adapter: 'agentloop' | 'claudecode';
  model: string;
  events: Array<{
    type: string;
    timestamp: number;
    [key: string]: unknown;
  }>;
  startTime: number;   // Date.now() at start
  endTime: number;     // Date.now() at end
  timedOut: boolean;
  aborted: boolean;
  agentTextOutput: string;
}

export interface TaskResult {
  taskId: string;
  taskName: string;
  difficulty: string;
  adapter: string;
  model: string;
  passed: boolean;
  timedOut: boolean;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  verifyExitCode: number;
  editFailures: number;    // tool_output events with is_error true and name 'Edit' or 'Write'
  backtracks: number;      // times agent reverted a file change
  stopReason?: string;
}

export interface AggregateScore {
  adapter: string;
  model: string;
  tag?: string;
  runId: string;
  totalTasks: number;
  passedTasks: number;
  passRate: number;
  avgTurns: number;
  avgTokens: number;
  totalCostUsd: number;
  taskResults: TaskResult[];
}

export interface RunMetrics {
  runId: string;
  adapter: string;
  model: string;
  tag?: string;
  gitSha: string;
  timestamp: string;
  tasks: TaskResult[];
}
