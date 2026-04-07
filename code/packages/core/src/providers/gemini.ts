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

// ── Retry helpers ───────────────────────────────────────────────────

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

function isTransientError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    // Google API 500/503/429 errors, network issues
    return (
      msg.includes('internal server error') ||
      msg.includes('500') ||
      msg.includes('503') ||
      msg.includes('service unavailable') ||
      msg.includes('overloaded') ||
      msg.includes('resource exhausted') ||
      msg.includes('rate limit') ||
      msg.includes('429') ||
      msg.includes('econnreset') ||
      msg.includes('socket hang up') ||
      msg.includes('timeout') ||
      msg.includes('fetch failed')
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

// ── Adapter ──────────────────────────────────────────────────────────

export class GeminiAdapter implements ProviderAdapter {
  private client: GoogleGenAI;

  constructor(opts: { apiKey: string }) {
    this.client = new GoogleGenAI({ apiKey: opts.apiKey });
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
      let cachedContentTokens = 0;
      let stopReason = 'end_turn';
      let succeeded = false;

      try {
        // Check if already aborted before starting
        if (params.signal?.aborted) {
          yield {
            type: 'message_end',
            stop_reason: 'aborted',
            usage: { input: 0, output: 0 },
          };
          return;
        }

        const stream = await this.client.models.generateContentStream({
          model: params.model,
          contents: toGeminiContents(params.messages),
          config: {
            systemInstruction: params.system,
            maxOutputTokens: params.maxTokens,
            tools: toGeminiTools(params.tools),
            abortSignal: params.signal,
          },
        });

        for await (const chunk of stream) {
          // Update usage from metadata (typically in last chunk)
          if (chunk.usageMetadata) {
            inputTokens = chunk.usageMetadata.promptTokenCount ?? inputTokens;
            outputTokens = chunk.usageMetadata.candidatesTokenCount ?? outputTokens;
            cachedContentTokens = (chunk.usageMetadata as Record<string, number>).cachedContentTokenCount ?? cachedContentTokens;
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
          usage: {
            input: inputTokens,
            output: outputTokens,
            cache_read_input: cachedContentTokens || undefined,
          },
        };

        // Stream completed successfully
        succeeded = true;
      } catch (err: unknown) {
        lastError = err;

        // Don't retry aborts
        if (params.signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
          yield {
            type: 'message_end',
            stop_reason: 'aborted',
            usage: { input: inputTokens, output: outputTokens },
          };
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
