import type { AgentLoop, AgentEvent } from '@angycode/core';

export type SessionEntry = {
  loop: AgentLoop;
  events: AgentEvent[];
  subscribers: Set<(event: AgentEvent) => void>;
  status: 'running' | 'done' | 'error';
};

const sessions = new Map<string, SessionEntry>();

export function registerSession(id: string, loop: AgentLoop): void {
  const entry: SessionEntry = {
    loop,
    events: [],
    subscribers: new Set(),
    status: 'running',
  };

  sessions.set(id, entry);

  loop.on('event', (event: AgentEvent) => {
    entry.events.push(event);
    for (const cb of entry.subscribers) {
      cb(event);
    }
    if (event.type === 'done') {
      entry.status = 'done';
    } else if (event.type === 'error') {
      entry.status = 'error';
    }
  });
}

export function getSession(id: string): SessionEntry | undefined {
  return sessions.get(id);
}

export function abortSession(id: string): boolean {
  const entry = sessions.get(id);
  if (!entry) return false;
  entry.loop.abort();
  return true;
}

export function allSessions(): string[] {
  return Array.from(sessions.keys());
}

export function setSessionStatus(id: string, status: 'running' | 'done' | 'error'): void {
  const entry = sessions.get(id);
  if (entry) {
    entry.status = status;
  }
}
