import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AgentEvent } from '@angycode/core';
import { registerSession, getSession, setSessionStatus } from '../session.js';
import { sseHandler } from '../sse.js';

// Minimal mock AgentLoop for testing HTTP layer
function createMockLoop(events: AgentEvent[] = []) {
  const listeners: Array<(event: AgentEvent) => void> = [];
  return {
    loop: {
      on(type: string, cb: (event: AgentEvent) => void) {
        if (type === 'event') listeners.push(cb);
      },
      abort: vi.fn(),
      run: vi.fn().mockResolvedValue(undefined),
      continueSession: vi.fn().mockResolvedValue(undefined),
    } as any,
    emit(event: AgentEvent) {
      for (const cb of listeners) cb(event);
    },
    emitSequence(evts: AgentEvent[]) {
      for (const e of evts) this.emit(e);
    },
  };
}

// Build a minimal Hono app that uses the real session registry + SSE handler
// but doesn't go through createApp (which requires a real DB and provider)
function buildTestApp() {
  const app = new Hono();
  app.use('*', cors({ origin: '*' }));

  app.get('/sessions/:id/events', (c) => sseHandler(c));

  app.post('/sessions/:id/abort', (c) => {
    const id = c.req.param('id');
    const session = getSession(id);
    if (!session) return c.json({ error: 'not found' }, 404);
    session.loop.abort();
    return c.json({ ok: true }, 200);
  });

  app.post('/sessions/:id/continue', async (c) => {
    const id = c.req.param('id');
    const session = getSession(id);
    if (!session) return c.json({ error: 'not found' }, 404);
    if (session.status === 'running') return c.json({ error: 'session is still running' }, 409);

    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }
    if (!body.message) return c.json({ error: 'message is required' }, 400);

    setSessionStatus(id, 'running');
    session.loop.continueSession(id, body.message).catch(() => {});

    return c.json({ ok: true }, 200);
  });

  return app;
}

describe('POST /sessions/:id/continue — 409 conflict', () => {
  it('returns 409 when session is still running', async () => {
    const { loop } = createMockLoop();
    const sessionId = 'test-running-409';
    registerSession(sessionId, loop);
    // session starts as 'running' by default in registerSession

    const app = buildTestApp();
    const res = await app.request(`/sessions/${sessionId}/continue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'do more' }),
    });

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('session is still running');
  });

  it('returns 200 when session is done', async () => {
    const mock = createMockLoop();
    const sessionId = 'test-done-continue';
    registerSession(sessionId, mock.loop);
    // Emit done to transition status
    mock.emit({ type: 'done', stop_reason: 'end_turn' } as AgentEvent);

    const session = getSession(sessionId)!;
    expect(session.status).toBe('done');

    const app = buildTestApp();
    const res = await app.request(`/sessions/${sessionId}/continue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'follow up' }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it('returns 404 for non-existent session', async () => {
    const app = buildTestApp();
    const res = await app.request('/sessions/nonexistent/continue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });

    expect(res.status).toBe(404);
  });

  it('returns 400 when message is missing', async () => {
    const mock = createMockLoop();
    const sessionId = 'test-missing-message';
    registerSession(sessionId, mock.loop);
    mock.emit({ type: 'done', stop_reason: 'end_turn' } as AgentEvent);

    const app = buildTestApp();
    const res = await app.request(`/sessions/${sessionId}/continue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('message is required');
  });
});

describe('GET /sessions/:id/events — cursor resumption', () => {
  it('replays only events after cursor', async () => {
    const mock = createMockLoop();
    const sessionId = 'test-cursor-replay';
    registerSession(sessionId, mock.loop);

    // Emit initial run events
    const initialEvents: AgentEvent[] = [
      { type: 'session_start', sessionId, provider: 'anthropic', model: 'claude-opus-4-6', workingDir: '/tmp' } as AgentEvent,
      { type: 'text', text: 'Hello from run 1' } as AgentEvent,
      { type: 'usage', input_tokens: 100, output_tokens: 50, cost_usd: 0.001 } as AgentEvent,
      { type: 'done', stop_reason: 'end_turn' } as AgentEvent,
    ];
    mock.emitSequence(initialEvents);

    const session = getSession(sessionId)!;
    expect(session.events).toHaveLength(4);
    expect(session.status).toBe('done');

    // Now simulate continuation: reset status, emit more events
    setSessionStatus(sessionId, 'running');
    const continuationEvents: AgentEvent[] = [
      { type: 'text', text: 'Hello from continuation' } as AgentEvent,
      { type: 'done', stop_reason: 'end_turn' } as AgentEvent,
    ];
    mock.emitSequence(continuationEvents);

    expect(session.events).toHaveLength(6);

    // Request events with cursor=4 (skip initial run)
    const app = buildTestApp();
    const res = await app.request(`/sessions/${sessionId}/events?cursor=4`);
    expect(res.status).toBe(200);

    const text = await res.text();
    const dataLines = text.split('\n').filter((l) => l.startsWith('data:'));

    // Should only see the 2 continuation events
    expect(dataLines).toHaveLength(2);
    const event0 = JSON.parse(dataLines[0].replace('data: ', ''));
    expect(event0.type).toBe('text');
    expect(event0.text).toBe('Hello from continuation');
    const event1 = JSON.parse(dataLines[1].replace('data: ', ''));
    expect(event1.type).toBe('done');
  });

  it('returns 404 for non-existent session', async () => {
    const app = buildTestApp();
    const res = await app.request('/sessions/nonexistent/events');
    expect(res.status).toBe(404);
  });

  it('replays all events when cursor is 0 and session is done', async () => {
    const mock = createMockLoop();
    const sessionId = 'test-cursor-zero';
    registerSession(sessionId, mock.loop);

    mock.emitSequence([
      { type: 'text', text: 'hi' } as AgentEvent,
      { type: 'done', stop_reason: 'end_turn' } as AgentEvent,
    ]);

    const app = buildTestApp();
    const res = await app.request(`/sessions/${sessionId}/events?cursor=0`);
    const text = await res.text();
    const dataLines = text.split('\n').filter((l) => l.startsWith('data:'));
    expect(dataLines).toHaveLength(2);
  });
});

describe('POST /sessions/:id/abort', () => {
  it('returns 404 for non-existent session', async () => {
    const app = buildTestApp();
    const res = await app.request('/sessions/nonexistent/abort', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('calls abort on the loop and returns ok', async () => {
    const mock = createMockLoop();
    const sessionId = 'test-abort';
    registerSession(sessionId, mock.loop);

    const app = buildTestApp();
    const res = await app.request(`/sessions/${sessionId}/abort`, { method: 'POST' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(mock.loop.abort).toHaveBeenCalled();
  });
});

describe('POST /sessions — invalid JSON body', () => {
  it('returns 400 for malformed JSON', async () => {
    const app = buildTestApp();
    // buildTestApp doesn't have POST /sessions, so use createApp via the real server module
    // Instead, test through the continue endpoint which also parses JSON
    const mock = createMockLoop();
    const sessionId = 'test-invalid-json';
    registerSession(sessionId, mock.loop);
    mock.emit({ type: 'done', stop_reason: 'end_turn' } as AgentEvent);

    const res = await app.request(`/sessions/${sessionId}/continue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid JSON');
  });
});

describe('SSE streaming — text, usage, done event pipeline (mock, no API key needed)', () => {
  it('delivers text, usage, and done events with correct shapes via SSE', async () => {
    const mock = createMockLoop();
    const sessionId = 'test-full-pipeline';
    registerSession(sessionId, mock.loop);

    // Emit a realistic sequence: session_start, text, usage, done
    mock.emitSequence([
      { type: 'session_start', sessionId, provider: 'anthropic', model: 'claude-opus-4-6', workingDir: '/tmp' } as AgentEvent,
      { type: 'text', text: 'Hello' } as AgentEvent,
      { type: 'text', text: ' world' } as AgentEvent,
      { type: 'usage', input_tokens: 150, output_tokens: 50, cost_usd: 0.003 } as AgentEvent,
      { type: 'done', stop_reason: 'end_turn' } as AgentEvent,
    ]);

    const app = buildTestApp();
    const res = await app.request(`/sessions/${sessionId}/events?cursor=0`);
    expect(res.status).toBe(200);

    const raw = await res.text();
    const events = raw
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => JSON.parse(l.replace(/^data:\s*/, '')));

    // At least one text event
    const textEvents = events.filter((e: any) => e.type === 'text');
    expect(textEvents.length).toBeGreaterThanOrEqual(1);
    for (const te of textEvents) {
      expect(te).toHaveProperty('text');
      expect(typeof te.text).toBe('string');
      expect(te.text.length).toBeGreaterThan(0);
    }

    // Exactly one usage event with numeric fields
    const usageEvents = events.filter((e: any) => e.type === 'usage');
    expect(usageEvents).toHaveLength(1);
    expect(typeof usageEvents[0].input_tokens).toBe('number');
    expect(typeof usageEvents[0].output_tokens).toBe('number');
    expect(typeof usageEvents[0].cost_usd).toBe('number');

    // Exactly one done event with stop_reason
    const doneEvents = events.filter((e: any) => e.type === 'done');
    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0]).toHaveProperty('stop_reason');
    expect(typeof doneEvents[0].stop_reason).toBe('string');
  });

  it('delivers events in emission order', async () => {
    const mock = createMockLoop();
    const sessionId = 'test-pipeline-order';
    registerSession(sessionId, mock.loop);

    mock.emitSequence([
      { type: 'session_start', sessionId, provider: 'gemini', model: 'gemini-2.0-flash', workingDir: '/tmp' } as AgentEvent,
      { type: 'text', text: 'Hi' } as AgentEvent,
      { type: 'usage', input_tokens: 10, output_tokens: 5, cost_usd: 0.0001 } as AgentEvent,
      { type: 'done', stop_reason: 'end_turn' } as AgentEvent,
    ]);

    const app = buildTestApp();
    const res = await app.request(`/sessions/${sessionId}/events?cursor=0`);
    const raw = await res.text();
    const types = raw
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => JSON.parse(l.replace(/^data:\s*/, '')).type);

    expect(types).toEqual(['session_start', 'text', 'usage', 'done']);
  });
});

const hasApiKey = !!(process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY);

describe.skipIf(!hasApiKey)('Real LLM streaming E2E (requires API key)', () => {
  let sessionId: string | undefined;
  let abortController: AbortController | undefined;

  // Determine which provider/key to use
  const provider = process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'gemini';
  const apiKey = (process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY) as string;

  afterEach(async () => {
    if (abortController) {
      abortController.abort();
      abortController = undefined;
    }
  });

  it('streams text and done events from a real LLM', async () => {
    // Import createApp and set up a real server app
    const { createApp } = await import('../server.js');
    const { DatabaseImpl } = await import('@angycode/core');
    const { mkdirSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const tmpDb = join(tmpdir(), `angycode-test-${Date.now()}.db`);
    const db = new DatabaseImpl(tmpDb);
    const app = createApp(db);

    // 1. Create a session
    const createRes = await app.request('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goal: 'Say hello',
        provider,
        apiKey,
        workingDir: tmpdir(),
        maxTurns: 1,
      }),
    });

    expect(createRes.status).toBe(201);
    const createBody = await createRes.json() as { sessionId: string };
    sessionId = createBody.sessionId;
    expect(sessionId).toBeTruthy();

    // 1b. Verify invalid JSON returns 400
    const badRes = await app.request('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(badRes.status).toBe(400);
    const badBody = await badRes.json() as { error: string };
    expect(badBody.error).toBe('invalid JSON');

    // 2. Connect to SSE stream and collect events
    abortController = new AbortController();
    const eventsRes = await app.request(`/sessions/${sessionId}/events?cursor=0`, {
      signal: abortController.signal,
    });

    expect(eventsRes.status).toBe(200);

    const text = await eventsRes.text();
    const dataLines = text
      .split('\n')
      .filter((l: string) => l.startsWith('data:'))
      .map((l: string) => JSON.parse(l.replace(/^data:\s*/, '')));

    // 3. Assert we got at least one text event and one done event
    const textEvents = dataLines.filter((e: any) => e.type === 'text');
    const doneEvents = dataLines.filter((e: any) => e.type === 'done');

    expect(textEvents.length).toBeGreaterThanOrEqual(1);
    expect(doneEvents.length).toBe(1);
  }, 60_000); // 60s timeout for real API call
});
