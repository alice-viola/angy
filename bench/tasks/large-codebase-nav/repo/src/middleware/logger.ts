export function loggerMiddleware(req: unknown, res: unknown, next: () => void): void {
  const start = Date.now();
  next();
}
