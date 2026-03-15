import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message, ProviderStreamEvent } from '../../types.js';

// Mock the Anthropic SDK
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class Anthropic {
      messages = { create: mockCreate };
      constructor() {}
    },
  };
});

// Import after mock
import { AnthropicAdapter, toAnthropicMessages } from '../anthropic.js';

// Helper: create an async iterable from an array of events
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

async function collectEvents(iter: AsyncIterable<ProviderStreamEvent>) {
  const events: ProviderStreamEvent[] = [];
  for await (const e of iter) events.push(e);
  return events;
}

describe('toAnthropicMessages', () => {
  it('translates text parts', () => {
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    ];
    const result = toAnthropicMessages(messages);
    expect(result).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    ]);
  });

  it('translates tool_use parts', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tc1', name: 'Read', input: { file_path: '/test' } },
        ],
      },
    ];
    const result = toAnthropicMessages(messages);
    expect(result).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tc1', name: 'Read', input: { file_path: '/test' } },
        ],
      },
    ]);
  });

  it('translates tool_result parts', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tc1', content: 'file content', is_error: false },
        ],
      },
    ];
    const result = toAnthropicMessages(messages);
    expect(result).toEqual([
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tc1', content: 'file content', is_error: false },
        ],
      },
    ]);
  });

  it('handles mixed content parts in a single message', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me read that file' },
          { type: 'tool_use', id: 'tc1', name: 'Read', input: { path: '/a' } },
        ],
      },
    ];
    const result = toAnthropicMessages(messages);
    expect(result[0].content).toHaveLength(2);
    expect(result[0].content[0]).toEqual({ type: 'text', text: 'Let me read that file' });
    expect(result[0].content[1]).toEqual({ type: 'tool_use', id: 'tc1', name: 'Read', input: { path: '/a' } });
  });
});

describe('AnthropicAdapter', () => {
  let adapter: AnthropicAdapter;

  beforeEach(() => {
    mockCreate.mockReset();
    adapter = new AnthropicAdapter({ apiKey: 'test-key' });
  });

  it('maps text_delta events', async () => {
    mockCreate.mockResolvedValue(
      asyncIter([
        { type: 'message_start', message: { usage: { input_tokens: 100, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' world' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } },
      ]),
    );

    const events = await collectEvents(
      adapter.streamMessage({
        model: 'claude-opus-4-6',
        system: 'you are helpful',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        tools: [],
        maxTokens: 1024,
      }),
    );

    expect(events).toEqual([
      { type: 'text_delta', text: 'hello' },
      { type: 'text_delta', text: ' world' },
      { type: 'message_end', stop_reason: 'end_turn', usage: { input: 100, output: 10 } },
    ]);
  });

  it('maps tool_use events', async () => {
    mockCreate.mockResolvedValue(
      asyncIter([
        { type: 'message_start', message: { usage: { input_tokens: 50, output_tokens: 0 } } },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'tc1', name: 'Read' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"file' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '":"a.ts"}' },
        },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } },
      ]),
    );

    const events = await collectEvents(
      adapter.streamMessage({
        model: 'claude-opus-4-6',
        system: '',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'read a.ts' }] }],
        tools: [{ name: 'Read', description: 'read', inputSchema: { type: 'object' } }],
        maxTokens: 1024,
      }),
    );

    expect(events).toEqual([
      { type: 'tool_call_start', id: 'tc1', name: 'Read' },
      { type: 'tool_call_delta', id: 'tc1', input: '{"file' },
      { type: 'tool_call_delta', id: 'tc1', input: '":"a.ts"}' },
      { type: 'tool_call_end', id: 'tc1' },
      { type: 'message_end', stop_reason: 'tool_use', usage: { input: 50, output: 20 } },
    ]);
  });

  it('handles mixed text and tool blocks', async () => {
    mockCreate.mockResolvedValue(
      asyncIter([
        { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'reading...' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tc2', name: 'Bash' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{}' } },
        { type: 'content_block_stop', index: 1 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } },
      ]),
    );

    const events = await collectEvents(
      adapter.streamMessage({
        model: 'test',
        system: '',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
        tools: [{ name: 'Bash', description: 'bash', inputSchema: { type: 'object' } }],
        maxTokens: 1024,
      }),
    );

    const types = events.map((e) => e.type);
    expect(types).toEqual([
      'text_delta',
      'tool_call_start',
      'tool_call_delta',
      'tool_call_end',
      'message_end',
    ]);
  });

  it('catches API errors and yields message_end with stop_reason error', async () => {
    mockCreate.mockRejectedValue(new Error('rate limited'));

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
      { type: 'message_end', stop_reason: 'error', usage: { input: 0, output: 0 } },
    ]);
  });

  it('catches stream iteration errors and yields message_end', async () => {
    const failingIter = {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            throw new Error('stream broke');
          },
        };
      },
    };
    mockCreate.mockResolvedValue(failingIter);

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
      { type: 'message_end', stop_reason: 'error', usage: { input: 0, output: 0 } },
    ]);
  });
});
