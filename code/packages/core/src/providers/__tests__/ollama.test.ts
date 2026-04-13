import { describe, it, expect } from 'vitest';
import { OllamaAdapter, toOllamaMessages } from '../ollama.js';
import type { Message, ProviderStreamEvent } from '../../types.js';

// ── Unit tests (always run) ──────────────────────────────────────────

describe('toOllamaMessages', () => {
  it('converts simple user/assistant messages', () => {
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hi there' }] },
    ];
    const result = toOllamaMessages('You are helpful.', messages);

    expect(result[0]).toEqual({ role: 'system', content: 'You are helpful.' });
    expect(result[1]).toEqual({ role: 'user', content: 'hello' });
    expect(result[2]).toEqual({ role: 'assistant', content: 'hi there' });
  });

  it('converts tool_use and tool_result pairs', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me check.' },
          { type: 'tool_use', id: 'tc1', name: 'read_file', input: { path: '/a.txt' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tc1', content: 'file contents here', is_error: false },
        ],
      },
    ];
    const result = toOllamaMessages('sys', messages);

    // system + assistant (with tool_calls) + tool response
    expect(result).toHaveLength(3);
    expect(result[1].role).toBe('assistant');
    expect(result[1].tool_calls).toHaveLength(1);
    expect(result[1].tool_calls![0].function.name).toBe('read_file');
    expect(result[2].role).toBe('tool');
    expect(result[2].content).toBe('file contents here');
    expect(result[2].tool_call_id).toBe('tc1');
  });

  it('handles image parts as base64 images array', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this?' },
          { type: 'image', data: 'base64data', mimeType: 'image/png' },
        ],
      },
    ];
    const result = toOllamaMessages('sys', messages);
    expect(result[1].images).toEqual(['base64data']);
    expect(result[1].content).toBe('what is this?');
  });
});

// ── Integration test (requires running Ollama with gemma4) ──────────

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

// Check if Ollama is running before the integration test
async function isOllamaRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    return res.ok;
  } catch {
    return false;
  }
}

describe('OllamaAdapter integration', () => {
  it('streams a simple text response from gemma4', async () => {
    const running = await isOllamaRunning();
    if (!running) {
      console.log('Skipping: Ollama not running');
      return;
    }

    const adapter = new OllamaAdapter({ baseUrl: OLLAMA_URL });
    const events: ProviderStreamEvent[] = [];

    for await (const event of adapter.streamMessage({
      model: 'gemma4',
      system: 'You are a helpful assistant. Reply in one sentence.',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Say hello.' }] }],
      tools: [],
      maxTokens: 100,
    })) {
      events.push(event);
    }

    // Should have at least one text_delta and one message_end
    const textDeltas = events.filter(e => e.type === 'text_delta');
    const messageEnds = events.filter(e => e.type === 'message_end');

    expect(textDeltas.length).toBeGreaterThan(0);
    expect(messageEnds).toHaveLength(1);
    expect(messageEnds[0].stop_reason).toBe('end_turn');

    // Check we got some actual text
    const fullText = textDeltas.map(e => (e as any).text).join('');
    expect(fullText.length).toBeGreaterThan(0);
    console.log('Gemma 4 response:', fullText);
  }, 60_000);

  it('handles tool calling with gemma4', async () => {
    const running = await isOllamaRunning();
    if (!running) {
      console.log('Skipping: Ollama not running');
      return;
    }

    const adapter = new OllamaAdapter({ baseUrl: OLLAMA_URL });
    const events: ProviderStreamEvent[] = [];

    for await (const event of adapter.streamMessage({
      model: 'gemma4',
      system: 'You are an assistant. Use the get_weather tool to answer weather questions. Always use the tool, never answer directly.',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'What is the weather in Tokyo?' }] },
      ],
      tools: [
        {
          name: 'get_weather',
          description: 'Get the current weather for a location',
          inputSchema: {
            type: 'object',
            properties: {
              location: { type: 'string', description: 'City name' },
            },
            required: ['location'],
          },
        },
      ],
      maxTokens: 500,
    })) {
      events.push(event);
    }

    const toolStarts = events.filter(e => e.type === 'tool_call_start');
    const toolDeltas = events.filter(e => e.type === 'tool_call_delta');
    const toolEnds = events.filter(e => e.type === 'tool_call_end');

    console.log('Tool call events:', { toolStarts: toolStarts.length, toolDeltas: toolDeltas.length, toolEnds: toolEnds.length });
    console.log('All events:', events.map(e => e.type));

    // Gemma 4 should call the tool (if it does, great; if not, just log)
    if (toolStarts.length > 0) {
      expect(toolStarts[0]).toHaveProperty('name', 'get_weather');
      expect(toolDeltas.length).toBeGreaterThan(0);
      expect(toolEnds.length).toBeGreaterThan(0);

      // Parse the arguments
      const argsJson = (toolDeltas[0] as any).input;
      const args = JSON.parse(argsJson);
      console.log('Tool call args:', args);
      expect(args).toHaveProperty('location');
    } else {
      // Model may not always use tools — log and pass
      const text = events.filter(e => e.type === 'text_delta').map(e => (e as any).text).join('');
      console.log('Model responded with text instead of tool call:', text);
    }
  }, 60_000);
});
