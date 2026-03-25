import type { Task } from './task.schema.js';
import type { RawTrace, TaskResult } from './types.js';

interface TraceEvent {
  type: string;
  timestamp: number;
  [key: string]: unknown;
}

// Per-million-token pricing in USD — covers full model IDs and aliases
const PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-opus-4-20250514': { input: 15, output: 75 },
  'claude-opus-4-6': { input: 15, output: 75 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4 },
  // Gemini
  'gemini-2.5-flash': { input: 0.15, output: 0.6 },
  'gemini-2.5-pro': { input: 1.25, output: 10 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  // Try exact match first, then prefix match
  let pricing = PRICING[model];
  if (!pricing) {
    const key = Object.keys(PRICING).find((k) => model.startsWith(k) || k.startsWith(model));
    if (key) pricing = PRICING[key];
  }
  if (!pricing) return 0;
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

export function scoreTask(
  task: Task,
  trace: RawTrace,
  verifyExitCode: number,
  _verifyStdout: string
): TaskResult {
  const events = trace.events as TraceEvent[];

  // Count turns (both adapters emit 'turn' events — one per provider round-trip)
  // Falls back to 'usage' events then 'done' for backward compat with old traces
  let turns = events.filter((e) => e.type === 'turn').length;
  if (turns === 0) {
    turns = events.filter((e) => e.type === 'usage').length;
  }
  if (turns === 0) {
    turns = events.filter((e) => e.type === 'done').length;
  }

  // Sum tokens from usage events
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;

  for (const event of events) {
    if (event.type === 'usage') {
      inputTokens += (event.input_tokens as number) ?? 0;
      outputTokens += (event.output_tokens as number) ?? 0;
      costUsd += (event.cost_usd as number) ?? 0;
    }
  }

  // If server didn't report cost (model name mismatch), compute from tokens
  if (costUsd === 0 && (inputTokens > 0 || outputTokens > 0)) {
    costUsd = estimateCost(trace.model, inputTokens, outputTokens);
  }

  // Count edit failures (tool_output with is_error and name is Edit/Write)
  let editFailures = 0;
  for (const event of events) {
    if (event.type === 'tool_output') {
      const isError = event.is_error as boolean;
      const name = event.name as string | undefined;
      if (isError && (name === 'Edit' || name === 'Write')) {
        editFailures++;
      }
    }
  }

  // Count backtracks (Write to same file path as a previous Write)
  let backtracks = 0;
  const writtenPaths = new Set<string>();
  for (const event of events) {
    if (event.type === 'tool_start' && event.name === 'Write') {
      const input = event.input as { file_path?: string } | undefined;
      const filePath = input?.file_path;
      if (filePath) {
        if (writtenPaths.has(filePath)) {
          backtracks++;
        }
        writtenPaths.add(filePath);
      }
    }
  }

  // Get stop reason from done event
  let stopReason: string | undefined;
  for (const event of events) {
    if (event.type === 'done') {
      stopReason = event.stop_reason as string | undefined;
      break;
    }
  }

  return {
    taskId: task.id,
    taskName: task.name,
    difficulty: task.difficulty,
    adapter: trace.adapter,
    model: trace.model,
    passed: verifyExitCode === 0,
    timedOut: trace.timedOut,
    turns,
    inputTokens,
    outputTokens,
    costUsd,
    durationMs: trace.endTime - trace.startTime,
    verifyExitCode,
    editFailures,
    backtracks,
    stopReason,
  };
}
