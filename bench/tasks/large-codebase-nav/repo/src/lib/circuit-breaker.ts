export class CircuitBreaker {
  private failures = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  constructor(private threshold: number = 5) {}
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') throw new Error('Circuit is open');
    try { const result = await fn(); this.failures = 0; return result; }
    catch (e) { this.failures++; if (this.failures >= this.threshold) this.state = 'open'; throw e; }
  }
}
