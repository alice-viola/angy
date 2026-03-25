export class AnalyticsService {
  async trackEvent(name: string, properties: Record<string, unknown>): Promise<void> {}
  async getMetrics(startDate: Date, endDate: Date): Promise<Record<string, number>> { return {}; }
}
