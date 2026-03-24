export function serialize(data: unknown): string {
  return JSON.stringify(data);
}
export function deserialize<T>(raw: string): T {
  return JSON.parse(raw) as T;
}
