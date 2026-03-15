import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import { configGetCommand, configSetCommand } from '../commands/config.js';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

describe('config commands', () => {
  let output: string;

  beforeEach(() => {
    output = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output += String(chunk);
      return true;
    });
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('config get shows current config', () => {
    configGetCommand({});
    expect(output).toContain('provider: anthropic');
    expect(output).toContain('model: claude-opus-4-6');
    expect(output).toContain('maxTokens: 8192');
    expect(output).toContain('maxTurns: 200');
  });

  it('config get --json outputs JSON', () => {
    configGetCommand({ json: true });
    const parsed = JSON.parse(output);
    expect(parsed.provider).toBe('anthropic');
  });

  it('config set updates a value', () => {
    configSetCommand('model', 'claude-opus-4-6');
    expect(output).toContain('Updated model');
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it('config set rejects invalid key', () => {
    expect(() => configSetCommand('invalid', 'value')).toThrow('Invalid config key');
  });

  it('config set validates provider', () => {
    expect(() => configSetCommand('provider', 'openai')).toThrow('Invalid provider');
  });

  it('config set validates numeric fields', () => {
    expect(() => configSetCommand('maxTokens', 'abc')).toThrow('positive integer');
  });
});
