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
  epicId?: string;
  pipelineId?: string;
  pipelineNodeId?: string;
  delegationTask?: string;
  delegationStatus: DelegationStatus;
  delegationResult?: string;
  claudeSessionId?: string;
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
  epicId?: string;
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

import type { Epic, EpicColumn } from './KosTypes';

// ── Engine Event Bus Types ────────────────────────────────────────────────

export type EngineEvents = {
  'agent:statusChanged': { agentId: string; status: AgentStatus; activity: string };
  'agent:output': { sessionId: string; text: string };
  'agent:costUpdate': { sessionId: string; costUsd: number; inputTokens: number; outputTokens: number; epicId?: string };
  'session:created': { sessionId: string; parentSessionId?: string };
  'session:finished': { sessionId: string; exitCode: number };
  'session:idChanged': { oldId: string; newId: string };
  'diff:fileChanged': { sessionId: string; filePath: string; diff: FileDiff };
  'orchestrator:phaseChanged': { phase: string };
  'orchestrator:delegationStarted': { role: string; task: string; parentSessionId?: string };
  'git:statusChanged': { entries: GitFileEntry[] };
  'orchestrator:checkpointCreated': { hash: string; message: string };
  'orchestrator:artifacts': {
    epicId: string;
    validations: Array<{ command: string; passed: boolean; output: string }>;
    childOutputs: Array<{ role: string; agentName: string; output: string }>;
  };
  'epic:phaseChanged': { epicId: string; phase: string };
  'epic:completed': { epicId: string; summary: string };
  'epic:failed': { epicId: string; reason: string };
  'epic:subOrchestratorSpawned': { task: string; depth: number; epicId: string };
  'scheduler:error': { epicId?: string; title: string; message: string };
  'scheduler:info': { epicId?: string; title: string; message: string };
  'epic:requestStart': { epicId: string };
  'epic:requestStop': { epicId: string; targetColumn?: EpicColumn };
  'epic:updated': { epicId: string; epic: Epic };
  'orchestrator:autoProfilesDetected': { orchestratorId: string; profileIds: string[]; profileNames: string[]; profileIcons: string[] };
  'epic:storeSyncNeeded': void;
  // Headless agent streaming — emitted by HeadlessHandle so ChatPanel can show live updates
  'agent:textDelta': { sessionId: string; text: string };
  'agent:toolUse': { sessionId: string; toolName: string; summary: string; toolInput?: Record<string, any> };
  'agent:thinkingDelta': { sessionId: string; text: string };
  'agent:thinking': { sessionId: string; thinking: boolean };
  'agent:turnDone': { sessionId: string };
  'agent:fileEdited': { sessionId: string; filePath: string; toolName: string; toolInput?: Record<string, any> };
};

// ── Agent Handle (UI-agnostic event sink for Claude process output) ──────

export interface AgentHandle {
  appendTextDelta(sessionId: string, text: string): void;
  appendThinkingDelta(sessionId: string, text: string): void;
  addToolUse(sessionId: string, toolName: string, summary: string, toolInput?: Record<string, any>, toolId?: string): void;
  markDone(sessionId: string): void;
  showError(sessionId: string, error: string): void;
  setThinking(sessionId: string, thinking: boolean): void;
  setRealSessionId(sessionId: string, realId: string): void;
  onFileEdited?(sessionId: string, filePath: string, toolName: string, toolInput?: Record<string, any>): void;
  onCheckpointReceived?(sessionId: string, uuid: string, replayIndex: number): void;
}

// ── Process Options ──────────────────────────────────────────────────────

export interface ProcessOptions {
  workingDir: string;
  mode?: string;
  model?: string;
  systemPrompt?: string;
  resumeSessionId?: string;
  images?: Array<{ data: string; mediaType: string }>;
  agentName?: string;
  teamId?: string;
  autoCommit?: boolean;
  epicEnabled?: boolean;
  specialistRole?: string;
}

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
