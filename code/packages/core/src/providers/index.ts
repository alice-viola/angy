import type { ProviderConfig, ProviderAdapter } from '../types.js';
import { AnthropicAdapter } from './anthropic.js';
import { GeminiAdapter } from './gemini.js';
import { OllamaAdapter } from './ollama.js';
import { MockAdapter } from './mock.js';

export { AnthropicAdapter } from './anthropic.js';
export { GeminiAdapter } from './gemini.js';
export { OllamaAdapter } from './ollama.js';
export { MockAdapter } from './mock.js';
export { toAnthropicMessages } from './anthropic.js';
export { toGeminiContents, toGeminiSchema } from './gemini.js';
export { toOllamaMessages } from './ollama.js';

export function createProvider(config: ProviderConfig): ProviderAdapter {
  switch (config.name) {
    case 'anthropic':
      return new AnthropicAdapter({ apiKey: config.apiKey });
    case 'gemini':
      return new GeminiAdapter({ apiKey: config.apiKey });
    case 'ollama':
      return new OllamaAdapter({ baseUrl: config.apiKey || undefined });
    case 'mock':
      return new MockAdapter();
    default:
      throw new Error(`Unknown provider: ${config.name as string}`);
  }
}
