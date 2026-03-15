import { DatabaseImpl, createSessionStore } from '@angycode/core';
import type { Session } from '@angycode/core';

export interface SessionsOptions {
  limit?: number;
  json?: boolean;
}

export function sessionsCommand(opts: SessionsOptions): void {
  const db = new DatabaseImpl();
  try {
    const store = createSessionStore(db.db);
    const sessions = store.listSessions(opts.limit ?? 20);

    if (opts.json) {
      process.stdout.write(JSON.stringify(sessions, null, 2) + '\n');
      return;
    }

    if (sessions.length === 0) {
      process.stdout.write('No sessions found.\n');
      return;
    }

    for (const s of sessions) {
      process.stdout.write(formatSession(s) + '\n');
    }
  } finally {
    db.close();
  }
}

function formatSession(s: Session): string {
  const date = new Date(s.createdAt).toISOString().slice(0, 19).replace('T', ' ');
  const goal = s.goal.length > 60 ? s.goal.slice(0, 57) + '...' : s.goal;
  const status = s.status.padEnd(7);
  return `${s.id.slice(0, 8)}  ${status}  ${date}  ${goal}`;
}
