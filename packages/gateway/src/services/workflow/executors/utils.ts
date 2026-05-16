/**
 * Workflow Node Executor — Shared Utilities
 *
 * Helpers used by multiple executor families:
 *  - `safeVmEval`            — hardened vm.runInContext for user-supplied expressions
 *  - `toToolExecResult`      — convert ToolServiceResult to ToolExecutionResult
 *  - `resolveWorkflowToolName` — handle dot-stripped tool names from the AI copilot
 *
 * Also exports the constants shared between filter/map/aggregate/etc.
 */

import vm from 'node:vm';
import type { IToolService, ToolServiceResult } from '@ownpilot/core';
import { validateToolCode } from '@ownpilot/core';
import { getLog } from '../../log.js';
import type { ToolExecutionResult } from '../types.js';

export const log = getLog('WorkflowService');

/** Maximum array size for per-element VM evaluation (filter/map nodes). */
export const MAX_ARRAY_EVAL_SIZE = 10_000;

/** Maximum expression length for VM evaluation (prevent memory exhaustion). */
export const MAX_EXPRESSION_LENGTH = 10_000;

/**
 * Safe VM expression evaluator — hardens against prototype-chain sandbox escapes.
 *
 * Defenses:
 * - `codeGeneration.strings: false` blocks dynamic-code constructors inside the sandbox
 * - Dangerous globals (`process`, `require`, `global`, `globalThis`) are frozen as undefined
 * - Timeout prevents infinite loops
 */
export function safeVmEval(
  expression: string,
  context: Record<string, unknown>,
  timeoutMs: number
): unknown {
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw new Error(`Expression exceeds maximum length of ${MAX_EXPRESSION_LENGTH} characters`);
  }

  const validation = validateToolCode(expression);
  if (!validation.valid) {
    throw new Error(`Expression blocked: ${validation.errors.join('; ')}`);
  }

  const cloneContext = new Map<string, unknown>();
  for (const [k, v] of Object.entries(context)) {
    if (typeof v === 'object' && v !== null) {
      try {
        cloneContext.set(k, structuredClone(v));
      } catch {
        throw new Error(
          `Transformer input "${k}" must be JSON-serializable. Functions, Symbols, and non-cloneable values are not supported.`
        );
      }
    } else {
      cloneContext.set(k, v);
    }
  }

  const dangerous = ['process', 'require', 'global', 'globalThis', 'Function', 'eval', 'import'];
  const sandbox: Record<string, unknown> = { ...Object.fromEntries(cloneContext) };
  for (const key of dangerous) sandbox[key] = undefined;

  const vmContext = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
  });
  return vm.runInContext(expression, vmContext, { timeout: timeoutMs });
}

/** Convert ToolServiceResult to ToolExecutionResult. */
export function toToolExecResult(r: ToolServiceResult): ToolExecutionResult {
  if (r.isError) {
    return { success: false, error: r.content };
  }
  try {
    return { success: true, result: JSON.parse(r.content) };
  } catch {
    return { success: true, result: r.content };
  }
}

/**
 * Resolve a tool name that may have dots stripped by the AI copilot.
 * e.g. "mcpgithublist_repositories" -> "mcp.github.list_repositories"
 */
export function resolveWorkflowToolName(name: string, toolService: IToolService): string {
  if (toolService.has(name)) return name;

  const normalized = name.replace(/\./g, '').toLowerCase();
  for (const def of toolService.getDefinitions()) {
    const defNormalized = def.name.replace(/\./g, '').toLowerCase();
    if (defNormalized === normalized) {
      log.info(`Resolved workflow tool name "${name}" -> "${def.name}"`);
      return def.name;
    }
  }

  return name;
}
