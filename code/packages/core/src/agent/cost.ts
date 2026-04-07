// Per-million-token pricing in USD
const PRICING: Record<string, { input: number; output: number; cacheWrite?: number; cacheRead?: number }> = {
  // Anthropic
  'claude-opus-4-6': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4, cacheWrite: 1.0, cacheRead: 0.08 },
  // Gemini (implicit caching — no write cost, read at 25% of input price)
  'gemini-2.0-pro': { input: 1.25, output: 10, cacheRead: 0.3125 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4, cacheRead: 0.025 },
  'gemini-1.5-pro': { input: 1.25, output: 5, cacheRead: 0.3125 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3, cacheRead: 0.01875 },
  'gemini-3-flash-preview': { input: 0.5, output: 3, cacheRead: 0.125 },
};

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationInputTokens?: number,
  cacheReadInputTokens?: number,
): number | undefined {
  const pricing = PRICING[model];
  if (!pricing) return undefined;

  const cacheWrite = cacheCreationInputTokens ?? 0;
  const cacheRead = cacheReadInputTokens ?? 0;

  // Non-cached input tokens = total input - cache write - cache read
  const standardInput = Math.max(0, inputTokens - cacheWrite - cacheRead);

  return (
    standardInput * pricing.input +
    cacheWrite * (pricing.cacheWrite ?? pricing.input) +
    cacheRead * (pricing.cacheRead ?? pricing.input) +
    outputTokens * pricing.output
  ) / 1_000_000;
}
