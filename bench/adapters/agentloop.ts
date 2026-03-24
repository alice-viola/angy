import type { Task } from '../task.schema.js';
import type { RawTrace, RunConfig } from '../types.js';

const DEFAULT_SERVER_URL = 'http://127.0.0.1:3000';

interface SessionCreateResponse {
  sessionId: string;
}

interface SessionErrorResponse {
  error: string;
}

// Event types from the server
interface SessionStartEvent {
  type: 'session_start';
  sessionId: string;
  provider: string;
  model: string;
  workingDir: string;
}

interface TextEvent {
  type: 'text';
  text: string;
}

interface ToolStartEvent {
  type: 'tool_start';
  id: string;
  name: string;
  input: unknown;
}

interface ToolOutputEvent {
  type: 'tool_output';
  id: string;
  name: string;
  output: string;
  is_error: boolean;
  duration_ms: number;
}

interface UsageEvent {
  type: 'usage';
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | undefined;
}

interface DoneEvent {
  type: 'done';
  stop_reason: 'end_turn' | 'max_tokens' | 'max_turns' | 'error' | 'aborted';
}

interface ErrorEvent {
  type: 'error';
  message: string;
}

type AgentEvent =
  | SessionStartEvent
  | TextEvent
  | ToolStartEvent
  | ToolOutputEvent
  | UsageEvent
  | DoneEvent
  | ErrorEvent;

export async function runAgentLoop(
  task: Task,
  config: RunConfig
): Promise<RawTrace> {
  const serverBaseUrl = config.serverBaseUrl ?? DEFAULT_SERVER_URL;
  const timeoutMs = config.timeoutMs ?? task.maxTimeSeconds * 1000;
  const maxTurns = config.maxTurns ?? task.maxTurns;

  if (!config.workDir) {
    throw new Error('workDir is required in RunConfig');
  }
  const workDir = config.workDir;

  const trace: RawTrace = {
    adapter: 'agentloop',
    model: config.model,
    events: [],
    startTime: Date.now(),
    endTime: 0,
    timedOut: false,
    aborted: false,
    agentTextOutput: '',
  };

  let sessionId: string | null = null;

  try {
    // Create session
    const createResponse = await fetch(`${serverBaseUrl}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goal: task.goal,
        provider: config.provider,
        apiKey: config.apiKey,
        workingDir: workDir,
        model: config.model,
        maxTurns: maxTurns,
      }),
    });

    if (createResponse.status !== 201) {
      const errorBody = (await createResponse.json()) as SessionErrorResponse;
      throw new Error(`Session creation failed: ${errorBody.error}`);
    }

    const sessionData = (await createResponse.json()) as SessionCreateResponse;
    sessionId = sessionData.sessionId;

    // Set up abort controller for timeout
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, timeoutMs);

    try {
      // Connect to SSE stream
      const eventsUrl = `${serverBaseUrl}/sessions/${sessionId}/events`;
      const eventsResponse = await fetch(eventsUrl, {
        signal: abortController.signal,
      });

      if (!eventsResponse.ok || !eventsResponse.body) {
        throw new Error(`Failed to connect to events stream: ${eventsResponse.status}`);
      }

      // Parse SSE stream manually
      const reader = eventsResponse.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let done = false;

      while (!done) {
        const { value, done: readerDone } = await reader.read();

        if (readerDone) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Split on double newlines (SSE block separator)
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() ?? ''; // Keep incomplete block in buffer

        for (const block of blocks) {
          if (!block.trim()) continue;

          // Extract data lines
          const lines = block.split('\n');
          const dataLines: string[] = [];

          for (const line of lines) {
            if (line.startsWith('data:')) {
              dataLines.push(line.slice(5).trim());
            }
          }

          if (dataLines.length === 0) continue;

          const dataStr = dataLines.join('');
          if (!dataStr) continue;

          try {
            const event = JSON.parse(dataStr) as AgentEvent;
            const timestamp = Date.now();

            // Push event to trace
            trace.events.push({
              ...event,
              timestamp,
            });

            // Accumulate text output
            if (event.type === 'text') {
              trace.agentTextOutput += event.text;
            }

            // Stop on done or error
            if (event.type === 'done' || event.type === 'error') {
              done = true;
              break;
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }

      clearTimeout(timeoutId);
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof Error && err.name === 'AbortError') {
        trace.timedOut = true;

        // Send abort request
        if (sessionId) {
          try {
            await fetch(`${serverBaseUrl}/sessions/${sessionId}/abort`, {
              method: 'POST',
            });
          } catch {
            // Ignore abort errors
          }
        }
      } else {
        throw err;
      }
    }
  } catch (err) {
    // Record error event
    trace.events.push({
      type: 'error',
      timestamp: Date.now(),
      message: err instanceof Error ? err.message : String(err),
    });
  }

  trace.endTime = Date.now();
  return trace;
}
