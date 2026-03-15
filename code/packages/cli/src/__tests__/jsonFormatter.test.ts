import { describe, it, expect } from 'vitest';
import { formatEventJson } from '../jsonFormatter.js';
import type { AgentEvent } from '@angycode/core';

describe('formatEventJson', () => {
  it('serializes text event', () => {
    const event: AgentEvent = { type: 'text', text: 'Hello' };
    const json = formatEventJson(event);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual({ type: 'text', text: 'Hello' });
  });

  it('serializes tool_start event', () => {
    const event: AgentEvent = {
      type: 'tool_start',
      id: 'tc1',
      name: 'Bash',
      input: { command: 'ls' },
    };
    const json = formatEventJson(event);
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe('tool_start');
    expect(parsed.name).toBe('Bash');
    expect(parsed.input.command).toBe('ls');
  });

  it('serializes usage event with cost', () => {
    const event: AgentEvent = {
      type: 'usage',
      input_tokens: 100,
      output_tokens: 50,
      cost_usd: 0.0525,
    };
    const json = formatEventJson(event);
    const parsed = JSON.parse(json);
    expect(parsed.cost_usd).toBe(0.0525);
  });

  it('serializes done event', () => {
    const event: AgentEvent = {
      type: 'done',
      stop_reason: 'end_turn',
    };
    const json = formatEventJson(event);
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe('done');
    expect(parsed.stop_reason).toBe('end_turn');
  });

  it('produces valid single-line JSON', () => {
    const event: AgentEvent = { type: 'text', text: 'line1\nline2' };
    const json = formatEventJson(event);
    expect(json.split('\n')).toHaveLength(1); // Single line
    expect(JSON.parse(json).text).toBe('line1\nline2');
  });
});
