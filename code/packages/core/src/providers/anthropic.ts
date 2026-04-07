import Anthropic from '@anthropic-ai/sdk';
import type {
  Message,
  ContentPart,
  ToolDefinition,
  ProviderStreamEvent,
  StreamParams,
  ProviderAdapter,
} from '../types.js';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContentBlock[];
}

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | { type: 'image'; source: { type: 'base64'; media_type: ImageMediaType; data: string } };

export function toAnthropicMessages(messages: Message[]): AnthropicMessage[] {
  const anthropicMessages: AnthropicMessage[] = [];
  for (const msg of messages) {
    const mappedContent = msg.content.map((part): AnthropicContentBlock => {
      switch (part.type) {
        case 'text':
          return { type: 'text', text: part.text };
        case 'image':
          return {
            type: 'image',
            source: {
              type: 'base64',
              media_type: part.mimeType as ImageMediaType,
              data: part.data,
            },
          };
        case 'tool_use':
          return { type: 'tool_use', id: part.id, name: part.name, input: part.input };
        case 'tool_result':
          return {
            type: 'tool_result',
            tool_use_id: part.tool_use_id,
            content: part.content,
            is_error: part.is_error,
          };
      }
    });
    
    if (anthropicMessages.length > 0 && anthropicMessages[anthropicMessages.length - 1].role === msg.role) {
      anthropicMessages[anthropicMessages.length - 1].content.push(...mappedContent);
    } else {
      anthropicMessages.push({ role: msg.role, content: mappedContent });
    }
  }
  return sanitizeAnthropicMessages(anthropicMessages);
}

/**
 * Sanitize the Anthropic message array to ensure tool_use / tool_result
 * pairing invariants required by the API:
 *
 * 1. Every tool_result in a user message must reference a tool_use id that
 *    exists in the immediately preceding assistant message.
 * 2. Every tool_use in an assistant message must have a matching tool_result
 *    in the immediately following user message (if one exists with
 *    tool_results).
 * 3. The conversation must end with a user message.
 *
 * Orphaned tool_results are removed. Missing tool_results for orphaned
 * tool_uses are synthesised so the API never rejects the request.
 */
export function sanitizeAnthropicMessages(messages: AnthropicMessage[]): AnthropicMessage[] {
  const result: AnthropicMessage[] = [...messages.map(m => ({ ...m, content: [...m.content] }))];

  for (let i = 0; i < result.length; i++) {
    const msg = result[i];

    // ── Fix user messages: drop tool_results that don't match preceding assistant ──
    if (msg.role === 'user') {
      const prevAssistant = i > 0 && result[i - 1].role === 'assistant' ? result[i - 1] : null;
      const validToolUseIds = new Set<string>();
      if (prevAssistant) {
        for (const block of prevAssistant.content) {
          if (block.type === 'tool_use') {
            validToolUseIds.add(block.id);
          }
        }
      }

      msg.content = msg.content.filter((block) => {
        if (block.type !== 'tool_result') return true;
        return validToolUseIds.has(block.tool_use_id);
      });

      // If all content was filtered out, add a placeholder text so the
      // message is never empty (Anthropic requires non-empty content).
      if (msg.content.length === 0) {
        msg.content.push({ type: 'text', text: '(continued)' });
      }
    }

    // ── Fix assistant messages: ensure every tool_use has a matching tool_result ──
    if (msg.role === 'assistant') {
      const toolUseIds: string[] = [];
      for (const block of msg.content) {
        if (block.type === 'tool_use') {
          toolUseIds.push(block.id);
        }
      }

      if (toolUseIds.length > 0) {
        // Find the next user message (it might not exist yet if the
        // conversation was interrupted before tool results were saved).
        const nextMsg = i + 1 < result.length ? result[i + 1] : null;

        if (nextMsg && nextMsg.role === 'user') {
          const existingResultIds = new Set<string>();
          for (const block of nextMsg.content) {
            if (block.type === 'tool_result') {
              existingResultIds.add(block.tool_use_id);
            }
          }

          // Prepend missing tool_results
          const missingResults: AnthropicContentBlock[] = [];
          for (const id of toolUseIds) {
            if (!existingResultIds.has(id)) {
              missingResults.push({
                type: 'tool_result',
                tool_use_id: id,
                content: 'Error: tool execution was interrupted',
                is_error: true,
              });
            }
          }
          if (missingResults.length > 0) {
            nextMsg.content = [...missingResults, ...nextMsg.content];
          }
        } else {
          // No following user message — insert one with placeholder tool_results
          const placeholderContent: AnthropicContentBlock[] = toolUseIds.map((id) => ({
            type: 'tool_result' as const,
            tool_use_id: id,
            content: 'Error: tool execution was interrupted',
            is_error: true,
          }));
          result.splice(i + 1, 0, { role: 'user', content: placeholderContent });
        }
      }
    }
  }

  // Ensure the conversation ends with a user message
  if (result.length > 0 && result[result.length - 1].role !== 'user') {
    result.push({ role: 'user', content: [{ type: 'text', text: '(continued)' }] });
  }

  return result;
}

function toAnthropicTools(tools: ToolDefinition[]) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: 'object' as const,
      properties: t.inputSchema.properties,
      required: t.inputSchema.required,
      description: t.inputSchema.description,
    },
  }));
}

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

function isTransientError(err: unknown): boolean {
  if (err instanceof Anthropic.APIError) {
    // 500, 502, 503, 529 (overloaded) are transient
    return err.status >= 500 || err.status === 429;
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes('internal server error') ||
      msg.includes('overloaded') ||
      msg.includes('rate limit') ||
      msg.includes('econnreset') ||
      msg.includes('socket hang up') ||
      msg.includes('timeout')
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

export class AnthropicAdapter implements ProviderAdapter {
  private client: Anthropic;

  constructor(opts: { apiKey: string }) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
  }

  async *streamMessage(params: StreamParams): AsyncIterable<ProviderStreamEvent> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        try {
          await sleep(delayMs, params.signal);
        } catch {
          // Aborted during backoff
          yield {
            type: 'message_end',
            stop_reason: 'error',
            usage: { input: 0, output: 0 },
            error: lastError instanceof Error ? lastError.message : String(lastError),
          };
          return;
        }
      }

      let inputTokens = 0;
      let outputTokens = 0;
      let cacheCreationInputTokens = 0;
      let cacheReadInputTokens = 0;
      const toolBlocks = new Map<number, { id: string; name: string }>();
      let succeeded = false;

      try {
        const stream = await this.client.messages.create({
          model: params.model,
          max_tokens: params.maxTokens,
          system: [
            {
              type: 'text' as const,
              text: params.system,
              cache_control: { type: 'ephemeral' as const },
            },
          ],
          messages: toAnthropicMessages(params.messages),
          tools: params.tools.length > 0 ? toAnthropicTools(params.tools) : undefined,
          stream: true,
        }, {
          signal: params.signal,
        });

        for await (const event of stream) {
          switch (event.type) {
            case 'message_start': {
              const usage = event.message?.usage;
              if (usage) {
                inputTokens = usage.input_tokens ?? 0;
                outputTokens = usage.output_tokens ?? 0;
                cacheCreationInputTokens = (usage as unknown as Record<string, number>).cache_creation_input_tokens ?? 0;
                cacheReadInputTokens = (usage as unknown as Record<string, number>).cache_read_input_tokens ?? 0;
              }
              break;
            }

            case 'content_block_start': {
              const block = event.content_block;
              if (block.type === 'tool_use') {
                toolBlocks.set(event.index, { id: block.id, name: block.name });
                yield { type: 'tool_call_start', id: block.id, name: block.name };
              }
              break;
            }

            case 'content_block_delta': {
              const delta = event.delta;
              if (delta.type === 'text_delta') {
                yield { type: 'text_delta', text: delta.text };
              } else if (delta.type === 'input_json_delta') {
                const tool = toolBlocks.get(event.index);
                if (tool) {
                  yield { type: 'tool_call_delta', id: tool.id, input: delta.partial_json };
                }
              }
              break;
            }

            case 'content_block_stop': {
              const tool = toolBlocks.get(event.index);
              if (tool) {
                yield { type: 'tool_call_end', id: tool.id };
                toolBlocks.delete(event.index);
              }
              break;
            }

            case 'message_delta': {
              if (event.usage) {
                outputTokens = event.usage.output_tokens ?? outputTokens;
              }
              const stopReason = event.delta?.stop_reason ?? 'end_turn';
              yield {
                type: 'message_end',
                stop_reason: stopReason,
                usage: {
                  input: inputTokens,
                  output: outputTokens,
                  cache_creation_input: cacheCreationInputTokens || undefined,
                  cache_read_input: cacheReadInputTokens || undefined,
                },
              };
              break;
            }
          }
        }

        // Stream completed successfully
        succeeded = true;
      } catch (err: unknown) {
        lastError = err;

        // Don't retry aborts or non-transient errors
        if (params.signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
          throw err;
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
