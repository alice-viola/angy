export type SortDirection = 'asc' | 'desc';
export function buildSortClause(field: string, direction: SortDirection): string {
  return `${field} ${direction.toUpperCase()}`;
}
