import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { formatEvent } from '../formatter.js';
import type { AgentEvent } from '@angycode/core';

describe('formatEvent', () => {
  const origNoColor = process.env['NO_COLOR'];

  afterEach(() => {
    if (origNoColor === undefined) {
      delete process.env['NO_COLOR'];
    } else {
      process.env['NO_COLOR'] = origNoColor;
    }
  });

  it('formats text events', () => {
    const result = formatEvent({ type: 'text', text: 'Hello world' });
    expect(result).toBe('Hello world');
  });

  it('formats tool_start events', () => {
    const event: AgentEvent = {
      type: 'tool_start',
      id: 'tc1',
      name: 'Read',
      input: { file_path: '/tmp/test.ts' },
    };
    const result = formatEvent(event)!;
    expect(result).toContain('Read');
    expect(result).toContain('file_path');
  });

  it('formats tool_output events (success)', () => {
    const event: AgentEvent = {
      type: 'tool_output',
      id: 'tc1',
      name: 'Read',
      output: 'file contents here',
      is_error: false,
      duration_ms: 42,
    };
    const result = formatEvent(event)!;
    expect(result).toContain('42ms');
    expect(result).toContain('file contents here');
  });

  it('formats tool_output events (error)', () => {
    const event: AgentEvent = {
      type: 'tool_output',
      id: 'tc1',
      name: 'Read',
      output: 'ENOENT: file not found',
      is_error: true,
      duration_ms: 5,
    };
    const result = formatEvent(event)!;
    expect(result).toContain('ENOENT');
  });

  it('formats usage events', () => {
    const event: AgentEvent = {
      type: 'usage',
      input_tokens: 100,
      output_tokens: 50,
      cost_usd: 0.0525,
    };
    const result = formatEvent(event)!;
    expect(result).toContain('100');
    expect(result).toContain('50');
    expect(result).toContain('$0.0525');
  });

  it('formats done event (end_turn)', () => {
    const result = formatEvent({
      type: 'done',
      stop_reason: 'end_turn',
    })!;
    expect(result).toContain('Done');
  });

  it('formats done event (max_tokens)', () => {
    const result = formatEvent({
      type: 'done',
      stop_reason: 'max_tokens',
    })!;
    expect(result).toContain('max tokens');
  });

  it('formats error events', () => {
    const result = formatEvent({ type: 'error', message: 'Something broke' })!;
    expect(result).toContain('Error');
    expect(result).toContain('Something broke');
  });

  it('respects NO_COLOR', () => {
    process.env['NO_COLOR'] = '1';
    const result = formatEvent({ type: 'text', text: 'plain' })!;
    // Should not contain ANSI escape codes
    expect(result).not.toContain('\x1b[');
    expect(result).toBe('plain');
  });

  it('truncates long tool output', () => {
    const longOutput = 'x'.repeat(1000);
    const result = formatEvent({
      type: 'tool_output',
      id: 'tc1',
      name: 'Read',
      output: longOutput,
      is_error: false,
      duration_ms: 10,
    })!;
    expect(result).toContain('...');
    expect(result.length).toBeLessThan(longOutput.length);
  });
});
