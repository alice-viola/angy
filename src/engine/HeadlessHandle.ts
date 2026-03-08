/**
 * HeadlessHandle — AgentHandle implementation that runs without any Vue component.
 *
 * Tracks per-session state in memory (accumulated text, messages, turn counter)
 * and persists messages to the Database on markDone. Enables orchestrators to
 * run headlessly — no ChatPanel, no DOM, no Vue dependency.
 *
 * Each orchestrator (or concurrent epic) gets its own HeadlessHandle instance,
 * so multiple orchestrators can run in parallel without shared state.
 */

import type { AgentHandle } from './types';
import { DelegationStatus } from './types';
import type { Database } from './Database';
import type { SessionManager } from './SessionManager';
import { engineBus } from './EventBus';

// ── Internal per-session state ───────────────────────────────────────────

interface HeadlessMessage {
  role: string;
  content: string;
  toolName?: string;
  toolInput?: string;
  turnId: number;
  timestamp: number;
}

interface HeadlessSessionState {
  messages: HeadlessMessage[];
  currentText: string;
  realClaudeSessionId: string;
  turnCounter: number;
  lastAssistantContent: string;
}

// ── HeadlessHandle ───────────────────────────────────────────────────────

export class HeadlessHandle implements AgentHandle {
  private sessions = new Map<string, HeadlessSessionState>();
  private finalizedChildren = new Set<string>();
  private db: Database;
  private mgr: SessionManager;

  /**
   * Called when a delegated child session finishes.
   * The orchestrator wires this to `orch.onDelegateFinished(sessionId, result)`.
   */
  onDelegateFinished: ((sessionId: string, result: string) => void) | null = null;

  /**
   * Called when a session should be persisted to the database.
   * The caller wires this to `sessionsStore.persistSession(sessionId)` or
   * `sessionService.persistSession(sessionId)`.
   */
  onPersistSession: ((sessionId: string) => void) | null = null;

  constructor(db: Database, mgr: SessionManager) {
    this.db = db;
    this.mgr = mgr;
  }

  // ── State management ─────────────────────────────────────────────────

  private getOrCreate(sessionId: string): HeadlessSessionState {
    let s = this.sessions.get(sessionId);
    if (!s) {
      s = {
        messages: [],
        currentText: '',
        realClaudeSessionId: '',
        turnCounter: 0,
        lastAssistantContent: '',
      };
      this.sessions.set(sessionId, s);
    }
    return s;
  }

  /**
   * Prepare a session for a new outgoing message.
   * Increments the turn counter, records the user message, and persists it.
   * Must be called before `sendMessageToEngine` for the session.
   */
  async prepareForSend(sessionId: string, text: string): Promise<void> {
    const s = this.getOrCreate(sessionId);
    s.turnCounter++;
    s.currentText = '';
    s.messages.push({
      role: 'user',
      content: text,
      turnId: s.turnCounter,
      timestamp: Date.now(),
    });
    await this.db.saveMessage({
      sessionId,
      role: 'user',
      content: text,
      turnId: s.turnCounter,
      timestamp: Math.floor(Date.now() / 1000),
    });
  }

  /** Get the real Claude CLI session ID (for resume). */
  getRealSessionId(sessionId: string): string {
    return this.sessions.get(sessionId)?.realClaudeSessionId ?? '';
  }

  /**
   * Get the last assistant content for a session.
   * Returns accumulated text if a turn is in progress, otherwise the
   * last completed assistant message.
   */
  getLastAssistantContent(sessionId: string): string {
    const s = this.sessions.get(sessionId);
    if (!s) return '';
    if (s.currentText) return s.currentText;
    const last = [...s.messages].reverse().find(m => m.role === 'assistant');
    return last?.content ?? s.lastAssistantContent;
  }

  // ── AgentHandle implementation ────────────────────────────────────────

  appendTextDelta(sessionId: string, text: string): void {
    this.getOrCreate(sessionId).currentText += text;
    engineBus.emit('agent:textDelta', { sessionId, text });
  }

  appendThinkingDelta(sessionId: string, text: string): void {
    engineBus.emit('agent:thinkingDelta', { sessionId, text });
  }

  addToolUse(
    sessionId: string,
    toolName: string,
    summary: string,
    toolInput?: Record<string, any>,
    _toolId?: string,
  ): void {
    const s = this.getOrCreate(sessionId);
    s.messages.push({
      role: 'tool',
      content: summary,
      toolName,
      toolInput: toolInput ? JSON.stringify(toolInput) : undefined,
      turnId: s.turnCounter,
      timestamp: Date.now(),
    });
    engineBus.emit('agent:toolUse', { sessionId, toolName, summary, toolInput });
  }

  async markDone(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;

    // Flush any accumulated text as an assistant message
    if (s.currentText) {
      s.messages.push({
        role: 'assistant',
        content: s.currentText,
        turnId: s.turnCounter,
        timestamp: Date.now(),
      });
    }

    // Extract result BEFORE clearing messages
    const lastAssistant = [...s.messages].reverse().find(m => m.role === 'assistant');
    const result = lastAssistant?.content ?? '';
    s.lastAssistantContent = result;
    s.currentText = '';

    // Persist non-user messages to DB (user messages were persisted in prepareForSend)
    const savePromises: Promise<void>[] = [];
    for (const msg of s.messages) {
      if (msg.role === 'user') continue;
      savePromises.push(
        this.db.saveMessage({
          sessionId,
          role: msg.role,
          content: msg.content,
          toolName: msg.toolName,
          toolInput: msg.toolInput,
          turnId: msg.turnId,
          timestamp: Math.floor(msg.timestamp / 1000),
        }).catch(err => {
          console.error(`[HeadlessHandle] Failed to persist ${msg.role} message for session ${sessionId}:`, err);
        }),
      );
    }
    await Promise.all(savePromises);
    s.messages = [];

    // Handle delegation completion for child sessions
    const info = this.mgr.sessionInfo(sessionId);
    if (info?.delegationTask && !this.finalizedChildren.has(sessionId)) {
      this.finalizedChildren.add(sessionId);
      this.mgr.setDelegationStatus(sessionId, DelegationStatus.Completed);
      this.mgr.setDelegationResult(sessionId, result);
    }

    this.onPersistSession?.(sessionId);

    engineBus.emit('agent:turnDone', { sessionId });

    // Notify orchestrator (must be after persist so state is saved)
    if (info?.delegationTask && this.finalizedChildren.has(sessionId)) {
      this.onDelegateFinished?.(sessionId, result);
    }
  }

  async showError(sessionId: string, error: string): Promise<void> {
    const s = this.getOrCreate(sessionId);
    // Flush any accumulated text
    if (s.currentText) {
      s.messages.push({
        role: 'assistant',
        content: s.currentText,
        turnId: s.turnCounter,
        timestamp: Date.now(),
      });
      s.currentText = '';
    }
    s.messages.push({
      role: 'assistant',
      content: `Error: ${error}`,
      turnId: s.turnCounter,
      timestamp: Date.now(),
    });
    await this.markDone(sessionId);
  }

  setThinking(sessionId: string, thinking: boolean): void {
    engineBus.emit('agent:thinking', { sessionId, thinking });
  }

  setRealSessionId(sessionId: string, realId: string): void {
    this.getOrCreate(sessionId).realClaudeSessionId = realId;
  }

  onFileEdited(sessionId: string, filePath: string, toolName: string, toolInput?: Record<string, any>): void {
    engineBus.emit('agent:fileEdited', { sessionId, filePath, toolName, toolInput });
  }
}
