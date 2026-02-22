/**
 * Agent cache infrastructure and provider/config helpers.
 *
 * Extracted from agents.ts — contains runtime caches, LRU eviction,
 * provider resolution, and config-related helpers.
 */

import {
  type Agent,
  type AgentConfig,
  generateId,
  getProviderConfig as coreGetProviderConfig,
  getModelPricing,
  type AIProvider,
  TOOL_GROUPS,
} from '@ownpilot/core';
import { localProvidersRepo } from '../db/repositories/index.js';
import { getApiKey } from './settings.js';
import { getApprovalManager } from '../autonomy/index.js';
import type { ActionCategory } from '../autonomy/types.js';
import {
  MAX_AGENT_CACHE_SIZE,
  MAX_CHAT_AGENT_CACHE_SIZE,
  AGENT_CREATE_DEFAULT_MAX_TOKENS,
  AGENT_DEFAULT_TEMPERATURE,
  AGENT_DEFAULT_MAX_TURNS,
  AGENT_DEFAULT_MAX_TOOL_CALLS,
} from '../config/defaults.js';
import { getLog } from '../services/log.js';
import { safeStringArray } from './agent-tools.js';

const log = getLog('AgentCache');

/** Providers with built-in SDK support (non-native fall back to OpenAI-compatible) */
export const NATIVE_PROVIDERS = new Set([
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'groq',
  'mistral',
  'xai',
  'together',
  'fireworks',
  'perplexity',
]);

// Runtime agent cache (runtime instances, not serializable)
export const agentCache = new Map<string, Agent>();
export const agentConfigCache = new Map<string, AgentConfig>();
export const chatAgentCache = new Map<string, Agent>(); // Chat agents keyed by provider:model
export { MAX_AGENT_CACHE_SIZE, MAX_CHAT_AGENT_CACHE_SIZE };

/** LRU touch: move entry to end of Map iteration order */
export function lruGet<V>(cache: Map<string, V>, key: string): V | undefined {
  const value = cache.get(key);
  if (value !== undefined) {
    cache.delete(key);
    cache.set(key, value);
  }
  return value;
}

// In-flight creation promises to prevent duplicate concurrent creation
export const pendingAgents = new Map<string, Promise<Agent>>();
export const pendingChatAgents = new Map<string, Promise<Agent>>();

/**
 * Clear all agent caches
 * Call this when custom tools, plugins, or other dynamic resources change
 */
export function invalidateAgentCache(): void {
  agentCache.clear();
  agentConfigCache.clear();
  chatAgentCache.clear();
  pendingAgents.clear();
  pendingChatAgents.clear();
  log.info('Agent cache invalidated due to tool/plugin changes');
}

/**
 * Generate unique agent ID
 */
export function generateAgentId(): string {
  return generateId('agent');
}

/**
 * Create a requestApproval callback for agent configs.
 * Bridges the Agent tool system to the ApprovalManager.
 *
 * NOTE: This callback is used in non-streaming contexts where there is no
 * bidirectional channel to the user. If approval is required and no remembered
 * decision exists, the action is rejected immediately and the pending action
 * is cleaned up. Streaming paths use wireStreamApproval() instead, which can
 * send approval_required SSE events and await user response.
 */
export function createApprovalCallback(): AgentConfig['requestApproval'] {
  return async (category, actionType, description, params) => {
    const approvalMgr = getApprovalManager();
    const result = await approvalMgr.requestApproval(
      'default',
      category as ActionCategory,
      actionType,
      description,
      params
    );
    if (!result) return true;
    if (result.action.status === 'rejected') return false;

    // Non-streaming: no way to prompt user — reject and clean up the pending action
    approvalMgr.processDecision({
      actionId: result.action.id,
      decision: 'reject',
      reason: 'Auto-rejected: approval not available in non-streaming context',
    });
    return false;
  };
}

/**
 * Helper: Get API key for a provider
 * Uses getApiKey from settings which checks both env vars and database
 */
export async function getProviderApiKey(provider: string): Promise<string | undefined> {
  // Check local provider first (may have its own API key, or none required)
  const localProv = await localProvidersRepo.getProvider(provider);
  if (localProv) {
    // Local providers may not require API key; return key or a dummy placeholder
    return localProv.apiKey || 'local-no-key';
  }
  // Fallback to remote provider API key
  return await getApiKey(provider);
}

/**
 * Load provider config from core module
 * Uses the core's getProviderConfig which properly resolves JSON paths
 */
export function loadProviderConfig(
  providerId: string
): { baseUrl?: string; apiKeyEnv?: string; type?: string } | null {
  // 1. Check builtin provider configs
  const config = coreGetProviderConfig(providerId);
  if (config) {
    return {
      baseUrl: config.baseUrl,
      apiKeyEnv: config.apiKeyEnv,
      type: config.type,
    };
  }

  // 2. Check local providers (sync access via cache)
  const localProv = localProvidersRepo.getProviderSync(providerId);
  if (localProv) {
    // Ensure baseUrl ends with /v1 for OpenAI-compatible chat/completions endpoint
    // Discovery uses its own endpoint paths, but the provider SDK appends /chat/completions
    const base = localProv.baseUrl.replace(/\/+$/, '');
    const baseUrl = base.endsWith('/v1') ? base : `${base}/v1`;
    return {
      baseUrl,
      apiKeyEnv: undefined,
      type: 'openai-compatible',
    };
  }

  return null;
}

/**
 * Resolve context window size using the fallback chain:
 * 1. User model config override (from AI Models settings)
 * 2. Provider JSON config (accurate per-model data from models.dev)
 * 3. Static pricing database (may not have all models)
 * 4. Hardcoded fallback: 128K
 */
export function resolveContextWindow(
  provider: string,
  model: string,
  userOverride?: number
): number {
  if (userOverride !== undefined) return userOverride;

  // Provider config has accurate context windows for all models (loaded from JSON)
  const providerConfig = coreGetProviderConfig(provider);
  const modelConfig = providerConfig?.models?.find((m) => m.id === model);
  if (modelConfig?.contextWindow) return modelConfig.contextWindow;

  // Static pricing database (fallback — may match wrong model variant)
  const pricing = getModelPricing(provider as AIProvider, model);
  return pricing?.contextWindow ?? 128_000;
}

/**
 * Resolve toolGroups to individual tool names
 */
export function resolveToolGroups(
  toolGroups: string[] | undefined,
  explicitTools: string[] | undefined
): string[] {
  const tools = new Set<string>();

  // Add explicit tools first
  if (explicitTools && explicitTools.length > 0) {
    for (const tool of explicitTools) {
      tools.add(tool);
    }
  }

  // Add tools from groups
  if (toolGroups && toolGroups.length > 0) {
    for (const groupId of toolGroups) {
      const group = TOOL_GROUPS[groupId];
      if (group) {
        for (const tool of group.tools) {
          tools.add(tool);
        }
      }
    }
  }

  return Array.from(tools);
}

/** Resolve configured tools and toolGroups from an agent record's config */
export function resolveRecordTools(config: Record<string, unknown>): {
  configuredTools: string[] | undefined;
  configuredToolGroups: string[] | undefined;
  tools: string[];
} {
  const configuredTools = safeStringArray(config.tools);
  const configuredToolGroups = safeStringArray(config.toolGroups);
  const tools = resolveToolGroups(configuredToolGroups, configuredTools);
  return { configuredTools, configuredToolGroups, tools };
}

/** Build standardized agent config response object */
export function buildAgentConfigResponse(
  config: Record<string, unknown>,
  configuredTools: string[] | undefined,
  configuredToolGroups: string[] | undefined
) {
  return {
    maxTokens: (config.maxTokens as number) ?? AGENT_CREATE_DEFAULT_MAX_TOKENS,
    temperature: (config.temperature as number) ?? AGENT_DEFAULT_TEMPERATURE,
    maxTurns: (config.maxTurns as number) ?? AGENT_DEFAULT_MAX_TURNS,
    maxToolCalls: (config.maxToolCalls as number) ?? AGENT_DEFAULT_MAX_TOOL_CALLS,
    tools: configuredTools,
    toolGroups: configuredToolGroups,
  };
}

/** Invalidate both agent caches for a given agent ID */
export function evictAgentFromCache(id: string): void {
  agentCache.delete(id);
  agentConfigCache.delete(id);
}
