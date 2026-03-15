import { ToolRegistryImpl } from './registry.js';
import { bashTool } from './bash.js';
import { readTool } from './read.js';
import { writeTool } from './write.js';
import { editTool } from './edit.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { thinkTool } from './think.js';
import { webfetchTool } from './webfetch.js';
import type { ToolRegistry } from '../types.js';

export { ToolRegistryImpl } from './registry.js';
export { bashTool } from './bash.js';
export { readTool } from './read.js';
export { writeTool } from './write.js';
export { editTool } from './edit.js';
export { globTool } from './glob.js';
export { grepTool } from './grep.js';
export { thinkTool } from './think.js';
export { webfetchTool } from './webfetch.js';

export function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistryImpl();
  registry.register(bashTool);
  registry.register(readTool);
  registry.register(writeTool);
  registry.register(editTool);
  registry.register(globTool);
  registry.register(grepTool);
  registry.register(thinkTool);
  registry.register(webfetchTool);
  return registry;
}
