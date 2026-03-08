/**
 * useEngine — thin composable bridge between ProcessManager and the UI.
 *
 * Delegates all heavy lifting to ProcessManager (engine layer).
 * Re-exports AgentHandle (aliased as ChatPanelHandle for backward compat)
 * and provides module-level functions that match the old API.
 */

import { ProcessManager } from '../engine/ProcessManager';
import { ClaudeProcess } from '../engine/ClaudeProcess';
import type { AgentHandle, ProcessOptions } from '../engine/types';
import type { Orchestrator } from '../engine/Orchestrator';

// ── Re-export for backward compatibility ─────────────────────────────────

export type { AgentHandle, ProcessOptions };
/** @deprecated Use AgentHandle instead */
export type ChatPanelHandle = AgentHandle;

// ── Singleton ProcessManager ─────────────────────────────────────────────
//
// The AngyEngine owns the canonical ProcessManager instance. This module
// can either share that instance (via setProcessManager) or create a
// standalone one for legacy / non-engine usage.

let _pm: ProcessManager | null = null;

function getProcessManager(): ProcessManager {
  if (!_pm) {
    _pm = new ProcessManager();
  }
  return _pm;
}

/** Inject the ProcessManager instance (called by AngyEngine or App.vue). */
export function setProcessManager(pm: ProcessManager): void {
  _pm = pm;
}

// ── Legacy interceptor API (delegates to ProcessManager) ─────────────────

/** @deprecated Use engine.processes.setOrchestratorLookup() instead */
export function setMcpToolInterceptor(
  _callback: ((sessionId: string, toolName: string, args: Record<string, any>) => void) | null,
): void {
  // No longer used — orchestrator routing goes through ProcessManager.setOrchestratorLookup()
  console.warn('[useEngine] setMcpToolInterceptor is deprecated — use setOrchestratorLookup instead');
}

/** @deprecated Use engine.processes.setOrchestratorLookup() instead */
export function setSessionFinishedInterceptor(
  _callback: ((sessionId: string) => void) | null,
): void {
  console.warn('[useEngine] setSessionFinishedInterceptor is deprecated — use setOrchestratorLookup instead');
}

/**
 * Register a function that maps sessionId → Orchestrator instance.
 * Delegates to ProcessManager.
 */
export function setOrchestratorLookup(
  lookup: ((sessionId: string) => Orchestrator | null) | null,
): void {
  getProcessManager().setOrchestratorLookup(lookup);
}

// ── Public API (delegates to ProcessManager) ─────────────────────────────

/**
 * Send a message to Claude for a given session.
 * Creates a new ClaudeProcess, wires all StreamParser events to the handle,
 * and sends the message.
 */
export function sendMessageToEngine(
  sessionId: string,
  text: string,
  chatPanel: AgentHandle,
  options: ProcessOptions = { workingDir: '.' },
): ClaudeProcess {
  return getProcessManager().sendMessage(sessionId, text, chatPanel, options);
}

/**
 * Send a tool result back to Claude for a given session.
 */
export function sendToolResultToEngine(
  sessionId: string,
  toolUseId: string,
  content: string,
  chatPanel: AgentHandle,
  options: {
    workingDir: string;
    mode?: string;
    model?: string;
    resumeSessionId: string;
  },
): ClaudeProcess {
  return getProcessManager().sendToolResult(sessionId, toolUseId, content, chatPanel, options);
}

/**
 * Cancel the running process for a session.
 */
export function cancelProcess(sessionId: string): void {
  getProcessManager().cancelProcess(sessionId);
}

/**
 * Get the active process for a session (if any).
 */
export function getProcess(sessionId: string): ClaudeProcess | undefined {
  return getProcessManager().getProcess(sessionId);
}
