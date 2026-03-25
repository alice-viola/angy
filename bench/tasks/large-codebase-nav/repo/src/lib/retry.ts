export async function withRetry<T>(fn: () => Promise<T>, maxAttempts: number = 3, delayMs: number = 1000): Promise<T> {
  let lastError: Error | undefined;
  for (let i = 0; i < maxAttempts; i++) {
    try { return await fn(); } catch (e) { lastError = e as Error; }
  }
  throw lastError;
}
