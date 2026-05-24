/**
 * Dynamic Tools System
 *
 * Allows LLM to create, register, and execute custom tools at runtime.
 * Tools are stored in the database and executed in a sandboxed environment.
 *
 * This barrel re-exports the surface consumed by the gateway through
 * `tools/index.ts`. Submodules (permissions, sandbox, executor) are imported
 * directly from their files everywhere else; they used to live here as
 * back-compat re-exports but no callers remain.
 */

// Types
export type {
  DynamicToolPermission,
  DynamicToolDefinition,
  DynamicToolRegistry,
} from './dynamic-tool-types.js';

// Registry
export { createDynamicToolRegistry } from './dynamic-tool-registry.js';

// Tool definitions
export {
  createToolDefinition,
  listToolsDefinition,
  deleteToolDefinition,
  toggleToolDefinition,
  searchToolsDefinition,
  getToolHelpDefinition,
  useToolDefinition,
  batchUseToolDefinition,
  DYNAMIC_TOOL_DEFINITIONS,
  DYNAMIC_TOOL_NAMES,
} from './dynamic-tool-defs.js';
