import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { nanoid } from 'nanoid';
import {
  AgentLoop,
  createProvider,
  createDefaultRegistry,
  type Database,
} from '@angycode/core';
import { registerSession, getSession, abortSession, setSessionStatus } from './session.js';
import { sseHandler } from './sse.js';

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-opus-4-6',
  gemini: 'gemini-2.5-flash',
  mock: 'mock',
};

export function createApp(db: Database): Hono {
  const app = new Hono();
  app.use('*', cors({ origin: '*' }));

  app.post('/sessions', async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }
    if (!body.goal) return c.json({ error: 'goal is required' }, 400);
    if (!body.provider) return c.json({ error: 'provider is required' }, 400);
    if (!body.apiKey) return c.json({ error: 'apiKey is required' }, 400);
    if (!body.workingDir) return c.json({ error: 'workingDir is required' }, 400);

    const model = body.model ?? DEFAULT_MODELS[body.provider] ?? 'claude-opus-4-6';
    const sessionId = nanoid();

    const provider = createProvider({
      name: body.provider,
      apiKey: body.apiKey,
      model,
    });
    const tools = createDefaultRegistry();

    const loop = new AgentLoop({
      provider,
      tools,
      db,
      workingDir: body.workingDir,
      maxTokens: body.maxTokens ?? 8192,
      maxTurns: body.maxTurns ?? 200,
      providerName: body.provider,
      model,
      systemPromptExtra: body.systemPromptExtra,
      disabledTools: body.disabledTools,
      sessionId,
    });

    registerSession(sessionId, loop);
    loop.run(body.goal).catch((err) => console.error('loop error:', err));

    return c.json({ sessionId }, 201);
  });

  app.get('/sessions/:id/events', (c) => {
    return sseHandler(c);
  });

  app.post('/sessions/:id/abort', (c) => {
    const id = c.req.param('id');
    const found = abortSession(id);
    if (!found) return c.json({ error: 'not found' }, 404);
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
    session.loop.continueSession(id, body.message).catch((err) => console.error('loop error:', err));

    return c.json({ ok: true }, 200);
  });

  return app;
}
