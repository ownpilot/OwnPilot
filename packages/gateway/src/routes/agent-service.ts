/**
 * Agent service — public API for creating, fetching, and managing agents.
 *
 * Extracted from agents.ts — contains createAgentFromRecord, getAgent,
 * getOrCreateDefaultAgent, getOrCreateChatAgent, session info,
 * context breakdown, compaction, and demo mode detection.
 */

import {
  hasServiceRegistry,
  getServiceRegistry,
  Services,
  createAgent,
  type Agent,
  type AgentConfig,
  type AIProvider,
  type WorkspaceContext,
  ToolRegistry,
  injectMemoryIntoPrompt,
  unsafeToolId,
  getBaseName,
  createProvider,
  type ProviderConfig,
} from '@ownpilot/core';
import type { SessionInfo } from '../types/index.js';
import { agentsRepo, type AgentRecord } from '../db/repositories/index.js';
import {
  resolveProviderAndModel,
  getDefaultProvider,
  getDefaultModel,
  getConfiguredProviderIds,
  getEnabledToolGroupIds,
} from './settings.js';
import { localProvidersRepo } from '../db/repositories/local-providers.js';
import { gatewayConfigCenter } from '../services/config-center-impl.js';
import { getLog } from '../services/log.js';
import { BASE_SYSTEM_PROMPT } from './agent-prompt.js';
import {
  registerGatewayTools,
  registerDynamicTools,
  registerPluginTools,
  registerExtensionTools,
  registerMcpTools,
  registerAllTools,
  getToolDefinitions,
  MEMORY_TOOLS,
  GOAL_TOOLS,
  CUSTOM_DATA_TOOLS,
  PERSONAL_DATA_TOOLS,
  CONFIG_TOOLS,
  TRIGGER_TOOLS,
  PLAN_TOOLS,
  HEARTBEAT_TOOLS,
  EXTENSION_TOOLS,
  DYNAMIC_TOOL_DEFINITIONS,
} from './agent-tools.js';
import {
  NATIVE_PROVIDERS,
  agentCache,
  agentConfigCache,
  chatAgentCache,
  pendingAgents,
  pendingChatAgents,
  lruGet,
  createApprovalCallback,
  getProviderApiKey,
  loadProviderConfig,
  resolveContextWindow,
  resolveRecordTools,
  resolveToolGroups,
  evictAgentFromCache,
  MAX_AGENT_CACHE_SIZE,
  MAX_CHAT_AGENT_CACHE_SIZE,
} from './agent-cache.js';
import {
  AGENT_DEFAULT_MAX_TOKENS,
  AGENT_DEFAULT_TEMPERATURE,
  AGENT_DEFAULT_MAX_TURNS,
  AGENT_DEFAULT_MAX_TOOL_CALLS,
  AI_META_TOOL_NAMES,
} from '../config/defaults.js';

const log = getLog('AgentService');

// =============================================================================
// Agent creation
// =============================================================================

/**
 * Create runtime Agent instance from database record
 */
async function createAgentFromRecord(record: AgentRecord): Promise<Agent> {
  // Resolve "default" provider/model to actual values via IProviderService
  const providerSvc = hasServiceRegistry() ? getServiceRegistry().tryGet(Services.Provider) : null;

  const { provider: resolvedProvider, model: resolvedModel } = providerSvc
    ? await providerSvc.resolve({ provider: record.provider, model: record.model })
    : await resolveProviderAndModel(record.provider, record.model);

  // Validate resolved values
  if (!resolvedProvider) {
    throw new Error('No provider configured. Configure a provider in Settings.');
  }
  if (!resolvedModel) {
    throw new Error(`No model configured for provider: ${resolvedProvider}`);
  }

  const apiKey = await getProviderApiKey(resolvedProvider);
  if (!apiKey) {
    throw new Error(`API key not configured for provider: ${resolvedProvider}`);
  }

  // Load provider config to get baseUrl for non-native providers
  const providerConfig = loadProviderConfig(resolvedProvider);
  const baseUrl = providerConfig?.baseUrl;

  // Determine the actual provider type for the core library
  const providerType = NATIVE_PROVIDERS.has(resolvedProvider) ? resolvedProvider : 'openai';

  // Create tool registry with ALL tools (not just core)
  const tools = new ToolRegistry();
  registerAllTools(tools);
  tools.setConfigCenter(gatewayConfigCenter);

  // Register all gateway domain tools (memory, goals, etc.) with tracing
  const userId = 'default';
  registerGatewayTools(tools, userId, true);

  // Register dynamic tools (CRUD meta-tools, special meta-tools, active custom tools)
  const activeCustomToolDefs = await registerDynamicTools(tools, userId, record.id, true);
  log.info(`Registered ${activeCustomToolDefs.length} active custom tools`);

  // Register plugin tools and remove superseded core stubs
  const pluginToolDefs = registerPluginTools(tools, true);
  log.info(`Registered ${pluginToolDefs.length} plugin tools`);

  // Register extension tools (from installed extensions)
  const extensionToolDefs = registerExtensionTools(tools, userId, true);
  if (extensionToolDefs.length > 0) {
    log.info(`Registered ${extensionToolDefs.length} extension tools`);
  }

  // Register MCP tools from connected external MCP servers
  const mcpToolDefs = registerMcpTools(tools, true);
  if (mcpToolDefs.length > 0) {
    log.info(`Registered ${mcpToolDefs.length} MCP tools`);
  }

  // Separate standard tools (from TOOL_GROUPS) and special tools that bypass filtering
  // Filter getToolDefinitions() to exclude stubs that were unregistered above
  const coreToolDefs = getToolDefinitions().filter((t) => tools.has(t.name));
  const standardToolDefs = [
    ...coreToolDefs,
    ...MEMORY_TOOLS,
    ...GOAL_TOOLS,
    ...CUSTOM_DATA_TOOLS,
    ...PERSONAL_DATA_TOOLS,
    ...CONFIG_TOOLS,
    ...TRIGGER_TOOLS,
    ...PLAN_TOOLS,
    ...HEARTBEAT_TOOLS,
    ...EXTENSION_TOOLS,
  ];

  // These tools ALWAYS bypass toolGroup filtering:
  const alwaysIncludedToolDefs = [
    ...DYNAMIC_TOOL_DEFINITIONS,
    ...activeCustomToolDefs,
    ...pluginToolDefs,
    ...extensionToolDefs,
    ...mcpToolDefs,
  ];

  // Filter tools: per-agent toolGroups first, fall back to global settings
  const { tools: resolvedToolNames, configuredToolGroups } = resolveRecordTools(record.config);
  const hasAgentConfig =
    (configuredToolGroups && configuredToolGroups.length > 0) || resolvedToolNames.length > 0;

  let filteredStandardTools: typeof standardToolDefs;
  if (hasAgentConfig) {
    // Per-agent toolGroups override
    const agentAllowed = new Set(resolvedToolNames);
    filteredStandardTools = standardToolDefs.filter(
      (tool) => agentAllowed.has(tool.name) || agentAllowed.has(getBaseName(tool.name))
    );
  } else {
    // Fall back to global tool-groups setting
    const globalGroupIds = getEnabledToolGroupIds();
    const globalAllowed = new Set(resolveToolGroups(globalGroupIds, undefined));
    filteredStandardTools = standardToolDefs.filter(
      (tool) => globalAllowed.has(tool.name) || globalAllowed.has(getBaseName(tool.name))
    );
  }

  const toolDefs = [...filteredStandardTools, ...alwaysIncludedToolDefs];

  const basePrompt = record.systemPrompt ?? 'You are a helpful personal AI assistant.';

  let { systemPrompt: enhancedPrompt } = await injectMemoryIntoPrompt(basePrompt, {
    userId: 'default',
    tools: toolDefs,
    includeProfile: true,
    includeInstructions: true,
    includeTimeContext: true,
    includeToolDescriptions: true,
  });

  // Inject extension system prompts
  try {
    const extPromptSections = getServiceRegistry()
      .get(Services.Extension)
      .getSystemPromptSections();
    if (extPromptSections.length > 0) {
      enhancedPrompt += '\n\n' + extPromptSections.join('\n\n');
    }
  } catch {
    log.debug('Extension service not initialized, skipping system prompt injection');
  }

  const metaToolFilter = AI_META_TOOL_NAMES.map((n) => unsafeToolId(n));

  const config: AgentConfig = {
    name: record.name,
    systemPrompt: enhancedPrompt,
    provider: {
      provider: providerType as AIProvider,
      apiKey,
      baseUrl,
    },
    model: {
      model: resolvedModel,
      maxTokens: (record.config.maxTokens as number) ?? AGENT_DEFAULT_MAX_TOKENS,
      temperature: (record.config.temperature as number) ?? AGENT_DEFAULT_TEMPERATURE,
    },
    maxTurns: (record.config.maxTurns as number) ?? AGENT_DEFAULT_MAX_TURNS,
    maxToolCalls: (record.config.maxToolCalls as number) ?? AGENT_DEFAULT_MAX_TOOL_CALLS,
    tools: metaToolFilter,
    requestApproval: createApprovalCallback(),
  };

  const agent = createAgent(config, { tools });

  // Evict oldest entry if cache is at capacity
  if (agentCache.size >= MAX_AGENT_CACHE_SIZE) {
    const oldestKey = agentCache.keys().next().value;
    if (oldestKey) {
      evictAgentFromCache(oldestKey);
    }
  }

  agentCache.set(record.id, agent);
  agentConfigCache.set(record.id, config);

  return agent;
}

/**
 * Get or create runtime Agent instance.
 * Uses promise-based deduplication so concurrent requests for the same agent
 * share a single createAgentFromRecord call instead of racing.
 */
export async function getOrCreateAgentInstance(record: AgentRecord): Promise<Agent> {
  const cached = lruGet(agentCache, record.id);
  if (cached) return cached;

  const pending = pendingAgents.get(record.id);
  if (pending) return pending;

  const promise = createAgentFromRecord(record).finally(() => {
    pendingAgents.delete(record.id);
  });
  pendingAgents.set(record.id, promise);

  return promise;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Get agent from store (database + cache).
 */
export async function getAgent(id: string): Promise<Agent | undefined> {
  const cached = lruGet(agentCache, id);
  if (cached) return cached;

  const pending = pendingAgents.get(id);
  if (pending) {
    try {
      return await pending;
    } catch {
      return undefined;
    }
  }

  const record = await agentsRepo.getById(id);
  if (!record) return undefined;

  const promise = createAgentFromRecord(record).finally(() => {
    pendingAgents.delete(id);
  });
  pendingAgents.set(id, promise);

  try {
    return await promise;
  } catch {
    return undefined;
  }
}

/**
 * Get or create default agent.
 */
export async function getOrCreateDefaultAgent(): Promise<Agent> {
  const defaultId = 'default';

  const cached = lruGet(agentCache, defaultId);
  if (cached) return cached;

  const pending = pendingAgents.get(defaultId);
  if (pending) return pending;

  const promise = (async () => {
    let record = await agentsRepo.getById(defaultId);

    if (!record) {
      const provider = await getDefaultProvider();
      if (!provider) {
        throw new Error(
          'No API key configured for any provider. Configure a provider in Settings.'
        );
      }

      const model = await getDefaultModel(provider);
      if (!model) {
        throw new Error(`No model available for provider: ${provider}`);
      }

      record = await agentsRepo.create({
        id: defaultId,
        name: 'Personal Assistant',
        systemPrompt: BASE_SYSTEM_PROMPT,
        provider,
        model,
        config: {
          maxTokens: AGENT_DEFAULT_MAX_TOKENS,
          temperature: AGENT_DEFAULT_TEMPERATURE,
          maxTurns: AGENT_DEFAULT_MAX_TURNS,
          maxToolCalls: AGENT_DEFAULT_MAX_TOOL_CALLS,
        },
      });
    }

    return createAgentFromRecord(record);
  })().finally(() => {
    pendingAgents.delete(defaultId);
  });
  pendingAgents.set(defaultId, promise);

  return promise;
}

/**
 * Get or create an agent for chat with specific provider and model.
 */
export async function getOrCreateChatAgent(provider: string, model: string): Promise<Agent> {
  const cacheKey = `chat|${provider.replace(/\|/g, '_')}|${model.replace(/\|/g, '_')}`;

  const cached = lruGet(chatAgentCache, cacheKey);
  if (cached) return cached;

  const pending = pendingChatAgents.get(cacheKey);
  if (pending) return pending;

  const promise = createChatAgentInstance(provider, model, cacheKey).finally(() => {
    pendingChatAgents.delete(cacheKey);
  });
  pendingChatAgents.set(cacheKey, promise);

  return promise;
}

/**
 * Internal: Create a chat agent instance.
 */
async function createChatAgentInstance(
  provider: string,
  model: string,
  cacheKey: string
): Promise<Agent> {
  const apiKey = await getProviderApiKey(provider);
  if (!apiKey) {
    throw new Error(`API key not configured for provider: ${provider}`);
  }

  const providerConfig = loadProviderConfig(provider);
  const baseUrl = providerConfig?.baseUrl;
  const providerType = NATIVE_PROVIDERS.has(provider) ? provider : 'openai';

  const tools = new ToolRegistry();
  registerAllTools(tools);
  tools.setConfigCenter(gatewayConfigCenter);

  const userId = 'default';
  registerGatewayTools(tools, userId, false);

  const activeCustomToolDefs = await registerDynamicTools(
    tools,
    userId,
    `chat_${provider}_${model}`,
    false
  );
  const pluginToolDefs = registerPluginTools(tools, false);
  const extensionToolDefs = registerExtensionTools(tools, userId, false);
  const mcpToolDefs = registerMcpTools(tools, false);

  const chatCoreToolDefs = getToolDefinitions().filter((t) => tools.has(t.name));
  const chatStandardToolDefs = [
    ...chatCoreToolDefs,
    ...MEMORY_TOOLS,
    ...GOAL_TOOLS,
    ...CUSTOM_DATA_TOOLS,
    ...PERSONAL_DATA_TOOLS,
    ...CONFIG_TOOLS,
    ...TRIGGER_TOOLS,
    ...PLAN_TOOLS,
    ...HEARTBEAT_TOOLS,
    ...EXTENSION_TOOLS,
  ];
  const chatAlwaysIncluded = [
    ...DYNAMIC_TOOL_DEFINITIONS,
    ...activeCustomToolDefs,
    ...pluginToolDefs,
    ...extensionToolDefs,
    ...mcpToolDefs,
  ];

  // Filter by global tool-groups setting
  const enabledGroupIds = getEnabledToolGroupIds();
  const allowedToolNames = new Set(resolveToolGroups(enabledGroupIds, undefined));
  const filteredChatTools = chatStandardToolDefs.filter(
    (tool) => allowedToolNames.has(tool.name) || allowedToolNames.has(getBaseName(tool.name))
  );
  const toolDefs = [...filteredChatTools, ...chatAlwaysIncluded];

  const basePrompt = BASE_SYSTEM_PROMPT;
  let { systemPrompt: enhancedPrompt } = await injectMemoryIntoPrompt(basePrompt, {
    userId: 'default',
    tools: toolDefs,
    includeProfile: true,
    includeInstructions: true,
    includeTimeContext: true,
    includeToolDescriptions: true,
  });

  try {
    const extPromptSections = getServiceRegistry()
      .get(Services.Extension)
      .getSystemPromptSections();
    if (extPromptSections.length > 0) {
      enhancedPrompt += '\n\n' + extPromptSections.join('\n\n');
    }
  } catch {
    log.debug('Extension service not initialized, skipping system prompt injection');
  }

  const chatMetaToolFilter = AI_META_TOOL_NAMES.map((n) => unsafeToolId(n));

  const ctxWindow = resolveContextWindow(provider, model);
  const memoryMaxTokens = Math.floor(ctxWindow * 0.75);

  const config: AgentConfig = {
    name: `Personal Assistant (${provider})`,
    systemPrompt: enhancedPrompt,
    provider: {
      provider: providerType as AIProvider,
      apiKey,
      baseUrl,
    },
    model: {
      model,
      maxTokens: AGENT_DEFAULT_MAX_TOKENS,
      temperature: AGENT_DEFAULT_TEMPERATURE,
    },
    maxTurns: AGENT_DEFAULT_MAX_TURNS,
    maxToolCalls: AGENT_DEFAULT_MAX_TOOL_CALLS,
    tools: chatMetaToolFilter,
    requestApproval: createApprovalCallback(),
    memory: { maxTokens: memoryMaxTokens },
  };

  if (chatAgentCache.size >= MAX_CHAT_AGENT_CACHE_SIZE) {
    const oldestKey = chatAgentCache.keys().next().value;
    if (oldestKey) chatAgentCache.delete(oldestKey);
  }

  const agent = createAgent(config, { tools });
  chatAgentCache.set(cacheKey, agent);

  return agent;
}

/**
 * Reset chat agent context - clears conversation memory
 */
export function resetChatAgentContext(
  provider: string,
  model: string
): { reset: boolean; newSessionId?: string } {
  const cacheKey = `chat|${provider.replace(/\|/g, '_')}|${model.replace(/\|/g, '_')}`;
  const agent = chatAgentCache.get(cacheKey);

  if (agent) {
    const memory = agent.getMemory();
    const currentConversation = agent.getConversation();
    memory.delete(currentConversation.id);
    const newConversation = memory.create(currentConversation.systemPrompt);
    agent.loadConversation(newConversation.id);

    log.info(`Reset context for ${provider}/${model}, new conversation: ${newConversation.id}`);
    return { reset: true, newSessionId: newConversation.id };
  }

  return { reset: false };
}

/**
 * Get session info (context usage) for an agent's current conversation.
 */
export function getSessionInfo(
  agent: Agent,
  provider: string,
  model: string,
  contextWindowOverride?: number
): SessionInfo {
  const conversation = agent.getConversation();
  const memory = agent.getMemory();
  const stats = memory.getStats(conversation.id);
  const maxCtx = resolveContextWindow(provider, model, contextWindowOverride);
  const estimated = stats?.estimatedTokens ?? 0;

  return {
    sessionId: conversation.id,
    messageCount: stats?.messageCount ?? 0,
    estimatedTokens: estimated,
    maxContextTokens: maxCtx,
    contextFillPercent: Math.min(100, Math.round((estimated / maxCtx) * 100)),
  };
}

/**
 * Clear all chat agent caches - useful for full reset
 */
export function clearAllChatAgentCaches(): number {
  const count = chatAgentCache.size;
  chatAgentCache.clear();
  log.info(`Cleared ${count} cached chat agents`);
  return count;
}

// =============================================================================
// Context breakdown
// =============================================================================

export interface ContextBreakdown {
  systemPromptTokens: number;
  messageHistoryTokens: number;
  messageCount: number;
  maxContextTokens: number;
  modelName: string;
  providerName: string;
  sections: Array<{ name: string; tokens: number }>;
}

/**
 * Get detailed context breakdown for a cached chat agent.
 */
export function getContextBreakdown(
  provider: string,
  model: string,
  contextWindowOverride?: number
): ContextBreakdown | null {
  const cacheKey = `chat|${provider.replace(/\|/g, '_')}|${model.replace(/\|/g, '_')}`;
  const agent = chatAgentCache.get(cacheKey);
  if (!agent) return null;

  const conversation = agent.getConversation();
  const memory = agent.getMemory();
  const maxCtx = resolveContextWindow(provider, model, contextWindowOverride);
  const systemPrompt = conversation.systemPrompt ?? '';
  const stats = memory.getStats(conversation.id);

  const sections: Array<{ name: string; tokens: number }> = [];
  const headingRegex = /^## (.+)/gm;
  const headings: Array<{ name: string; start: number }> = [];
  let m;
  while ((m = headingRegex.exec(systemPrompt)) !== null) {
    headings.push({ name: m[1]!, start: m.index });
  }

  const firstHeading = headings[0];
  if (firstHeading && firstHeading.start > 0) {
    sections.push({ name: 'Base Prompt', tokens: Math.ceil(firstHeading.start / 4) });
  } else if (headings.length === 0 && systemPrompt.length > 0) {
    sections.push({ name: 'System Prompt', tokens: Math.ceil(systemPrompt.length / 4) });
  }

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i]!;
    const end = headings[i + 1]?.start ?? systemPrompt.length;
    sections.push({
      name: heading.name,
      tokens: Math.ceil((end - heading.start) / 4),
    });
  }

  return {
    systemPromptTokens: Math.ceil(systemPrompt.length / 4),
    messageHistoryTokens: stats?.estimatedTokens ?? 0,
    messageCount: stats?.messageCount ?? 0,
    maxContextTokens: maxCtx,
    modelName: model,
    providerName: provider,
    sections,
  };
}

// =============================================================================
// Context compaction
// =============================================================================

/**
 * Compact conversation context by summarizing old messages.
 */
export async function compactContext(
  provider: string,
  model: string,
  keepRecentMessages: number = 6
): Promise<{
  compacted: boolean;
  summary?: string;
  removedMessages: number;
  newTokenEstimate: number;
}> {
  const cacheKey = `chat|${provider.replace(/\|/g, '_')}|${model.replace(/\|/g, '_')}`;
  const agent = chatAgentCache.get(cacheKey);
  if (!agent) {
    return { compacted: false, removedMessages: 0, newTokenEstimate: 0 };
  }

  const conversation = agent.getConversation();
  const memory = agent.getMemory();
  const messages = memory.getContextMessages(conversation.id);

  if (messages.length <= keepRecentMessages + 2) {
    return { compacted: false, removedMessages: 0, newTokenEstimate: 0 };
  }

  const olderMessages = messages.slice(0, messages.length - keepRecentMessages);
  const recentMessages = messages.slice(messages.length - keepRecentMessages);

  const conversationText = olderMessages
    .map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content : '[complex content]'}`)
    .join('\n');

  const summaryPrompt = `Summarize the following conversation history into a concise summary (max 200 words). Focus on key topics discussed, decisions made, and important context needed to continue the conversation naturally:\n\n${conversationText}`;

  const apiKey = await getProviderApiKey(provider);
  if (!apiKey) {
    return { compacted: false, removedMessages: 0, newTokenEstimate: 0 };
  }

  const providerConfig = loadProviderConfig(provider);
  const providerType = NATIVE_PROVIDERS.has(provider) ? provider : 'openai';

  try {
    const summaryProvider = createProvider({
      provider: providerType as ProviderConfig['provider'],
      apiKey,
      baseUrl: providerConfig?.baseUrl,
    });

    const result = await summaryProvider.complete({
      messages: [{ role: 'user', content: summaryPrompt }],
      model: { model, maxTokens: 500, temperature: 0.3 },
    });

    if (!result.ok) {
      log.warn('Context compaction failed: AI summarization error');
      return { compacted: false, removedMessages: 0, newTokenEstimate: 0 };
    }

    const summary = result.value.content;

    memory.clearMessages(conversation.id);
    memory.addMessage(conversation.id, {
      role: 'user',
      content: `[Previous conversation summary: ${summary}]`,
    });
    memory.addMessage(conversation.id, {
      role: 'assistant',
      content: 'Understood. I have the context from our earlier conversation. How can I help?',
    });

    for (const msg of recentMessages) {
      memory.addMessage(conversation.id, msg);
    }

    const newStats = memory.getStats(conversation.id);
    const removedCount = olderMessages.length;

    log.info(
      `Compacted context: removed ${removedCount} messages, kept ${recentMessages.length} recent`
    );

    return {
      compacted: true,
      summary,
      removedMessages: removedCount,
      newTokenEstimate: newStats?.estimatedTokens ?? 0,
    };
  } catch (err) {
    log.error('Context compaction error:', err);
    return { compacted: false, removedMessages: 0, newTokenEstimate: 0 };
  }
}

/**
 * Get workspace context for file operations
 */
export function getWorkspaceContext(sessionWorkspaceDir?: string): WorkspaceContext {
  const workspaceDir = sessionWorkspaceDir ?? process.env.WORKSPACE_DIR ?? process.cwd();
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? undefined;
  const tempDir = process.platform === 'win32' ? 'C:\\Temp' : '/tmp';

  return {
    workspaceDir,
    homeDir,
    tempDir,
  };
}

/**
 * Check if demo mode is enabled (no API keys configured)
 */
export async function isDemoMode(): Promise<boolean> {
  // Check cloud providers
  const configured = await getConfiguredProviderIds();
  const providers = [
    'openai',
    'anthropic',
    'zhipu',
    'deepseek',
    'groq',
    'google',
    'xai',
    'mistral',
    'together',
    'fireworks',
    'perplexity',
  ];
  if (providers.some((p) => configured.has(p))) return false;

  // Check local providers (Ollama, LM Studio, etc.)
  const localProviders = await localProvidersRepo.listProviders();
  if (localProviders.some((p: { isEnabled: boolean }) => p.isEnabled)) return false;

  return true;
}
