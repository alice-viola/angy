export function validateBody(schema: Record<string, unknown>) {
  return (req: unknown, res: unknown, next: () => void) => { next(); };
}
