import type { Task } from './task.schema.js';
import type { RawTrace, TaskResult } from './types.js';

interface TraceEvent {
  type: string;
  timestamp: number;
  [key: string]: unknown;
}

export function scoreTask(
  task: Task,
  trace: RawTrace,
  verifyExitCode: number,
  _verifyStdout: string
): TaskResult {
  const events = trace.events as TraceEvent[];

  // Count turns (tool_start events)
  const turns = events.filter((e) => e.type === 'tool_start').length;

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
