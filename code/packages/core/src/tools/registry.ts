import type { Tool, ToolDefinition, ToolRegistry as IToolRegistry } from '../types.js';

export class ToolRegistryImpl implements IToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.definition.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  all(): Tool[] {
    return [...this.tools.values()];
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  list(): ToolDefinition[] {
    return this.all().map((t) => t.definition);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }
}
