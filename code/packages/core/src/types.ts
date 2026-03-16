// ── Shared Types ──────────────────────────────────────────────────────

export type ProviderName = 'anthropic' | 'gemini' | 'mock';

// ── JSON Schema (for tool input schemas) ─────────────────────────────

export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  description?: string;
  items?: JsonSchema;
  enum?: string[];
}

// ── Content Parts (discriminated union) ──────────────────────────────

export interface TextPart {
  type: 'text';
  text: string;
}

export interface ToolUsePart {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
  thought_signature?: string;
}

export interface ToolResultPart {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error: boolean;
}

export type ContentPart = TextPart | ToolUsePart | ToolResultPart;

// ── Message ──────────────────────────────────────────────────────────

export interface Message {
  role: 'user' | 'assistant';
  content: ContentPart[];
}

// ── Session ──────────────────────────────────────────────────────────

export interface Session {
  id: string;
  goal: string;
  provider: ProviderName;
  model: string;
  status: 'running' | 'paused' | 'done' | 'error';
  workingDir: string;
  systemPrompt?: string;
  turnCount: number;
  createdAt: number;
  updatedAt: number;
}

// ── Tools ────────────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface ToolResult {
  content: string;
  is_error: boolean;
}

export interface ToolContext {
  workingDir: string;
  sessionId: string;
  filesRead: Set<string>;
  emit: (event: AgentEvent) => void;
}

// ── Agent Events (discriminated union) ───────────────────────────────

export interface TextEvent {
  type: 'text';
  text: string;
}

export interface ToolStartEvent {
  type: 'tool_start';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolOutputEvent {
  type: 'tool_output';
  id: string;
  name: string;
  output: string;
  is_error: boolean;
  duration_ms: number;
}

export interface UsageEvent {
  type: 'usage';
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | undefined;
}

export interface DoneEvent {
  type: 'done';
  stop_reason: 'end_turn' | 'max_tokens' | 'max_turns' | 'error' | 'aborted';
}

export interface ErrorEvent {
  type: 'error';
  message: string;
}

export interface SessionStartEvent {
  type: 'session_start';
  sessionId: string;
  provider: string;
  model: string;
  workingDir: string;
}

export type AgentEvent =
  | SessionStartEvent
  | TextEvent
  | ToolStartEvent
  | ToolOutputEvent
  | UsageEvent
  | DoneEvent
  | ErrorEvent;

// ── Provider Config ──────────────────────────────────────────────────

export interface ProviderConfig {
  name: ProviderName;
  apiKey: string;
  model: string;
}

// ── Agent Loop Options ───────────────────────────────────────────────

export interface AgentLoopOptions {
  provider: ProviderAdapter;
  tools: ToolRegistry;
  db: Database;
  workingDir: string;
  maxTokens: number;
  maxTurns: number;
  providerName?: ProviderName;
  model?: string;
  systemPromptExtra?: string;
  disabledTools?: string[];
  sessionId?: string;
}

// ── Forward-declared interfaces (implemented in their own modules) ───

export interface ProviderAdapter {
  streamMessage(params: StreamParams): AsyncIterable<ProviderStreamEvent>;
}

export interface StreamParams {
  model: string;
  system: string;
  messages: Message[];
  tools: ToolDefinition[];
  maxTokens: number;
}

export interface ProviderStreamTextDelta {
  type: 'text_delta';
  text: string;
}

export interface ProviderStreamToolCallStart {
  type: 'tool_call_start';
  id: string;
  name: string;
  thought_signature?: string;
}

export interface ProviderStreamToolCallDelta {
  type: 'tool_call_delta';
  id: string;
  input: string;
}

export interface ProviderStreamToolCallEnd {
  type: 'tool_call_end';
  id: string;
}

export interface ProviderStreamMessageEnd {
  type: 'message_end';
  stop_reason: string;
  usage: { input: number; output: number };
  error?: string;
}

export type ProviderStreamEvent =
  | ProviderStreamTextDelta
  | ProviderStreamToolCallStart
  | ProviderStreamToolCallDelta
  | ProviderStreamToolCallEnd
  | ProviderStreamMessageEnd;

export interface ToolRegistry {
  register(tool: Tool): void;
  get(name: string): Tool | undefined;
  all(): Tool[];
  names(): string[];
  list(): ToolDefinition[];
  has(name: string): boolean;
}

export interface Tool {
  definition: ToolDefinition;
  execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export interface Database {
  db: import('better-sqlite3').Database;
  close(): void;
}
