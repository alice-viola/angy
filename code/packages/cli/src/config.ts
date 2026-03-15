import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { ProviderName } from '@angycode/core';

export interface CliConfig {
  provider: ProviderName;
  model: string;
  maxTokens: number;
  maxTurns: number;
}

const DEFAULTS: CliConfig = {
  provider: 'anthropic',
  model: 'claude-opus-4-6',
  maxTokens: 8192,
  maxTurns: 200,
};

const CONFIG_DIR = path.join(os.homedir(), '.angycode');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function loadConfig(): CliConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<CliConfig>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(updates: Partial<CliConfig>): CliConfig {
  const current = loadConfig();
  const merged = { ...current, ...updates };
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2) + '\n');
  return merged;
}

export function resolveConfig(cliFlags: Partial<CliConfig>): CliConfig {
  const fileConfig = loadConfig();
  return {
    provider: cliFlags.provider ?? fileConfig.provider ?? DEFAULTS.provider,
    model: cliFlags.model ?? fileConfig.model ?? DEFAULTS.model,
    maxTokens: cliFlags.maxTokens ?? fileConfig.maxTokens ?? DEFAULTS.maxTokens,
    maxTurns: cliFlags.maxTurns ?? fileConfig.maxTurns ?? DEFAULTS.maxTurns,
  };
}

export function getDefaults(): CliConfig {
  return { ...DEFAULTS };
}
