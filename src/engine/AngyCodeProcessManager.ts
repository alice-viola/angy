import type { AgentHandle, AngyCodeProcessOptions } from './types';
import { engineBus } from './EventBus';
import type { Database } from './Database';
import { SessionMessageBuffer } from './SessionMessageBuffer';
import { summarizeTool } from './toolSummary';

interface SessionEntry {
  serverSessionId: string;
  eventSource: EventSource | null;
  cursor: number;
  done: boolean;
}

export class AngyCodeProcessManager {
  private sessions = new Map<string, SessionEntry>();
  private buffer: SessionMessageBuffer;
  private handle: AgentHandle | null = null;
  private baseUrl = '';

  constructor(db: Database) {
    this.buffer = new SessionMessageBuffer(db);
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url;
  }

  setHandle(handle: AgentHandle): void {
    this.handle = handle;
  }

  async sendMessage(options: AngyCodeProcessOptions, handle: AgentHandle): Promise<void> {
    this.handle = handle;
    const entry = this.sessions.get(options.sessionId);

    if (entry && entry.done) {
      await this.continueSession(options.sessionId, options.goal, handle);
    } else {
      await this.createSession(options, handle);
    }
  }

  async cancel(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    const handle = this.handle;
    if (!handle) return;

    entry.eventSource?.close();
    entry.eventSource = null;

    fetch(`${this.baseUrl}/sessions/${entry.serverSessionId}/abort`, { method: 'POST' }).catch(() => {});

    await this.buffer.flush(sessionId);
    handle.markDone(sessionId);
    this.buffer.clear(sessionId);

    engineBus.emit('agent:statusChanged', { agentId: sessionId, status: 'idle', activity: '' });
    engineBus.emit('session:finished', { sessionId, exitCode: 1 });
    entry.done = true;
  }

  isRunning(sessionId: string): boolean {
    const entry = this.sessions.get(sessionId);
    return entry != null && !entry.done;
  }

  // ── Private ─────────────────────────────────────────────────────────

  private async createSession(options: AngyCodeProcessOptions, handle: AgentHandle): Promise<void> {
    const body: Record<string, unknown> = {
      goal: options.goal,
      provider: options.provider,
      apiKey: options.apiKey,
      workingDir: options.workingDir,
    };
    if (options.model) body.model = options.model;
    if (options.systemPrompt) body.systemPromptExtra = options.systemPrompt;
    if (options.maxTokens) body.maxTokens = options.maxTokens;
    if (options.maxTurns) body.maxTurns = options.maxTurns;

    const res = await fetch(`${this.baseUrl}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      handle.showError(options.sessionId, err.error || `Server error ${res.status}`);
      return;
    }

    const data: { sessionId: string } = await res.json();
    const entry: SessionEntry = {
      serverSessionId: data.sessionId,
      eventSource: null,
      cursor: 0,
      done: false,
    };
    this.sessions.set(options.sessionId, entry);
    this.openEventSource(options.sessionId, handle);
  }

  private async continueSession(sessionId: string, message: string, handle: AgentHandle): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;

    entry.done = false;

    const res = await fetch(`${this.baseUrl}/sessions/${entry.serverSessionId}/continue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      handle.showError(sessionId, err.error || `Server error ${res.status}`);
      entry.done = true;
      return;
    }

    this.openEventSource(sessionId, handle);
  }

  private openEventSource(sessionId: string, handle: AgentHandle): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;

    // Close any existing EventSource
    entry.eventSource?.close();

    const url = `${this.baseUrl}/sessions/${entry.serverSessionId}/events?cursor=${entry.cursor}`;
    const es = new EventSource(url);
    entry.eventSource = es;

    es.onmessage = (e: MessageEvent) => {
      const event = JSON.parse(e.data);
      this.handleEvent(event, sessionId, handle);
    };

    es.onerror = () => {
      // Close and manually re-open with fresh cursor to avoid replaying stale events.
      // Native EventSource auto-reconnect reuses the original URL (stale cursor).
      es.close();
      entry.eventSource = null;
      if (!entry.done) {
        setTimeout(() => this.openEventSource(sessionId, handle), 1000);
      }
    };
  }

  private handleEvent(event: { type: string; [key: string]: unknown }, sessionId: string, handle: AgentHandle): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;

    switch (event.type) {
      case 'session_start':
        handle.setRealSessionId(sessionId, event.sessionId as string);
        entry.cursor++;
        break;

      case 'text':
        handle.appendTextDelta(sessionId, event.text as string);
        this.buffer.appendAssistantDelta(sessionId, event.text as string);
        entry.cursor++;
        break;

      case 'tool_start': {
        const toolName = event.name as string;
        const input = (event.input as Record<string, unknown>) || {};
        const summary = summarizeTool(toolName, input);

        handle.addToolUse(sessionId, toolName, summary, input, event.id as string);
        this.buffer.addToolMessage(sessionId, {
          toolName,
          summary,
          toolInput: input ? JSON.stringify(input) : undefined,
          toolId: event.id as string,
          timestamp: Math.floor(Date.now() / 1000),
        });

        const activity = `${toolName}: ${summary.substring(0, 50)}`;
        engineBus.emit('agent:statusChanged', {
          agentId: sessionId,
          status: 'working',
          activity,
        });

        if (['Edit', 'Write', 'StrReplace', 'MultiEdit'].includes(toolName)) {
          const filePath = (input.file_path as string) || (input.path as string) || '';
          if (filePath) {
            handle.onFileEdited?.(sessionId, filePath, toolName, input);
          }
        }

        entry.cursor++;
        break;
      }

      case 'tool_output':
        entry.cursor++;
        break;

      case 'usage':
        engineBus.emit('agent:costUpdate', {
          sessionId,
          costUsd: (event.cost_usd as number) || 0,
          inputTokens: (event.input_tokens as number) || 0,
          outputTokens: (event.output_tokens as number) || 0,
        });
        entry.cursor++;
        break;

      case 'done':
        entry.eventSource?.close();
        entry.cursor++;
        this.buffer.flush(sessionId).then(() => {
          if (entry.done) return;
          handle.markDone(sessionId);
          this.buffer.clear(sessionId);
          engineBus.emit('agent:statusChanged', { agentId: sessionId, status: 'idle', activity: '' });
          engineBus.emit('session:finished', { sessionId, exitCode: 0 });
          entry.done = true;
        }).catch(err => console.error('[AngyCodeProcessManager] flush error in done handler:', err));
        break;

      case 'error':
        handle.showError(sessionId, event.message as string);
        this.buffer.appendAssistantDelta(sessionId, `Error: ${event.message}`);
        entry.cursor++;
        break;
    }
  }
}
