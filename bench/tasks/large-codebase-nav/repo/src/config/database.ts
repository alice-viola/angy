export interface DatabaseConfig { host: string; port: number; name: string; }
export function getDatabaseConfig(): DatabaseConfig {
  return { host: 'localhost', port: 5432, name: 'app' };
}
