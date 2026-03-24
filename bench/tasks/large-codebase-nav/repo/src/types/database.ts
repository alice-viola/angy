export interface QueryResult<T> { rows: T[]; rowCount: number; }
export interface ConnectionOptions { host: string; port: number; database: string; ssl: boolean; }
