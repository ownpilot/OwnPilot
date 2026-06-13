/**
 * Shared utilities for autonomous agent runners.
 *
 * Eliminates duplication across autonomous runners (claws, etc.)
 * by extracting common patterns:
 * - Tool registration pipeline
 * - Agent creation from provider config
 * - Timeout/cancellation promises
 * - JSON parsing and tool call collection
 * - Model routing resolution
 *
 * Trust boundary: Shared agent-runner helpers cast between typed tool-call envelopes and the executor's expected input shape. The executor contract is the trust boundary; the cast documents the call-site type agreement.
 */

import {
  Agent,
  ToolRegistry,
  registerAllTools,
  qualifyToolName,
  type IProvider,
  createProvider,
  createFallbackProvider,
  type ProviderConfig,
  type ToolCall,
  type Message,
} from '@ownpilot/core/agent';
import { calculateCost } from '@ownpilot/core/costs';
import type { AIProvider } from '@ownpilot/core/costs';
import type { ToolId } from '@ownpilot/core/types';
import { getErrorMessage } from '@ownpilot/core/services';
import { getExtensionService } from '@ownpilot/core/services';
import { getLog } from '../log.js';
import { resolveForProcess } from '../llm/model-routing.js';
import { getProviderApiKey, loadProviderConfig, NATIVE_PROVIDERS } from './cache.js';
import { resolveAuthForRequest } from '../auth/oauth-flow.js';
import { getLLMRouter, getConfigCenter } from '@ownpilot/core/services';
import { estimateCost } from '@ownpilot/core/costs';
import { budgetManager } from '../usage-tracking.js';
import {
  registerGatewayTools,
  registerDynamicTools,
  registerPluginTools,
  registerExtensionTools,
  registerMcpTools,
} from '../../tools/agent-tool-registry.js';
import { AGENT_DEFAULT_MAX_TOKENS, AGENT_DEFAULT_TEMPERATURE } from '../../config/defaults.js';
import { getLlmSemaphore } from '../llm/semaphore.js';
import type { ExtensionService } from '../extension/service.js';
import { getProviderMetricsRepository } from '../../db/repositories/costs/provider-metrics.js';

const log = getLog('AgentRunnerUtils');

// ============================================================================
// Tool Registration
// ============================================================================

/**
 * Register ALL tool sources into a ToolRegistry.
 * This is the canonical 6-step pipeline shared by all runners.
 *
 * Trust boundary: Shared agent-runner helpers cast between typed tool-call envelopes and the executor's expected input shape. The executor contract is the trust boundary; the cast documents the call-site type agreement.
 */
export async function registerAllToolSources(
  tools: ToolRegistry,
  userId: string,
  conversationId: string,
  logPrefix: string
): Promise<void> {
  // 1. Core tools (built-in utilities, file, code, web, etc.)
  registerAllTools(tools);
  tools.setConfigCenter(getConfigCenter());

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
 *
 * Trust boundary: Shared agent-runner helpers cast between typed tool-call envelopes and the executor's expected input shape. The executor contract is the trust boundary; the cast documents the call-site type agreement.
 */
export async function resolveProviderAndModel(
  explicitProvider: string | undefined,
  explicitModel: string | undefined,
  process: 'pulse' | 'chat' | 'channel' | 'channel_media' = 'pulse',
  errorContext?: string
): Promise<{
  provider: string;
  model: string;
  fallbackProvider?: string;
  fallbackModel?: string;
}> {
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

  return {
    provider,
    model,
    fallbackProvider: resolved.fallbackProvider ?? undefined,
    fallbackModel: resolved.fallbackModel ?? undefined,
  };
}

// ============================================================================
// Agent Factory
// ============================================================================

interface CreateAgentOptions {
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
  /** Optional backup provider/model for failover (resolved via LLM routing). */
  fallbackProvider?: string;
  fallbackModel?: string;
  /**
   * Absolute path scoping all file-system tool operations to this directory
   * (plus os.tmpdir()). When omitted, file tools fall back to process.cwd() —
   * which means autonomous agents would otherwise range over the gateway
   * working directory. Per-claw / per-workspace runners should always pass
   * this so a runaway tool call can only touch its own session files.
   */
  workspaceDir?: string;
}

/**
 * Create a fully configured Agent with all tool sources registered.
 * Single construction path for all runners.
 *
 * Trust boundary: Shared agent-runner helpers cast between typed tool-call envelopes and the executor's expected input shape. The executor contract is the trust boundary; the cast documents the call-site type agreement.
 */
export async function createConfiguredAgent(opts: CreateAgentOptions): Promise<Agent> {
  // Resolve full auth (session_token / oauth / api_key). Falls back to the
  // legacy `api_key:<provider>` setting via getResolvedAuth's fallback path
  // when no auth blob is stored. Keep `apiKey` in sync as the canonical
  // bearer string for backward compatibility with provider impls that have
  // not yet migrated off `config.apiKey`.
  const resolvedAuth = await resolveAuthForRequest(opts.provider);
  const apiKey = resolvedAuth?.value ?? (await getProviderApiKey(opts.provider));
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

  // Scope file-system tools to the caller's workspace dir if supplied. The
  // file-system tools read this via context.workspaceDir, and the registry
  // injects its stored workspaceDir on every execute(). When omitted the
  // tools fall back to process.cwd() (intentional for the chat path which
  // runs as the operator) — autonomous runners should always supply it.
  if (opts.workspaceDir) {
    tools.setWorkspaceDir(opts.workspaceDir);
  }

  // Build provider config for Agent (config.provider) and create real IProvider for options.provider
  const agentProviderConfig: ProviderConfig = {
    provider: providerType as AIProvider,
    apiKey,
    resolvedAuth,
    baseUrl: providerConfig?.baseUrl,
    headers: providerConfig?.headers,
  };

  // Provider failover for autonomous runs: a long-running claw/heartbeat
  // shouldn't die on a transient primary outage. If a backup provider/model is
  // configured, wrap in a FallbackProvider (the fallback's defaultModel is
  // honored on failover). The compaction summarizer inherits failover too,
  // since it shares this provider instance.
  let providerInstance: IProvider = createProvider(agentProviderConfig);
  if (opts.fallbackProvider && opts.fallbackModel) {
    try {
      const fbResolvedAuth = await resolveAuthForRequest(opts.fallbackProvider);
      const fbApiKey = fbResolvedAuth?.value ?? (await getProviderApiKey(opts.fallbackProvider));
      if (fbApiKey) {
        const fbConfig = loadProviderConfig(opts.fallbackProvider);
        const fbType = NATIVE_PROVIDERS.has(opts.fallbackProvider)
          ? opts.fallbackProvider
          : 'openai';
        providerInstance = createFallbackProvider({
          primary: agentProviderConfig,
          fallbacks: [
            {
              provider: fbType as AIProvider,
              apiKey: fbApiKey,
              resolvedAuth: fbResolvedAuth,
              baseUrl: fbConfig?.baseUrl,
              headers: fbConfig?.headers,
              defaultModel: { model: opts.fallbackModel },
            },
          ],
          onFallback: (failed, error, next) => {
            log.warn(
              `[${opts.name}] Provider fallback: ${String(failed)} -> ${String(next)}: ${error.message}`
            );
          },
        });
      }
    } catch (fbErr) {
      log.warn(`[${opts.name}] Failed to build fallback provider: ${getErrorMessage(fbErr)}`);
    }
  }

  // Compute a model-aware memory cap and output buffer so autonomous runners
  // (claws, etc.) stay inside the model's context window
  // on small models too. Pass `dynamicInjectionReserve: 0` because autonomous
  // runners don't go through the chat context-injection middleware.
  const router = getLLMRouter();
  const ctxWindow = router.getContextWindow(opts.provider, opts.model);
  const modelMaxOutput = router.getMaxOutput(opts.provider, opts.model);
  const desiredOutput = opts.maxTokens ?? AGENT_DEFAULT_MAX_TOKENS;
  const outputBuffer = Math.min(desiredOutput, modelMaxOutput);
  const systemPromptTokens = Math.ceil(opts.systemPrompt.length / 4);
  const memoryMaxTokens = router.computeMemoryMaxTokens({
    ctxWindow,
    systemPromptTokens,
    outputBuffer,
    dynamicInjectionReserve: 0,
  });

  const agent = new Agent(
    {
      name: opts.name,
      systemPrompt: opts.systemPrompt,
      provider: agentProviderConfig,
      model: {
        model: opts.model,
        // Honor the model's real output ceiling — asking for more is
        // silently truncated by some providers but rejected by others.
        maxTokens: outputBuffer,
        temperature: opts.temperature ?? AGENT_DEFAULT_TEMPERATURE,
      },
      maxTurns: opts.maxTurns,
      maxToolCalls: opts.maxToolCalls,
      tools: opts.toolFilter,
      memory: { maxTokens: memoryMaxTokens },
    },
    { tools, provider: providerInstance }
  );

  // Enable direct tool mode for autonomous agents (no meta-tool indirection)
  agent.setDirectToolMode(true);

  // Headless preflight compaction: autonomous runners (claws, heartbeats,
  // channel chats) have no UI to prompt for compaction, so without this their
  // memory window would silently front-truncate (drop) old turns once over
  // budget. Install an LLM summarizer so older context is condensed into a
  // summary instead. Gated inside the Agent: only fires when the conversation
  // exceeds the threshold, and fails open if summarization errors.
  agent.setPreflightCompactor(
    async (older: readonly Message[]): Promise<string | null> => {
      const transcript = renderTranscriptForSummary(older);
      if (!transcript.trim()) return null;
      // This is an autonomous, otherwise-invisible behavior that spends tokens,
      // so log when it fires / succeeds / fails for operator visibility.
      log.info(
        `[${opts.name}] Headless compaction: summarizing ${older.length} older messages (${opts.provider}/${opts.model})`
      );
      const result = await providerInstance.complete({
        messages: [
          { role: 'system', content: HEADLESS_COMPACTION_INSTRUCTIONS },
          { role: 'user', content: transcript },
        ],
        model: { model: opts.model, maxTokens: 700, temperature: 0.2 },
      });
      if (!result.ok) {
        log.warn(
          `[${opts.name}] Headless compaction failed (${getErrorMessage(result.error)}) — falling back to window truncation`
        );
        return null;
      }
      const summary = result.value.content.trim();
      if (summary.length === 0) {
        log.warn(`[${opts.name}] Headless compaction produced an empty summary — skipping`);
        return null;
      }
      log.info(
        `[${opts.name}] Headless compaction done: ${older.length} messages -> ${summary.length}-char summary`
      );
      return summary;
    },
    { threshold: 0.75, keepRecent: 6 }
  );

  return agent;
}

const HEADLESS_COMPACTION_INSTRUCTIONS = `You are compacting the earlier part of an autonomous agent's working transcript so it fits in context. Produce a dense, factual summary under these headers:
GOAL — what the agent is trying to accomplish.
DECISIONS — choices made and why.
ARTIFACTS — concrete results, file paths, IDs, values produced.
OPEN QUESTIONS — unresolved items / next steps.
Keep it compact. Do not invent information. Output only the summary.`;

/**
 * Render a list of messages into a compact text transcript for summarization.
 * Tool calls and results are flattened to short markers so the summary model
 * sees what happened without the full payloads.
 *
 * Trust boundary: Shared agent-runner helpers cast between typed tool-call envelopes and the executor's expected input shape. The executor contract is the trust boundary; the cast documents the call-site type agreement.
 */
function renderTranscriptForSummary(messages: readonly Message[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    let text =
      typeof m.content === 'string'
        ? m.content
        : m.content.map((p) => (p.type === 'text' ? p.text : `[${p.type}]`)).join(' ');
    if (m.toolCalls?.length) {
      text += ' ' + m.toolCalls.map((tc) => `[tool:${tc.name}]`).join(' ');
    }
    if (m.toolResults?.length) {
      text += ' ' + m.toolResults.map((tr) => `[result:${tr.content.slice(0, 200)}]`).join(' ');
    }
    const trimmed = text.trim();
    if (trimmed) lines.push(`${m.role.toUpperCase()}: ${trimmed}`);
  }
  return lines.join('\n');
}

// ============================================================================
// Skill Filter Resolution
// ============================================================================

/**
 * Resolve skill IDs to qualified tool names and merge with explicit allowedTools.
 *
 * Trust boundary: Shared agent-runner helpers cast between typed tool-call envelopes and the executor's expected input shape. The executor contract is the trust boundary; the cast documents the call-site type agreement.
 */
export function resolveToolFilter(
  allowedTools: string[] | undefined,
  skills: string[] | undefined,
  logPrefix: string
): ToolId[] | undefined {
  const allowedSet = new Set(allowedTools ?? []);

  if (skills && skills.length > 0) {
    try {
      const extService = getExtensionService() as unknown as ExtensionService;
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
 *
 * Trust boundary: Shared agent-runner helpers cast between typed tool-call envelopes and the executor's expected input shape. The executor contract is the trust boundary; the cast documents the call-site type agreement.
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
 *
 * Trust boundary: Shared agent-runner helpers cast between typed tool-call envelopes and the executor's expected input shape. The executor contract is the trust boundary; the cast documents the call-site type agreement.
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
 *
 * Trust boundary: Shared agent-runner helpers cast between typed tool-call envelopes and the executor's expected input shape. The executor contract is the trust boundary; the cast documents the call-site type agreement.
 */
interface CollectedToolCall {
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
 *
 * Trust boundary: Shared agent-runner helpers cast between typed tool-call envelopes and the executor's expected input shape. The executor contract is the trust boundary; the cast documents the call-site type agreement.
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
 *
 * Trust boundary: Shared agent-runner helpers cast between typed tool-call envelopes and the executor's expected input shape. The executor contract is the trust boundary; the cast documents the call-site type agreement.
 */
interface AgentPipelineOptions {
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
  /**
   * Optional per-tool-call authorization gate. Runs before each tool executes;
   * returning `{ approved: false }` skips the call. Used by autonomous runners
   * to enforce permission / autonomy policy (see ClawRunner guardrail).
   */
  onBeforeToolCall?: (tc: ToolCall) => Promise<{ approved: boolean; reason?: string }>;
  /** Optional telemetry context for provider_metrics (gap 24.4) */
  workflowId?: string;
  agentId?: string;
  userId?: string;
}

/**
 * Result from the unified agent execution pipeline.
 *
 * Trust boundary: Shared agent-runner helpers cast between typed tool-call envelopes and the executor's expected input shape. The executor contract is the trust boundary; the cast documents the call-site type agreement.
 */
interface AgentPipelineResult {
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
 *
 * Trust boundary: Shared agent-runner helpers cast between typed tool-call envelopes and the executor's expected input shape. The executor contract is the trust boundary; the cast documents the call-site type agreement.
 */
function createCancellationPromise(signal: AbortSignal): {
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
 *
 * Trust boundary: Shared agent-runner helpers cast between typed tool-call envelopes and the executor's expected input shape. The executor contract is the trust boundary; the cast documents the call-site type agreement.
 */
/**
 * Thrown when a pre-spend budget check blocks an autonomous LLM call (BIZ-001).
 * Distinct type so the fail-open catch around the budget subsystem does not
 * swallow an intentional block, and so runners can recognise it.
 *
 * Trust boundary: Shared agent-runner helpers cast between typed tool-call envelopes and the executor's expected input shape. The executor contract is the trust boundary; the cast documents the call-site type agreement.
 */
export class BudgetExceededError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'BudgetExceededError';
  }
}

export async function executeAgentPipeline(
  provider: string,
  model: string,
  opts: AgentPipelineOptions
): Promise<AgentPipelineResult> {
  const startTime = Date.now();

  // Pre-spend budget enforcement (BIZ-001): the chat HTTP route enforces the
  // operator's budget before dispatching an LLM call, but autonomous runners
  // (Claw continuous/interval, Soul heartbeat, Subagent) went straight to
  // agent.chat() — a runaway loop could blow the daily/weekly/monthly budget.
  // executeAgentPipeline is the shared chokepoint for all of them. Fail open on
  // any budget-subsystem error so a misconfiguration never wedges autonomous
  // execution; only an explicit "not allowed" decision blocks.
  if (provider && model && !provider.startsWith('cli-')) {
    try {
      const messageText = typeof opts.message === 'string' ? opts.message : '';
      const estimate = estimateCost(provider as AIProvider, model, messageText, 1000);
      const decision = await budgetManager.canSpend(estimate.estimatedCost);
      if (!decision.allowed) {
        log.warn(
          `[AgentPipeline] Blocked by budget for ${
            opts.agentId ?? opts.timeoutLabel ?? 'agent'
          }: ${decision.reason}`
        );
        throw new BudgetExceededError(decision.reason ?? 'Request blocked by budget policy.');
      }
    } catch (err) {
      if (err instanceof BudgetExceededError) throw err;
      log.debug(
        `[AgentPipeline] Budget check skipped (fail-open): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  // Collect tool calls via callback
  const collector = createToolCallCollector();
  const wrappedOnToolEnd = (
    tc: ToolCall,
    result: { content: string; isError: boolean; durationMs: number }
  ) => {
    collector.onToolEnd(tc, result);
    opts.onToolEnd?.(tc, result);
  };

  // LLM concurrency semaphore — prevents provider stampede across all agents
  const llmSemaphore = getLlmSemaphore();
  let releaseSemaphore: (() => void) | null = null;

  // Race: agent execution vs timeout vs optional cancellation
  const timeout = createTimeoutPromise(opts.timeoutMs, opts.timeoutLabel ?? 'Agent');
  const cancellation = opts.abortSignal ? createCancellationPromise(opts.abortSignal) : null;
  let chatResult: {
    ok: boolean;
    value?: { content?: string; usage?: { promptTokens?: number; completionTokens?: number } };
    error?: { message?: string };
  };
  try {
    // Acquire a concurrency slot before the LLM call fires
    releaseSemaphore = await llmSemaphore.acquire(
      opts.agentId ?? 'unknown',
      opts.agentId ?? opts.timeoutLabel ?? 'agent'
    );

    const agentPromise = opts.agent.chat(opts.message, {
      onToolEnd: wrappedOnToolEnd,
      onBeforeToolCall: opts.onBeforeToolCall,
    });
    // If timeout or cancellation wins the race, agentPromise keeps running and
    // may eventually reject (provider error, late timeout). Without a handler,
    // Node would emit unhandledRejection. timeout.promise / cancellation.promise
    // already suppress this internally.
    // eslint-disable-next-line no-restricted-syntax -- intentional: race-loser suppression
    agentPromise.catch(() => {});
    const promises: Promise<unknown>[] = [agentPromise, timeout.promise];
    if (cancellation) {
      promises.push(cancellation.promise);
    }
    chatResult = (await Promise.race(promises)) as typeof chatResult;
  } finally {
    releaseSemaphore?.();
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
 *
 * Trust boundary: Shared agent-runner helpers cast between typed tool-call envelopes and the executor's expected input shape. The executor contract is the trust boundary; the cast documents the call-site type agreement.
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
 *
 * Trust boundary: Shared agent-runner helpers cast between typed tool-call envelopes and the executor's expected input shape. The executor contract is the trust boundary; the cast documents the call-site type agreement.
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
