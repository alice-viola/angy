import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { type SessionInfo, type MessageRecord } from '../engine/types';
import { SessionManager } from '../engine/SessionManager';
import { Database } from '../engine/Database';
import { engineBus } from '../engine/EventBus';
import { broadcastSync } from '../engine/WindowSync';

// ── Singleton engines (initialized once, shared across stores) ──────────

let _sessionManager: SessionManager | null = null;
let _database: Database | null = null;

export function initSessionEngines(mgr: SessionManager, db: Database) {
  _sessionManager = mgr;
  _database = db;
}

export function getSessionManager(): SessionManager {
  if (!_sessionManager) {
    _sessionManager = new SessionManager();
  }
  return _sessionManager;
}

export function getDatabase(): Database {
  if (!_database) {
    console.warn('[sessions] getDatabase called before initSessionEngines - creating fallback instance');
    _database = new Database();
    // Attempt to open the fallback database
    _database.open().then(ok => {
      if (!ok) console.error('[sessions] Failed to open fallback database');
    });
  }
  return _database;
}

export function isDatabaseInitialized(): boolean {
  return _database !== null;
}

/** Ensure database is ready before using stores */
export async function ensureDatabaseReady(): Promise<boolean> {
  const db = getDatabase();
  return db.open();
}

// ── Sessions Store ──────────────────────────────────────────────────────

export const useSessionsStore = defineStore('sessions', () => {
  // ── State ──────────────────────────────────────────────────────────
  const sessions = ref<Map<string, SessionInfo>>(new Map());
  const activeSessionId = ref<string | null>(null);
  const messages = ref<Map<string, MessageRecord[]>>(new Map());

  // ── Getters ────────────────────────────────────────────────────────
  const activeSession = computed(() => {
    if (!activeSessionId.value) return null;
    return sessions.value.get(activeSessionId.value) ?? null;
  });

  const sessionList = computed(() => {
    return Array.from(sessions.value.values()).sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
  });

  const activeMessages = computed(() => {
    if (!activeSessionId.value) return [];
    return messages.value.get(activeSessionId.value) ?? [];
  });

  // ── Actions ────────────────────────────────────────────────────────

  async function createSession(workspace: string, mode = 'agent'): Promise<string> {
    const mgr = getSessionManager();
    const sessionId = mgr.createSession(workspace, mode);
    const info = mgr.sessionInfo(sessionId);
    if (info) {
      sessions.value.set(sessionId, info);
      messages.value.set(sessionId, []);
    }
    await persistSession(sessionId);
    broadcastSync('sessions');
    return sessionId;
  }

  async function createChildSession(parentId: string, workspace: string, mode: string, task: string): Promise<string> {
    const mgr = getSessionManager();
    const childId = mgr.createChildSession(parentId, workspace, mode, task);
    const info = mgr.sessionInfo(childId);
    if (info) {
      sessions.value.set(childId, info);
      messages.value.set(childId, []);
    }
    await persistSession(childId);
    broadcastSync('sessions');
    engineBus.emit('session:created', { sessionId: childId, parentSessionId: parentId });
    return childId;
  }

  function selectSession(sessionId: string) {
    if (!sessions.value.has(sessionId)) return;
    activeSessionId.value = sessionId;
  }

  function removeSession(sessionId: string) {
    const mgr = getSessionManager();
    mgr.removeSession(sessionId);
    sessions.value.delete(sessionId);
    messages.value.delete(sessionId);

    if (activeSessionId.value === sessionId) {
      // Select the most recently updated remaining session
      const remaining = sessionList.value;
      activeSessionId.value = remaining.length > 0 ? remaining[0].sessionId : null;
    }

    // Persist deletion
    const db = getDatabase();
    db.deleteSession(sessionId);
  }

  function updateSessionTitle(sessionId: string, title: string) {
    const mgr = getSessionManager();
    mgr.setSessionTitle(sessionId, title);
    const info = sessions.value.get(sessionId);
    if (info) {
      info.title = title;
      info.updatedAt = Math.floor(Date.now() / 1000);
      persistSession(sessionId);
    }
  }

  function toggleFavorite(sessionId: string) {
    const info = sessions.value.get(sessionId);
    if (!info) return;
    const newFav = !info.favorite;
    const mgr = getSessionManager();
    mgr.setSessionFavorite(sessionId, newFav);
    info.favorite = newFav;
    persistSession(sessionId);
  }

  function addMessage(sessionId: string, message: MessageRecord) {
    let arr = messages.value.get(sessionId);
    if (!arr) {
      arr = [];
      messages.value.set(sessionId, arr);
    }
    arr.push(message);

    // Update session timestamp
    const info = sessions.value.get(sessionId);
    if (info) {
      info.updatedAt = Math.floor(Date.now() / 1000);
    }
  }

  function getMessages(sessionId: string): MessageRecord[] {
    return messages.value.get(sessionId) ?? [];
  }

  function setMessages(sessionId: string, msgs: MessageRecord[]) {
    messages.value.set(sessionId, msgs);
  }

  // Session ID update (temp → real from Claude CLI)
  function updateSessionId(tempId: string, realId: string) {
    const mgr = getSessionManager();
    mgr.updateSessionId(tempId, realId);

    const info = sessions.value.get(tempId);
    if (info) {
      sessions.value.delete(tempId);
      info.sessionId = realId;
      sessions.value.set(realId, info);
    }

    const msgs = messages.value.get(tempId);
    if (msgs) {
      messages.value.delete(tempId);
      // Update sessionId in each message
      for (const m of msgs) {
        m.sessionId = realId;
      }
      messages.value.set(realId, msgs);
    }

    if (activeSessionId.value === tempId) {
      activeSessionId.value = realId;
    }

    // Persist
    const db = getDatabase();
    db.updateMessageSessionId(tempId, realId);
  }

  // Sync session info from engine (e.g., after delegation status change)
  function syncFromEngine(sessionId: string) {
    const mgr = getSessionManager();
    const info = mgr.sessionInfo(sessionId);
    if (info) {
      sessions.value.set(sessionId, info);
    }
  }

  // Register an externally created session (e.g., child delegation)
  function registerSession(info: SessionInfo) {
    const mgr = getSessionManager();
    if (!mgr.hasSession(info.sessionId)) {
      mgr.registerSession(info.sessionId, info);
    }
    sessions.value.set(info.sessionId, info);
    if (!messages.value.has(info.sessionId)) {
      messages.value.set(info.sessionId, []);
    }
    engineBus.emit('session:created', { sessionId: info.sessionId, parentSessionId: info.parentSessionId });
  }

  // Load sessions from database on startup
  async function loadFromDatabase(workspacePath?: string) {
    const db = getDatabase();
    const mgr = getSessionManager();
    const saved = await db.loadSessions(workspacePath);
    for (const info of saved) {
      // Filter by workspace if specified
      if (workspacePath && (!info.workspace || info.workspace !== workspacePath)) {
        continue;
      }
      sessions.value.set(info.sessionId, info);
      if (!mgr.hasSession(info.sessionId)) {
        mgr.registerSession(info.sessionId, info);
      }
    }
  }

  /**
   * Sync new/updated sessions from the database (for cross-instance sync).
   * Returns true if any new sessions were added.
   */
  async function syncNewSessions(workspacePath?: string): Promise<boolean> {
    const db = getDatabase();
    const mgr = getSessionManager();
    const saved = await db.loadSessions(workspacePath);
    let added = false;
    for (const info of saved) {
      if (workspacePath && (!info.workspace || info.workspace !== workspacePath)) {
        continue;
      }
      const existing = sessions.value.get(info.sessionId);
      if (!existing) {
        // New session from another instance
        sessions.value.set(info.sessionId, info);
        if (!mgr.hasSession(info.sessionId)) {
          mgr.registerSession(info.sessionId, info);
        }
        added = true;
      } else if (info.updatedAt > existing.updatedAt) {
        // Session was updated externally — sync title and timestamp
        existing.title = info.title;
        existing.updatedAt = info.updatedAt;
        existing.delegationStatus = info.delegationStatus;
        existing.epicId = info.epicId;
      }
    }
    return added;
  }

  // Persist a session to database
  async function persistSession(sessionId: string) {
    const info = sessions.value.get(sessionId);
    if (!info) return;
    const db = getDatabase();
    await db.saveSession(info);
  }

  return {
    // State
    sessions,
    activeSessionId,
    messages,
    // Getters
    activeSession,
    sessionList,
    activeMessages,
    // Actions
    createSession,
    createChildSession,
    selectSession,
    removeSession,
    updateSessionTitle,
    toggleFavorite,
    addMessage,
    getMessages,
    setMessages,
    updateSessionId,
    syncFromEngine,
    registerSession,
    loadFromDatabase,
    syncNewSessions,
    persistSession,
  };
});
