import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { AgentLoop } from '../AgentLoop.js';
import { DatabaseImpl } from '../../db/database.js';
import { ToolRegistryImpl } from '../../tools/registry.js';
import type {
  AgentEvent,
  ProviderAdapter,
  ProviderStreamEvent,
  StreamParams,
  Tool,
  ToolResult,
  ToolContext,
} from '../../types.js';

let db: DatabaseImpl;
let tmpPath: string;

beforeEach(() => {
  tmpPath = path.join(os.tmpdir(), `angycode-loop-test-${Date.now()}.db`);
  db = new DatabaseImpl(tmpPath);
});

afterEach(() => {
  db.close();
  if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
});

// Helper: create a mock provider from scripted event sequences
// Each call to streamMessage returns the next sequence
function createMockProvider(
  sequences: ProviderStreamEvent[][],
): ProviderAdapter {
  let callIndex = 0;
  return {
    async *streamMessage(_params: StreamParams) {
      const events = sequences[callIndex] ?? sequences[sequences.length - 1];
      callIndex++;
      for (const event of events) {
        yield event;
      }
    },
  };
}

// Helper: simple tool for testing
function createEchoTool(): Tool {
  return {
    definition: {
      name: 'Echo',
      description: 'Returns the input as output',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
    },
    async execute(input: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
      return { content: `echo: ${input.text as string}`, is_error: false };
    },
  };
}

function createRegistry(tools: Tool[] = []): ToolRegistryImpl {
  const reg = new ToolRegistryImpl();
  for (const tool of tools) reg.register(tool);
  return reg;
}

function collectEvents(loop: AgentLoop): AgentEvent[] {
  const events: AgentEvent[] = [];
  loop.on('event', (e) => events.push(e));
  return events;
}

describe('AgentLoop', () => {
  it('completes a single-turn text response', async () => {
    const provider = createMockProvider([
      [
        { type: 'text_delta', text: 'Hello!' },
        { type: 'message_end', stop_reason: 'end_turn', usage: { input: 10, output: 5 } },
      ],
    ]);

    const loop = new AgentLoop({
      provider,
      tools: createRegistry(),
      db,
      workingDir: '/tmp',
      maxTokens: 1024,
      maxTurns: 10,
    });

    const events = collectEvents(loop);
    const session = await loop.run('say hello');

    expect(session.status).toBe('done');
    expect(events.some((e) => e.type === 'text' && e.text === 'Hello!')).toBe(true);
    expect(events.some((e) => e.type === 'done' && e.stop_reason === 'end_turn')).toBe(true);
    expect(events.some((e) => e.type === 'usage')).toBe(true);
  });

  it('executes tool calls and loops', async () => {
    const provider = createMockProvider([
      // Turn 1: tool call
      [
        { type: 'text_delta', text: 'Let me echo.' },
        { type: 'tool_call_start', id: 'tc1', name: 'Echo' },
        { type: 'tool_call_delta', id: 'tc1', input: '{"text":"hi"}' },
        { type: 'tool_call_end', id: 'tc1' },
        { type: 'message_end', stop_reason: 'tool_use', usage: { input: 20, output: 10 } },
      ],
      // Turn 2: done
      [
        { type: 'text_delta', text: 'Done!' },
        { type: 'message_end', stop_reason: 'end_turn', usage: { input: 30, output: 15 } },
      ],
    ]);

    const loop = new AgentLoop({
      provider,
      tools: createRegistry([createEchoTool()]),
      db,
      workingDir: '/tmp',
      maxTokens: 1024,
      maxTurns: 10,
    });

    const events = collectEvents(loop);
    const session = await loop.run('echo something');

    expect(session.status).toBe('done');

    // Check tool_start and tool_output events
    const toolStart = events.find((e) => e.type === 'tool_start');
    expect(toolStart).toBeDefined();
    expect(toolStart!.type === 'tool_start' && toolStart!.name).toBe('Echo');

    const toolOutput = events.find((e) => e.type === 'tool_output');
    expect(toolOutput).toBeDefined();
    if (toolOutput!.type === 'tool_output') {
      expect(toolOutput!.output).toBe('echo: hi');
      expect(toolOutput!.is_error).toBe(false);
    }

    // Should have 2 usage events (one per turn)
    const usageEvents = events.filter((e) => e.type === 'usage');
    expect(usageEvents).toHaveLength(2);
  });

  it('stops at maxTurns limit', async () => {
    // Provider always returns tool calls — will hit turn limit
    const toolCallSequence: ProviderStreamEvent[] = [
      { type: 'tool_call_start', id: 'tc1', name: 'Echo' },
      { type: 'tool_call_delta', id: 'tc1', input: '{"text":"loop"}' },
      { type: 'tool_call_end', id: 'tc1' },
      { type: 'message_end', stop_reason: 'tool_use', usage: { input: 10, output: 5 } },
    ];

    const provider = createMockProvider([
      toolCallSequence,
      toolCallSequence,
      toolCallSequence,
    ]);

    const loop = new AgentLoop({
      provider,
      tools: createRegistry([createEchoTool()]),
      db,
      workingDir: '/tmp',
      maxTokens: 1024,
      maxTurns: 2,
    });

    const events = collectEvents(loop);
    const session = await loop.run('loop forever');

    expect(session.status).toBe('paused');
    const doneEvent = events.find((e) => e.type === 'done');
    expect(doneEvent).toBeDefined();
    if (doneEvent!.type === 'done') {
      expect(doneEvent!.stop_reason).toBe('max_turns');
    }
  });

  it('handles abort mid-loop', async () => {
    // Provider returns tool call on first turn
    const provider = createMockProvider([
      [
        { type: 'tool_call_start', id: 'tc1', name: 'Echo' },
        { type: 'tool_call_delta', id: 'tc1', input: '{"text":"a"}' },
        { type: 'tool_call_end', id: 'tc1' },
        { type: 'message_end', stop_reason: 'tool_use', usage: { input: 10, output: 5 } },
      ],
      // This turn should not be reached
      [
        { type: 'text_delta', text: 'should not see this' },
        { type: 'message_end', stop_reason: 'end_turn', usage: { input: 10, output: 5 } },
      ],
    ]);

    const loop = new AgentLoop({
      provider,
      tools: createRegistry([createEchoTool()]),
      db,
      workingDir: '/tmp',
      maxTokens: 1024,
      maxTurns: 10,
    });

    // Abort after first tool call completes
    loop.on('event', (e) => {
      if (e.type === 'tool_output') {
        loop.abort();
      }
    });

    const events: AgentEvent[] = [];
    loop.on('event', (e) => events.push(e));

    const session = await loop.run('do something');

    expect(session.status).toBe('paused');
    const doneEvent = events.find((e) => e.type === 'done');
    expect(doneEvent).toBeDefined();
    if (doneEvent!.type === 'done') {
      expect(doneEvent!.stop_reason).toBe('aborted');
    }

    // Should NOT see the text from the second turn
    expect(events.some((e) => e.type === 'text' && e.text === 'should not see this')).toBe(false);
  });

  it('handles provider error stop_reason', async () => {
    const provider = createMockProvider([
      [
        { type: 'message_end', stop_reason: 'error', usage: { input: 0, output: 0 } },
      ],
    ]);

    const loop = new AgentLoop({
      provider,
      tools: createRegistry(),
      db,
      workingDir: '/tmp',
      maxTokens: 1024,
      maxTurns: 10,
    });

    const events = collectEvents(loop);
    const session = await loop.run('fail');

    expect(session.status).toBe('error');
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('persists messages to database', async () => {
    const provider = createMockProvider([
      [
        { type: 'text_delta', text: 'response' },
        { type: 'message_end', stop_reason: 'end_turn', usage: { input: 10, output: 5 } },
      ],
    ]);

    const loop = new AgentLoop({
      provider,
      tools: createRegistry(),
      db,
      workingDir: '/tmp',
      maxTokens: 1024,
      maxTurns: 10,
    });

    const session = await loop.run('persist test');

    // Check messages were persisted
    const { createMessageStore } = await import('../../db/messageStore.js');
    const msgStore = createMessageStore(db.db);
    const messages = msgStore.getMessages(session.id);

    // Should have user message + assistant message
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content[0]).toEqual({ type: 'text', text: 'response' });
  });

  it('records usage in database', async () => {
    const provider = createMockProvider([
      [
        { type: 'text_delta', text: 'ok' },
        { type: 'message_end', stop_reason: 'end_turn', usage: { input: 100, output: 50 } },
      ],
    ]);

    const loop = new AgentLoop({
      provider,
      tools: createRegistry(),
      db,
      workingDir: '/tmp',
      maxTokens: 1024,
      maxTurns: 10,
    });

    const session = await loop.run('usage test');

    const { createUsageStore } = await import('../../db/usageStore.js');
    const usageStore = createUsageStore(db.db);
    const usage = usageStore.getSessionUsage(session.id);

    expect(usage.totalInputTokens).toBe(100);
    expect(usage.totalOutputTokens).toBe(50);
  });

  it('handles unknown tool gracefully', async () => {
    const provider = createMockProvider([
      [
        { type: 'tool_call_start', id: 'tc1', name: 'NonExistent' },
        { type: 'tool_call_delta', id: 'tc1', input: '{}' },
        { type: 'tool_call_end', id: 'tc1' },
        { type: 'message_end', stop_reason: 'tool_use', usage: { input: 10, output: 5 } },
      ],
      [
        { type: 'text_delta', text: 'done' },
        { type: 'message_end', stop_reason: 'end_turn', usage: { input: 10, output: 5 } },
      ],
    ]);

    const loop = new AgentLoop({
      provider,
      tools: createRegistry(),
      db,
      workingDir: '/tmp',
      maxTokens: 1024,
      maxTurns: 10,
    });

    const events = collectEvents(loop);
    const session = await loop.run('use unknown tool');

    expect(session.status).toBe('done');
    const toolOutput = events.find((e) => e.type === 'tool_output');
    expect(toolOutput).toBeDefined();
    if (toolOutput!.type === 'tool_output') {
      expect(toolOutput!.is_error).toBe(true);
      expect(toolOutput!.output).toContain('Unknown tool');
    }
  });

  it('filters disabled tools', async () => {
    let capturedParams: StreamParams | null = null;
    const provider: ProviderAdapter = {
      async *streamMessage(params: StreamParams) {
        capturedParams = params;
        yield { type: 'text_delta' as const, text: 'ok' };
        yield {
          type: 'message_end' as const,
          stop_reason: 'end_turn',
          usage: { input: 10, output: 5 },
        };
      },
    };

    const registry = createRegistry([createEchoTool()]);
    // Also register a second tool
    registry.register({
      definition: { name: 'Bash', description: 'bash', inputSchema: { type: 'object' } },
      async execute() {
        return { content: 'ok', is_error: false };
      },
    });

    const loop = new AgentLoop({
      provider,
      tools: registry,
      db,
      workingDir: '/tmp',
      maxTokens: 1024,
      maxTurns: 10,
      disabledTools: ['Bash'],
    });

    await loop.run('test');

    expect(capturedParams).not.toBeNull();
    const toolNames = capturedParams!.tools.map((t) => t.name);
    expect(toolNames).toContain('Echo');
    expect(toolNames).not.toContain('Bash');
  });
});
