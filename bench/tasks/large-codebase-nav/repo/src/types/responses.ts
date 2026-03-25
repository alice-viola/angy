export interface PaginatedResponse<T> { items: T[]; total: number; page: number; pageSize: number; }
export interface SuccessResponse { success: boolean; message?: string; }
