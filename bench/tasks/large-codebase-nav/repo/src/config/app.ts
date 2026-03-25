export interface AppConfig { port: number; env: string; debug: boolean; }
export function getAppConfig(): AppConfig {
  return { port: 3000, env: 'development', debug: true };
}
