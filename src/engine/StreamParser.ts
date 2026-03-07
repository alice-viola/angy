import mitt from 'mitt';
import type { StreamEvent, PendingToolUse } from './types';

// ── StreamParser Events ───────────────────────────────────────────────────

export type StreamParserEvents = {
  textDelta: string;
  toolUseStarted: { toolName: string; toolId: string; input: Record<string, any> };
  toolResultReceived: string;
  resultReady: { sessionId: string; result: any };
  errorOccurred: string;
  eventParsed: StreamEvent;
  checkpointReceived: string;
  thinkingStarted: void;
  thinkingDelta: string;
  thinkingStopped: void;
  editStreamStarted: { toolName: string; filePath: string };
  editContentDelta: { blockIndex: number; partialNewString: string };
  editStreamFinished: number; // blockIndex
  costReported: { sessionId: string; costUsd: number; inputTokens: number; outputTokens: number };
};

// ── Helpers ───────────────────────────────────────────────────────────────

function jstr(j: any, key: string): string {
  if (j && typeof j[key] === 'string') return j[key];
  return '';
}

function jtype(j: any): string {
  if (j && typeof j.type === 'string') return j.type;
  return '';
}

function jint(j: any, key: string, def = -1): number {
  if (j && typeof j[key] === 'number') return j[key];
  return def;
}

// ── JSON string utilities ─────────────────────────────────────────────────

function unescapeJsonString(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) {
      const c = s[i + 1];
      if (c === '"') { out += '"'; i++; }
      else if (c === '\\') { out += '\\'; i++; }
      else if (c === 'n') { out += '\n'; i++; }
      else if (c === 't') { out += '\t'; i++; }
      else if (c === 'r') { out += '\r'; i++; }
      else if (c === '/') { out += '/'; i++; }
      else { out += s[i]; }
    } else {
      out += s[i];
    }
  }
  return out;
}

function findJsonFieldStart(json: string, field: string, from: number): number {
  let needle = `"${field}":"`;
  let pos = json.indexOf(needle, from);
  if (pos !== -1) return pos + needle.length;

  needle = `"${field}": "`;
  pos = json.indexOf(needle, from);
  if (pos !== -1) return pos + needle.length;

  return -1;
}

function extractFieldValue(json: string, fieldStart: number): string {
  let value = '';
  for (let i = fieldStart; i < json.length; i++) {
    if (json[i] === '\\' && i + 1 < json.length) {
      value += json[i];
      value += json[i + 1];
      i++;
    } else if (json[i] === '"') {
      break;
    } else {
      value += json[i];
    }
  }
  return value;
}

// ── StreamParser ──────────────────────────────────────────────────────────

export class StreamParser {
  readonly events = mitt<StreamParserEvents>();

  private accumulatedText = '';
  private pendingTools = new Map<number, PendingToolUse>();
  private emittedToolIds = new Set<string>();
  private activeThinkingBlockIdx = -1;

  reset(): void {
    this.accumulatedText = '';
    this.pendingTools.clear();
    this.emittedToolIds.clear();
    this.activeThinkingBlockIdx = -1;
  }

  feed(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let j: any;
    try {
      j = JSON.parse(trimmed);
    } catch {
      return;
    }

    const event = this.parseEvent(j);

    switch (event.type) {
      case 'textDelta':
        this.accumulatedText += event.text ?? '';
        this.events.emit('textDelta', event.text ?? '');
        break;
      case 'toolUse':
        this.events.emit('toolUseStarted', {
          toolName: event.toolName ?? '',
          toolId: event.toolId ?? '',
          input: event.toolInput ?? {},
        });
        break;
      case 'toolResult':
        this.events.emit('toolResultReceived', event.toolResultContent ?? '');
        break;
      case 'result':
        this.events.emit('resultReady', {
          sessionId: event.sessionId ?? '',
          result: event.raw,
        });
        break;
      case 'error':
        this.events.emit('errorOccurred', event.text ?? '');
        break;
    }
  }

  // ── Event classification ──────────────────────────────────────────────

  private parseEvent(j: any): StreamEvent {
    const event: StreamEvent = { type: 'unknown', raw: j };
    const type = jtype(j);

    // ── "system" init event ──
    if (type === 'system') {
      event.type = 'result';
      event.sessionId = jstr(j, 'session_id');
      return event;
    }

    // ── "result" event (final) ──
    if (type === 'result') {
      event.type = 'result';
      event.sessionId = jstr(j, 'session_id');

      // Extract cost data
      const costUsd = (typeof j.total_cost_usd === 'number' ? j.total_cost_usd : 0)
        || (typeof j.cost_usd === 'number' ? j.cost_usd : 0);
      const usage = j.usage ?? {};
      if (costUsd > 0 || usage.input_tokens) {
        this.events.emit('costReported', {
          sessionId: j.session_id ?? '',
          costUsd,
          inputTokens: usage.input_tokens ?? 0,
          outputTokens: usage.output_tokens ?? 0,
        });
      }

      return event;
    }

    // ── "error" ──
    if (type === 'error') {
      event.type = 'error';
      if (j.error) event.text = jstr(j.error, 'message');
      if (!event.text) event.text = JSON.stringify(j);
      return event;
    }

    // ── "stream_event" wrapper ──
    if (type === 'stream_event' && j.event) {
      this.handleInnerEvent(j.event);
      event.type = 'unknown'; // already handled
      return event;
    }

    // ── "user" message with checkpoint UUID (from --replay-user-messages) ──
    if (type === 'user') {
      if (j.isReplay === true) {
        const uuid = jstr(j, 'uuid');
        if (uuid) this.events.emit('checkpointReceived', uuid);
      }
      event.type = 'unknown';
      return event;
    }

    // ── "assistant" snapshot message ──
    if (type === 'assistant') {
      const content = j.message?.content;
      if (Array.isArray(content)) {
        // Emit ALL tool_use blocks directly (a single response can contain
        // multiple parallel tool calls — e.g. two delegate calls).
        for (const block of content) {
          if (jtype(block) === 'tool_use') {
            const toolId = jstr(block, 'id');
            if (toolId && !this.emittedToolIds.has(toolId)) {
              this.emittedToolIds.add(toolId);
              this.events.emit('toolUseStarted', {
                toolName: jstr(block, 'name'),
                toolId,
                input: block.input ?? {},
              });
            }
          }
        }
      }

      // Capture session_id
      const sid = jstr(j, 'session_id');
      if (sid) {
        event.type = 'result';
        event.sessionId = sid;
        return event;
      }

      event.type = 'unknown';
      return event;
    }

    // ── "tool_result" ──
    if (type === 'tool_result') {
      event.type = 'toolResult';
      if (j.content !== undefined) {
        event.toolResultContent = typeof j.content === 'string'
          ? j.content
          : JSON.stringify(j.content);
      }
      return event;
    }

    event.type = 'unknown';
    return event;
  }

  // ── Inner stream event handling ───────────────────────────────────────

  private handleInnerEvent(ev: any): void {
    const evType = jtype(ev);

    // --- Text streaming ---
    if (evType === 'content_block_delta') {
      if (ev.delta) {
        const dt = jtype(ev.delta);

        if (dt === 'text_delta') {
          const text = jstr(ev.delta, 'text');
          const event: StreamEvent = { type: 'textDelta', text };
          this.accumulatedText += text;
          this.events.emit('textDelta', text);
          this.events.emit('eventParsed', event);
          return;
        }

        if (dt === 'input_json_delta') {
          const idx = jint(ev, 'index');
          const pending = this.pendingTools.get(idx);
          if (pending) {
            let partial = '';
            if (typeof ev.delta.partial_json === 'string')
              partial = ev.delta.partial_json;
            pending.accumulatedJson += partial;
            this.processPartialToolJson(idx, partial);
          }
          return;
        }

        if (dt === 'thinking_delta') {
          const text = jstr(ev.delta, 'thinking');
          if (text) this.events.emit('thinkingDelta', text);
          return;
        }

        if (dt === 'signature_delta') {
          return;
        }
      }
      return;
    }

    if (evType === 'content_block_start') {
      if (ev.content_block) {
        const bt = jtype(ev.content_block);
        const idx = jint(ev, 'index');

        if (bt === 'tool_use' && idx >= 0) {
          const pending: PendingToolUse = {
            name: jstr(ev.content_block, 'name'),
            id: jstr(ev.content_block, 'id'),
            blockIndex: idx,
            accumulatedJson: '',
            pathEmitted: false,
            inNewString: false,
            extractedPath: '',
            newStringBuffer: '',
            lastScanPos: 0,
          };
          this.pendingTools.set(idx, pending);
        } else if (bt === 'thinking') {
          this.activeThinkingBlockIdx = idx;
          this.events.emit('thinkingStarted', undefined);
        }
      }
      return;
    }

    if (evType === 'content_block_stop') {
      const idx = jint(ev, 'index');

      if (idx === this.activeThinkingBlockIdx) {
        this.activeThinkingBlockIdx = -1;
        this.events.emit('thinkingStopped', undefined);
        return;
      }

      const pending = this.pendingTools.get(idx);
      if (pending) {
        const wasStreaming = pending.inNewString || pending.pathEmitted;
        if (wasStreaming) this.events.emit('editStreamFinished', idx);

        if (pending.id && !this.emittedToolIds.has(pending.id) && pending.accumulatedJson) {
          let toolInput: Record<string, any> = {};
          try {
            toolInput = JSON.parse(pending.accumulatedJson);
          } catch {
            toolInput = {};
          }

          this.emittedToolIds.add(pending.id);
          const event: StreamEvent = {
            type: 'toolUse',
            toolName: pending.name,
            toolId: pending.id,
            toolInput,
          };
          this.events.emit('toolUseStarted', {
            toolName: pending.name,
            toolId: pending.id,
            input: toolInput,
          });
          this.events.emit('eventParsed', event);
        }

        this.pendingTools.delete(idx);
      }
      return;
    }

    // message_start, message_delta, message_stop — no action needed
  }

  // ── Streaming field extraction for Edit/Write tools ───────────────────

  private processPartialToolJson(idx: number, _partial: string): void {
    const p = this.pendingTools.get(idx);
    if (!p) return;

    const isEdit = p.name === 'Edit' || p.name === 'StrReplace' || p.name === 'Write';
    if (!isEdit) return;

    const json = p.accumulatedJson;

    // 1. Extract path field
    if (!p.pathEmitted) {
      let pathStart = findJsonFieldStart(json, 'path', 0);
      if (pathStart === -1) pathStart = findJsonFieldStart(json, 'file_path', 0);

      if (pathStart !== -1) {
        const rawVal = extractFieldValue(json, pathStart);
        // Ensure the closing quote exists (field is complete)
        if (json.indexOf('"', pathStart + rawVal.length) !== -1) {
          p.extractedPath = unescapeJsonString(rawVal);
          p.pathEmitted = true;
          this.events.emit('editStreamStarted', {
            toolName: p.name,
            filePath: p.extractedPath,
          });
        }
      }
    }

    // 2. Find content field start
    if (p.pathEmitted && !p.inNewString) {
      const fieldName = p.name === 'Write' ? 'content' : 'new_string';
      let start = findJsonFieldStart(json, fieldName, 0);
      if (start === -1 && p.name === 'Write')
        start = findJsonFieldStart(json, 'contents', 0);
      if (start !== -1) {
        p.inNewString = true;
        p.lastScanPos = start;
      }
    }

    // 3. Extract new content deltas
    if (p.inNewString) {
      const rawVal = extractFieldValue(json, p.lastScanPos);
      const decoded = unescapeJsonString(rawVal);
      if (decoded.length > p.newStringBuffer.length) {
        const delta = decoded.substring(p.newStringBuffer.length);
        p.newStringBuffer = decoded;
        this.events.emit('editContentDelta', {
          blockIndex: idx,
          partialNewString: delta,
        });
      }
    }
  }
}
