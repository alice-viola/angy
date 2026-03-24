type Listener = (...args: unknown[]) => void;
export class EventBus {
  private listeners = new Map<string, Listener[]>();
  on(event: string, fn: Listener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), fn]);
  }
  emit(event: string, ...args: unknown[]): void {
    (this.listeners.get(event) ?? []).forEach(fn => fn(...args));
  }
}
