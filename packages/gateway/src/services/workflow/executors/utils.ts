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
const MAX_EXPRESSION_LENGTH = 10_000;

/**
 * Safe VM expression evaluator — hardens against prototype-chain sandbox escapes.
 *
 * Defenses:
 * - `codeGeneration.strings: false` blocks dynamic-code constructors inside the sandbox
 * - SECURITY (RCE-001/RCE-003): context values are serialized to JSON and
 *   re-parsed INSIDE the vm, so every binding the expression can reach is a
 *   *context-realm* object whose `.constructor` is the context Function (blocked
 *   by the codegen flag). The previous implementation injected `structuredClone`
 *   results, which are HOST-realm objects — `data['con'+'structor']['con'+'structor']('return process')()`
 *   walked their constructor chain to the host Function and escaped the sandbox.
 * - Timeout prevents infinite loops.
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

  // Serialize the whole context to JSON. Functions/Symbols are dropped and
  // circular structures throw — both surfaced as the JSON-serializable error,
  // matching the documented contract.
  let ctxJson: string | undefined;
  try {
    ctxJson = JSON.stringify(context ?? {});
  } catch {
    throw new Error(
      'Transformer input must be JSON-serializable. Functions, Symbols, and circular values are not supported.'
    );
  }
  if (ctxJson === undefined) ctxJson = '{}';

  const vmContext = vm.createContext(
    { __ctxJson: ctxJson },
    { codeGeneration: { strings: false, wasm: false } }
  );

  // Bootstrap: re-parse the context inside the vm (values become context-realm),
  // bind each key as a global, then sever the raw JSON payload.
  vm.runInContext(
    `(() => { const c = JSON.parse(__ctxJson); for (const k of Object.keys(c)) globalThis[k] = c[k]; delete globalThis.__ctxJson; })();`,
    vmContext
  );

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
