import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { DatabaseImpl } from '../database.js';
import { createSessionStore } from '../sessionStore.js';
import { createMessageStore, type MessageStore } from '../messageStore.js';
import type { Message, ContentPart } from '../../types.js';

let db: DatabaseImpl;
let msgStore: MessageStore;
let tmpPath: string;

beforeEach(() => {
  tmpPath = path.join(os.tmpdir(), `angycode-msg-test-${Date.now()}.db`);
  db = new DatabaseImpl(tmpPath);
  // Create a session first (FK constraint)
  const sessionStore = createSessionStore(db.db);
  sessionStore.createSession({
    id: 'sess-1',
    goal: 'test',
    provider: 'anthropic',
    model: 'test',
    status: 'running',
    workingDir: '/tmp',
  });
  msgStore = createMessageStore(db.db);
});

afterEach(() => {
  db.close();
  if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
});

describe('MessageStore', () => {
  it('adds and retrieves messages in order', () => {
    msgStore.addMessage('sess-1', {
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
    });
    msgStore.addMessage('sess-1', {
      role: 'assistant',
      content: [{ type: 'text', text: 'hi there' }],
    });

    const messages = msgStore.getMessages('sess-1');
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
  });

  it('round-trips ContentPart[] through JSON serialization', () => {
    const complexContent: ContentPart[] = [
      { type: 'text', text: 'Let me read that file' },
      { type: 'tool_use', id: 'tc1', name: 'Read', input: { file_path: '/a.ts' } },
    ];

    msgStore.addMessage('sess-1', { role: 'assistant', content: complexContent });

    const messages = msgStore.getMessages('sess-1');
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toEqual(complexContent);
    expect(messages[0].content[0].type).toBe('text');
    expect(messages[0].content[1].type).toBe('tool_use');
  });

  it('round-trips tool_result ContentPart', () => {
    const content: ContentPart[] = [
      { type: 'tool_result', tool_use_id: 'tc1', content: 'file data here', is_error: false },
    ];

    msgStore.addMessage('sess-1', { role: 'user', content });

    const messages = msgStore.getMessages('sess-1');
    const part = messages[0].content[0];
    expect(part.type).toBe('tool_result');
    if (part.type === 'tool_result') {
      expect(part.tool_use_id).toBe('tc1');
      expect(part.content).toBe('file data here');
      expect(part.is_error).toBe(false);
    }
  });

  it('returns empty array for session with no messages', () => {
    const messages = msgStore.getMessages('sess-1');
    expect(messages).toEqual([]);
  });

  it('preserves message ordering (ASC by created_at)', () => {
    for (let i = 0; i < 5; i++) {
      msgStore.addMessage('sess-1', {
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: [{ type: 'text', text: `message ${i}` }],
      });
    }

    const messages = msgStore.getMessages('sess-1');
    expect(messages).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      expect(messages[i].content[0]).toEqual({ type: 'text', text: `message ${i}` });
    }
  });
});
