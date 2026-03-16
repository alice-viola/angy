import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseImpl } from '@angycode/core';
import { createApp } from '../server.js';

/**
 * E2E test using the mock provider — exercises the full pipeline:
 *   POST /sessions → GET /sessions/:id/events (SSE)
 * No real API key required.
 */
describe('E2E mock-provider SSE streaming', () => {
  function makeApp() {
    const dbPath = join(tmpdir(), `angycode-e2e-mock-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    const db = new DatabaseImpl(dbPath);
    return createApp(db);
  }

  it('streams session_start, text, tool_start, tool_output, usage, and done events', async () => {
    const app = makeApp();

    // 1. Create session with mock provider
    const createRes = await app.request('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goal: 'Say hello',
        provider: 'mock',
        apiKey: 'mock',
        workingDir: tmpdir(),
        maxTurns: 5,
      }),
    });

    expect(createRes.status).toBe(201);
    const { sessionId } = (await createRes.json()) as { sessionId: string };
    expect(sessionId).toBeTruthy();

    // 2. Wait briefly for the agent loop to complete (mock is synchronous-ish)
    await new Promise((r) => setTimeout(r, 500));

    // 3. Fetch SSE events (session should be done, so all events are buffered)
    const eventsRes = await app.request(`/sessions/${sessionId}/events?cursor=0`);
    expect(eventsRes.status).toBe(200);

    const raw = await eventsRes.text();
    const events = raw
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => JSON.parse(l.replace(/^data:\s*/, '')));

    const types = events.map((e: any) => e.type);

    // Must include all these event types
    expect(types).toContain('session_start');
    expect(types).toContain('text');
    expect(types).toContain('tool_start');
    expect(types).toContain('tool_output');
    expect(types).toContain('usage');
    expect(types).toContain('done');

    // Validate shapes of key events
    const sessionStart = events.find((e: any) => e.type === 'session_start');
    expect(sessionStart.sessionId).toBe(sessionId);
    expect(sessionStart.provider).toBe('mock');
    expect(sessionStart.model).toBe('mock');
    expect(sessionStart.workingDir).toBe(tmpdir());

    const textEvents = events.filter((e: any) => e.type === 'text');
    expect(textEvents.length).toBeGreaterThanOrEqual(2);
    for (const te of textEvents) {
      expect(typeof te.text).toBe('string');
      expect(te.text.length).toBeGreaterThan(0);
    }

    const toolStart = events.find((e: any) => e.type === 'tool_start');
    expect(toolStart.id).toBe('mock-tool-1');
    expect(toolStart.name).toBe('mock_echo');
    expect(toolStart.input).toEqual({ msg: 'hi' });

    const toolOutput = events.find((e: any) => e.type === 'tool_output');
    expect(toolOutput.id).toBe('mock-tool-1');
    expect(toolOutput.name).toBe('mock_echo');
    expect(typeof toolOutput.output).toBe('string');
    expect(typeof toolOutput.is_error).toBe('boolean');
    expect(typeof toolOutput.duration_ms).toBe('number');

    const usageEvents = events.filter((e: any) => e.type === 'usage');
    expect(usageEvents.length).toBeGreaterThanOrEqual(1);
    for (const ue of usageEvents) {
      expect(typeof ue.input_tokens).toBe('number');
      expect(typeof ue.output_tokens).toBe('number');
    }

    const doneEvent = events.find((e: any) => e.type === 'done');
    expect(doneEvent.stop_reason).toBe('end_turn');

    // done must be the last event
    expect(types[types.length - 1]).toBe('done');
  }, 10_000);

  it('cursor replay returns identical events for a completed session', async () => {
    const app = makeApp();

    const createRes = await app.request('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goal: 'Test cursor',
        provider: 'mock',
        apiKey: 'mock',
        workingDir: tmpdir(),
        maxTurns: 5,
      }),
    });

    const { sessionId } = (await createRes.json()) as { sessionId: string };
    await new Promise((r) => setTimeout(r, 500));

    // First fetch
    const res1 = await app.request(`/sessions/${sessionId}/events?cursor=0`);
    const raw1 = await res1.text();
    const events1 = raw1
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => JSON.parse(l.replace(/^data:\s*/, '')));

    // Second fetch (cursor=0 again) should replay all events identically
    const res2 = await app.request(`/sessions/${sessionId}/events?cursor=0`);
    const raw2 = await res2.text();
    const events2 = raw2
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => JSON.parse(l.replace(/^data:\s*/, '')));

    expect(events2).toEqual(events1);

    // Fetch with cursor past all events should return nothing (or just done)
    const res3 = await app.request(`/sessions/${sessionId}/events?cursor=${events1.length}`);
    const raw3 = await res3.text();
    const events3 = raw3
      .split('\n')
      .filter((l) => l.startsWith('data:'));

    expect(events3).toHaveLength(0);
  }, 10_000);

  it('stream closes after done event (no hanging connection)', async () => {
    const app = makeApp();

    const createRes = await app.request('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goal: 'Close test',
        provider: 'mock',
        apiKey: 'mock',
        workingDir: tmpdir(),
        maxTurns: 5,
      }),
    });

    const { sessionId } = (await createRes.json()) as { sessionId: string };
    await new Promise((r) => setTimeout(r, 500));

    // The response should resolve fully (stream closed), not hang
    const eventsRes = await app.request(`/sessions/${sessionId}/events?cursor=0`);
    const text = await eventsRes.text();

    // If we got here, the stream closed successfully
    expect(text).toContain('"type":"done"');
  }, 10_000);
});
