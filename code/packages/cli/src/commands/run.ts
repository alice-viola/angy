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
import { formatEventJson } from '../jsonFormatter.js';

export interface RunOptions {
  provider?: ProviderName;
  model?: string;
  maxTokens?: number;
  maxTurns?: number;
  json?: boolean;
  noTools?: string;
  dir?: string;
  system?: string;
  verbose?: boolean;
}

export async function runCommand(goal: string, opts: RunOptions): Promise<void> {
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

  const disabledTools = opts.noTools ? opts.noTools.split(',') : undefined;
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
    if (opts.json) {
      process.stdout.write(formatEventJson(event) + '\n');
    } else {
      const formatted = formatEvent(event, formatterOpts);
      if (formatted !== null) {
        process.stdout.write(formatted);
      }
    }
  });

  try {
    await loop.run(goal);
  } finally {
    db.close();
  }
}
