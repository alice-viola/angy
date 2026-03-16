import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AgentEvent } from '@angycode/core';
import { getSession } from './session.js';

export function sseHandler(c: Context): Response | Promise<Response> {
  const id = c.req.param('id')!;
  const session = getSession(id);
  if (!session) {
    return c.json({ error: 'session not found' }, 404);
  }

  const cursor = parseInt(c.req.query('cursor') ?? '0', 10) || 0;

  return streamSSE(c, async (stream) => {
    // Replay buffered events from cursor
    for (let i = cursor; i < session.events.length; i++) {
      await stream.writeSSE({ data: JSON.stringify(session.events[i]) });
    }

    // If session is already terminal, close the stream
    if (session.status === 'done' || session.status === 'error') {
      return;
    }

    // Keep stream open via promise that resolves when done/error or client disconnects
    await new Promise<void>((resolve) => {
      const cb = async (event: AgentEvent) => {
        await stream.writeSSE({ data: JSON.stringify(event) });
        if (event.type === 'done' || event.type === 'error') {
          session.subscribers.delete(cb);
          resolve();
        }
      };
      session.subscribers.add(cb);

      stream.onAbort(() => {
        session.subscribers.delete(cb);
        resolve();
      });
    });
  });
}
