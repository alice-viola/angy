import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  AgentLoop,
  DatabaseImpl,
  createDefaultRegistry,
  createProvider,
} from '@angycode/core';
import type { ProviderName } from '@angycode/core';
import { resolveConfig } from '../config.js';
import { resolveApiKey } from '../keys.js';
import { formatEvent, type FormatterOptions } from '../formatter.js';

export interface ChatOptions {
  provider?: ProviderName;
  model?: string;
  maxTokens?: number;
  maxTurns?: number;
  dir?: string;
  system?: string;
  verbose?: boolean;
  noTools?: string;
}

export async function chatCommand(opts: ChatOptions): Promise<void> {
  const config = resolveConfig({
    provider: opts.provider,
    model: opts.model,
    maxTokens: opts.maxTokens,
    maxTurns: opts.maxTurns,
  });

  const apiKey = resolveApiKey(config.provider);
  const provider = createProvider({ name: config.provider, apiKey, model: config.model });
  const db = new DatabaseImpl();
  const tools = createDefaultRegistry();

  const disabledSet = new Set((opts.noTools ?? '').split(',').filter(Boolean));
  const disabledTools = disabledSet.size > 0 ? [...disabledSet] : undefined;
  const workingDir = opts.dir ?? process.cwd();

  const loop = new AgentLoop({
    provider,
    tools,
    db,
    workingDir,
    maxTokens: config.maxTokens,
    maxTurns: config.maxTurns,
    providerName: config.provider,
    model: config.model,
    systemPromptExtra: opts.system,
    disabledTools,
  });

  const formatterOpts: FormatterOptions = { verbose: opts.verbose };

  loop.on('event', (event) => {
    if (event.type === 'session_start') return; // suppress per-turn header in chat mode
    const formatted = formatEvent(event, formatterOpts);
    if (formatted !== null) {
      process.stdout.write(formatted);
    }
  });

  const rl = readline.createInterface({ input, output });

  process.stdout.write(
    `\x1b[38;5;176m\x1b[1m◆ AngyCode\x1b[0m — interactive  ` +
    `\x1b[2m(${config.provider} / ${config.model})\x1b[0m\n` +
    `  working → \x1b[1m${workingDir}\x1b[0m\n` +
    `  \x1b[38;5;245m${'─'.repeat(40)}\x1b[0m\n` +
    `  Type your goal, or \x1b[2mCtrl+C\x1b[0m to exit.\n\n`,
  );

  let sessionId: string | null = null;

  const cleanup = () => {
    rl.close();
    db.close();
  };

  process.on('SIGINT', () => {
    process.stdout.write('\n');
    cleanup();
    process.exit(0);
  });

  while (true) {
    let userInput: string;
    try {
      userInput = await rl.question('\x1b[38;5;80m>\x1b[0m ');
    } catch {
      // EOF / Ctrl+D
      break;
    }

    userInput = userInput.trim();
    if (!userInput) continue;
    if (userInput === '/exit' || userInput === '/quit') break;

    process.stdout.write('\n');

    try {
      let session;
      if (sessionId === null) {
        session = await loop.run(userInput);
        sessionId = session.id;
      } else {
        session = await loop.continueSession(sessionId, userInput);
      }
      // If the session errored out, allow starting fresh next turn
      if (session.status === 'error') {
        sessionId = null;
      }
    } catch (err) {
      process.stderr.write(`\x1b[38;5;203mError: ${err instanceof Error ? err.message : String(err)}\x1b[0m\n`);
    }

    process.stdout.write('\n');
  }

  cleanup();
}
