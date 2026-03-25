export function rateLimitMiddleware(maxRequests: number, windowMs: number) {
  return (req: unknown, res: unknown, next: () => void) => { next(); };
}
