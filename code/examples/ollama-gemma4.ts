/**
 * Example: Using Gemma 4 locally via @angycode/core + Ollama
 *
 * Prerequisites:
 *   1. Ollama running:  ollama serve
 *   2. Model pulled:    ollama pull gemma4
 *
 * Run:
 *   cd code && npx tsx examples/ollama-gemma4.ts
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

// ── 1. Simple one-shot chat (no tools) ─────────────────────────────

async function simpleChat() {
  console.log('═══ Simple Chat ═══\n');

  const provider = createProvider({
    name: 'ollama',
    apiKey: 'http://localhost:11434',   // for ollama, apiKey = base URL
    model: 'gemma4',
  });

  let fullText = '';
  for await (const event of provider.streamMessage({
    model: 'gemma4',
    system: 'You are a helpful assistant. Be concise.',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Explain what TypeScript generics are in 2 sentences.' }] },
    ],
    tools: [],
    maxTokens: 200,
  })) {
    if (event.type === 'text_delta') {
      process.stdout.write(event.text);
      fullText += event.text;
    }
    if (event.type === 'message_end') {
      console.log(`\n\n  [stop: ${event.stop_reason} | tokens: ${event.usage.input} in, ${event.usage.output} out]`);
    }
  }
}

// ── 2. Tool-calling round-trip ──────────────────────────────────────

async function toolCallingDemo() {
  console.log('\n═══ Tool Calling ═══\n');

  const provider = createProvider({
    name: 'ollama',
    apiKey: 'http://localhost:11434',
    model: 'gemma4',
  });

  const tools = [
    {
      name: 'get_weather',
      description: 'Get current weather for a city',
      inputSchema: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name' },
        },
        required: ['city'],
      },
    },
  ];

  // Turn 1: ask a question that requires the tool
  console.log('User: What is the weather in Rome?\n');
  console.log('Gemma 4:');

  let toolCallId = '';
  let toolName = '';
  let toolArgs = '';

  for await (const event of provider.streamMessage({
    model: 'gemma4',
    system: 'You are a weather assistant. Always use the get_weather tool to answer weather questions.',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'What is the weather in Rome?' }] },
    ],
    tools,
    maxTokens: 300,
  })) {
    if (event.type === 'text_delta') process.stdout.write(event.text);
    if (event.type === 'tool_call_start') {
      toolCallId = event.id;
      toolName = event.name;
      console.log(`  [calling tool: ${event.name}]`);
    }
    if (event.type === 'tool_call_delta') {
      toolArgs = event.input;
      console.log(`  [args: ${event.input}]`);
    }
  }

  if (!toolCallId) {
    console.log('  (model did not call tool this time)');
    return;
  }

  // Turn 2: send the tool result back and get the final answer
  console.log('\n  [sending tool result: "22°C, sunny"]\n');

  for await (const event of provider.streamMessage({
    model: 'gemma4',
    system: 'You are a weather assistant. Always use the get_weather tool to answer weather questions.',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'What is the weather in Rome?' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: toolCallId, name: toolName, input: JSON.parse(toolArgs) }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolCallId, content: '22°C, sunny with light breeze', is_error: false }] },
    ],
    tools,
    maxTokens: 300,
  })) {
    if (event.type === 'text_delta') process.stdout.write(event.text);
  }
  console.log('\n');
}

// ── 3. Full agent loop (with real tools: bash, read, write, etc.) ───

async function agentLoopDemo() {
  console.log('═══ Agent Loop (with real tools) ═══\n');

  const provider = createProvider({
    name: 'ollama',
    apiKey: 'http://localhost:11434',
    model: 'gemma4',
  });

  const tools = createDefaultRegistry();

  const dbDir = join(homedir(), '.angycode');
  mkdirSync(dbDir, { recursive: true });
  const db = new DatabaseImpl(join(dbDir, 'ollama-demo.db'));

  const loop = new AgentLoop({
    provider,
    tools,
    db,
    workingDir: process.cwd(),
    maxTokens: 4096,
    maxTurns: 5,
    providerName: 'ollama',
    model: 'gemma4',
  });

  loop.on('event', (event: AgentEvent) => {
    switch (event.type) {
      case 'text':
        process.stdout.write(event.text);
        break;
      case 'tool_start':
        console.log(`\n  [tool: ${event.name}(${JSON.stringify(event.input).slice(0, 80)}...)]`);
        break;
      case 'tool_output':
        console.log(`  [result: ${event.output.slice(0, 120)}${event.output.length > 120 ? '...' : ''}]`);
        break;
      case 'usage':
        console.log(`  [tokens: ${event.input_tokens} in, ${event.output_tokens} out | cost: ${event.cost_usd ?? 'free'}]`);
        break;
      case 'done':
        console.log(`\n  [done: ${event.stop_reason}]\n`);
        break;
      case 'error':
        console.error(`  [error: ${event.message}]`);
        break;
    }
  });

  await loop.run('List the files in the current directory and tell me what this project is about. Be brief.');

  db.close();
}

// ── Run ─────────────────────────────────────────────────────────────

async function main() {
  await simpleChat();
  await toolCallingDemo();
  await agentLoopDemo();
}

main().catch(console.error);
