export class LoggingService {
  info(message: string, meta?: Record<string, unknown>): void {}
  warn(message: string, meta?: Record<string, unknown>): void {}
  error(message: string, error?: Error): void {}
}
