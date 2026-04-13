# @angycode/core

Core library for **AngyCode** — an AI coding agent that can read, write, and edit code using LLM-powered tool loops. This package provides the agent loop, LLM provider adapters, built-in tools, and SQLite-backed persistence.

## Installation

```bash
npm install @angycode/core
```

## Quick Start

```typescript
import {
  AgentLoop,
  createProvider,
  createDefaultRegistry,
  DatabaseImpl,
} from '@angycode/core';

// 1. Set up the database (stores sessions, messages, and usage)
const db = new DatabaseImpl();          // defaults to ~/.angycode/angycode.db
// — or provide a custom path:
// const db = new DatabaseImpl('/tmp/my-agent.db');

// 2. Create a provider (Anthropic or Gemini)
const provider = createProvider({
  name: 'anthropic',
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: 'claude-sonnet-4-6',
});

// 3. Create the tool registry with all built-in tools
const tools = createDefaultRegistry();

// 4. Create and run the agent loop
const agent = new AgentLoop({
  provider,
  tools,
  db,
  workingDir: process.cwd(),
  maxTokens: 16_384,
  maxTurns: 50,
  model: 'claude-sonnet-4-6',
});

// 5. Listen for events
agent.on('event', (event) => {
  switch (event.type) {
    case 'text':
      process.stdout.write(event.text);
      break;
    case 'tool_start':
      console.log(`\n🔧 ${event.name}`);
      break;
    case 'tool_output':
      console.log(event.is_error ? `❌ ${event.output}` : `✅ Done (${event.duration_ms}ms)`);
      break;
    case 'usage':
      console.log(`\n📊 Tokens: ${event.input_tokens} in / ${event.output_tokens} out` +
        (event.cost_usd !== undefined ? ` ($${event.cost_usd.toFixed(4)})` : ''));
      break;
    case 'done':
      console.log(`\n✨ Finished (${event.stop_reason})`);
      break;
    case 'error':
      console.error(`\n💥 ${event.message}`);
      break;
  }
});

// 6. Run!
const session = await agent.run('Add a health-check endpoint to the Express server');

// Clean up
db.close();
```

## Features

### Providers

Connect to different LLM backends through a unified streaming interface.

| Provider | Adapter | Models |
|----------|---------|--------|
| Anthropic | `AnthropicAdapter` | `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001` |
| Gemini | `GeminiAdapter` | `gemini-2.0-pro`, `gemini-2.0-flash`, `gemini-1.5-pro`, `gemini-1.5-flash` |
| Ollama (local) | `OllamaAdapter` | Any model served by Ollama — Gemma 4, Llama, Mistral, Qwen, etc. |
| Mock | `MockAdapter` | (for testing) |

```typescript
import { createProvider, AnthropicAdapter, GeminiAdapter, OllamaAdapter } from '@angycode/core';

// Using the factory
const provider = createProvider({
  name: 'gemini',
  apiKey: process.env.GEMINI_API_KEY!,
  model: 'gemini-2.0-flash',
});

// Or construct directly
const anthropic = new AnthropicAdapter({ apiKey: process.env.ANTHROPIC_API_KEY! });
const gemini = new GeminiAdapter({ apiKey: process.env.GEMINI_API_KEY! });
const ollama = new OllamaAdapter({ baseUrl: 'http://localhost:11434' });
```

All providers implement the `ProviderAdapter` interface and return an `AsyncIterable<ProviderStreamEvent>` from `streamMessage()`.

#### Local Models with Ollama

The `OllamaAdapter` connects to an [Ollama](https://ollama.com) server running on your machine (or network), allowing you to use open models like **Gemma 4**, **Llama**, **Mistral**, **Qwen**, and others — completely free with no API keys required.

**Prerequisites**

1. Install Ollama:
   ```bash
   # macOS
   brew install ollama

   # Linux
   curl -fsSL https://ollama.com/install.sh | sh
   ```

2. Start the server:
   ```bash
   ollama serve
   ```

3. Pull a model:
   ```bash
   # Gemma 4 variants (Google)
   ollama pull gemma4          # E4B — 9.6 GB, 4.5B active params, 128K context
   ollama pull gemma4:e2b      # E2B — 7.2 GB, 2.3B active params, 128K context (fastest)
   ollama pull gemma4:26b      # MoE — 18 GB, 3.8B active params, 256K context (best quality)
   ollama pull gemma4:31b      # Dense — 20 GB, 30.7B active params, 256K context

   # Other popular models
   ollama pull llama3.3        # Llama 3.3 70B
   ollama pull qwen3:32b       # Qwen 3 32B
   ollama pull mistral-small   # Mistral Small 24B
   ```

**Using with `createProvider`**

```typescript
const provider = createProvider({
  name: 'ollama',
  apiKey: 'http://localhost:11434',  // apiKey is used as the Ollama base URL
  model: 'gemma4',
});
```

For the `OllamaAdapter`, the `apiKey` field is repurposed as the **Ollama server URL** (default: `http://localhost:11434`). No API key is needed for local inference.

**Using the adapter directly**

```typescript
import { OllamaAdapter } from '@angycode/core';

const adapter = new OllamaAdapter({
  baseUrl: 'http://localhost:11434',   // optional, this is the default
});

for await (const event of adapter.streamMessage({
  model: 'gemma4',
  system: 'You are a helpful assistant.',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello!' }] }],
  tools: [],
  maxTokens: 200,
})) {
  if (event.type === 'text_delta') process.stdout.write(event.text);
}
```

**Full agent loop with local models**

```typescript
import { AgentLoop, createProvider, createDefaultRegistry, DatabaseImpl } from '@angycode/core';

const agent = new AgentLoop({
  provider: createProvider({ name: 'ollama', apiKey: 'http://localhost:11434', model: 'gemma4' }),
  tools: createDefaultRegistry(),
  db: new DatabaseImpl('/tmp/local-agent.db'),
  workingDir: process.cwd(),
  maxTokens: 8192,
  maxTurns: 20,
  providerName: 'ollama',
  model: 'gemma4',
});

agent.on('event', (event) => {
  if (event.type === 'text') process.stdout.write(event.text);
  if (event.type === 'done') console.log('\nDone!');
});

await agent.run('List the files in this directory and explain the project structure.');
```

**Features supported**

| Feature | Supported | Notes |
|---------|-----------|-------|
| Text streaming | Yes | Via Ollama's `/api/chat` streaming |
| Tool/function calling | Yes | Native Gemma 4 tool support via Ollama |
| Vision (images) | Yes | Gemma 4 E2B/E4B support image inputs |
| Retry with backoff | Yes | Retries on connection errors, timeouts |
| Abort/cancel | Yes | Via `AbortSignal` |

**Hardware recommendations for Gemma 4**

| Model | VRAM/RAM needed | Apple Silicon | Notes |
|-------|----------------|---------------|-------|
| `gemma4:e2b` | ~7 GB | M1/M2/M3/M4 (8GB+) | Fastest, good for simple tasks |
| `gemma4` (E4B) | ~10 GB | M1/M2/M3/M4 (16GB+) | Good balance of speed and quality |
| `gemma4:26b` (MoE) | ~18 GB | M-series (24GB+) | Best quality, only 3.8B active params |
| `gemma4:31b` (Dense) | ~20 GB | M-series (32GB+) | Largest, needs ample memory |

On Apple Silicon, Ollama uses **Metal GPU acceleration** automatically. You can verify with `ollama ps` which shows `100% GPU` when the model is fully loaded in GPU memory.

To keep a model warm in GPU memory (avoids cold-start delay on next request):

```bash
# Keep loaded indefinitely (until manual unload or server restart)
curl http://localhost:11434/api/chat -d '{"model":"gemma4","keep_alive":-1,"messages":[]}'

# Unload when done
curl http://localhost:11434/api/chat -d '{"model":"gemma4","keep_alive":0,"messages":[]}'
```

### Built-in Tools

The agent comes with 8 built-in tools for interacting with the file system and web:

| Tool | Description |
|------|-------------|
| **Bash** | Execute shell commands and return output |
| **Read** | Read a file and return its contents with line numbers |
| **Write** | Write content to a file (creates parent directories if needed) |
| **Edit** | Find-and-replace text in a file (single or replace-all mode) |
| **Glob** | Find files matching a glob pattern, sorted by most recently modified |
| **Grep** | Search file contents for a regex pattern |
| **Think** | A no-op tool for the model to record its reasoning |
| **WebFetch** | Fetch a URL and return its content |

```typescript
import { createDefaultRegistry, ToolRegistryImpl, bashTool, readTool } from '@angycode/core';

// Get all built-in tools
const allTools = createDefaultRegistry();

// Or build a custom registry with only the tools you need
const registry = new ToolRegistryImpl();
registry.register(bashTool);
registry.register(readTool);
```

#### Disabling Tools

You can disable specific tools when creating the `AgentLoop` without removing them from the registry:

```typescript
const agent = new AgentLoop({
  // ...
  disabledTools: ['Bash', 'WebFetch'],  // tool names to exclude
});
```

#### Custom Tools

Implement the `Tool` interface to add your own tools:

```typescript
import type { Tool, ToolContext, ToolResult } from '@angycode/core';

const myTool: Tool = {
  definition: {
    name: 'MyTool',
    description: 'Does something custom',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The query to process' },
      },
      required: ['query'],
    },
  },
  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const query = input.query as string;
    return { content: `Result for: ${query}`, is_error: false };
  },
};

const registry = createDefaultRegistry();
registry.register(myTool);
```

The `ToolContext` passed to every tool provides:
- `workingDir` — the agent's working directory
- `sessionId` — the current session ID
- `filesRead` — a `Set<string>` tracking which files have been read (used for the read-before-edit rule)
- `emit(event)` — emit an `AgentEvent` from within tool execution

### AgentLoop

The `AgentLoop` is the main orchestrator. It streams messages from the LLM, executes tool calls, and persists everything to the database.

#### `run(goal, images?)`

Start a new session with an initial goal:

```typescript
const session = await agent.run('Refactor the auth module to use JWT');
```

You can optionally pass images (base64-encoded):

```typescript
const session = await agent.run('What does this diagram show?', [
  { data: base64String, mimeType: 'image/png' },
]);
```

#### `continueSession(sessionId, message, images?)`

Send a follow-up message within an existing session:

```typescript
const session = await agent.continueSession(
  session.id,
  'Also add unit tests for the new JWT validation',
);
```

#### `resume(sessionId)`

Resume a paused or interrupted session (replays existing messages):

```typescript
const session = await agent.resume('abc123');
```

#### `abort()`

Stop the agent loop mid-execution. The session will be set to `'paused'` and can be resumed later.

```typescript
agent.abort();
```

### Events

Subscribe to real-time events with `agent.on('event', callback)`. The `AgentEvent` union type includes:

| Event | Fields | Description |
|-------|--------|-------------|
| `session_start` | `sessionId`, `provider`, `model`, `workingDir` | Emitted when a session begins |
| `text` | `text` | Streamed text delta from the LLM |
| `tool_start` | `id`, `name`, `input` | A tool is about to execute |
| `tool_output` | `id`, `name`, `output`, `is_error`, `duration_ms` | A tool has finished executing |
| `usage` | `input_tokens`, `output_tokens`, `cost_usd` | Token usage for an LLM turn |
| `done` | `stop_reason` | Session ended (`end_turn`, `max_tokens`, `max_turns`, `error`, `aborted`) |
| `error` | `message` | An error occurred |

### Database

All sessions, messages, tool executions, and token usage are persisted in a local SQLite database.

```typescript
import { DatabaseImpl, createSessionStore, createMessageStore, createUsageStore } from '@angycode/core';

const db = new DatabaseImpl();               // ~/.angycode/angycode.db
const db2 = new DatabaseImpl('/tmp/test.db'); // custom path

// Access stores directly if you need to query data
const sessions = createSessionStore(db.db);
const messages = createMessageStore(db.db);
const usage = createUsageStore(db.db);

// Query session history
const session = sessions.getSession('abc123');
const msgs = messages.getMessages('abc123');

// Don't forget to close when done
db.close();
```

The database automatically creates these tables on first use:
- **`sessions`** — session metadata (goal, provider, model, status, working directory)
- **`messages`** — conversation history (role + content parts as JSON)
- **`tool_executions`** — tool call logs with input, output, duration, and error status
- **`usage`** — per-turn token counts and estimated cost

### Cost Estimation

Built-in cost estimation for supported models:

```typescript
import { estimateCost } from '@angycode/core';

const cost = estimateCost('claude-sonnet-4-6', 1000, 500);
// Returns cost in USD, or undefined for unknown models
```

### System Prompt

The system prompt is built automatically from the working directory, available tools, and optional extra instructions:

```typescript
import { buildSystemPrompt } from '@angycode/core';

const prompt = buildSystemPrompt({
  workingDir: '/home/user/project',
  tools: registry.list(),
  extra: 'Always write tests for new functions.',
});
```

You can pass `systemPromptExtra` to `AgentLoopOptions` to append custom instructions:

```typescript
const agent = new AgentLoop({
  // ...
  systemPromptExtra: 'Use TypeScript strict mode. Prefer functional patterns.',
});
```

## AgentLoopOptions Reference

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `provider` | `ProviderAdapter` | ✅ | The LLM provider to use |
| `tools` | `ToolRegistry` | ✅ | Tool registry (use `createDefaultRegistry()`) |
| `db` | `Database` | ✅ | Database for persistence |
| `workingDir` | `string` | ✅ | Working directory for tool operations |
| `maxTokens` | `number` | ✅ | Max tokens per LLM response |
| `maxTurns` | `number` | ✅ | Max agent loop turns before auto-pause |
| `providerName` | `ProviderName` | | Provider identifier (`'anthropic'`, `'gemini'`, `'ollama'`, `'mock'`) |
| `model` | `string` | | Model identifier (defaults to `claude-opus-4-6`) |
| `systemPromptExtra` | `string` | | Extra text appended to the system prompt |
| `disabledTools` | `string[]` | | Tool names to exclude from the session |
| `sessionId` | `string` | | Custom session ID (auto-generated if omitted) |

## Examples

See the [`examples/`](../../examples/) directory for runnable scripts:

- **[`ollama-gemma4.ts`](../../examples/ollama-gemma4.ts)** — Simple chat, tool calling round-trip, and full agent loop with Gemma 4 via Ollama
- **[`ollama-generate.ts`](../../examples/ollama-generate.ts)** — CLI tool that takes a prompt and output directory, runs a local model agent to generate files

```bash
# Simple demo: chat + tools + agent loop
cd code && npx tsx examples/ollama-gemma4.ts

# Generate files from a prompt
cd code && npx tsx examples/ollama-generate.ts \
  --output /tmp/my-site \
  "Build a landing page for a SaaS product called Flowboard"
```

## License

Apache 2.0 — see [LICENSE.md](./LICENSE.md)
