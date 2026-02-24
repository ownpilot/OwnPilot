/**
 * Template resolver — Resolves {{nodeId.output.field}} template expressions
 * in workflow node arguments, supporting nested access and variable fallback.
 */

import type { NodeResult } from '../../db/repositories/workflows.js';

/**
 * Resolve template expressions in tool arguments.
 * Replaces {{nodeId.output}} with full output and {{nodeId.output.field.sub}} with nested access.
 * Also supports {{variables.key}} for workflow-level variables.
 */
export function resolveTemplates(
  args: Record<string, unknown>,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>
): Record<string, unknown> {
  return deepResolve(args, nodeOutputs, variables) as Record<string, unknown>;
}

export function deepResolve(
  value: unknown,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>
): unknown {
  if (typeof value === 'string') {
    return resolveStringTemplates(value, nodeOutputs, variables);
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepResolve(item, nodeOutputs, variables));
  }
  if (value !== null && typeof value === 'object') {
    const resolved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      resolved[k] = deepResolve(v, nodeOutputs, variables);
    }
    return resolved;
  }
  return value;
}

export function resolveStringTemplates(
  str: string,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>
): unknown {
  // If the entire string is a single template, return the raw value (preserves types)
  const fullMatch = /^\{\{(.+?)\}\}$/.exec(str);
  if (fullMatch?.[1]) {
    return resolveTemplatePathWithFallback(fullMatch[1].trim(), nodeOutputs, variables);
  }

  // Otherwise, replace all templates inline (always returns string)
  return str.replace(/\{\{(.+?)\}\}/g, (_match, path: string) => {
    const val = resolveTemplatePathWithFallback(path.trim(), nodeOutputs, variables);
    return val === undefined ? '' : typeof val === 'string' ? val : JSON.stringify(val);
  });
}

export function resolveTemplatePath(
  path: string,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>
): unknown {
  const parts = path.split('.');

  // {{variables.key.subkey}}
  if (parts[0] === 'variables') {
    return getNestedValue(variables, parts.slice(1));
  }

  // {{nodeId.output}} or {{nodeId.output.field.sub}}
  const nodeId = parts[0]!;
  const nodeResult = nodeOutputs[nodeId];
  if (!nodeResult) return undefined;

  if (parts.length === 1) return nodeResult.output;
  if (parts[1] === 'output') {
    if (parts.length === 2) return nodeResult.output;
    return getNestedValue(nodeResult.output, parts.slice(2));
  }

  // Allow direct access: {{nodeId.field}} as shorthand for {{nodeId.output.field}}
  return getNestedValue(nodeResult.output, parts.slice(1));
}

// Fallback: check variables (enables {{itemVariable}} alias in ForEach body)
function resolveTemplatePathWithFallback(
  path: string,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>
): unknown {
  const result = resolveTemplatePath(path, nodeOutputs, variables);
  if (result !== undefined) return result;

  // Try variables directly ({{issue}} -> variables.issue)
  const parts = path.split('.');
  if (parts[0] && parts[0] in variables) {
    if (parts.length === 1) return variables[parts[0]];
    return getNestedValue(variables[parts[0]], parts.slice(1));
  }

  return undefined;
}

export function getNestedValue(obj: unknown, path: string[]): unknown {
  let current = obj;
  for (const key of path) {
    if (current === null || current === undefined) return undefined;
    // Auto-parse JSON strings so {{node.output.field}} works when output is a JSON string
    if (typeof current === 'string') {
      const trimmed = current.trim();
      if (
        (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))
      ) {
        try {
          current = JSON.parse(trimmed);
        } catch {
          return undefined;
        }
      } else {
        return undefined;
      }
    }
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  // Also auto-parse the final value if it's a JSON string (for whole-object references)
  if (typeof current === 'string') {
    const trimmed = current.trim();
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return JSON.parse(trimmed);
      } catch {
        /* return as-is */
      }
    }
  }
  return current;
}
