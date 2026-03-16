import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message, ProviderStreamEvent, JsonSchema } from '../../types.js';

// Mock nanoid to return predictable IDs
let nanoidCounter = 0;
vi.mock('nanoid', () => ({
  nanoid: () => `nano-${++nanoidCounter}`,
}));

// Mock the Gemini SDK
const mockGenerateContentStream = vi.fn();
vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class {
      models = { generateContentStream: mockGenerateContentStream };
      constructor() {}
    },
    Type: {
      STRING: 'STRING',
      NUMBER: 'NUMBER',
      INTEGER: 'INTEGER',
      BOOLEAN: 'BOOLEAN',
      ARRAY: 'ARRAY',
      OBJECT: 'OBJECT',
      TYPE_UNSPECIFIED: 'TYPE_UNSPECIFIED',
    },
  };
});

// Import after mocks
import { GeminiAdapter, toGeminiContents, toGeminiSchema } from '../gemini.js';

async function collectEvents(iter: AsyncIterable<ProviderStreamEvent>) {
  const events: ProviderStreamEvent[] = [];
  for await (const e of iter) events.push(e);
  return events;
}

// Helper: create async iterable from array
function asyncIter<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i < items.length) return { value: items[i++], done: false };
          return { value: undefined, done: true };
        },
      };
    },
  };
}

describe('toGeminiContents', () => {
  it('maps assistant role to model', () => {
    const messages: Message[] = [
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    ];
    const result = toGeminiContents(messages);
    expect(result[0].role).toBe('model');
  });

  it('maps user role to user', () => {
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ];
    const result = toGeminiContents(messages);
    expect(result[0].role).toBe('user');
  });

  it('translates text parts', () => {
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    ];
    const result = toGeminiContents(messages);
    expect(result[0].parts).toEqual([{ text: 'hello' }]);
  });

  it('translates tool_use to functionCall', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tc1', name: 'Read', input: { file_path: '/a' } },
        ],
      },
    ];
    const result = toGeminiContents(messages);
    expect(result[0].parts).toEqual([
      { functionCall: { name: 'Read', args: { file_path: '/a' } } },
    ]);
  });

  it('translates tool_result to functionResponse with name lookup', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tc1', name: 'Read', input: {} },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tc1', content: 'file data', is_error: false },
        ],
      },
    ];
    const result = toGeminiContents(messages);
    expect(result[1].parts).toEqual([
      {
        functionResponse: {
          name: 'Read',
          response: { output: 'file data', is_error: false },
        },
      },
    ]);
  });

  it('uses "unknown" for tool_result with missing tool_use_id', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'missing', content: 'err', is_error: true },
        ],
      },
    ];
    const result = toGeminiContents(messages);
    expect(result[0].parts[0]).toHaveProperty('functionResponse');
    const fr = result[0].parts[0] as { functionResponse: { name: string } };
    expect(fr.functionResponse.name).toBe('unknown');
  });
});

describe('toGeminiSchema', () => {
  it('translates string type', () => {
    const result = toGeminiSchema({ type: 'string' });
    expect(result.type).toBe('STRING');
  });

  it('translates number type', () => {
    const result = toGeminiSchema({ type: 'number' });
    expect(result.type).toBe('NUMBER');
  });

  it('translates integer type', () => {
    const result = toGeminiSchema({ type: 'integer' });
    expect(result.type).toBe('INTEGER');
  });

  it('translates boolean type', () => {
    const result = toGeminiSchema({ type: 'boolean' });
    expect(result.type).toBe('BOOLEAN');
  });

  it('translates array type with items', () => {
    const schema: JsonSchema = { type: 'array', items: { type: 'string' } };
    const result = toGeminiSchema(schema);
    expect(result.type).toBe('ARRAY');
    expect(result.items).toEqual({ type: 'STRING' });
  });

  it('translates object type with nested properties', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'the name' },
        count: { type: 'integer' },
      },
      required: ['name'],
    };
    const result = toGeminiSchema(schema);
    expect(result.type).toBe('OBJECT');
    expect(result.required).toEqual(['name']);
    expect((result.properties as Record<string, unknown>)['name']).toEqual({
      type: 'STRING',
      description: 'the name',
    });
    expect((result.properties as Record<string, unknown>)['count']).toEqual({
      type: 'INTEGER',
    });
  });

  it('falls back to STRING for unknown types', () => {
    const result = toGeminiSchema({ type: 'custom' });
    expect(result.type).toBe('STRING');
  });
});

describe('GeminiAdapter', () => {
  let adapter: GeminiAdapter;

  beforeEach(() => {
    mockGenerateContentStream.mockReset();
    nanoidCounter = 0;
    adapter = new GeminiAdapter({ apiKey: 'test-key' });
  });

  it('streams text deltas', async () => {
    mockGenerateContentStream.mockResolvedValue(
      asyncIter([
        {
          candidates: [{ content: { parts: [{ text: 'hello' }] } }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        },
        {
          candidates: [{ content: { parts: [{ text: ' world' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 8 },
        },
      ]),
    );

    const events = await collectEvents(
      adapter.streamMessage({
        model: 'gemini-2.0-flash',
        system: 'be helpful',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        tools: [],
        maxTokens: 1024,
      }),
    );

    expect(events).toEqual([
      { type: 'text_delta', text: 'hello' },
      { type: 'text_delta', text: ' world' },
      { type: 'message_end', stop_reason: 'end_turn', usage: { input: 10, output: 8 } },
    ]);
  });

  it('handles function calls with fabricated IDs', async () => {
    mockGenerateContentStream.mockResolvedValue(
      asyncIter([
        {
          candidates: [
            {
              content: {
                parts: [
                  { functionCall: { name: 'Read', args: { file_path: '/a.ts' } } },
                ],
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 15 },
        },
      ]),
    );

    const events = await collectEvents(
      adapter.streamMessage({
        model: 'gemini-2.0-flash',
        system: '',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'read a.ts' }] }],
        tools: [{ name: 'Read', description: 'read', inputSchema: { type: 'object' } }],
        maxTokens: 1024,
      }),
    );

    expect(events).toEqual([
      { type: 'tool_call_start', id: 'nano-1', name: 'Read' },
      { type: 'tool_call_delta', id: 'nano-1', input: '{"file_path":"/a.ts"}' },
      { type: 'tool_call_end', id: 'nano-1' },
      { type: 'message_end', stop_reason: 'end_turn', usage: { input: 20, output: 15 } },
    ]);
  });

  it('handles multiple tool calls with unique IDs', async () => {
    mockGenerateContentStream.mockResolvedValue(
      asyncIter([
        {
          candidates: [
            {
              content: {
                parts: [
                  { functionCall: { name: 'Read', args: { path: '/a' } } },
                  { functionCall: { name: 'Read', args: { path: '/b' } } },
                ],
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 },
        },
      ]),
    );

    const events = await collectEvents(
      adapter.streamMessage({
        model: 'test',
        system: '',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
        tools: [{ name: 'Read', description: 'read', inputSchema: { type: 'object' } }],
        maxTokens: 1024,
      }),
    );

    // Each tool call should get a unique nanoid
    const startEvents = events.filter((e) => e.type === 'tool_call_start');
    expect(startEvents).toHaveLength(2);
    expect((startEvents[0] as { id: string }).id).toBe('nano-1');
    expect((startEvents[1] as { id: string }).id).toBe('nano-2');
  });

  it('translates MAX_TOKENS finish reason', async () => {
    mockGenerateContentStream.mockResolvedValue(
      asyncIter([
        {
          candidates: [
            { content: { parts: [{ text: 'trunc' }] }, finishReason: 'MAX_TOKENS' },
          ],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 100 },
        },
      ]),
    );

    const events = await collectEvents(
      adapter.streamMessage({
        model: 'test',
        system: '',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
        tools: [],
        maxTokens: 100,
      }),
    );

    const endEvent = events.find((e) => e.type === 'message_end');
    expect(endEvent).toBeDefined();
    expect((endEvent as { stop_reason: string }).stop_reason).toBe('max_tokens');
  });

  it('catches API errors and yields message_end with error', async () => {
    mockGenerateContentStream.mockRejectedValue(new Error('quota exceeded'));

    const events = await collectEvents(
      adapter.streamMessage({
        model: 'test',
        system: '',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        tools: [],
        maxTokens: 1024,
      }),
    );

    expect(events).toEqual([
      { type: 'message_end', stop_reason: 'error', usage: { input: 0, output: 0 }, error: 'quota exceeded' },
    ]);
  });

  it('catches stream iteration errors', async () => {
    mockGenerateContentStream.mockResolvedValue({
      [Symbol.asyncIterator]() {
        return {
          async next() {
            throw new Error('stream died');
          },
        };
      },
    });

    const events = await collectEvents(
      adapter.streamMessage({
        model: 'test',
        system: '',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        tools: [],
        maxTokens: 1024,
      }),
    );

    expect(events).toEqual([
      { type: 'message_end', stop_reason: 'error', usage: { input: 0, output: 0 }, error: 'stream died' },
    ]);
  });

  it('handles chunks with no candidates gracefully', async () => {
    mockGenerateContentStream.mockResolvedValue(
      asyncIter([
        { usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 0 } },
        {
          candidates: [{ content: { parts: [{ text: 'done' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 },
        },
      ]),
    );

    const events = await collectEvents(
      adapter.streamMessage({
        model: 'test',
        system: '',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        tools: [],
        maxTokens: 1024,
      }),
    );

    expect(events[0]).toEqual({ type: 'text_delta', text: 'done' });
    expect(events[1]).toEqual({
      type: 'message_end',
      stop_reason: 'end_turn',
      usage: { input: 5, output: 3 },
    });
  });
});
