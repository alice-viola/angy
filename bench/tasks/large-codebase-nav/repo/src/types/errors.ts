export class AppError extends Error {
  constructor(public code: string, message: string, public statusCode: number = 500) {
    super(message);
  }
}
export class NotFoundError extends AppError {
  constructor(resource: string) { super('NOT_FOUND', `${resource} not found`, 404); }
}
