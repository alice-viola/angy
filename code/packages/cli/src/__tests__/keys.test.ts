import { describe, it, expect, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';

// Must use vi.mock for ESM modules
let mockReadFileSync: (() => string) | null = null;

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    readFileSync: (...args: unknown[]) => {
      if (mockReadFileSync) return mockReadFileSync();
      return (actual.readFileSync as Function)(...args);
    },
  };
});

import { resolveApiKey, getKeyFilePath } from '../keys.js';

describe('resolveApiKey', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    mockReadFileSync = null;
  });

  it('resolves from environment variable for anthropic', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test-123';
    expect(resolveApiKey('anthropic')).toBe('sk-test-123');
  });

  it('resolves from environment variable for gemini', () => {
    process.env['GEMINI_API_KEY'] = 'gem-test-456';
    expect(resolveApiKey('gemini')).toBe('gem-test-456');
  });

  it('throws when no key found', () => {
    delete process.env['ANTHROPIC_API_KEY'];
    mockReadFileSync = () => {
      throw new Error('ENOENT');
    };
    expect(() => resolveApiKey('anthropic')).toThrow('No API key found');
  });

  it('resolves from key file when env not set', () => {
    delete process.env['ANTHROPIC_API_KEY'];
    mockReadFileSync = () => '# API Keys\nANTHROPIC_API_KEY=sk-from-file\nGEMINI_API_KEY=gem-from-file\n';
    expect(resolveApiKey('anthropic')).toBe('sk-from-file');
  });

  it('prefers env over file', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-from-env';
    mockReadFileSync = () => 'ANTHROPIC_API_KEY=sk-from-file\n';
    expect(resolveApiKey('anthropic')).toBe('sk-from-env');
  });

  it('skips comment and empty lines in key file', () => {
    delete process.env['GEMINI_API_KEY'];
    mockReadFileSync = () => '\n# comment\n\nGEMINI_API_KEY=gem-key\n';
    expect(resolveApiKey('gemini')).toBe('gem-key');
  });

  it('getKeyFilePath returns expected path', () => {
    const expected = path.join(os.homedir(), '.angy', '.llm');
    expect(getKeyFilePath()).toBe(expected);
  });
});
