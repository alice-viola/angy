import { describe, it, expect } from 'vitest';
import { ToolRegistryImpl } from '../registry.js';
import type { Tool, ToolResult } from '../../types.js';

function makeTool(name: string): Tool {
  return {
    definition: { name, description: `${name} tool`, inputSchema: { type: 'object' } },
    async execute(): Promise<ToolResult> {
      return { content: 'ok', is_error: false };
    },
  };
}

describe('ToolRegistryImpl', () => {
  it('registers and retrieves a tool', () => {
    const reg = new ToolRegistryImpl();
    const tool = makeTool('Read');
    reg.register(tool);
    expect(reg.get('Read')).toBe(tool);
  });

  it('returns undefined for unknown tool', () => {
    const reg = new ToolRegistryImpl();
    expect(reg.get('Unknown')).toBeUndefined();
  });

  it('lists all tools', () => {
    const reg = new ToolRegistryImpl();
    reg.register(makeTool('Read'));
    reg.register(makeTool('Write'));
    expect(reg.all()).toHaveLength(2);
  });

  it('returns tool names', () => {
    const reg = new ToolRegistryImpl();
    reg.register(makeTool('Read'));
    reg.register(makeTool('Bash'));
    expect(reg.names()).toEqual(['Read', 'Bash']);
  });

  it('lists tool definitions', () => {
    const reg = new ToolRegistryImpl();
    reg.register(makeTool('Read'));
    const defs = reg.list();
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('Read');
  });

  it('has() returns true for registered tools', () => {
    const reg = new ToolRegistryImpl();
    reg.register(makeTool('Read'));
    expect(reg.has('Read')).toBe(true);
    expect(reg.has('Nope')).toBe(false);
  });

  it('overwrites tool with same name', () => {
    const reg = new ToolRegistryImpl();
    const tool1 = makeTool('Read');
    const tool2 = makeTool('Read');
    reg.register(tool1);
    reg.register(tool2);
    expect(reg.get('Read')).toBe(tool2);
    expect(reg.all()).toHaveLength(1);
  });
});
