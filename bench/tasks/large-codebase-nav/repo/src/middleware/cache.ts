export function cacheMiddleware(ttlSeconds: number) {
  return (req: unknown, res: unknown, next: () => void) => { next(); };
}
