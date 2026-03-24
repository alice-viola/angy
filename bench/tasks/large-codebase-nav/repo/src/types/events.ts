export interface DomainEvent { type: string; payload: unknown; timestamp: Date; }
export type EventHandler = (event: DomainEvent) => Promise<void>;
