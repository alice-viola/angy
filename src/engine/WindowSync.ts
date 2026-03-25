/**
 * Cross-window state synchronization via Tauri events.
 *
 * When a window mutates shared DB-backed state (projects, epics, scheduler config, etc.),
 * it calls `broadcastSync(channel)` to notify all other windows to re-read from the DB.
 * Each window registers reload handlers for the channels it cares about.
 *
 * This avoids polling and gives near-instant cross-window consistency.
 */

import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

/** Well-known sync channels */
export type SyncChannel =
  | 'projects'
  | 'epics'
  | 'sessions'
  | 'scheduler-config'
  | 'activity-log';

const TAURI_EVENT = 'angy:sync';

interface SyncMessage {
  channel: SyncChannel;
  source: string;
}

type ReloadHandler = () => void | Promise<void>;

const handlers = new Map<SyncChannel, ReloadHandler[]>();
let unlisten: UnlistenFn | null = null;

/**
 * Broadcast a sync event to all windows (including self).
 * Call this after writing shared state to the DB.
 */
export async function broadcastSync(channel: SyncChannel): Promise<void> {
  const label = getCurrentWindow().label;
  await emit(TAURI_EVENT, { channel, source: label } satisfies SyncMessage);
}

/**
 * Register a reload handler for a given channel.
 * The handler is called when *another* window changes that data.
 * Returns an unregister function.
 */
export function onSync(channel: SyncChannel, handler: ReloadHandler): () => void {
  if (!handlers.has(channel)) {
    handlers.set(channel, []);
  }
  handlers.get(channel)!.push(handler);

  return () => {
    const list = handlers.get(channel);
    if (list) {
      const idx = list.indexOf(handler);
      if (idx >= 0) list.splice(idx, 1);
    }
  };
}

/**
 * Start listening for cross-window sync events.
 * Call once during app mount.
 */
export async function startSyncListener(): Promise<void> {
  if (unlisten) return; // already listening

  const myLabel = getCurrentWindow().label;

  unlisten = await listen<SyncMessage>(TAURI_EVENT, async (event) => {
    const { channel, source } = event.payload;

    // Ignore events we emitted ourselves — our local state is already up-to-date
    if (source === myLabel) return;

    const list = handlers.get(channel);
    if (!list || list.length === 0) return;

    console.log(`[WindowSync] Received sync:${channel} from ${source}`);
    for (const handler of list) {
      try {
        await handler();
      } catch (err) {
        console.error(`[WindowSync] Handler error for ${channel}:`, err);
      }
    }
  });
}

/**
 * Stop listening and clear all handlers.
 * Call during app unmount.
 */
export function stopSyncListener(): void {
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
  handlers.clear();
}
