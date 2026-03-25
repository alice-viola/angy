export class AnalyticsRepository {
  async insertEvent(event: unknown): Promise<void> {}
  async aggregateByDate(metric: string, start: Date, end: Date): Promise<unknown[]> { return []; }
}
