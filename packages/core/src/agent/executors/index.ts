/**
 * Core Tool Executors — Barrel
 *
 * Imports all category executor objects and combines them into a single
 * CORE_EXECUTORS export. Definitions (schemas) are in core-tool-defs.ts.
 */

import type { ToolExecutor } from '../types.js';
import { TIME_EXECUTORS } from './time-tools.js';
import { FILE_EXECUTORS } from './file-tools.js';
import { TEXT_EXECUTORS } from './text-tools.js';
import { CONVERSION_EXECUTORS } from './conversion-tools.js';
import { GENERATOR_EXECUTORS } from './generator-tools.js';
import { DATA_EXECUTORS } from './data-tools.js';
import { STRING_EXECUTORS } from './string-tools.js';
import { RESOURCE_EXECUTORS } from './resource-tools.js';

/**
 * Core tool executors
 */
export const CORE_EXECUTORS: Record<string, ToolExecutor> = {
  ...TIME_EXECUTORS,
  ...FILE_EXECUTORS,
  ...TEXT_EXECUTORS,
  ...CONVERSION_EXECUTORS,
  ...GENERATOR_EXECUTORS,
  ...DATA_EXECUTORS,
  ...STRING_EXECUTORS,
  ...RESOURCE_EXECUTORS,
};

// Re-export category objects for consumers that need subsets
export {
  TIME_EXECUTORS,
  FILE_EXECUTORS,
  TEXT_EXECUTORS,
  CONVERSION_EXECUTORS,
  GENERATOR_EXECUTORS,
  DATA_EXECUTORS,
  STRING_EXECUTORS,
  RESOURCE_EXECUTORS,
};
