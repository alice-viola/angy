import type { Tool, ToolResult, ToolDefinition } from '../types.js';

const definition: ToolDefinition = {
  name: 'Think',
  description: 'A no-op tool for the model to record its reasoning.',
  inputSchema: {
    type: 'object',
    properties: {
      thought: { type: 'string', description: 'The thought to record' },
    },
    required: ['thought'],
  },
};

async function execute(input: Record<string, unknown>): Promise<ToolResult> {
  return { content: input.thought as string, is_error: false };
}

export const thinkTool: Tool = { definition, execute };
