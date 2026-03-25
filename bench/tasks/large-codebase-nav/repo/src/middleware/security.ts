export function securityHeaders(req: unknown, res: unknown, next: () => void): void {
  next();
}
export function sanitizeInput(input: string): string {
  return input.replace(/<[^>]*>/g, '');
}
