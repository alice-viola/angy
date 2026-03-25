export function formatLogEntry(level: string, message: string, timestamp: Date): string {
  return `[${timestamp.toISOString()}] ${level.toUpperCase()}: ${message}`;
}
