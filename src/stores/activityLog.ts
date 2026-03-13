import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ActivityLogEntry, ActivityLogLevel } from '@/engine/KosTypes';
import { getDatabase } from './sessions';

export const useActivityLogStore = defineStore('activityLog', () => {
  const entries = ref<ActivityLogEntry[]>([]);
  const maxInMemory = 200;

  async function load(): Promise<void> {
    const db = getDatabase();
    entries.value = await db.loadActivityLog(maxInMemory);
  }

  async function append(
    projectId: string,
    level: ActivityLogLevel,
    message: string,
    epicId?: string | null,
    sessionId?: string | null,
  ): Promise<void> {
    const entry: Omit<ActivityLogEntry, 'id'> = {
      projectId,
      epicId: epicId ?? null,
      sessionId: sessionId ?? null,
      level,
      message,
      timestamp: new Date().toISOString(),
    };

    const db = getDatabase();
    await db.appendActivityLog(entry);

    // Add to in-memory list (newest first)
    entries.value.unshift({ ...entry, id: Date.now() });
    if (entries.value.length > maxInMemory) {
      entries.value = entries.value.slice(0, maxInMemory);
    }
  }

  return {
    entries,
    load,
    append,
  };
});
