/**
 * Shared utilities for autonomous agent runners.
 *
 * Eliminates duplication across BackgroundAgentRunner, SubagentRunner,
 * and FleetWorker by extracting common patterns:
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

  // Create and populate tool registry
  const tools = new ToolRegistry();
  await registerAllToolSources(tools, opts.userId, opts.conversationId, opts.name);

  const agent = new Agent(
    {
      name: opts.name,
      systemPrompt: opts.systemPrompt,
      provider: {
        provider: providerType as AIProvider,
        apiKey,
        baseUrl: providerConfig?.baseUrl,
        headers: providerConfig?.headers,
      },
      model: {
        model: opts.model,
        maxTokens: opts.maxTokens ?? AGENT_DEFAULT_MAX_TOKENS,
        temperature: opts.temperature ?? AGENT_DEFAULT_TEMPERATURE,
      },
      maxTurns: opts.maxTurns,
      maxToolCalls: opts.maxToolCalls,
      tools: opts.toolFilter,
    },
    { tools }
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
 */
export function createTimeoutPromise(ms: number, label = 'Operation'): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  );
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
 */
export function createCancellationPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(new Error('Cancelled'));
      return;
    }
    signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true });
  });
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
  const promises: Promise<unknown>[] = [
    opts.agent.chat(opts.message, { onToolEnd: wrappedOnToolEnd }),
    createTimeoutPromise(opts.timeoutMs, opts.timeoutLabel ?? 'Agent'),
  ];
  if (opts.abortSignal) {
    promises.push(createCancellationPromise(opts.abortSignal));
  }

  const chatResult = (await Promise.race(promises)) as {
    ok: boolean;
    value?: { content?: string; usage?: { promptTokens?: number; completionTokens?: number } };
    error?: { message?: string };
  };

  // Unwrap Result type
  if (!chatResult.ok) {
    throw new Error(chatResult.error?.message ?? 'Agent execution failed');
  }

  const response = chatResult.value!;
  const durationMs = Date.now() - startTime;

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
