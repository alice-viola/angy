export function corsMiddleware(req: unknown, res: unknown, next: () => void): void {
  next();
}
