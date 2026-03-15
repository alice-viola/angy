import { vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(null),
}));

vi.mock('@tauri-apps/api/path', () => ({
  homeDir: vi.fn().mockResolvedValue('/home/test'),
  appDataDir: vi.fn().mockResolvedValue('/tmp/angy-test'),
  join: vi.fn((...parts: string[]) => parts.join('/')),
}));

vi.mock('@tauri-apps/plugin-shell', () => ({
  Command: { create: vi.fn() },
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn().mockResolvedValue(false),
  mkdir: vi.fn().mockResolvedValue(undefined),
  readTextFile: vi.fn().mockResolvedValue(''),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  readDir: vi.fn().mockResolvedValue([]),
  remove: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/plugin-sql', () => {
  const mockDb = {
    execute: vi.fn().mockResolvedValue(undefined),
    select: vi.fn().mockResolvedValue([]),
  };
  return { default: { load: vi.fn().mockResolvedValue(mockDb) } };
});
