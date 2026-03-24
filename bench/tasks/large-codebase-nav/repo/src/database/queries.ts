export function buildSelectQuery(table: string, where: Record<string, unknown>): string {
  const conditions = Object.keys(where).map((k, i) => `${k} = $${i + 1}`).join(' AND ');
  return `SELECT * FROM ${table} WHERE ${conditions}`;
}
