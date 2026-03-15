import type { AgentEvent } from '@angycode/core';

// ANSI 256-color palette
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[38;5;80m';
const GREEN = '\x1b[38;5;114m';
const RED = '\x1b[38;5;203m';
const YELLOW = '\x1b[38;5;222m';
const MAGENTA = '\x1b[38;5;176m';
const GRAY = '\x1b[38;5;245m';

// Unicode glyphs with ASCII fallbacks
const isUnicode = !process.env['NO_COLOR'] && process.stdout.isTTY !== false;
const GLYPH = {
  tool: isUnicode ? '\u25B6' : '>',   // ▶
  done: isUnicode ? '\u2714' : '[OK]', // ✔
  err:  isUnicode ? '\u2718' : '[ERR]', // ✘
  dot:  isUnicode ? '\u2022' : '*',    // •
};

function noColor(): boolean {
  return !!process.env['NO_COLOR'];
}

function c(color: string, text: string): string {
  if (noColor()) return text;
  return `${color}${text}${RESET}`;
}

export interface FormatterOptions {
  verbose?: boolean;
}

export function formatEvent(event: AgentEvent, options: FormatterOptions = {}): string | null {
  switch (event.type) {
    case 'session_start': {
      const lines = [
        `${c(MAGENTA, `${BOLD}◆ AngyCode`)} — session ${c(CYAN, `#${event.sessionId}`)}`,
        `  provider → ${c(BOLD, `${event.provider} / ${event.model}`)}`,
        `  working  → ${c(BOLD, event.workingDir)}`,
        `  ${c(GRAY, '─'.repeat(40))}`,
      ];
      return lines.join('\n') + '\n';
    }

    case 'text':
      return event.text;

    case 'tool_start': {
      const header = `\n${c(CYAN, `${GLYPH.tool} ${BOLD}${event.name}`)}${formatToolInput(event.input)}`;
      if (options.verbose) {
        const inputJson = c(DIM, indent(JSON.stringify(event.input, null, 2), '    '));
        return `${header}\n${inputJson}`;
      }
      return header;
    }

    case 'tool_output': {
      const color = event.is_error ? RED : GREEN;
      const glyph = event.is_error ? GLYPH.err : GLYPH.done;
      const duration = c(GRAY, `(${event.duration_ms}ms)`);
      if (options.verbose) {
        return `${c(color, `  ${glyph}`)} ${duration}\n${c(DIM, indent(event.output, '  '))}`;
      }
      return `${c(color, `  ${glyph}`)} ${duration}`;
    }

    case 'usage': {
      const parts = [
        `${c(GRAY, GLYPH.dot)} tokens: ${event.input_tokens}→${event.output_tokens}`,
      ];
      if (event.cost_usd !== undefined) {
        parts.push(c(YELLOW, `$${event.cost_usd.toFixed(4)}`));
      }
      return c(GRAY, parts.join(' '));
    }

    case 'done': {
      let msg: string;
      if (event.stop_reason === 'end_turn') {
        msg = `${GLYPH.done} Done`;
      } else if (event.stop_reason === 'max_tokens') {
        msg = `${GLYPH.err} Stopped (max tokens)`;
      } else if (event.stop_reason === 'max_turns') {
        msg = `${GLYPH.err} Stopped (max turns)`;
      } else if (event.stop_reason === 'aborted') {
        msg = `${GLYPH.err} Aborted`;
      } else {
        msg = `${GLYPH.err} Error`;
      }
      return `\n${c(MAGENTA, msg)}`;
    }

    case 'error':
      return `\n${c(RED, `${GLYPH.err} Error: ${event.message}`)}`;
  }
}

function formatToolInput(input: Record<string, unknown>): string {
  const keys = Object.keys(input);
  if (keys.length === 0) return '';
  // Show first key's value as a hint
  const first = input[keys[0]!];
  const preview = typeof first === 'string'
    ? truncate(first, 60)
    : JSON.stringify(first);
  return c(GRAY, ` ${keys[0]}: ${preview}`);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '...';
}

function indent(text: string, prefix: string): string {
  return text.split('\n').map((line) => prefix + line).join('\n');
}
