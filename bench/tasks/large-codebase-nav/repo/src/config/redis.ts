export interface RedisConfig { host: string; port: number; }
export function getRedisConfig(): RedisConfig {
  return { host: 'localhost', port: 6379 };
}
