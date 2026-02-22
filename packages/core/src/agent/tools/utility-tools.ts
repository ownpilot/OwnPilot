/**
 * Utility Tools — Aggregation Module
 *
 * Re-exports all utility tool definitions and executors from focused sub-modules:
 * - utility-date-tools:  Date/time, date diff, date add
 * - utility-math-tools:  Calculations, unit conversions, statistics
 * - utility-text-tools:  Text counting, extraction, transformation, comparison, regex
 * - utility-gen-tools:   UUID, password, random number, hashing, encoding
 * - utility-data-tools:  Validation, JSON, CSV, arrays, system info
 */

import type { ToolDefinition, ToolExecutor } from '../types.js';

// =============================================================================
// AGGREGATION ARRAY
// Individual tools are NOT re-exported here — import directly from source files
// (utility-date-tools, utility-math-tools, utility-text-tools, etc.)
// =============================================================================

import {
  getCurrentDateTimeTool as _dt,
  getCurrentDateTimeExecutor as _dte,
  dateDiffTool as _dd,
  dateDiffExecutor as _dde,
  dateAddTool as _da,
  dateAddExecutor as _dae,
} from './utility-date-tools.js';

import {
  calculateTool as _calc,
  calculateExecutor as _calce,
  convertUnitsTool as _cu,
  convertUnitsExecutor as _cue,
  calculateStatisticsTool as _cs,
  calculateStatisticsExecutor as _cse,
} from './utility-math-tools.js';

import {
  countTextTool as _ct,
  countTextExecutor as _cte,
  extractFromTextTool as _ef,
  extractFromTextExecutor as _efe,
  transformTextTool as _tt,
  transformTextExecutor as _tte,
  compareTextTool as _cmp,
  compareTextExecutor as _cmpe,
  runRegexTool as _rr,
  runRegexExecutor as _rre,
} from './utility-text-tools.js';

import {
  generateUuidTool as _gu,
  generateUuidExecutor as _gue,
  generatePasswordTool as _gp,
  generatePasswordExecutor as _gpe,
  generateRandomNumberTool as _gr,
  generateRandomNumberExecutor as _gre,
  hashTextTool as _ht,
  hashTextExecutor as _hte,
  encodeDecodeTool as _ed,
  encodeDecodeExecutor as _ede,
} from './utility-gen-tools.js';

import {
  validateDataTool as _vd,
  validateDataExecutor as _vde,
  formatJsonTool as _fj,
  formatJsonExecutor as _fje,
  parseCsvTool as _pc,
  parseCsvExecutor as _pce,
  generateCsvTool as _gc,
  generateCsvExecutor as _gce,
  arrayOperationsTool as _ao,
  arrayOperationsExecutor as _aoe,
  getSystemInfoTool as _si,
  getSystemInfoExecutor as _sie,
} from './utility-data-tools.js';

export const UTILITY_TOOLS: Array<{ definition: ToolDefinition; executor: ToolExecutor }> = [
  // Date/Time
  { definition: _dt, executor: _dte },
  { definition: _dd, executor: _dde },
  { definition: _da, executor: _dae },
  // Calculation & Statistics
  { definition: _calc, executor: _calce },
  { definition: _cs, executor: _cse },
  // Unit Conversion
  { definition: _cu, executor: _cue },
  // Random Generation
  { definition: _gu, executor: _gue },
  { definition: _gp, executor: _gpe },
  { definition: _gr, executor: _gre },
  // Encoding/Hashing
  { definition: _ht, executor: _hte },
  { definition: _ed, executor: _ede },
  // Text Utilities
  { definition: _ct, executor: _cte },
  { definition: _ef, executor: _efe },
  { definition: _tt, executor: _tte },
  { definition: _cmp, executor: _cmpe },
  { definition: _rr, executor: _rre },
  // Data Processing
  { definition: _fj, executor: _fje },
  { definition: _pc, executor: _pce },
  { definition: _gc, executor: _gce },
  { definition: _ao, executor: _aoe },
  // Validation
  { definition: _vd, executor: _vde },
  // System
  { definition: _si, executor: _sie },
];

export const UTILITY_TOOL_NAMES = UTILITY_TOOLS.map((t) => t.definition.name);
