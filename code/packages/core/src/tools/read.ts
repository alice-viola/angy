import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Tool, ToolContext, ToolResult, ToolDefinition } from '../types.js';

const definition: ToolDefinition = {
  name: 'Read',
  description: 'Read a file and return its contents with line numbers.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path to the file to read' },
      offset: { type: 'number', description: 'Line number to start reading from (1-based)' },
      limit: { type: 'number', description: 'Maximum number of lines to return' },
    },
    required: ['file_path'],
  },
};

async function execute(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    const filePath = path.resolve(ctx.workingDir, input.file_path as string);
    const content = await fs.readFile(filePath, 'utf-8');
    let lines = content.split('\n');

    const offset = input.offset as number | undefined;
    const limit = input.limit as number | undefined;

    // Apply offset (1-based: offset=5 means start at line 5, skip first 4)
    const startIndex = offset !== undefined && offset > 1 ? offset - 1 : 0;
    if (startIndex > 0) {
      lines = lines.slice(startIndex);
    }

    // Apply limit
    if (limit !== undefined && limit > 0) {
      lines = lines.slice(0, limit);
    }

    const totalLines = content.split('\n').length;
    const lineNumberStart = startIndex + 1;
    const lineNumberEnd = lineNumberStart + lines.length - 1;
    const numbered = lines
      .map((line, i) => `${String(lineNumberStart + i).padStart(6)}\t${line}`)
      .join('\n');

    const header = `[Lines ${lineNumberStart}-${lineNumberEnd} of ${totalLines}]\n`;

    ctx.filesRead.add(filePath);
    return { content: header + numbered, is_error: false };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: `Error: ${msg}`, is_error: true };
  }
}

export const readTool: Tool = { definition, execute };
