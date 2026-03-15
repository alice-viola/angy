import type { AgentEvent } from '@angycode/core';

// JSON output protocol: one JSON object per line, discriminated by `type`
// The first event emitted by AgentLoop is always `session_start`.
export function formatEventJson(event: AgentEvent): string {
  return JSON.stringify(event);
}
