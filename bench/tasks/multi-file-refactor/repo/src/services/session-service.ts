import type { Session } from '../models/session.js';

const sessions: Map<string, Session> = new Map();

export function storeSession(session: Session): void {
  sessions.set(session.id, session);
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}

export function deleteSession(id: string): boolean {
  return sessions.delete(id);
}
