export type MiddlewareFn = (req: unknown, res: unknown, next: () => void) => void;
export interface MiddlewareConfig { enabled: boolean; options: Record<string, unknown>; }
