/**
 * useEngine — thin composable bridge between ProcessManager and the UI.
 *
 * Delegates all heavy lifting to ProcessManager (engine layer).
 * Re-exports AgentHandle (aliased as ChatPanelHandle for backward compat)
 * and provides module-level functions that match the old API.
 */

import { ProcessManager } from '../engine/ProcessManager';
import { ClaudeProcess } from '../engine/ClaudeProcess';
import { CodexProcess } from '../engine/CodexProcess';
import type { AgentHandle, ProcessOptions, AngyCodeProcessOptions } from '../engine/types';
import { getDatabase } from '../stores/sessions';
import type { AngyCodeProcessManager } from '../engine/AngyCodeProcessManager';

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
    _pm = new ProcessManager(getDatabase());
  }
  return _pm;
}

/** Inject the ProcessManager instance (called by AngyEngine or App.vue). */
export function setProcessManager(pm: ProcessManager): void {
  _pm = pm;
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
): ClaudeProcess | CodexProcess {
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
): ClaudeProcess | CodexProcess {
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
export function getProcess(sessionId: string): ClaudeProcess | CodexProcess | undefined {
  return getProcessManager().getProcess(sessionId);
}

// ── Singleton AngyCodeProcessManager ────────────────────────────────────

let _acpm: AngyCodeProcessManager | null = null;

export function setAngyCodeProcessManager(acpm: AngyCodeProcessManager): void {
  _acpm = acpm;
}

export function getAngyCodeProcessManager(): AngyCodeProcessManager {
  if (!_acpm) throw new Error('AngyCodeProcessManager not initialized');
  return _acpm;
}

export function isAngyCodeModel(modelId: string): boolean {
  return modelId.startsWith('gemini') || modelId.startsWith('angy-');
}

export async function sendAngyCodeMessage(options: AngyCodeProcessOptions, handle: AgentHandle): Promise<void> {
  return getAngyCodeProcessManager().sendMessage(options, handle);
}

export function cancelAngyCodeProcess(sessionId: string): void {
  getAngyCodeProcessManager().cancel(sessionId);
}

export function isAngyCodeRunning(sessionId: string): boolean {
  if (!_acpm) return false;
  return _acpm.isRunning(sessionId);
}
