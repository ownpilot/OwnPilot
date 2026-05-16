/**
 * Shared utilities for autonomous agent runners.
 *
 * Eliminates duplication across SubagentRunner and FleetWorker
 * by extracting common patterns:
 * - Tool registration pipeline
 * - Agent creation from provider config
 * - Timeout/cancellation promises
 * - JSON parsing and tool call collection
 * - Model routing resolution
 */

import {
  Agent,
  ToolRegistry,
  registerAllTools,
  getErrorMessage,
  qualifyToolName,
  getServiceRegistry,
  Services,
  calculateCost,
  type IProvider,
  createProvider,
  type ProviderConfig,
} from '@ownpilot/core';
import type { AIProvider, ToolCall, ToolId } from '@ownpilot/core';
import { getLog } from './log.js';
import { resolveForProcess } from './model-routing.js';
import { getProviderApiKey, loadProviderConfig, NATIVE_PROVIDERS } from '../routes/agent-cache.js';
import {
  registerGatewayTools,
  registerDynamicTools,
  registerPluginTools,
  registerExtensionTools,
  registerMcpTools,
} from '../tools/agent-tool-registry.js';
import { gatewayConfigCenter } from './config-center-impl.js';
import { AGENT_DEFAULT_MAX_TOKENS, AGENT_DEFAULT_TEMPERATURE } from '../config/defaults.js';
import type { ExtensionService } from './extension-service.js';
import { getProviderMetricsRepository } from '../db/repositories/provider-metrics.js';

const log = getLog('AgentRunnerUtils');

// ============================================================================
// Tool Registration
// ============================================================================

/**
 * Register ALL tool sources into a ToolRegistry.
 * This is the canonical 6-step pipeline shared by all runners.
 */
export async function registerAllToolSources(
  tools: ToolRegistry,
  userId: string,
  conversationId: string,
  logPrefix: string
): Promise<void> {
  // 1. Core tools (built-in utilities, file, code, web, etc.)
  registerAllTools(tools);
  tools.setConfigCenter(gatewayConfigCenter);

  // 2. Gateway domain tools (memory, goals, custom data, triggers, plans, etc.)
  registerGatewayTools(tools, userId, false);

  // 3. Dynamic tools (custom tools, CRUD meta-tools, user-created tools)
  try {
    await registerDynamicTools(tools, userId, conversationId, false);
  } catch (err) {
    log.warn(`[${logPrefix}] Dynamic tools registration failed: ${getErrorMessage(err)}`);
  }

  // 4. Plugin tools
  try {
    registerPluginTools(tools, false);
  } catch (err) {
    log.warn(`[${logPrefix}] Plugin tools registration failed: ${getErrorMessage(err)}`);
  }

  // 5. Extension/Skill tools
  try {
    registerExtensionTools(tools, userId, false);
  } catch (err) {
    log.warn(`[${logPrefix}] Extension tools registration failed: ${getErrorMessage(err)}`);
  }

  // 6. MCP tools (external MCP servers)
  try {
    registerMcpTools(tools, false);
  } catch (err) {
    log.warn(`[${logPrefix}] MCP tools registration failed: ${getErrorMessage(err)}`);
  }
}

// ============================================================================
// Model Resolution
// ============================================================================

/**
 * Resolve AI provider and model from explicit config or system model routing.
 *
 * This is the *process-aware* waterfall (chat / pulse / subagent). It throws
 * on missing config. For the simple "what is the global default?" query (used
 * by Settings UI surface, pre-flight checks, channel fallback), see
 * `resolveDefaultProviderAndModel` in `routes/settings.ts`.
 */
export async function resolveProviderAndModel(
  explicitProvider: string | undefined,
  explicitModel: string | undefined,
  process: 'pulse' | 'subagent' | 'chat' = 'pulse',
  errorContext?: string
): Promise<{ provider: string; model: string }> {
  if (explicitProvider && explicitModel) {
    return { provider: explicitProvider, model: explicitModel };
  }

  const resolved = await resolveForProcess(process);
  const provider = explicitProvider ?? resolved.provider;
  const model = explicitModel ?? resolved.model;

  if (!provider || !model) {
    const ctx = errorContext ? ` for ${errorContext}` : '';
    throw new Error(
      `No AI provider configured${ctx}. Set provider/model on the agent or configure a default in Settings.`
    );
  }

  return { provider, model };
}

// ============================================================================
// Agent Factory
// ============================================================================

export interface CreateAgentOptions {
  name: string;
  provider: string;
  model: string;
  systemPrompt: string;
  userId: string;
  conversationId: string;
  maxTokens?: number;
  maxTurns?: number;
  maxToolCalls?: number;
  temperature?: number;
  toolFilter?: ToolId[];
}

/**
 * Create a fully configured Agent with all tool sources registered.
 * Single construction path for all runners.
 */
export async function createConfiguredAgent(opts: CreateAgentOptions): Promise<Agent> {
  const apiKey = await getProviderApiKey(opts.provider);
  if (!apiKey) {
    throw new Error(`API key not configured for provider: ${opts.provider}`);
  }

  const providerConfig = loadProviderConfig(opts.provider);
  const providerType = NATIVE_PROVIDERS.has(opts.provider) ? opts.provider : 'openai';

  // Fail fast for unrecognized providers — prevents silent fallback to OpenAI
  if (!providerConfig && !NATIVE_PROVIDERS.has(opts.provider)) {
    throw new Error(
      `Provider "${opts.provider}" is not configured. ` +
        `Add an API key in Settings → Providers, or select a native provider.`
    );
  }

  // Create and populate tool registry
  const tools = new ToolRegistry();
  await registerAllToolSources(tools, opts.userId, opts.conversationId, opts.name);

  // Build provider config for Agent (config.provider) and create real IProvider for options.provider
  const agentProviderConfig: ProviderConfig = {
    provider: providerType as AIProvider,
    apiKey,
    baseUrl: providerConfig?.baseUrl,
    headers: providerConfig?.headers,
  };
  const providerInstance = createProvider(agentProviderConfig);

  const agent = new Agent(
    {
      name: opts.name,
      systemPrompt: opts.systemPrompt,
      provider: agentProviderConfig,
      model: {
        model: opts.model,
        maxTokens: opts.maxTokens ?? AGENT_DEFAULT_MAX_TOKENS,
        temperature: opts.temperature ?? AGENT_DEFAULT_TEMPERATURE,
      },
      maxTurns: opts.maxTurns,
      maxToolCalls: opts.maxToolCalls,
      tools: opts.toolFilter,
    },
    { tools, provider: providerInstance }
  );

  // Enable direct tool mode for autonomous agents (no meta-tool indirection)
  agent.setDirectToolMode(true);

  return agent;
}

// ============================================================================
// Skill Filter Resolution
// ============================================================================

/**
 * Resolve skill IDs to qualified tool names and merge with explicit allowedTools.
 */
export function resolveToolFilter(
  allowedTools: string[] | undefined,
  skills: string[] | undefined,
  logPrefix: string
): ToolId[] | undefined {
  const allowedSet = new Set(allowedTools ?? []);

  if (skills && skills.length > 0) {
    try {
      const extService = getServiceRegistry().get(Services.Extension) as ExtensionService;
      const allowedSkillIds = new Set(skills);
      for (const def of extService.getToolDefinitions()) {
        if (allowedSkillIds.has(def.extensionId)) {
          const nsPrefix = def.format === 'agentskills' ? 'skill' : 'ext';
          allowedSet.add(qualifyToolName(def.name, nsPrefix as 'skill' | 'ext', def.extensionId));
        }
      }
    } catch (err) {
      log.warn(`[${logPrefix}] Skills filter build failed: ${getErrorMessage(err)}`);
    }
  }

  return allowedSet.size > 0 ? ([...allowedSet] as ToolId[]) : undefined;
}

// ============================================================================
// Common Utilities
// ============================================================================

/**
 * Create a promise that rejects after the given timeout.
 *
 * The returned `cancel` function MUST be called once the race completes so
 * the underlying setTimeout does not keep the event loop alive or fire a
 * stray rejection on a detached promise. Caller is responsible for cleanup.
 */
export function createTimeoutPromise(
  ms: number,
  label = 'Operation'
): { promise: Promise<never>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timer = null;
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });
  // Attach a no-op catch handler so that a late rejection (after the race has
  // already settled via another promise) does not surface as an unhandled
  // rejection in long-running services.
  // eslint-disable-next-line no-restricted-syntax -- intentional: race-loser suppression
  promise.catch(() => {});
  return {
    promise,
    cancel: () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

/**
 * Safely parse a JSON string, returning raw value on failure.
 */
export function safeParseJson(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str || '{}');
  } catch {
    return { _raw: str };
  }
}

/**
 * Generic tool call collector callback factory.
 */
export interface CollectedToolCall {
  tool: string;
  args: Record<string, unknown>;
  result: string;
  success: boolean;
  durationMs: number;
}

export function createToolCallCollector(): {
  toolCalls: CollectedToolCall[];
  onToolEnd: (
    tc: ToolCall,
    result: { content: string; isError: boolean; durationMs: number }
  ) => void;
} {
  const toolCalls: CollectedToolCall[] = [];
  const onToolEnd = (
    tc: ToolCall,
    result: { content: string; isError: boolean; durationMs: number }
  ) => {
    toolCalls.push({
      tool: tc.name,
      args: safeParseJson(tc.arguments),
      result: result.content,
      success: !result.isError,
      durationMs: result.durationMs,
    });
  };
  return { toolCalls, onToolEnd };
}

/**
 * Build a formatted current date/time string for agent prompts.
 */
export function buildDateTimeContext(): string {
  const now = new Date();
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return `${days[now.getDay()]} ${now.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}`;
}

// ============================================================================
// Agent Execution Pipeline
// ============================================================================

/**
 * Options for the unified agent execution pipeline.
 */
export interface AgentPipelineOptions {
  /** Fully configured Agent instance */
  agent: Agent;
  /** Message to send to the agent */
  message: string;
  /** Timeout in milliseconds */
  timeoutMs: number;
  /** Label for timeout errors (e.g., "Cycle", "Subagent", "Worker") */
  timeoutLabel?: string;
  /** Optional AbortSignal for cancellation */
  abortSignal?: AbortSignal;
  /** Optional external tool-end callback (called alongside the internal collector) */
  onToolEnd?: (
    tc: ToolCall,
    result: { content: string; isError: boolean; durationMs: number }
  ) => void;
  /** Optional telemetry context for provider_metrics (gap 24.4) */
  workflowId?: string;
  agentId?: string;
  userId?: string;
}

/**
 * Result from the unified agent execution pipeline.
 */
export interface AgentPipelineResult {
  content: string;
  toolCalls: CollectedToolCall[];
  usage: { promptTokens: number; completionTokens: number } | null;
  costUsd: number;
  durationMs: number;
}

/**
 * Create a promise that rejects when the given AbortSignal fires.
 *
 * The returned `cancel` function detaches the abort listener — call it once
 * the race completes so we do not leak a listener on a long-lived signal.
 */
export function createCancellationPromise(signal: AbortSignal): {
  promise: Promise<never>;
  cancel: () => void;
} {
  let listener: (() => void) | null = null;
  const promise = new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(new Error('Cancelled'));
      return;
    }
    listener = () => {
      listener = null;
      reject(new Error('Cancelled'));
    };
    signal.addEventListener('abort', listener, { once: true });
  });
  // eslint-disable-next-line no-restricted-syntax -- intentional: race-loser suppression
  promise.catch(() => {});
  return {
    promise,
    cancel: () => {
      if (listener !== null) {
        signal.removeEventListener('abort', listener);
        listener = null;
      }
    },
  };
}

/**
 * Unified agent execution pipeline shared by all runners.
 *
 * Handles: tool call collection, timeout, optional cancellation,
 * Result unwrapping, and cost calculation.
 *
 * Each runner is responsible for:
 * - Creating the agent (provider, model, system prompt, tool filter)
 * - Building the message
 * - Mapping `AgentPipelineResult` to its own domain result type
 */
export async function executeAgentPipeline(
  provider: string,
  model: string,
  opts: AgentPipelineOptions
): Promise<AgentPipelineResult> {
  const startTime = Date.now();

  // Collect tool calls via callback
  const collector = createToolCallCollector();
  const wrappedOnToolEnd = (
    tc: ToolCall,
    result: { content: string; isError: boolean; durationMs: number }
  ) => {
    collector.onToolEnd(tc, result);
    opts.onToolEnd?.(tc, result);
  };

  // Race: agent execution vs timeout vs optional cancellation
  const timeout = createTimeoutPromise(opts.timeoutMs, opts.timeoutLabel ?? 'Agent');
  const cancellation = opts.abortSignal ? createCancellationPromise(opts.abortSignal) : null;
  const promises: Promise<unknown>[] = [
    opts.agent.chat(opts.message, { onToolEnd: wrappedOnToolEnd }),
    timeout.promise,
  ];
  if (cancellation) {
    promises.push(cancellation.promise);
  }

  let chatResult: {
    ok: boolean;
    value?: { content?: string; usage?: { promptTokens?: number; completionTokens?: number } };
    error?: { message?: string };
  };
  try {
    chatResult = (await Promise.race(promises)) as typeof chatResult;
  } finally {
    // Always clear the timeout and abort listener so we do not leak timers
    // or event listeners when the agent wins the race.
    timeout.cancel();
    cancellation?.cancel();
  }

  // Unwrap Result type
  const durationMs = Date.now() - startTime;
  if (!chatResult.ok) {
    // Record error metric
    await recordTelemetry(
      opts.agent,
      provider,
      model,
      durationMs,
      true,
      opts.workflowId,
      opts.agentId,
      opts.userId
    );
    throw new Error(chatResult.error?.message ?? 'Agent execution failed');
  }

  const response = chatResult.value!;

  // Record success metric
  await recordTelemetry(
    opts.agent,
    provider,
    model,
    durationMs,
    false,
    opts.workflowId,
    opts.agentId,
    opts.userId,
    response.usage
  );

  return {
    content: response.content ?? '',
    toolCalls: collector.toolCalls,
    usage: response.usage
      ? {
          promptTokens: response.usage.promptTokens ?? 0,
          completionTokens: response.usage.completionTokens ?? 0,
        }
      : null,
    costUsd: calculateExecutionCost(provider, model, response.usage),
    durationMs,
  };
}

/**
 * Record a provider telemetry metric (gap 24.4).
 * Writes to provider_metrics DB table via ProviderMetricsRepository.
 * Non-blocking — failures are swallowed silently.
 */
async function recordTelemetry(
  agent: Agent,
  provider: string,
  model: string,
  latencyMs: number,
  isError: boolean,
  workflowId?: string,
  agentId?: string,
  userId?: string,
  usage?: { promptTokens?: number; completionTokens?: number }
): Promise<void> {
  try {
    const prov = (agent as unknown as { provider: IProvider }).provider;
    const costUsd = calculateExecutionCost(provider, model, usage ?? null);
    const metricInput = {
      id: crypto.randomUUID(),
      providerId: provider,
      modelId: model,
      latencyMs,
      error: isError,
      errorType: isError ? 'agent_execution_failed' : null,
      promptTokens: usage?.promptTokens ?? null,
      completionTokens: usage?.completionTokens ?? null,
      costUsd: costUsd > 0 ? costUsd : null,
      workflowId: workflowId ?? null,
      agentId: agentId ?? null,
      userId: userId ?? null,
    };
    // Write to DB (default behavior for all providers). Fire-and-forget — billing
    // drift is preferable to blocking agent responses, but we log so it doesn't
    // disappear silently.
    getProviderMetricsRepository()
      .record(metricInput)
      .catch((err) => {
        log.warn('Failed to record provider metrics', { provider, model, error: err });
      });
    // Also call provider hook (for providers that want custom handling)
    if (prov && typeof prov.recordMetric === 'function') {
      prov
        .recordMetric({
          modelId: model,
          latencyMs,
          error: isError,
          errorType: isError ? 'agent_execution_failed' : null,
          promptTokens: usage?.promptTokens ?? null,
          completionTokens: usage?.completionTokens ?? null,
          costUsd: costUsd > 0 ? costUsd : null,
          workflowId: workflowId ?? null,
          agentId: agentId ?? null,
          userId: userId ?? null,
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn(`[metrics] recordMetric failed: ${msg}`);
        });
    }
  } catch {
    // Non-blocking telemetry — never surface errors
  }
}

// ============================================================================
// Cost Calculation
// ============================================================================

/**
 * Calculate cost from provider/model and token usage.
 * Returns 0 if usage data is unavailable.
 */
export function calculateExecutionCost(
  provider: string,
  model: string,
  usage?: { promptTokens?: number; completionTokens?: number } | null
): number {
  if (!usage) return 0;
  return calculateCost(
    provider as AIProvider,
    model,
    usage.promptTokens ?? 0,
    usage.completionTokens ?? 0
  );
}
