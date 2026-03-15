import mitt, { type Emitter } from 'mitt';
import type { AgentEvent } from './types.js';

type Events = { event: AgentEvent };

export const createEventBus = (): Emitter<Events> =>
  (mitt as unknown as <T extends Record<string, unknown>>() => Emitter<T>)<Events>();

export type EventBus = Emitter<Events>;
