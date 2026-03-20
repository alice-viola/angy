import { GoogleGenAI, Type as SchemaType } from '@google/genai';
import { nanoid } from 'nanoid';
import type {
  Message,
  ContentPart,
  ToolDefinition,
  JsonSchema,
  ProviderStreamEvent,
  StreamParams,
  ProviderAdapter,
} from '../types.js';

// ── Schema translation ───────────────────────────────────────────────

const schemaTypeMap: Record<string, SchemaType> = {
  string: SchemaType.STRING,
  number: SchemaType.NUMBER,
  integer: SchemaType.INTEGER,
  boolean: SchemaType.BOOLEAN,
  array: SchemaType.ARRAY,
  object: SchemaType.OBJECT,
};

export function toGeminiSchema(schema: JsonSchema): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (schema.type) {
    result.type = schemaTypeMap[schema.type] ?? SchemaType.STRING;
  }
  if (schema.description) {
    result.description = schema.description;
  }
  if (schema.enum) {
    result.enum = schema.enum;
  }
  if (schema.required) {
    result.required = schema.required;
  }
  if (schema.items) {
    result.items = toGeminiSchema(schema.items);
  }
  if (schema.properties) {
    const props: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(schema.properties)) {
      props[key] = toGeminiSchema(val);
    }
    result.properties = props;
  }

  return result;
}

// ── Message translation ──────────────────────────────────────────────

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

type GeminiPart =
  | { text: string; thoughtSignature?: string }
  | { functionCall: { name: string; args: Record<string, unknown> }; thoughtSignature?: string }
  | { functionResponse: { name: string; response: Record<string, unknown> } }
  | { inlineData: { mimeType: string; data: string } };

// Map our tool_use_id → tool name for building function responses
export function toGeminiContents(messages: Message[]): GeminiContent[] {
  // Build a map from tool_use_id → tool name so we can reconstruct function responses
  const toolNameById = new Map<string, string>();
  for (const msg of messages) {
    for (const part of msg.content) {
      if (part.type === 'tool_use') {
        toolNameById.set(part.id, part.name);
      }
    }
  }

  const geminiContents: GeminiContent[] = [];

  for (const msg of messages) {
    const role = msg.role === 'assistant' ? 'model' : 'user';
    const parts = msg.content.map((part): GeminiPart => {
      switch (part.type) {
        case 'text':
          return { text: part.text };
        case 'image':
          return {
            inlineData: {
              mimeType: part.mimeType,
              data: part.data,
            },
          };
        case 'tool_use':
          return {
            functionCall: { name: part.name, args: part.input },
            ...(part.thought_signature ? { thoughtSignature: part.thought_signature } : {}),
          };
        case 'tool_result': {
          const name = toolNameById.get(part.tool_use_id) ?? 'unknown';
          return {
            functionResponse: {
              name,
              response: {
                output: part.content,
                is_error: part.is_error,
              },
            },
          };
        }
      }
    });

    if (geminiContents.length > 0 && geminiContents[geminiContents.length - 1].role === role) {
      geminiContents[geminiContents.length - 1].parts.push(...parts);
    } else {
      geminiContents.push({ role, parts });
    }
  }

  return geminiContents;
}

// ── Tool translation ─────────────────────────────────────────────────

function toGeminiTools(tools: ToolDefinition[]) {
  if (tools.length === 0) return undefined;
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: toGeminiSchema(t.inputSchema),
      })),
    },
  ];
}

// ── Adapter ──────────────────────────────────────────────────────────

export class GeminiAdapter implements ProviderAdapter {
  private client: GoogleGenAI;

  constructor(opts: { apiKey: string }) {
    this.client = new GoogleGenAI({ apiKey: opts.apiKey });
  }

  async *streamMessage(params: StreamParams): AsyncIterable<ProviderStreamEvent> {
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason = 'end_turn';

    try {
      const stream = await this.client.models.generateContentStream({
        model: params.model,
        contents: toGeminiContents(params.messages),
        config: {
          systemInstruction: params.system,
          maxOutputTokens: params.maxTokens,
          tools: toGeminiTools(params.tools),
        },
      });

      for await (const chunk of stream) {
        // Update usage from metadata (typically in last chunk)
        if (chunk.usageMetadata) {
          inputTokens = chunk.usageMetadata.promptTokenCount ?? inputTokens;
          outputTokens = chunk.usageMetadata.candidatesTokenCount ?? outputTokens;
        }

        const candidate = chunk.candidates?.[0];
        if (!candidate?.content?.parts) continue;

        // Check finish reason
        if (candidate.finishReason) {
          switch (candidate.finishReason) {
            case 'STOP':
              stopReason = 'end_turn';
              break;
            case 'MAX_TOKENS':
              stopReason = 'max_tokens';
              break;
            case 'SAFETY':
              stopReason = 'safety';
              break;
            default:
              stopReason = candidate.finishReason.toLowerCase();
          }
        }

        for (const part of candidate.content.parts) {
          if (part.text !== undefined && part.text !== null) {
            yield { type: 'text_delta', text: part.text };
          }

          if (part.functionCall) {
            const id = nanoid();
            const thoughtSignature = (part as Record<string, unknown>)['thoughtSignature'] as string | undefined;
            yield {
              type: 'tool_call_start',
              id,
              name: part.functionCall.name ?? 'unknown',
              ...(thoughtSignature ? { thought_signature: thoughtSignature } : {}),
            };
            // Gemini delivers full args in one shot, emit as single delta
            yield {
              type: 'tool_call_delta',
              id,
              input: JSON.stringify(part.functionCall.args ?? {}),
            };
            yield { type: 'tool_call_end', id };
          }
        }
      }

      yield {
        type: 'message_end',
        stop_reason: stopReason,
        usage: { input: inputTokens, output: outputTokens },
      };
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
