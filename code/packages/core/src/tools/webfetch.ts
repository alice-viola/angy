import type { Tool, ToolResult, ToolDefinition } from '../types.js';

const MAX_OUTPUT = 50_000;

const definition: ToolDefinition = {
  name: 'WebFetch',
  description: 'Fetch a URL and return its content with HTML tags stripped.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to fetch' },
    },
    required: ['url'],
  },
};

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + '\n… (truncated)';
}

async function execute(input: Record<string, unknown>): Promise<ToolResult> {
  try {
    const url = input.url as string;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'AngyCode/0.1' },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return {
        content: `Error: HTTP ${response.status} ${response.statusText}`,
        is_error: true,
      };
    }

    const text = await response.text();
    const contentType = response.headers.get('content-type') ?? '';
    const isHtml = contentType.includes('html');

    const content = isHtml ? stripHtml(text) : text;
    return { content: truncate(content, MAX_OUTPUT), is_error: false };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: `Error: ${msg}`, is_error: true };
  }
}

export const webfetchTool: Tool = { definition, execute };
