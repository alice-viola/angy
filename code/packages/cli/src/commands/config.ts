import { loadConfig, saveConfig, getConfigPath } from '../config.js';
import type { CliConfig } from '../config.js';
import type { ProviderName } from '@angycode/core';

export interface ConfigOptions {
  json?: boolean;
}

export function configGetCommand(opts: ConfigOptions): void {
  const config = loadConfig();
  if (opts.json) {
    process.stdout.write(JSON.stringify(config, null, 2) + '\n');
  } else {
    process.stdout.write(`Config: ${getConfigPath()}\n`);
    for (const [key, value] of Object.entries(config)) {
      process.stdout.write(`  ${key}: ${String(value)}\n`);
    }
  }
}

export function configSetCommand(key: string, value: string): void {
  const VALID_KEYS: (keyof CliConfig)[] = ['provider', 'model', 'maxTokens', 'maxTurns'];
  if (!VALID_KEYS.includes(key as keyof CliConfig)) {
    throw new Error(`Invalid config key: ${key}. Valid keys: ${VALID_KEYS.join(', ')}`);
  }

  let parsed: Partial<CliConfig>;
  if (key === 'provider') {
    if (value !== 'anthropic' && value !== 'gemini') {
      throw new Error(`Invalid provider: ${value}. Must be "anthropic" or "gemini".`);
    }
    parsed = { provider: value as ProviderName };
  } else if (key === 'maxTokens' || key === 'maxTurns') {
    const num = parseInt(value, 10);
    if (isNaN(num) || num <= 0) {
      throw new Error(`${key} must be a positive integer.`);
    }
    parsed = { [key]: num };
  } else {
    parsed = { [key]: value };
  }

  const result = saveConfig(parsed);
  process.stdout.write(`Updated ${key} = ${String(result[key as keyof CliConfig])}\n`);
}
