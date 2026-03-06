// ── Stream Events from Claude CLI ──────────────────────────────────────────

export type StreamEventType =
  | 'textDelta'
  | 'toolUse'
  | 'toolResult'
  | 'result'
  | 'error'
  | 'unknown';

export interface StreamEvent {
  type: StreamEventType;
  text?: string;
  toolName?: string;
  toolId?: string;
  toolInput?: Record<string, any>;
  toolResultContent?: string;
  sessionId?: string;
  raw?: any;
}

// ── Pending Tool Use (streaming field extraction state) ────────────────────

export interface PendingToolUse {
  name: string;
  id: string;
  blockIndex: number;
  accumulatedJson: string;
  pathEmitted: boolean;
  inNewString: boolean;
  extractedPath: string;
  newStringBuffer: string;
  lastScanPos: number;
}

// ── Session Info ──────────────────────────────────────────────────────────

export enum DelegationStatus {
  None = 0,
  Pending = 1,
  Running = 2,
  Completed = 3,
  Failed = 4,
}

export interface SessionInfo {
  sessionId: string;
  title: string;
  workspace: string;
  mode: string; // 'agent' | 'ask' | 'plan' | 'orchestrator'
  createdAt: number;
  updatedAt: number;
  favorite: boolean;
  parentSessionId?: string;
  pipelineId?: string;
  pipelineNodeId?: string;
  delegationTask?: string;
  delegationStatus: DelegationStatus;
  delegationResult?: string;
}

// ── Agent Status (for fleet panel) ────────────────────────────────────────

export type AgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'error';

export interface AgentSummary {
  sessionId: string;
  title: string;
  status: AgentStatus;
  activity: string;
  editCount: number;
  costUsd: number;
  mode: string;
  favorite: boolean;
  updatedAt: number;
  parentSessionId?: string;
}

// ── Database Records ──────────────────────────────────────────────────────

export interface MessageRecord {
  id?: number;
  sessionId: string;
  role: string; // 'user' | 'assistant' | 'tool'
  content: string;
  toolName?: string;
  toolInput?: string;
  turnId: number;
  timestamp: number;
}

export interface CheckpointRecord {
  sessionId: string;
  turnId: number;
  uuid: string;
  timestamp: number;
}

// ── File Changes / Diff ───────────────────────────────────────────────────

export interface FileChange {
  filePath: string;
  changeType: 'modified' | 'created' | 'deleted';
  linesAdded: number;
  linesRemoved: number;
}

export interface FileDiff {
  hunks: DiffHunk[];
  linesAdded: number;
  linesRemoved: number;
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
}

// ── Git Types ─────────────────────────────────────────────────────────────

export interface GitFileEntry {
  path: string;
  status: string; // 'M', 'A', 'D', '??', etc.
  staged: boolean;
}

// ── Engine Event Bus Types ────────────────────────────────────────────────

export type EngineEvents = {
  'agent:statusChanged': { agentId: string; status: AgentStatus; activity: string };
  'agent:output': { sessionId: string; text: string };
  'agent:costUpdate': { sessionId: string; costUsd: number };
  'session:created': { sessionId: string; parentSessionId?: string };
  'session:finished': { sessionId: string; exitCode: number };
  'session:idChanged': { oldId: string; newId: string };
  'diff:fileChanged': { sessionId: string; filePath: string; diff: FileDiff };
  'orchestrator:phaseChanged': { phase: string };
  'orchestrator:delegationStarted': { role: string; task: string; parentSessionId?: string };
  'git:statusChanged': { entries: GitFileEntry[] };
  'orchestrator:checkpointCreated': { hash: string; message: string };
};

// ── Attached Context / Images ─────────────────────────────────────────────

export interface AttachedContext {
  displayName: string;
  fullPath: string;
}

export interface AttachedImage {
  data: string; // base64
  format: string; // 'png', 'jpeg', etc.
  displayName: string;
}
