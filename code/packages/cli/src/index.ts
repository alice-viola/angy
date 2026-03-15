#!/usr/bin/env node

import { Command } from 'commander';
import type { ProviderName } from '@angycode/core';
import { runCommand } from './commands/run.js';
import { resumeCommand } from './commands/resume.js';
import { sessionsCommand } from './commands/sessions.js';
import { costCommand } from './commands/cost.js';
import { configGetCommand, configSetCommand } from './commands/config.js';
import { chatCommand } from './commands/chat.js';

const program = new Command();

program
  .name('angycode')
  .description('AngyCode — provider-agnostic agentic CLI')
  .version('0.1.0')
  .option('-p, --provider <name>', 'Provider (anthropic or gemini)')
  .option('-m, --model <model>', 'Model name')
  .option('-d, --dir <path>', 'Working directory')
  .option('--max-tokens <n>', 'Max tokens per response', parseInt)
  .option('--max-turns <n>', 'Max agent turns', parseInt)
  .option('--system <text>', 'Extra system prompt text')
  .option('--verbose', 'Enable verbose output')
  .option('--disable-tools <list>', 'Comma-separated list of tools to disable')
  .action(async (opts: Record<string, unknown>) => {
    await chatCommand({
      provider: opts['provider'] as ProviderName | undefined,
      model: opts['model'] as string | undefined,
      dir: opts['dir'] as string | undefined,
      maxTokens: opts['maxTokens'] as number | undefined,
      maxTurns: opts['maxTurns'] as number | undefined,
      system: opts['system'] as string | undefined,
      verbose: opts['verbose'] as boolean | undefined,
      noTools: opts['disableTools'] as string | undefined,
    });
  });

program
  .command('run')
  .description('Start a new agent session')
  .argument('<goal>', 'The task for the agent to accomplish')
  .option('-p, --provider <name>', 'Provider (anthropic or gemini)')
  .option('-m, --model <model>', 'Model name')
  .option('-d, --dir <path>', 'Working directory')
  .option('--max-tokens <n>', 'Max tokens per response', parseInt)
  .option('--max-turns <n>', 'Max agent turns', parseInt)
  .option('--system <text>', 'Extra system prompt text')
  .option('--verbose', 'Enable verbose output (tool I/O, token counts)')
  .option('--json', 'Output events as JSON lines')
  .option('--disable-tools <list>', 'Comma-separated list of tools to disable')
  .action(async (goal: string, opts: Record<string, unknown>) => {
    await runCommand(goal, {
      provider: opts['provider'] as ProviderName | undefined,
      model: opts['model'] as string | undefined,
      dir: opts['dir'] as string | undefined,
      maxTokens: opts['maxTokens'] as number | undefined,
      maxTurns: opts['maxTurns'] as number | undefined,
      system: opts['system'] as string | undefined,
      verbose: opts['verbose'] as boolean | undefined,
      json: opts['json'] as boolean | undefined,
      noTools: opts['disableTools'] as string | undefined,
    });
  });

program
  .command('resume')
  .description('Resume a paused session')
  .argument('<session-id>', 'Session ID to resume')
  .option('--json', 'Output events as JSON lines')
  .option('--max-turns <n>', 'Max agent turns', parseInt)
  .action(async (sessionId: string, opts: Record<string, unknown>) => {
    await resumeCommand(sessionId, {
      json: opts['json'] as boolean | undefined,
      maxTurns: opts['maxTurns'] as number | undefined,
    });
  });

program
  .command('sessions')
  .description('List recent sessions')
  .option('-n, --limit <n>', 'Number of sessions', parseInt)
  .option('--json', 'Output as JSON')
  .action((opts: Record<string, unknown>) => {
    sessionsCommand({
      limit: opts['limit'] as number | undefined,
      json: opts['json'] as boolean | undefined,
    });
  });

program
  .command('cost')
  .description('Show usage and cost')
  .option('-s, --session <id>', 'Show cost for specific session')
  .option('--since <duration>', 'Filter usage since (e.g. 7d, 24h)')
  .option('--json', 'Output as JSON')
  .action((opts: Record<string, unknown>) => {
    costCommand({
      session: opts['session'] as string | undefined,
      since: opts['since'] as string | undefined,
      json: opts['json'] as boolean | undefined,
    });
  });

const configCmd = program
  .command('config')
  .description('Manage configuration');

configCmd
  .command('get')
  .description('Show current configuration')
  .option('--json', 'Output as JSON')
  .action((opts: Record<string, unknown>) => {
    configGetCommand({ json: opts['json'] as boolean | undefined });
  });

configCmd
  .command('set')
  .description('Set a configuration value')
  .argument('<key>', 'Config key (provider, model, maxTokens, maxTurns)')
  .argument('<value>', 'New value')
  .action((key: string, value: string) => {
    configSetCommand(key, value);
  });

program.parse();
