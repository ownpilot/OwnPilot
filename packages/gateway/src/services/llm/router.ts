/**
 * LLMRouter — gateway implementation of the ILLMRouter contract from core.
 *
 * Thin facade over the gateway-internal helpers (`resolveProviderAndModel`
 * in agent-runner-utils, `resolveContextWindow` / `resolveMaxOutput` /
 * `computeMemoryMaxTokens` in services/agent-cache, `calculateExecutionCost`
 * in agent-runner-utils). Those helpers stay in their homes because they
 * have other legitimate dependencies (cache, model-routing); this facade
 * binds them to the single `ILLMRouter` capability contract that runtimes
 * consume via `getLLMRouter()` from `@ownpilot/core` (or `ctx.llm`).
 *
 * Callers MUST import `getLLMRouter` from `@ownpilot/core`, never from
 * this file — runtimes are not allowed to reach into gateway-internal
 * paths. The gateway's job is to *install* the impl at startup
 * (`installLLMRouter()`); after that the core singleton is canonical.
 */

import type { ILLMRouter } from '@ownpilot/core';
import { setLLMRouter } from '@ownpilot/core';
import { resolveProviderAndModel, calculateExecutionCost } from '../agent/runner-utils.js';
import { resolveContextWindow, resolveMaxOutput, computeMemoryMaxTokens } from '../agent/cache.js';

/** Gateway-side LLMRouter implementation — thin facade over scattered helpers. */
const llmRouter: ILLMRouter = {
  pick: (opts) =>
    resolveProviderAndModel(
      opts.explicitProvider,
      opts.explicitModel,
      opts.process ?? 'pulse',
      opts.errorContext
    ),
  getContextWindow: resolveContextWindow,
  getMaxOutput: resolveMaxOutput,
  computeMemoryMaxTokens,
  calculateCost: calculateExecutionCost,
};

/**
 * Install the gateway LLMRouter into the core singleton + service registry.
 * Called once at gateway startup. Idempotent (setLLMRouter checks
 * registry.has() before re-registering).
 */
export function installLLMRouter(): void {
  setLLMRouter(llmRouter);
}
