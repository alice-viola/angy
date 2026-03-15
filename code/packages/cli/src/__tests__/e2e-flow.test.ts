import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import {
  AgentLoop,
  DatabaseImpl,
  createDefaultRegistry,
  createSessionStore,
  createMessageStore,
} from '@angycode/core';
import type { ProviderAdapter, StreamParams, ProviderStreamEvent } from '@angycode/core';

let db: DatabaseImpl;
let tmpDir: string;
let dbPath: string;

function createMockProvider(sequences: ProviderStreamEvent[][]): ProviderAdapter {
  let callIndex = 0;
  return {
    async *streamMessage(_params: StreamParams) {
      const events = sequences[callIndex] ?? sequences[sequences.length - 1]!;
      callIndex++;
      for (const event of events) {
        yield event;
      }
    },
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'angy-e2e-'));
  dbPath = path.join(tmpDir, 'test.db');
  db = new DatabaseImpl(dbPath);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('e2e flow', () => {
  it('writes, reads, and edits a file via tool calls', async () => {
    const testFile = path.join(tmpDir, 'hello.txt');

    // Turn 1: Write tool call
    // Turn 2: Read tool call
    // Turn 3: Edit tool call
    // Turn 4: Done
    const provider = createMockProvider([
      // Turn 1: Write file
      [
        { type: 'text_delta', text: 'Writing file.' },
        { type: 'tool_call_start', id: 'tc1', name: 'Write' },
        {
          type: 'tool_call_delta',
          id: 'tc1',
          input: JSON.stringify({ file_path: testFile, content: 'Hello World\nLine 2\n' }),
        },
        { type: 'tool_call_end', id: 'tc1' },
        { type: 'message_end', stop_reason: 'tool_use', usage: { input: 50, output: 20 } },
      ],
      // Turn 2: Read the file
      [
        { type: 'text_delta', text: 'Reading file.' },
        { type: 'tool_call_start', id: 'tc2', name: 'Read' },
        {
          type: 'tool_call_delta',
          id: 'tc2',
          input: JSON.stringify({ file_path: testFile }),
        },
        { type: 'tool_call_end', id: 'tc2' },
        { type: 'message_end', stop_reason: 'tool_use', usage: { input: 60, output: 25 } },
      ],
      // Turn 3: Edit the file
      [
        { type: 'text_delta', text: 'Editing file.' },
        { type: 'tool_call_start', id: 'tc3', name: 'Edit' },
        {
          type: 'tool_call_delta',
          id: 'tc3',
          input: JSON.stringify({
            file_path: testFile,
            old_string: 'Hello World',
            new_string: 'Hello AngyCode',
          }),
        },
        { type: 'tool_call_end', id: 'tc3' },
        { type: 'message_end', stop_reason: 'tool_use', usage: { input: 70, output: 30 } },
      ],
      // Turn 4: Done
      [
        { type: 'text_delta', text: 'All done!' },
        { type: 'message_end', stop_reason: 'end_turn', usage: { input: 80, output: 35 } },
      ],
    ]);

    const tools = createDefaultRegistry();
    const loop = new AgentLoop({
      provider,
      tools,
      db,
      workingDir: tmpDir,
      maxTokens: 4096,
      maxTurns: 10,
    });

    const events: string[] = [];
    loop.on('event', (e) => {
      events.push(e.type);
    });

    const session = await loop.run('write, read, and edit a file');

    expect(session.status).toBe('done');

    // File should exist with edited content
    const finalContent = fs.readFileSync(testFile, 'utf-8');
    expect(finalContent).toContain('Hello AngyCode');
    expect(finalContent).toContain('Line 2');
    expect(finalContent).not.toContain('Hello World');

    // Events should include tool operations
    expect(events.filter((t) => t === 'tool_start')).toHaveLength(3);
    expect(events.filter((t) => t === 'tool_output')).toHaveLength(3);
    expect(events.filter((t) => t === 'usage')).toHaveLength(4);
    expect(events).toContain('done');

    // Session should be persisted in DB
    const sessStore = createSessionStore(db.db);
    const saved = sessStore.getSession(session.id);
    expect(saved).not.toBeNull();
    expect(saved!.status).toBe('done');

    // Messages should be persisted
    const msgStore = createMessageStore(db.db);
    const messages = msgStore.getMessages(session.id);
    // user + (assistant+user tool results) * 3 turns + final assistant = 1 + 3*2 + 1 = 8
    expect(messages.length).toBeGreaterThanOrEqual(5);
  });

  it('handles tool errors gracefully in e2e flow', async () => {
    const provider = createMockProvider([
      // Try to read nonexistent file
      [
        { type: 'tool_call_start', id: 'tc1', name: 'Read' },
        {
          type: 'tool_call_delta',
          id: 'tc1',
          input: JSON.stringify({ file_path: '/tmp/does-not-exist-angycode.txt' }),
        },
        { type: 'tool_call_end', id: 'tc1' },
        { type: 'message_end', stop_reason: 'tool_use', usage: { input: 20, output: 10 } },
      ],
      // Recover and finish
      [
        { type: 'text_delta', text: 'File not found, done.' },
        { type: 'message_end', stop_reason: 'end_turn', usage: { input: 30, output: 15 } },
      ],
    ]);

    const tools = createDefaultRegistry();
    const loop = new AgentLoop({
      provider,
      tools,
      db,
      workingDir: tmpDir,
      maxTokens: 4096,
      maxTurns: 10,
    });

    const toolOutputs: { output: string; is_error: boolean }[] = [];
    loop.on('event', (e) => {
      if (e.type === 'tool_output') {
        toolOutputs.push({ output: e.output, is_error: e.is_error });
      }
    });

    const session = await loop.run('read a missing file');
    expect(session.status).toBe('done');
    expect(toolOutputs).toHaveLength(1);
    expect(toolOutputs[0]!.is_error).toBe(true);
  });
});
