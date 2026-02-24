/**
 * Dynamic Tools System
 *
 * Allows LLM to create, register, and execute custom tools at runtime.
 * Tools are stored in the database and executed in a sandboxed environment.
 *
 * This barrel module re-exports from focused sub-modules for backward compatibility.
 */

// Types
export type {
  DynamicToolPermission,
  RequiredConfigService,
  DynamicToolDefinition,
  DynamicToolRegistry,
} from './dynamic-tool-types.js';

// Permissions & URL validation
export { isToolCallAllowed, isPrivateUrl } from './dynamic-tool-permissions.js';

// Sandbox utilities
export {
  createSafeFetch,
  assertInputSize,
  assertArraySize,
  mapPermissions,
  createSandboxUtils,
} from './dynamic-tool-sandbox.js';

// Executor
export { executeDynamicTool } from './dynamic-tool-executor.js';

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
  inspectToolSourceDefinition,
  updateCustomToolDefinition,
  DYNAMIC_TOOL_DEFINITIONS,
  DYNAMIC_TOOL_NAMES,
} from './dynamic-tool-defs.js';
