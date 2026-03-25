export interface HealthCheckResult {
  service: string;
  status: 'healthy' | 'degraded' | 'down';
  latencyMs: number;
}
