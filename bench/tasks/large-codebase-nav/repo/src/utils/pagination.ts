export interface PaginationParams { page: number; limit: number; }
export function getOffset(params: PaginationParams): number {
  return (params.page - 1) * params.limit;
}
