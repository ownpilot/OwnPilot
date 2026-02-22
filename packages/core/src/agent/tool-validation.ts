/**
 * Tool Call Validation
 *
 * Validates tool calls before execution:
 * - Tool existence check with fuzzy name matching (auto-correction)
 * - JSON Schema parameter validation
 * - Help text generation for LLM error recovery
 *
 * Zero external dependencies. Covers the JSONSchemaProperty subset used by OwnPilot.
 */

import type { ToolRegistry } from './tools.js';
import type { ToolDefinition } from './types.js';
import { TOOL_MAX_LIMITS } from './tools/tool-limits.js';

// =============================================================================
// Types
// =============================================================================

export interface ToolCallValidation {
  /** Whether the tool call is valid */
  valid: boolean;
  /** Auto-corrected tool name if original was not found (fuzzy match) */
  correctedName?: string;
  /** Validation errors */
  errors: ToolValidationError[];
  /** Full parameter docs for LLM recovery */
  helpText?: string;
}

export interface ToolValidationError {
  /** Path to the invalid value, e.g. "params.email" or "params.items[0].name" */
  path: string;
  /** Human-readable error message */
  message: string;
  /** Expected type or value */
  expected?: string;
  /** Actual type or value */
  received?: string;
}

/** Shape of a JSON Schema object stored in ToolDefinition.parameters */
interface ToolParameterSchema {
  properties?: Record<string, Record<string, unknown>>;
  required?: string[];
}

// =============================================================================
// JSON Schema Validation
// =============================================================================

/**
 * Validate a value against a JSON Schema property definition.
 * Covers the subset used by OwnPilot tools: type, required, enum, items,
 * properties, default. Returns an array of validation errors (empty = valid).
 */
export function validateAgainstSchema(
  value: unknown,
  schema: Record<string, unknown>,
  path: string = 'params'
): ToolValidationError[] {
  const errors: ToolValidationError[] = [];
  const type = schema.type as string | undefined;

  // Null/undefined checks
  if (value === undefined || value === null) {
    // Required is checked at the parent level, so skip here
    return errors;
  }

  // Type checking
  if (type) {
    const actualType = getJsonType(value);
    if (!isTypeMatch(actualType, type)) {
      errors.push({
        path,
        message: `${path}: expected ${type}, got ${actualType}`,
        expected: type,
        received: actualType,
      });
      return errors; // No point checking further if type is wrong
    }
  }

  // Enum validation
  if (Array.isArray(schema.enum)) {
    const enumValues = schema.enum as unknown[];
    if (!enumValues.includes(value)) {
      errors.push({
        path,
        message: `${path}: must be one of ${enumValues.map((v) => JSON.stringify(v)).join(', ')}`,
        expected: enumValues.map((v) => JSON.stringify(v)).join(' | '),
        received: JSON.stringify(value),
      });
    }
  }

  // Object property validation
  if (type === 'object' && typeof value === 'object' && value !== null && schema.properties) {
    const props = schema.properties as Record<string, Record<string, unknown>>;
    const required = new Set<string>((schema.required as string[]) || []);
    const obj = value as Record<string, unknown>;

    // Check required properties
    for (const reqProp of required) {
      if (obj[reqProp] === undefined || obj[reqProp] === null) {
        errors.push({
          path: `${path}.${reqProp}`,
          message: `${path}.${reqProp}: required but missing`,
          expected: (props[reqProp]?.type as string) || 'any',
          received: 'undefined',
        });
      }
    }

    // Validate each provided property
    for (const [propName, propValue] of Object.entries(obj)) {
      const propSchema = props[propName];
      if (propSchema) {
        errors.push(...validateAgainstSchema(propValue, propSchema, `${path}.${propName}`));
      }
    }
  }

  // Array items validation
  if (type === 'array' && Array.isArray(value) && schema.items) {
    const itemSchema = schema.items as Record<string, unknown>;
    for (let i = 0; i < value.length; i++) {
      errors.push(...validateAgainstSchema(value[i], itemSchema, `${path}[${i}]`));
    }
  }

  return errors;
}

/** Get the JSON type string for a value */
function getJsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'number' && Number.isInteger(value)) return 'integer';
  return t; // 'string' | 'number' | 'boolean' | 'object'
}

/** Check if an actual type matches the expected schema type */
function isTypeMatch(actual: string, expected: string): boolean {
  if (actual === expected) return true;
  // 'integer' is a valid 'number'
  if (expected === 'number' && actual === 'integer') return true;
  // 'number' can satisfy 'integer' if it's actually an integer
  if (expected === 'integer' && actual === 'number') return false;
  return false;
}

// =============================================================================
// Tool Call Validation Pipeline
// =============================================================================

/**
 * Full tool call validation:
 * 1. Tool existence check + fuzzy name auto-correction
 * 2. JSON Schema parameter validation
 * 3. Help text generation for recovery
 */
export function validateToolCall(
  registry: ToolRegistry,
  toolName: string,
  args: Record<string, unknown>
): ToolCallValidation {
  // Stage 1: Tool existence check
  let def = registry.getDefinition(toolName);

  if (!def) {
    // Try fuzzy matching
    const similar = findSimilarToolNames(registry, toolName, 5);

    if (similar.length > 0 && similar[0]) {
      // If top match is very close, auto-correct
      const topMatch = similar[0];
      const distance = levenshtein(toolName.toLowerCase(), topMatch.toLowerCase());
      const threshold = Math.max(2, Math.floor(toolName.length * 0.3));

      if (distance <= threshold) {
        // Auto-correct to closest match
        def = registry.getDefinition(topMatch);
        if (def) {
          // Validate params against the corrected tool
          const paramErrors = validateParams(def, args);
          return {
            valid: paramErrors.length === 0,
            correctedName: topMatch,
            errors: paramErrors,
            helpText: paramErrors.length > 0 ? buildToolHelpText(registry, topMatch) : undefined,
          };
        }
      }
    }

    // Tool not found, no auto-correction
    const suggestionsText = similar.length > 0 ? `\nDid you mean: ${similar.join(', ')}?` : '';
    return {
      valid: false,
      errors: [
        {
          path: 'tool_name',
          message: `Tool '${toolName}' not found.${suggestionsText}`,
          expected: 'valid tool name',
          received: toolName,
        },
      ],
    };
  }

  // Stage 2: Parameter validation
  const paramErrors = validateParams(def, args);

  if (paramErrors.length > 0) {
    return {
      valid: false,
      errors: paramErrors,
      helpText: buildToolHelpText(registry, toolName),
    };
  }

  return { valid: true, errors: [] };
}

/**
 * Validate parameters against a tool's JSON Schema definition.
 */
function validateParams(def: ToolDefinition, args: Record<string, unknown>): ToolValidationError[] {
  if (!def.parameters) return [];

  const schema = def.parameters as unknown as ToolParameterSchema;
  if (!schema.properties) return [];

  const errors: ToolValidationError[] = [];
  const required = new Set(schema.required || []);

  // Check required params
  for (const reqParam of required) {
    if (args[reqParam] === undefined || args[reqParam] === null) {
      const propSchema = schema.properties[reqParam];
      const expectedType = (propSchema?.type as string) || 'any';
      errors.push({
        path: `params.${reqParam}`,
        message: `Missing required parameter: ${reqParam} (${expectedType})`,
        expected: expectedType,
        received: 'undefined',
      });
    }
  }

  // Validate each provided param against its schema
  for (const [paramName, paramValue] of Object.entries(args)) {
    const propSchema = schema.properties[paramName];
    if (propSchema) {
      errors.push(...validateAgainstSchema(paramValue, propSchema, `params.${paramName}`));
    }
    // Unknown params are ignored (not an error) — tools often accept extra args
  }

  return errors;
}

// =============================================================================
// Fuzzy Tool Name Matching
// =============================================================================

/**
 * Find similar tool names via substring/fuzzy matching.
 * Returns up to `limit` suggestions sorted by relevance.
 */
export function findSimilarToolNames(
  registry: ToolRegistry,
  query: string,
  limit: number = 5
): string[] {
  const allDefs = registry.getDefinitions();
  const q = query.toLowerCase().replace(/[_.\-]/g, ' ');
  const qWords = q.split(/\s+/).filter(Boolean);

  const scored = allDefs
    .filter(
      (d) =>
        d.name !== 'search_tools' &&
        d.name !== 'get_tool_help' &&
        d.name !== 'use_tool' &&
        d.name !== 'batch_use_tool'
    )
    .map((d) => {
      const name = d.name.toLowerCase();
      const nameWords = name.replace(/[_.\-]/g, ' ');
      let score = 0;

      // Exact substring match in name
      if (name.includes(q.replace(/ /g, '_'))) score += 10;
      if (nameWords.includes(q)) score += 8;

      // Word-level matches
      for (const w of qWords) {
        if (name.includes(w)) score += 3;
        if (d.description.toLowerCase().includes(w)) score += 1;
      }

      // Shared prefix bonus
      const minLen = Math.min(q.length, name.length);
      let prefix = 0;
      for (let i = 0; i < minLen; i++) {
        if (q[i] === name[i]) prefix++;
        else break;
      }
      if (prefix >= 3) score += prefix;

      return { name: d.name, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map((s) => s.name);
}

/**
 * Simple Levenshtein distance for auto-correction threshold.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0) as number[]);

  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1]![j - 1]!
          : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }

  return dp[m]![n]!;
}

// =============================================================================
// Help Text Builders
// =============================================================================

/**
 * Recursively format a JSON Schema parameter for human-readable help output.
 * Handles nested objects, arrays with item schemas, enums, defaults.
 */
export function formatParamSchema(
  name: string,
  schema: Record<string, unknown>,
  requiredSet: Set<string>,
  indent: string = '  '
): string[] {
  const lines: string[] = [];
  const req = requiredSet.has(name) ? ' (REQUIRED)' : ' (optional)';
  const type = (schema.type as string) || 'any';
  const desc = schema.description ? ` — ${schema.description}` : '';
  const dflt = schema.default !== undefined ? ` [default: ${JSON.stringify(schema.default)}]` : '';

  if (Array.isArray(schema.enum)) {
    const enumVals = (schema.enum as string[]).map((v) => JSON.stringify(v)).join(' | ');
    lines.push(`${indent}• ${name}: ${enumVals}${req}${desc}${dflt}`);
  } else if (type === 'array') {
    const items = schema.items as Record<string, unknown> | undefined;
    if (items?.type === 'object' && items.properties) {
      // Array of objects — show nested structure
      lines.push(`${indent}• ${name}: array of objects${req}${desc}`);
      const itemProps = items.properties as Record<string, Record<string, unknown>>;
      const itemRequired = new Set<string>((items.required as string[]) || []);
      for (const [propName, propSchema] of Object.entries(itemProps)) {
        lines.push(...formatParamSchema(propName, propSchema, itemRequired, indent + '    '));
      }
    } else {
      const itemType = items ? (items.type as string) || 'any' : 'any';
      lines.push(`${indent}• ${name}: array of ${itemType}${req}${desc}${dflt}`);
    }
  } else if (type === 'object' && schema.properties) {
    // Nested object with defined properties
    lines.push(`${indent}• ${name}: object${req}${desc}`);
    const nestedProps = schema.properties as Record<string, Record<string, unknown>>;
    const nestedRequired = new Set<string>((schema.required as string[]) || []);
    for (const [propName, propSchema] of Object.entries(nestedProps)) {
      lines.push(...formatParamSchema(propName, propSchema, nestedRequired, indent + '    '));
    }
  } else {
    lines.push(`${indent}• ${name}: ${type}${req}${desc}${dflt}`);
  }

  return lines;
}

/**
 * Build a realistic example value for a parameter based on its JSON Schema.
 */
export function buildExampleValue(schema: Record<string, unknown>, name: string): unknown {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }
  const type = schema.type as string;
  if (type === 'array') {
    const items = schema.items as Record<string, unknown> | undefined;
    if (items?.type === 'object' && items.properties) {
      // Build one example item with its required fields
      const itemProps = items.properties as Record<string, Record<string, unknown>>;
      const itemRequired = new Set<string>((items.required as string[]) || []);
      const example: Record<string, unknown> = {};
      for (const [propName, propSchema] of Object.entries(itemProps)) {
        if (itemRequired.has(propName) || Object.keys(itemProps).length <= 3) {
          example[propName] = buildExampleValue(propSchema, propName);
        }
      }
      return [example];
    }
    return ['...'];
  }
  if (type === 'object') {
    if (schema.properties) {
      const nestedProps = schema.properties as Record<string, Record<string, unknown>>;
      const nestedRequired = new Set<string>((schema.required as string[]) || []);
      const example: Record<string, unknown> = {};
      for (const [propName, propSchema] of Object.entries(nestedProps)) {
        if (nestedRequired.has(propName)) {
          example[propName] = buildExampleValue(propSchema, propName);
        }
      }
      return example;
    }
    return {};
  }
  if (type === 'number' || type === 'integer') return 0;
  if (type === 'boolean') return true;
  // String — try to generate a meaningful placeholder
  if (name.includes('email') || name === 'to' || name === 'replyTo') return 'user@example.com';
  if (name.includes('path') || name.includes('file')) return '/path/to/file';
  if (name.includes('url') || name.includes('link')) return 'https://example.com';
  if (name.includes('date')) return '2025-01-01';
  if (name.includes('id')) return 'some-id';
  return '...';
}

/**
 * Build full tool help text for error recovery.
 * Includes description, parameters with nested schemas, and a ready-to-use example.
 */
export function buildToolHelpText(registry: ToolRegistry, toolName: string): string {
  const def = registry.getDefinition(toolName);
  if (!def?.parameters) return '';
  const params = def.parameters as unknown as ToolParameterSchema;
  if (!params.properties) return '';

  const requiredSet = new Set(params.required || []);
  const lines = [`\n\n--- TOOL HELP (${toolName}) ---`, def.description, '', 'Parameters:'];

  const exampleArgs: Record<string, unknown> = {};

  for (const [name, schema] of Object.entries(params.properties)) {
    lines.push(...formatParamSchema(name, schema, requiredSet));
    if (requiredSet.has(name)) {
      exampleArgs[name] = buildExampleValue(schema, name);
    }
  }

  lines.push('');
  lines.push(`Example: use_tool("${toolName}", ${JSON.stringify(exampleArgs)})`);
  lines.push('Fix your parameters and retry immediately.');
  return lines.join('\n');
}

/**
 * Build comprehensive help output for get_tool_help.
 * Richer than buildToolHelpText — includes ALL parameters (not just required) in example.
 */
export function formatFullToolHelp(registry: ToolRegistry, toolName: string): string {
  const def = registry.getDefinition(toolName);
  if (!def) return `Tool '${toolName}' not found.`;

  const params = def.parameters as unknown as ToolParameterSchema;

  const lines = [`## ${def.name}`, def.description, ''];

  if (!params?.properties || Object.keys(params.properties).length === 0) {
    lines.push('No parameters required.');
    lines.push('');
    lines.push('### Example');
    lines.push(`use_tool("${def.name}", {})`);
    return lines.join('\n');
  }

  const requiredSet = new Set(params.required || []);
  const requiredNames = Object.keys(params.properties).filter((n) => requiredSet.has(n));
  const optionalNames = Object.keys(params.properties).filter((n) => !requiredSet.has(n));

  // Required parameters first
  if (requiredNames.length > 0) {
    lines.push('### Required Parameters');
    for (const name of requiredNames) {
      lines.push(...formatParamSchema(name, params.properties[name]!, requiredSet));
    }
    lines.push('');
  }

  // Optional parameters
  if (optionalNames.length > 0) {
    lines.push('### Optional Parameters');
    for (const name of optionalNames) {
      lines.push(...formatParamSchema(name, params.properties[name]!, requiredSet));
    }
    lines.push('');
  }

  // Build example with required params
  const exampleArgs: Record<string, unknown> = {};
  for (const name of requiredNames) {
    exampleArgs[name] = buildExampleValue(params.properties[name]!, name);
  }

  lines.push('### Example Call');
  lines.push(`use_tool("${def.name}", ${JSON.stringify(exampleArgs, null, 2)})`);

  // Add tool-specific max limit info if available
  const toolLimit = TOOL_MAX_LIMITS[toolName];
  if (toolLimit) {
    lines.push('');
    lines.push(
      `Note: "${toolLimit.paramName}" parameter is capped at max ${toolLimit.maxValue} (default: ${toolLimit.defaultValue}).`
    );
  }

  return lines.join('\n');
}

/**
 * Validate required parameters are present before tool execution.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateRequiredParams(
  registry: ToolRegistry,
  toolName: string,
  args: Record<string, unknown>
): string | null {
  const def = registry.getDefinition(toolName);
  if (!def?.parameters) return null;
  const required = def.parameters.required as string[] | undefined;
  if (!required || required.length === 0) return null;

  const missing = required.filter((p) => args[p] === undefined || args[p] === null);
  if (missing.length === 0) return null;

  return `Missing required parameter(s): ${missing.join(', ')}`;
}
