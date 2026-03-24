export function requireAuth(req: unknown, res: unknown, next: () => void): void {
  next();
}
export function requireRole(role: string) {
  return (req: unknown, res: unknown, next: () => void) => { next(); };
}
