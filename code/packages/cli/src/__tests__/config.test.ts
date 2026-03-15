import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import { loadConfig, saveConfig, resolveConfig, getDefaults, getConfigPath } from '../config.js';

// Mock fs to avoid touching real filesystem
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

describe('config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loadConfig returns defaults when file not found', () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const config = loadConfig();
    expect(config).toEqual(getDefaults());
    expect(config.provider).toBe('anthropic');
    expect(config.model).toBe('claude-opus-4-6');
    expect(config.maxTokens).toBe(8192);
    expect(config.maxTurns).toBe(200);
  });

  it('loadConfig merges file config with defaults', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ provider: 'gemini', model: 'gemini-2.0-pro' }),
    );
    const config = loadConfig();
    expect(config.provider).toBe('gemini');
    expect(config.model).toBe('gemini-2.0-pro');
    expect(config.maxTokens).toBe(8192); // default
  });

  it('saveConfig writes merged config', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ provider: 'anthropic' }));
    const result = saveConfig({ model: 'claude-opus-4-6' });
    expect(result.model).toBe('claude-opus-4-6');
    expect(result.provider).toBe('anthropic');
    expect(fs.mkdirSync).toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it('resolveConfig gives CLI flags highest priority', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ provider: 'gemini', model: 'gemini-2.0-flash' }),
    );
    const config = resolveConfig({ model: 'override-model' });
    expect(config.model).toBe('override-model');
    expect(config.provider).toBe('gemini'); // from file
  });

  it('resolveConfig falls through to defaults', () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const config = resolveConfig({});
    expect(config).toEqual(getDefaults());
  });

  it('getConfigPath returns a path string', () => {
    expect(getConfigPath()).toContain('.angycode');
    expect(getConfigPath()).toContain('config.json');
  });
});
