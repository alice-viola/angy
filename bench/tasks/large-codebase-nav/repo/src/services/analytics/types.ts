export interface AnalyticsEvent {
  name: string;
  timestamp: Date;
  properties: Record<string, unknown>;
}
