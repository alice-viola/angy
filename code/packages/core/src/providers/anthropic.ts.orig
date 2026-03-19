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
  return messages.map((msg) => ({
    role: msg.role,
    content: msg.content.map((part): AnthropicContentBlock => {
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
    }),
  }));
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

export class AnthropicAdapter implements ProviderAdapter {
  private client: Anthropic;

  constructor(opts: { apiKey: string }) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
  }

  async *streamMessage(params: StreamParams): AsyncIterable<ProviderStreamEvent> {
    let inputTokens = 0;
    let outputTokens = 0;

    // Track which content block indices are tool_use blocks
    const toolBlocks = new Map<number, { id: string; name: string }>();

    try {
      const stream = await this.client.messages.create({
        model: params.model,
        max_tokens: params.maxTokens,
        system: params.system,
        messages: toAnthropicMessages(params.messages),
        tools: params.tools.length > 0 ? toAnthropicTools(params.tools) : undefined,
        stream: true,
      });

      for await (const event of stream) {
        switch (event.type) {
          case 'message_start': {
            const usage = event.message?.usage;
            if (usage) {
              inputTokens = usage.input_tokens ?? 0;
              outputTokens = usage.output_tokens ?? 0;
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
              usage: { input: inputTokens, output: outputTokens },
            };
            break;
          }
        }
      }
    } catch (err: unknown) {
      yield {
        type: 'message_end',
        stop_reason: 'error',
        usage: { input: 0, output: 0 },
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
