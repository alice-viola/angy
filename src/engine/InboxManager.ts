import { getAngyConfigDir } from '@/engine/platform';

// ── Peer Messaging System ────────────────────────────────────────────────────
// Port of the inbox JSONL system from orchestrator_server.py.
// Uses Tauri fs plugin with atomic rename for file safety.

// ── Inbox Message ────────────────────────────────────────────────────────────

export interface InboxMessage {
  from: string;
  to: string;
  content: string;
  timestamp: number;
}

// ── InboxManager ─────────────────────────────────────────────────────────────

export class InboxManager {
  /**
   * Send a message to another agent's inbox.
   * Uses atomic write: read existing → append → write to tmp → rename over original.
   */
  static async sendMessage(
    teamId: string,
    fromAgent: string,
    toAgent: string,
    content: string,
  ): Promise<void> {
    const { readTextFile, writeTextFile, rename, mkdir } = await import('@tauri-apps/plugin-fs');
    const { join } = await import('@tauri-apps/api/path');

    const inboxDir = await join(await getAngyConfigDir(), 'inboxes', teamId);
    const inboxFile = await join(inboxDir, `${toAgent}.jsonl`);
    const tmpFile = await join(inboxDir, `${toAgent}.tmp.${Date.now()}`);

    // Ensure directory exists
    try { await mkdir(inboxDir, { recursive: true }); } catch { /* exists */ }

    const message: InboxMessage = {
      from: fromAgent,
      to: toAgent,
      content,
      timestamp: Date.now() / 1000,
    };

    const line = JSON.stringify(message) + '\n';

    // Atomic append: read existing, append, write to tmp, rename
    let existing = '';
    try { existing = await readTextFile(inboxFile); } catch { /* doesn't exist yet */ }

    await writeTextFile(tmpFile, existing + line);
    await rename(tmpFile, inboxFile);
  }

  /**
   * Check an agent's inbox for messages.
   * Clears the inbox after reading (rename to .read for debugging).
   */
  static async checkInbox(
    teamId: string,
    agentName: string,
  ): Promise<InboxMessage[]> {
    const { readTextFile, rename } = await import('@tauri-apps/plugin-fs');
    const { join } = await import('@tauri-apps/api/path');

    const configDir = await getAngyConfigDir();
    const inboxFile = await join(configDir, 'inboxes', teamId, `${agentName}.jsonl`);
    const readFile = await join(configDir, 'inboxes', teamId, `${agentName}.read`);

    let content = '';
    try { content = await readTextFile(inboxFile); } catch { return []; }

    if (!content.trim()) return [];

    // Archive by renaming to .read
    try { await rename(inboxFile, readFile); } catch { /* ok */ }

    const messages: InboxMessage[] = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        messages.push(JSON.parse(trimmed));
      } catch { /* skip malformed lines */ }
    }

    return messages;
  }

  /**
   * Cleanup all inboxes for a team (called when orchestration ends).
   */
  static async cleanup(teamId: string): Promise<void> {
    if (!teamId) return;
    try {
      const { remove } = await import('@tauri-apps/plugin-fs');
      const { join } = await import('@tauri-apps/api/path');
      await remove(await join(await getAngyConfigDir(), 'inboxes', teamId), { recursive: true });
    } catch { /* ok */ }
  }
}
