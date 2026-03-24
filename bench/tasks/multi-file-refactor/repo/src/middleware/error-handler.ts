export interface AppError {
  status: number;
  code: string;
  message: string;
}

export function createError(status: number, code: string, message: string): AppError {
  return { status, code, message };
}

export function isAppError(value: unknown): value is AppError {
  return typeof value === 'object' && value !== null && 'status' in value && 'code' in value;
}
