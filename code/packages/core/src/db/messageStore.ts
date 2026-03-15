import type BetterSqlite3 from 'better-sqlite3';
import type { Message, ContentPart } from '../types.js';

interface MessageRow {
  id: number;
  session_id: string;
  role: string;
  content: string;
  turn_index: number | null;
  created_at: number;
}

export interface MessageStore {
  addMessage(sessionId: string, message: Message): void;
  getMessages(sessionId: string): Message[];
}

export function createMessageStore(db: BetterSqlite3.Database): MessageStore {
  const insertStmt = db.prepare(`
    INSERT INTO messages (session_id, role, content, turn_index, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const getStmt = db.prepare(
    'SELECT * FROM messages WHERE session_id = ? ORDER BY turn_index ASC, id ASC',
  );

  const maxTurnIndexStmt = db.prepare(
    'SELECT COALESCE(MAX(turn_index), -1) as max_idx FROM messages WHERE session_id = ?',
  );

  return {
    addMessage(sessionId, message) {
      const row = maxTurnIndexStmt.get(sessionId) as { max_idx: number };
      const turnIndex = row.max_idx + 1;

      insertStmt.run(
        sessionId,
        message.role,
        JSON.stringify(message.content),
        turnIndex,
        Date.now(),
      );
    },

    getMessages(sessionId) {
      const rows = getStmt.all(sessionId) as MessageRow[];
      return rows.map((row) => ({
        role: row.role as Message['role'],
        content: JSON.parse(row.content) as ContentPart[],
      }));
    },
  };
}
