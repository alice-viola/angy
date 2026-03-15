import {
  AgentLoop,
  DatabaseImpl,
  createDefaultRegistry,
  createProvider,
  createSessionStore,
} from '@angycode/core';
import { resolveConfig } from '../config.js';
import { resolveApiKey } from '../keys.js';
import { formatEvent } from '../formatter.js';
import { formatEventJson } from '../jsonFormatter.js';

export interface ResumeOptions {
  json?: boolean;
  maxTurns?: number;
}

export async function resumeCommand(sessionId: string, opts: ResumeOptions): Promise<void> {
  const db = new DatabaseImpl();
  const sessionStore = createSessionStore(db.db);
  const session = sessionStore.getSession(sessionId);

  if (!session) {
    db.close();
    throw new Error(`Session not found: ${sessionId}`);
  }

  // Verify session is in a resumable state
  if (session.status !== 'paused' && session.status !== 'error') {
    db.close();
    throw new Error(`Cannot resume session ${sessionId}: status is '${session.status}'`);
  }

  const config = resolveConfig({
    provider: session.provider,
    model: session.model || undefined,
    maxTurns: opts.maxTurns,
  });

  const apiKey = resolveApiKey(config.provider);
  const provider = createProvider({ name: config.provider, apiKey, model: config.model });
  const tools = createDefaultRegistry();

  const loop = new AgentLoop({
    provider,
    tools,
    db,
    workingDir: session.workingDir,
    maxTokens: config.maxTokens,
    maxTurns: config.maxTurns,
    providerName: config.provider,
    model: config.model,
  });

  loop.on('event', (event) => {
    if (opts.json) {
      process.stdout.write(formatEventJson(event) + '\n');
    } else {
      const formatted = formatEvent(event);
      if (formatted !== null) {
        process.stdout.write(formatted);
      }
    }
  });

  try {
    await loop.resume(sessionId);
  } finally {
    db.close();
  }
}
