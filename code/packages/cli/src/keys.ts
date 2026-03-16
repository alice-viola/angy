import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { ProviderName } from '@angycode/core';

const KEY_FILE = path.join(os.homedir(), '.angy', '.llm');

const ENV_VARS: Record<ProviderName, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  mock: 'MOCK_API_KEY',
};

export function resolveApiKey(provider: ProviderName): string {
  // 1. Environment variable
  const envVar = ENV_VARS[provider];
  const envValue = process.env[envVar];
  if (envValue) return envValue;

  // 2. ~/.angy/.llm file (KEY=VALUE format, one per line)
  try {
    const content = fs.readFileSync(KEY_FILE, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const rawValue = trimmed.slice(eqIdx + 1).trim();
      // Strip surrounding quotes (single or double)
      const value = rawValue.replace(/^['"](.*)['"]$/, '$1');
      if (key === envVar && value) return value;
    }
  } catch {
    // File doesn't exist — fall through
  }

  throw new Error(
    `No API key found for ${provider}. Set ${envVar} or add ${envVar}=<key> to ${KEY_FILE}`,
  );
}

export function getKeyFilePath(): string {
  return KEY_FILE;
}
