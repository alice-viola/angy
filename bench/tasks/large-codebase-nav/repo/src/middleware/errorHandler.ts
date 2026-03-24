export function errorHandler(err: Error, req: unknown, res: unknown, next: () => void): void {
  console.error(err.message);
  next();
}
