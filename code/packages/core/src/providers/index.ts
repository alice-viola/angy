import type { ProviderConfig, ProviderAdapter } from '../types.js';
import { AnthropicAdapter } from './anthropic.js';
import { GeminiAdapter } from './gemini.js';

export { AnthropicAdapter } from './anthropic.js';
export { GeminiAdapter } from './gemini.js';
export { toAnthropicMessages } from './anthropic.js';
export { toGeminiContents, toGeminiSchema } from './gemini.js';

export function createProvider(config: ProviderConfig): ProviderAdapter {
  switch (config.name) {
    case 'anthropic':
      return new AnthropicAdapter({ apiKey: config.apiKey });
    case 'gemini':
      return new GeminiAdapter({ apiKey: config.apiKey });
    default:
      throw new Error(`Unknown provider: ${config.name as string}`);
  }
}
