export class MetricsCollector {
  private counters = new Map<string, number>();
  increment(name: string): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + 1);
  }
  getAll(): Record<string, number> {
    return Object.fromEntries(this.counters);
  }
}
