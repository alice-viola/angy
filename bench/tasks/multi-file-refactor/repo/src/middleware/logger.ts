export function loggerMiddleware(req: { method: string; path: string }): void {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
}
