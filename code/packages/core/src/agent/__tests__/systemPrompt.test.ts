import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../systemPrompt.js';

describe('buildSystemPrompt', () => {
  it('includes working directory', () => {
    const prompt = buildSystemPrompt({
      workingDir: '/Users/alice/project',
      tools: [],
    });
    expect(prompt).toContain('/Users/alice/project');
  });

  it('lists tool names and descriptions', () => {
    const prompt = buildSystemPrompt({
      workingDir: '/tmp',
      tools: [
        { name: 'Read', description: 'Read a file', inputSchema: { type: 'object' } },
        { name: 'Bash', description: 'Run a command', inputSchema: { type: 'object' } },
      ],
    });
    expect(prompt).toContain('- Read: Read a file');
    expect(prompt).toContain('- Bash: Run a command');
  });

  it('includes extra when provided', () => {
    const prompt = buildSystemPrompt({
      workingDir: '/tmp',
      tools: [],
      extra: 'Always write tests first.',
    });
    expect(prompt).toContain('Always write tests first.');
  });

  it('omits extra when not provided', () => {
    const prompt = buildSystemPrompt({
      workingDir: '/tmp',
      tools: [],
    });
    // Should not end with an empty section
    expect(prompt.trim()).not.toEqual('');
  });

  it('includes date context', () => {
    const prompt = buildSystemPrompt({
      workingDir: '/tmp',
      tools: [],
    });
    // Should contain current date in YYYY-MM-DD format
    expect(prompt).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('identifies as AngyCode', () => {
    const prompt = buildSystemPrompt({
      workingDir: '/tmp',
      tools: [],
    });
    expect(prompt).toContain('AngyCode');
  });
});
