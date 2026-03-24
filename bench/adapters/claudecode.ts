import { spawn, type ChildProcess } from 'node:child_process';
import type { Task } from '../task.schema.js';
import type { RawTrace, RunConfig } from '../types.js';

interface AssistantMessage {
  type: 'assistant';
  session_id: string;
  message: {
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'tool_use'; id: string; name: string; input: unknown }
    >;
  };
}

interface ResultMessage {
  type: 'result';
  session_id: string;
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface ErrorMessage {
  type: 'error';
  error: {
    message: string;
  };
}

interface SystemMessage {
  type: 'system';
  session_id: string;
}

interface ToolResultMessage {
  type: 'tool_result';
  content: string | unknown[];
}

type ClaudeEvent =
  | AssistantMessage
  | ResultMessage
  | ErrorMessage
  | SystemMessage
  | ToolResultMessage;

export async function runClaudeCode(
  task: Task,
  config: RunConfig
): Promise<RawTrace> {
  const timeoutMs = config.timeoutMs ?? task.maxTimeSeconds * 1000;
  const maxTurns = config.maxTurns ?? task.maxTurns;

  if (!config.workDir) {
    throw new Error('workDir is required in RunConfig');
  }
  const workDir = config.workDir;

  const trace: RawTrace = {
    adapter: 'claudecode',
    model: config.model,
    events: [],
    startTime: Date.now(),
    endTime: 0,
    timedOut: false,
    aborted: false,
    agentTextOutput: '',
  };

  return new Promise((resolvePromise) => {
    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--permission-mode', 'bypassPermissions',
      '--model', config.model,
      '--add-dir', workDir,
      '--max-turns', String(maxTurns),
    ];

    const child: ChildProcess = spawn('claude', args, {
      cwd: workDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdoutBuffer = '';
    let killed = false;

    // Set up timeout
    const timeoutId = setTimeout(() => {
      trace.timedOut = true;
      killed = true;

      // Send SIGTERM first
      child.kill('SIGTERM');

      // Force kill after 5 seconds
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 5000);
    }, timeoutMs);

    // Write input to stdin
    const inputMessage = {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: task.goal }],
      },
    };

    if (child.stdin) {
      child.stdin.write(JSON.stringify(inputMessage) + '\n');
      child.stdin.end();
    }

    // Parse stdout line by line
    if (child.stdout) {
      child.stdout.on('data', (data: Buffer) => {
        stdoutBuffer += data.toString();

        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() ?? ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const event = JSON.parse(line) as ClaudeEvent;
            const timestamp = Date.now();

            if (event.type === 'system') {
              // Ignore system init event
              continue;
            }

            if (event.type === 'assistant') {
              // Walk content array
              for (const block of event.message.content) {
                if (block.type === 'text') {
                  trace.agentTextOutput += block.text;
                  trace.events.push({
                    type: 'text',
                    timestamp,
                    text: block.text,
                  });
                } else if (block.type === 'tool_use') {
                  trace.events.push({
                    type: 'tool_start',
                    timestamp,
                    id: block.id,
                    name: block.name,
                    input: block.input,
                  });
                }
              }
            } else if (event.type === 'tool_result') {
              trace.events.push({
                type: 'tool_output',
                timestamp,
                output: typeof event.content === 'string'
                  ? event.content
                  : JSON.stringify(event.content),
                is_error: false,
              });
            } else if (event.type === 'result') {
              trace.events.push({
                type: 'usage',
                timestamp,
                input_tokens: event.usage.input_tokens,
                output_tokens: event.usage.output_tokens,
                cost_usd: event.total_cost_usd ?? 0,
              });
              trace.events.push({
                type: 'done',
                timestamp,
                stop_reason: 'end_turn',
              });
            } else if (event.type === 'error') {
              trace.events.push({
                type: 'error',
                timestamp,
                message: event.error.message,
              });
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      });
    }

    // Capture stderr for debugging
    if (child.stderr) {
      child.stderr.on('data', () => {
        // stderr ignored for tracing
      });
    }

    child.on('close', (code) => {
      clearTimeout(timeoutId);
      trace.endTime = Date.now();

      // If process exited with error and we didn't timeout
      if (code !== 0 && !killed) {
        trace.events.push({
          type: 'done',
          timestamp: Date.now(),
          stop_reason: 'error',
        });
      }

      resolvePromise(trace);
    });

    child.on('error', (err) => {
      clearTimeout(timeoutId);
      trace.endTime = Date.now();
      trace.events.push({
        type: 'error',
        timestamp: Date.now(),
        message: err.message,
      });
      resolvePromise(trace);
    });
  });
}
