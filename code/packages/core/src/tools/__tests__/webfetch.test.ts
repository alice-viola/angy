import { describe, it, expect, vi, beforeEach } from 'vitest';
import { webfetchTool } from '../webfetch.js';
import type { ToolContext, AgentEvent } from '../../types.js';

const ctx: ToolContext = {
  workingDir: '/tmp',
  sessionId: 'test',
  filesRead: new Set(),
  emit: (_e: AgentEvent) => {},
};

describe('WebFetch tool', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches and returns text content', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => 'plain text response',
        headers: new Map([['content-type', 'text/plain']]),
      }),
    );

    const result = await webfetchTool.execute({ url: 'https://example.com/api' }, ctx);
    expect(result.is_error).toBe(false);
    expect(result.content).toBe('plain text response');
  });

  it('strips HTML tags', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => '<html><body><h1>Title</h1><p>Text</p></body></html>',
        headers: new Map([['content-type', 'text/html']]),
      }),
    );

    const result = await webfetchTool.execute({ url: 'https://example.com' }, ctx);
    expect(result.is_error).toBe(false);
    expect(result.content).toContain('Title');
    expect(result.content).toContain('Text');
    expect(result.content).not.toContain('<h1>');
    expect(result.content).not.toContain('<p>');
  });

  it('strips script and style tags', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          '<html><script>alert("xss")</script><style>.a{}</style><p>Content</p></html>',
        headers: new Map([['content-type', 'text/html']]),
      }),
    );

    const result = await webfetchTool.execute({ url: 'https://example.com' }, ctx);
    expect(result.content).not.toContain('alert');
    expect(result.content).not.toContain('.a{}');
    expect(result.content).toContain('Content');
  });

  it('returns error for HTTP errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      }),
    );

    const result = await webfetchTool.execute({ url: 'https://example.com/missing' }, ctx);
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('404');
  });

  it('catches fetch errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

    const result = await webfetchTool.execute({ url: 'https://example.com' }, ctx);
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('network error');
  });

  it('truncates long responses', async () => {
    const longText = 'x'.repeat(60_000);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => longText,
        headers: new Map([['content-type', 'text/plain']]),
      }),
    );

    const result = await webfetchTool.execute({ url: 'https://example.com' }, ctx);
    expect(result.content.length).toBeLessThan(55_000);
    expect(result.content).toContain('… (truncated)');
  });

  it('has correct definition', () => {
    expect(webfetchTool.definition.name).toBe('WebFetch');
  });
});
