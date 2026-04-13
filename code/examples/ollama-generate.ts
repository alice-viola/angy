#!/usr/bin/env npx tsx
/**
 * Generate files with Gemma 4 via @angycode/core agent loop.
 *
 * Usage:
 *   npx tsx examples/ollama-generate.ts --output /path/to/dir "Your prompt here"
 *
 * Options:
 *   --output, -o   Output directory (created if missing)
 *   --model, -m    Ollama model name (default: gemma4)
 *   --turns, -t    Max agent turns (default: 30)
 *   --url, -u      Ollama base URL (default: http://localhost:11434)
 */

import {
  createProvider,
  AgentLoop,
  createDefaultRegistry,
  DatabaseImpl,
  type AgentEvent,
} from '@angycode/core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ── Parse CLI args ──────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let output = '';
  let model = 'gemma4';
  let turns = 30;
  let url = 'http://localhost:11434';
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if ((a === '--output' || a === '-o') && args[i + 1]) { output = args[++i]; }
    else if ((a === '--model' || a === '-m') && args[i + 1]) { model = args[++i]; }
    else if ((a === '--turns' || a === '-t') && args[i + 1]) { turns = parseInt(args[++i], 10); }
    else if ((a === '--url' || a === '-u') && args[i + 1]) { url = args[++i]; }
    else { positional.push(a); }
  }

  const prompt = positional.join(' ');
  if (!prompt || !output) {
    console.error('Usage: npx tsx examples/ollama-generate.ts --output <dir> "prompt"');
    process.exit(1);
  }

  return { prompt, output, model, turns, url };
}

// ── Waiting spinner ─────────────────────────────────────────────────

function startSpinner(label: string) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const start = Date.now();
  const interval = setInterval(() => {
    const elapsed = ((Date.now() - start) / 1000).toFixed(0);
    process.stderr.write(`\r  ${frames[i++ % frames.length]} ${label} (${elapsed}s)`);
  }, 100);
  return {
    stop(msg?: string) {
      clearInterval(interval);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      process.stderr.write(`\r  ✓ ${msg ?? label} (${elapsed}s)\n`);
    },
    update(newLabel: string) {
      label = newLabel;
    },
  };
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const { prompt, output, model, turns, url } = parseArgs();

  mkdirSync(output, { recursive: true });

  console.log(`Model:   ${model}`);
  console.log(`Output:  ${output}`);
  console.log(`Turns:   ${turns}`);
  console.log(`Prompt:  ${prompt.slice(0, 120)}${prompt.length > 120 ? '...' : ''}`);
  console.log('─'.repeat(60));

  const provider = createProvider({ name: 'ollama', apiKey: url, model });
  const tools = createDefaultRegistry();

  const dbDir = join(homedir(), '.angycode');
  mkdirSync(dbDir, { recursive: true });
  const db = new DatabaseImpl(join(dbDir, 'ollama-generate.db'));

  const loop = new AgentLoop({
    provider,
    tools,
    db,
    workingDir: output,
    maxTokens: 8192,
    maxTurns: turns,
    providerName: 'ollama',
    model,
    systemPromptExtra: [
      'You are a senior frontend developer.',
      '',
      'CRITICAL: When calling the Write tool, you MUST provide BOTH arguments:',
      '  - file_path: the filename (e.g. "index.html", "styles.css")',
      '  - content: the full file content',
      'Example: Write({ "file_path": "index.html", "content": "<!DOCTYPE html>..." })',
      '',
      'Rules:',
      '- Write all files to the working directory using the Write tool.',
      '- Create complete, production-quality HTML + CSS.',
      '- Use modern CSS (grid, flexbox, variables).',
      '- Make the design dark-themed, clean, and professional.',
      '- Create a single-page app with all sections navigable via sidebar or tabs.',
      '- Write one file at a time. Always include file_path in every Write call.',
    ].join('\n'),
  });

  let totalIn = 0;
  let totalOut = 0;
  let toolCount = 0;
  let turnCount = 0;
  let spinner = startSpinner(`Turn 1 — waiting for ${model}`);
  let gotFirstEvent = false;

  loop.on('event', (event: AgentEvent) => {
    switch (event.type) {
      case 'text':
        if (!gotFirstEvent) {
          gotFirstEvent = true;
          spinner.stop(`Turn ${turnCount + 1} — model responded`);
        }
        process.stdout.write(event.text);
        break;

      case 'tool_start':
        if (!gotFirstEvent) {
          gotFirstEvent = true;
          spinner.stop(`Turn ${turnCount + 1} — model responded`);
        }
        toolCount++;
        console.log(`\n  ▸ [${toolCount}] ${event.name}`);
        const input = event.input as Record<string, unknown>;
        for (const [k, v] of Object.entries(input)) {
          const val = typeof v === 'string' ? v : JSON.stringify(v);
          if (val.length > 300) {
            console.log(`      ${k}: ${val.slice(0, 300)}... (${val.length} chars)`);
          } else {
            console.log(`      ${k}: ${val}`);
          }
        }
        break;

      case 'tool_output':
        if (event.is_error) {
          console.log(`    ✗ ERROR (${event.duration_ms}ms): ${event.output.slice(0, 500)}`);
        } else {
          const lines = event.output.split('\n');
          const preview = lines.slice(0, 8).join('\n');
          const suffix = lines.length > 8 ? `\n      ... (${lines.length} lines total)` : '';
          console.log(`    ✓ OK (${event.duration_ms}ms)${event.output.length > 0 ? ':' : ''}`);
          if (event.output.length > 0) {
            console.log(`      ${preview.replace(/\n/g, '\n      ')}${suffix}`);
          }
        }
        break;

      case 'usage':
        totalIn += event.input_tokens;
        totalOut += event.output_tokens;
        turnCount++;
        console.log(`\n  [Turn ${turnCount} done — ${event.input_tokens} in, ${event.output_tokens} out]`);
        // Start spinner for next turn
        gotFirstEvent = false;
        spinner = startSpinner(`Turn ${turnCount + 1} — waiting for ${model}`);
        break;

      case 'done':
        spinner.stop('finished');
        console.log(`${'─'.repeat(60)}`);
        console.log(`Done (${event.stop_reason}) | ${turnCount} turns | ${toolCount} tool calls | ${totalIn} in + ${totalOut} out tokens`);
        break;

      case 'error':
        spinner.stop('error');
        console.error(`\n  ✗ ERROR: ${event.message}`);
        break;
    }
  });

  await loop.run(prompt);
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
