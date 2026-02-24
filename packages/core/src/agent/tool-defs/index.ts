/**
 * Core Tool Definitions — Barrel
 *
 * Imports all category definition arrays and combines them into a single
 * CORE_TOOLS export. Executors (implementations) are in executors/.
 */

import type { ToolDefinition } from '../types.js';
import { TIME_TOOL_DEFS } from './time-tools.js';
import { FILE_TOOL_DEFS } from './file-tools.js';
import { TEXT_TOOL_DEFS } from './text-tools.js';
import { CONVERSION_TOOL_DEFS } from './conversion-tools.js';
import { GENERATOR_TOOL_DEFS } from './generator-tools.js';
import { DATA_TOOL_DEFS } from './data-tools.js';
import { STRING_TOOL_DEFS } from './string-tools.js';
import { RESOURCE_TOOL_DEFS } from './resource-tools.js';

/**
 * Built-in core tools
 */
export const CORE_TOOLS: readonly ToolDefinition[] = [
  ...TIME_TOOL_DEFS,
  ...FILE_TOOL_DEFS,
  ...TEXT_TOOL_DEFS,
  ...CONVERSION_TOOL_DEFS,
  ...GENERATOR_TOOL_DEFS,
  ...DATA_TOOL_DEFS,
  ...STRING_TOOL_DEFS,
  ...RESOURCE_TOOL_DEFS,
];

// Re-export category arrays for consumers that need subsets
export {
  TIME_TOOL_DEFS,
  FILE_TOOL_DEFS,
  TEXT_TOOL_DEFS,
  CONVERSION_TOOL_DEFS,
  GENERATOR_TOOL_DEFS,
  DATA_TOOL_DEFS,
  STRING_TOOL_DEFS,
  RESOURCE_TOOL_DEFS,
};
