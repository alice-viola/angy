import { nanoid } from 'nanoid';
import type {
  Message,
  ContentPart,
  ToolDefinition,
  ProviderStreamEvent,
  StreamParams,
  ProviderAdapter,
} from '../types.js';

// ── Message translation ──────────────────────────────────────────────

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  images?: string[];
  tool_calls?: OllamaToolCall[];
  tool_call_id?: string;
}

interface OllamaToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: Record<string, unknown> };
}

// Map our tool_use_id → tool name for building tool responses
export function toOllamaMessages(system: string, messages: Message[]): OllamaMessage[] {
  const result: OllamaMessage[] = [];

  // System message
  result.push({ role: 'system', content: system });

  // Build a map from tool_use_id → tool name
  const toolNameById = new Map<string, string>();
  for (const msg of messages) {
    for (const part of msg.content) {
      if (part.type === 'tool_use') {
        toolNameById.set(part.id, part.name);
      }
    }
  }

  for (const msg of messages) {
    if (msg.role === 'assistant') {
      // Collect text and tool calls
      let text = '';
      const toolCalls: OllamaToolCall[] = [];

      for (const part of msg.content) {
        if (part.type === 'text') {
          text += part.text;
        } else if (part.type === 'tool_use') {
          toolCalls.push({
            id: part.id,
            type: 'function',
            function: { name: part.name, arguments: part.input },
          });
        }
      }

      const assistantMsg: OllamaMessage = { role: 'assistant', content: text };
      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls;
      }
      result.push(assistantMsg);
    } else {
      // User message — may contain text, images, or tool results
      // Tool results become separate 'tool' role messages
      const textParts: string[] = [];
      const images: string[] = [];

      for (const part of msg.content) {
        if (part.type === 'text') {
          textParts.push(part.text);
        } else if (part.type === 'image') {
          images.push(part.data); // base64
        } else if (part.type === 'tool_result') {
          // Emit as a tool role message
          result.push({
            role: 'tool',
            content: part.content,
            tool_call_id: part.tool_use_id,
          });
        }
      }

      if (textParts.length > 0 || images.length > 0) {
        const userMsg: OllamaMessage = { role: 'user', content: textParts.join('\n') };
        if (images.length > 0) {
          userMsg.images = images;
        }
        result.push(userMsg);
      }
    }
  }

  return result;
}

// ── Tool translation ─────────────────────────────────────────────────

function toOllamaTools(tools: ToolDefinition[]) {
  if (tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object',
        properties: t.inputSchema.properties ?? {},
        required: t.inputSchema.required ?? [],
      },
    },
  }));
}

// ── Retry helpers ───────────────────────────────────────────────────

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

function isTransientError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes('econnrefused') ||
      msg.includes('econnreset') ||
      msg.includes('socket hang up') ||
      msg.includes('timeout') ||
      msg.includes('fetch failed') ||
      msg.includes('503') ||
      msg.includes('429') ||
      msg.includes('overloaded')
    );
  }
  return false;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

// ── SSE line parser ─────────────────────────────────────────────────

async function* parseSSELines(reader: ReadableStreamDefaultReader<Uint8Array>, signal?: AbortSignal): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    if (signal?.aborted) return;

    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) yield trimmed;
    }
  }

  // Flush remainder
  if (buffer.trim()) yield buffer.trim();
}

// ── Adapter ──────────────────────────────────────────────────────────

export class OllamaAdapter implements ProviderAdapter {
  private baseUrl: string;

  constructor(opts: { baseUrl?: string }) {
    this.baseUrl = (opts.baseUrl ?? 'http://localhost:11434').replace(/\/+$/, '');
  }

  async *streamMessage(params: StreamParams): AsyncIterable<ProviderStreamEvent> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        try {
          await sleep(delayMs, params.signal);
        } catch {
          yield {
            type: 'message_end',
            stop_reason: 'error',
            usage: { input: 0, output: 0 },
            error: lastError instanceof Error ? lastError.message : String(lastError),
          };
          return;
        }
      }

      let succeeded = false;

      try {
        if (params.signal?.aborted) {
          yield { type: 'message_end', stop_reason: 'aborted', usage: { input: 0, output: 0 } };
          return;
        }

        const body: Record<string, unknown> = {
          model: params.model,
          messages: toOllamaMessages(params.system, params.messages),
          stream: true,
        };

        const ollamaTools = toOllamaTools(params.tools);
        if (ollamaTools) {
          body.tools = ollamaTools;
        }

        // Use Ollama's native /api/chat endpoint (richer than OpenAI-compat)
        const response = await fetch(`${this.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: params.signal,
        });

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(`Ollama API error ${response.status}: ${text}`);
        }

        if (!response.body) {
          throw new Error('Ollama returned no response body');
        }

        const reader = response.body.getReader();
        let inputTokens = 0;
        let outputTokens = 0;
        let stopReason = 'end_turn';

        // Track active tool calls to emit proper events
        const pendingToolCalls: OllamaToolCall[] = [];

        for await (const line of parseSSELines(reader, params.signal)) {
          let chunk: any;
          try {
            chunk = JSON.parse(line);
          } catch {
            continue; // skip malformed lines
          }

          // Ollama streaming: each chunk has { message: { role, content, tool_calls? }, done: bool }
          if (chunk.message) {
            // Text content
            if (chunk.message.content) {
              yield { type: 'text_delta', text: chunk.message.content };
            }

            // Tool calls — Ollama delivers full tool calls in streaming chunks
            if (chunk.message.tool_calls && Array.isArray(chunk.message.tool_calls)) {
              for (const tc of chunk.message.tool_calls) {
                const id = nanoid();
                const name = tc.function?.name ?? 'unknown';
                const args = tc.function?.arguments ?? {};

                yield { type: 'tool_call_start', id, name };
                yield { type: 'tool_call_delta', id, input: JSON.stringify(args) };
                yield { type: 'tool_call_end', id };

                pendingToolCalls.push({ id, type: 'function', function: { name, arguments: args } });
              }
            }
          }

          // Final chunk
          if (chunk.done) {
            if (chunk.prompt_eval_count) inputTokens = chunk.prompt_eval_count;
            if (chunk.eval_count) outputTokens = chunk.eval_count;

            // If we had tool calls, stop reason is tool_use
            if (pendingToolCalls.length > 0) {
              stopReason = 'tool_use';
            } else if (chunk.done_reason === 'length') {
              stopReason = 'max_tokens';
            }
          }
        }

        yield {
          type: 'message_end',
          stop_reason: stopReason,
          usage: { input: inputTokens, output: outputTokens },
        };

        succeeded = true;
      } catch (err: unknown) {
        lastError = err;

        if (params.signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
          yield { type: 'message_end', stop_reason: 'aborted', usage: { input: 0, output: 0 } };
          return;
        }

        if (!isTransientError(err) || attempt === MAX_RETRIES) {
          yield {
            type: 'message_end',
            stop_reason: 'error',
            usage: { input: 0, output: 0 },
            error: err instanceof Error ? err.message : String(err),
          };
          return;
        }
        // Otherwise: loop will retry
      }

      if (succeeded) return;
    }
  }
}
