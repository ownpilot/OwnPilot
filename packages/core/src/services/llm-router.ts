/**
 * LLMRouter — unified contract for LLM provider/model selection,
 * context window resolution, and cost calculation.
 *
 * Why this exists:
 *   Before this contract, every runtime (Claw, Chat, Soul Heartbeat,
 *   Workflow) imported a different combination of helpers — some from
 *   `agent-runner-utils.ts`, some from `agent-cache.ts`, some from
 *   `routes/settings.ts`. The same conceptual question ("how does THIS
 *   runtime pick an LLM and figure out its limits?") had three different
 *   answers depending on where you looked.
 *
 *   This module declares the single capability surface for "LLM access"
 *   so runtimes only ever consume one named interface. Implementation
 *   stays in the gateway package (where the routing + DB-backed config
 *   live); only the contract lives here in core.
 */

/** Token usage shape returned by any LLM provider. */
export interface LLMTokenUsage {
  promptTokens?: number;
  completionTokens?: number;
}

/** Options for picking a provider+model. */
export interface LLMPickOptions {
  /** When set together with explicitModel, used directly without waterfall. */
  explicitProvider?: string;
  explicitModel?: string;
  /**
   * The runtime kind asking. Determines which per-process default applies
   * when explicit provider/model is omitted: 'pulse' = autonomous (Claw /
   * Soul Heartbeat / Pulse), 'chat' = interactive conversation.
   */
  process?: 'pulse' | 'chat';
  /** Free-form label included in the "no provider configured" error message. */
  errorContext?: string;
}

/** Result of LLMRouter.pick(). */
export interface LLMResolvedModel {
  provider: string;
  model: string;
  /**
   * Optional fallback provider/model resolved from per-process routing
   * config. When the primary call fails (provider down, model unavailable),
   * runtimes can retry with this pair. `undefined` when no fallback is
   * configured.
   */
  fallbackProvider?: string;
  fallbackModel?: string;
}

/** Inputs for the memory-budget calculation. */
export interface LLMMemoryBudgetOptions {
  /** Total context window of the chosen model (tokens). */
  ctxWindow: number;
  /** Estimated tokens consumed by the system prompt. */
  systemPromptTokens: number;
  /** Reserved tokens for the model's output. */
  outputBuffer: number;
  /**
   * Tokens reserved for dynamic mid-conversation injection (memories, goals,
   * etc.). Defaults to min(8192, ctxWindow * 0.25) when not provided.
   * Autonomous runners typically pass 0 because they don't go through the
   * chat injection middleware.
   */
  dynamicInjectionReserve?: number;
}

/**
 * The single capability contract for LLM access. Every runtime that needs
 * to pick a model, ask "how big is its context window?", or calculate cost
 * should consume this interface. Direct imports of `resolveProviderAndModel`,
 * `resolveContextWindow`, `calculateExecutionCost`, etc. are now legacy and
 * should be migrated as touched.
 */
export interface ILLMRouter {
  /**
   * Resolve provider+model via waterfall:
   *   explicit args -> per-process default (settings) -> system default
   * Throws if no provider/model can be resolved.
   */
  pick(opts: LLMPickOptions): Promise<LLMResolvedModel>;

  /**
   * Look up the context window (in tokens) for a provider+model.
   * Honors the user override when supplied. Falls back to a safe default
   * when the model isn't in the local provider config.
   */
  getContextWindow(provider: string, model: string, userOverride?: number): number;

  /** Look up the max output tokens for a provider+model. */
  getMaxOutput(provider: string, model: string): number;

  /**
   * Given a context window + system prompt size + output buffer, compute
   * how many tokens are safe to spend on memory (i.e. conversation history
   * + dynamic injection). Bounded by `ctxWindow * 0.75` and a fixed
   * 1024-token safety margin.
   */
  computeMemoryMaxTokens(opts: LLMMemoryBudgetOptions): number;

  /** Convert token usage to a USD cost figure. Returns 0 when usage is null. */
  calculateCost(provider: string, model: string, usage?: LLMTokenUsage | null): number;
}

// ============================================================================
// Singleton access — matches the IChannelService / ConfigCenter pattern
// ============================================================================

import { hasServiceRegistry, getServiceRegistry } from './registry.js';
import { Services } from './tokens.js';

let _llmRouter: ILLMRouter | null = null;

/**
 * Register the LLMRouter implementation. Called once at gateway startup.
 * Also mirrors into the service registry under Services.LLMRouter.
 */
export function setLLMRouter(router: ILLMRouter): void {
  _llmRouter = router;

  if (hasServiceRegistry()) {
    try {
      const registry = getServiceRegistry();
      if (!registry.has(Services.LLMRouter)) {
        registry.register(Services.LLMRouter, router);
      }
    } catch {
      // Registry not ready
    }
  }
}

/**
 * Get the LLMRouter. Tries the service registry first, falls back to
 * the direct singleton. Throws if neither is initialized.
 */
export function getLLMRouter(): ILLMRouter {
  if (hasServiceRegistry()) {
    try {
      return getServiceRegistry().get(Services.LLMRouter);
    } catch {
      // Not registered yet — fall through to direct singleton
    }
  }

  if (!_llmRouter) {
    throw new Error('LLMRouter not initialized. Call setLLMRouter() during gateway startup.');
  }
  return _llmRouter;
}

/** Check whether the LLMRouter has been initialized. */
export function hasLLMRouter(): boolean {
  if (hasServiceRegistry()) {
    try {
      return getServiceRegistry().has(Services.LLMRouter);
    } catch {
      // fall through
    }
  }
  return _llmRouter !== null;
}
