const requestCounts: Map<string, number> = new Map();

export function rateLimitMiddleware(ip: string, maxRequests = 100): boolean {
  const count = requestCounts.get(ip) ?? 0;
  if (count >= maxRequests) return false;
  requestCounts.set(ip, count + 1);
  return true;
}

export function resetRateLimit(ip: string): void {
  requestCounts.delete(ip);
}
