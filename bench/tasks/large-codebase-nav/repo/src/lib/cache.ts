export class CacheClient {
  private store = new Map<string, unknown>();
  async get(key: string): Promise<unknown | null> { return this.store.get(key) ?? null; }
  async set(key: string, value: unknown, ttl?: number): Promise<void> { this.store.set(key, value); }
  async del(key: string): Promise<void> { this.store.delete(key); }
}
