/**
 * Agent service — public API for creating, fetching, and managing agents.
 *
 * Extracted from agents.ts — contains createAgentFromRecord, getAgent,
 * getOrCreateDefaultAgent, getOrCreateChatAgent, session info,
 * context breakdown, compaction, and demo mode detection.
 */

import {
  createAgent,
  type Agent,
  type AgentConfig,
  type IProvider,
  type WorkspaceContext,
  injectMemoryIntoPrompt,
  createFallbackProvider,
  type ResolvedAuth,
  buildSoulPrompt,
} from '@ownpilot/core/agent';
import { ToolRegistry, getBaseName } from '@ownpilot/core/tools';
import { hasProviderService, getProviderService } from '@ownpilot/core/services';
import type { AIProvider } from '@ownpilot/core/costs';
import { unsafeToolId } from '@ownpilot/core/types';
import { agentsRepo, type AgentRecord } from '../../db/repositories/index.js';
import {
  resolveDefaultProviderAndModel,
  getDefaultProvider,
  getDefaultModel,
  getConfiguredProviderIds,
  getEnabledToolGroupIds,
} from '../app-settings.js';
import { resolveAuthForRequest } from '../auth/oauth-flow.js';
import { localProvidersRepo } from '../../db/repositories/local-providers.js';
import { getSoulsRepository } from '../../db/repositories/souls.js';
import { getAgentMessagesRepository } from '../../db/repositories/agents/messages.js';
import { getLog } from '../log.js';
import { BASE_SYSTEM_PROMPT, CLI_SYSTEM_PROMPT } from './prompt.js';
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
  NOTIFICATION_TOOLS,
  EVENT_TOOLS,
  SOUL_COMMUNICATION_TOOLS,
  DYNAMIC_TOOL_DEFINITIONS,
} from '../../tools/agent-tool-registry.js';
import {
  NATIVE_PROVIDERS,
  agentCache,
  agentConfigCache,
  chatAgentCache,
  pendingAgents,
  pendingChatAgents,
  lruGet,
  createApprovalCallback,
  createSoulAwareApprovalCallback,
  getProviderApiKey,
  loadProviderConfig,
  resolveRecordTools,
  resolveToolGroups,
  evictAgentFromCache,
  MAX_AGENT_CACHE_SIZE,
  MAX_CHAT_AGENT_CACHE_SIZE,
} from './cache.js';
import { getLLMRouter, getConfigCenter } from '@ownpilot/core/services';
import {
  AGENT_DEFAULT_MAX_TOKENS,
  AGENT_DEFAULT_TEMPERATURE,
  AGENT_DEFAULT_MAX_TURNS,
  AGENT_DEFAULT_MAX_TOOL_CALLS,
  AI_META_TOOL_NAMES,
} from '../../config/defaults.js';
import {
  isCliChatProvider,
  getCliBinaryFromProviderId,
  createCliChatProvider,
  getCliChatProviderDefinition,
} from '../cli/chat-provider.js';

const log = getLog('AgentService');

// =============================================================================
// CLI Provider Correlation (links MCP tool calls to chat SSE streams)
// =============================================================================

/** WeakMap to store correlationId for CLI agents (for MCP event forwarding) */
const cliCorrelationIds = new WeakMap<Agent, string>();

/**
 * Get the MCP correlation ID for a CLI agent.
 * Returns undefined for non-CLI agents.
 */
export function getCliCorrelationId(agent: Agent): string | undefined {
  return cliCorrelationIds.get(agent);
}

// =============================================================================
// Agent creation
// =============================================================================

/**
 * Create runtime Agent instance from database record
 */
async function createAgentFromRecord(record: AgentRecord): Promise<Agent> {
  // Resolve "default" provider/model to actual values via IProviderService
  const providerSvc = hasProviderService() ? getProviderService() : null;

  const { provider: resolvedProvider, model: resolvedModel } = providerSvc
    ? await providerSvc.resolve({ provider: record.provider, model: record.model })
    : await resolveDefaultProviderAndModel(record.provider, record.model);

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
  tools.setConfigCenter(getConfigCenter());

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
    ...NOTIFICATION_TOOLS,
    ...EVENT_TOOLS,
    ...SOUL_COMMUNICATION_TOOLS,
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

  // ── Soul prompt injection ──
  // If this agent has a soul, prepend the soul prompt to the base system prompt.
  let soulSection = '';
  let soulAutonomy = null;
  try {
    const soul = await getSoulsRepository().getByAgentId(record.id);
    if (soul) {
      const pendingInbox = await getAgentMessagesRepository().countUnread(record.id);
      soulSection = buildSoulPrompt(soul, [], pendingInbox);
      soulAutonomy = soul.autonomy;
    }
  } catch {
    // Soul lookup failure is non-fatal — agent works without a soul
  }

  const rawBasePrompt = record.systemPrompt ?? 'You are a helpful personal AI assistant.';
  const basePrompt = soulSection ? `${soulSection}\n\n${rawBasePrompt}` : rawBasePrompt;

  const { systemPrompt: enhancedPrompt } = await injectMemoryIntoPrompt(basePrompt, {
    userId: 'default',
    tools: toolDefs,
    includeProfile: true,
    includeInstructions: true,
    includeTimeContext: true,
    includeToolDescriptions: true,
  });

  // Extension sections are now injected per-request by the context-injection middleware
  // based on routing decisions from the request-preprocessor middleware.

  const metaToolFilter = AI_META_TOOL_NAMES.map((n) => unsafeToolId(n));

  // ── Autonomy Level Enforcement (AGENT-HIGH-002) ──
  // Use soul-aware approval callback if this agent has a soul with autonomy config
  const approvalCallback = soulAutonomy
    ? createSoulAwareApprovalCallback(record.id, record.name, soulAutonomy)
    : createApprovalCallback();

  const config: AgentConfig = {
    name: record.name,
    systemPrompt: enhancedPrompt,
    provider: {
      provider: providerType as AIProvider,
      apiKey,
      baseUrl,
      headers: providerConfig?.headers,
    },
    model: {
      model: resolvedModel,
      maxTokens: (record.config.maxTokens as number) ?? AGENT_DEFAULT_MAX_TOKENS,
      temperature: (record.config.temperature as number) ?? AGENT_DEFAULT_TEMPERATURE,
    },
    maxTurns: (record.config.maxTurns as number) ?? AGENT_DEFAULT_MAX_TURNS,
    maxToolCalls: (record.config.maxToolCalls as number) ?? AGENT_DEFAULT_MAX_TOOL_CALLS,
    tools: metaToolFilter,
    requestApproval: approvalCallback,
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
 *
 * Race-safety: the pending entry is installed synchronously (no await
 * between check and set), so concurrent callers under the same id all
 * await the same DB read + agent construction. Without this, two
 * requests racing through the cache-miss path would each start their
 * own DB query and agent build — orphaning one of the resulting agents
 * when the second `agentCache.set` overwrites the first.
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

  const promise = (async () => {
    const record = await agentsRepo.getById(id);
    if (!record) return undefined;
    return createAgentFromRecord(record);
  })().finally(() => {
    pendingAgents.delete(id);
  });
  pendingAgents.set(id, promise as Promise<Agent>);

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
 * Optionally accepts a fallback provider/model for automatic failover.
 */
export async function getOrCreateChatAgent(
  provider: string,
  model: string,
  fallback?: { provider: string; model: string },
  pageContext?: { path?: string } | null,
  conversationId?: string,
  gatewayUrl?: string
): Promise<Agent> {
  // CLI providers are NOT cached — each request may need fresh MCP session state
  // while still reusing the persistent ~/.ownpilot/workspace directory.
  if (isCliChatProvider(provider)) {
    return createChatAgentInstance(
      provider,
      model,
      `cli-${Date.now()}`,
      fallback,
      pageContext,
      gatewayUrl
    );
  }

  // Per-conversation cache key when conversationId is provided.
  // Each conversation gets its own agent instance so parallel chats don't block
  // each other with "Agent is already processing a request" errors.
  const sanitize = (s: string) => s.replace(/\|/g, '_');
  const fbSuffix = fallback ? `|fb_${sanitize(fallback.provider)}_${sanitize(fallback.model)}` : '';
  const pathSuffix = pageContext?.path ? `|dir_${sanitize(pageContext.path)}` : '';
  const convSuffix = conversationId ? `|conv_${sanitize(conversationId)}` : '';
  const cacheKey = `chat|${sanitize(provider)}|${sanitize(model)}${fbSuffix}${pathSuffix}${convSuffix}`;

  const cached = lruGet(chatAgentCache, cacheKey);
  if (cached) return cached;

  const pending = pendingChatAgents.get(cacheKey);
  if (pending) return pending;

  const promise = createChatAgentInstance(
    provider,
    model,
    cacheKey,
    fallback,
    pageContext,
    gatewayUrl
  ).finally(() => {
    pendingChatAgents.delete(cacheKey);
  });
  pendingChatAgents.set(cacheKey, promise);

  return promise;
}

/**
 * Internal: Create a chat agent instance.
 * When a fallback is provided, wraps the provider in a FallbackProvider
 * so the agent automatically retries with the backup on failure.
 */
async function createChatAgentInstance(
  provider: string,
  model: string,
  cacheKey: string,
  fallback?: { provider: string; model: string },
  _pageContext?: { path?: string } | null,
  gatewayUrl?: string
): Promise<Agent> {
  // ── CLI Chat Provider path ──
  // CLI providers (cli-claude, cli-codex, cli-gemini) use login-based auth
  // and don't require API keys. They spawn CLI processes for completions.
  const isCliProvider = isCliChatProvider(provider);
  let correlationId: string | undefined;

  let apiKey: string | undefined;
  let resolvedAuth: ResolvedAuth | undefined;
  if (!isCliProvider) {
    resolvedAuth = await resolveAuthForRequest(provider);
    apiKey = resolvedAuth?.value ?? (await getProviderApiKey(provider));
    if (!apiKey) {
      throw new Error(`API key not configured for provider: ${provider}`);
    }
  }

  const providerConfig = isCliProvider ? null : loadProviderConfig(provider);
  const baseUrl = providerConfig?.baseUrl;

  // For CLI providers, map to the underlying core provider type
  const cliDef = isCliProvider ? getCliChatProviderDefinition(provider) : null;
  const providerType = isCliProvider
    ? (cliDef?.coreProvider ?? 'openai')
    : NATIVE_PROVIDERS.has(provider)
      ? provider
      : (providerConfig?.type ?? 'openai');

  const tools = new ToolRegistry();
  registerAllTools(tools);
  tools.setConfigCenter(getConfigCenter());

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
    ...NOTIFICATION_TOOLS,
    ...EVENT_TOOLS,
    ...SOUL_COMMUNICATION_TOOLS,
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

  // CLI providers get a compact identity-first prompt (no meta-tools, no namespaces).
  // API providers get the full prompt with tool schemas injected.
  const basePrompt = isCliProvider ? CLI_SYSTEM_PROMPT : BASE_SYSTEM_PROMPT;
  const { systemPrompt: enhancedPrompt } = await injectMemoryIntoPrompt(basePrompt, {
    userId: 'default',
    tools: isCliProvider ? [] : toolDefs, // CLI tools are discovered via MCP, not injected
    includeProfile: true,
    includeInstructions: true,
    includeTimeContext: true,
    includeToolDescriptions: !isCliProvider, // CLI doesn't need tool descriptions in prompt
  });

  // Extension sections are now injected per-request by the context-injection middleware
  // based on routing decisions from the request-preprocessor middleware.

  const chatMetaToolFilter = AI_META_TOOL_NAMES.map((n) => unsafeToolId(n));

  const router = getLLMRouter();
  const ctxWindow = router.getContextWindow(provider, model);
  // For chat we DO include the dynamic-injection reserve because
  // context-injection middleware grows the system prompt per request with
  // extensions, skills, page context, tool suggestions, and data hints.
  const systemPromptTokens = Math.ceil(enhancedPrompt.length / 4);
  const modelMaxOutput = router.getMaxOutput(provider, model);
  const outputBuffer = Math.min(AGENT_DEFAULT_MAX_TOKENS, modelMaxOutput);
  const memoryMaxTokens = router.computeMemoryMaxTokens({
    ctxWindow,
    systemPromptTokens,
    outputBuffer,
  });

  const config: AgentConfig = {
    name: isCliProvider
      ? `Personal Assistant (${cliDef?.displayName ?? provider})`
      : `Personal Assistant (${provider})`,
    systemPrompt: enhancedPrompt,
    provider: {
      id: provider,
      provider: providerType as AIProvider,
      apiKey: apiKey ?? 'cli-no-key',
      resolvedAuth,
      baseUrl,
      headers: providerConfig?.headers,
      endpoint: providerConfig?.endpoint,
      features: providerConfig?.features,
    },
    model: {
      model,
      // Honor the model's real output ceiling from models.dev — asking for
      // more than the model can produce is silently truncated by some
      // providers but rejected by others.
      maxTokens: outputBuffer,
      temperature: AGENT_DEFAULT_TEMPERATURE,
    },
    // CLI providers handle tool calling internally via ToolBridge (prompt-based),
    // so the agent loop itself doesn't need to do tool calling rounds.
    maxTurns: isCliProvider ? 1 : AGENT_DEFAULT_MAX_TURNS,
    maxToolCalls: isCliProvider ? 0 : AGENT_DEFAULT_MAX_TOOL_CALLS,
    tools: isCliProvider ? [] : chatMetaToolFilter,
    requestApproval: createApprovalCallback(),
    memory: { maxTokens: memoryMaxTokens },
  };

  // Build provider instance
  let providerInstance: IProvider | undefined;

  if (isCliProvider) {
    // CLI provider: spawn CLI process for completions.
    // Uses MCP mode — CLI discovers tools via MCP server automatically.
    // No ToolBridge prompt injection needed (avoids bloating the prompt).
    const cliBinary = getCliBinaryFromProviderId(provider);
    if (!cliBinary) {
      throw new Error(`Unknown CLI chat provider: ${provider}`);
    }

    const useNativeMcp = cliBinary === 'claude';

    // All CLI chat providers run from the persistent ~/.ownpilot/workspace directory.
    // We always rewrite .mcp.json with a fresh session token/correlationId so any
    // workspace MCP discovery is authenticated. Claude uses this as its native path;
    // Gemini/Codex still rely primarily on ToolBridge.
    const { createTempWorkspace } = await import('../../mcp/workspace.js');
    correlationId = crypto.randomUUID();
    const { createMcpSession } = await import('../../services/ui-session.js');
    const mcpSession = await createMcpSession();
    const workspace = await createTempWorkspace({
      ...(gatewayUrl && { gatewayUrl }),
      correlationId,
      sessionToken: mcpSession.token,
    });
    const workspaceDir = workspace.dir;

    providerInstance = createCliChatProvider({
      binary: cliBinary,
      model,
      apiKey: apiKey ?? undefined,
      mcpToolContext: useNativeMcp,
      toolBridge: useNativeMcp
        ? undefined
        : {
            tools,
            toolDefinitions: toolDefs,
            conversationId: cacheKey,
            userId,
          },
      cwd: workspaceDir,
      correlationId,
    });
    log.info(
      `Created CLI chat provider: ${provider} (${cliBinary}) model=${model} correlationId=${correlationId}`
    );
  } else if (fallback) {
    // Build FallbackProvider if a backup model is configured
    try {
      const fbResolvedAuth = await resolveAuthForRequest(fallback.provider);
      const fbApiKey = fbResolvedAuth?.value ?? (await getProviderApiKey(fallback.provider));
      if (fbApiKey) {
        const fbConfig = loadProviderConfig(fallback.provider);
        const fbType = NATIVE_PROVIDERS.has(fallback.provider) ? fallback.provider : 'openai';
        providerInstance = createFallbackProvider({
          primary: {
            provider: providerType as AIProvider,
            apiKey: apiKey!,
            resolvedAuth,
            baseUrl,
            headers: providerConfig?.headers,
          },
          fallbacks: [
            {
              provider: fbType as AIProvider,
              apiKey: fbApiKey,
              resolvedAuth: fbResolvedAuth,
              baseUrl: fbConfig?.baseUrl,
              headers: fbConfig?.headers,
            },
          ],
          onFallback: (failed, error, next) => {
            log.warn(`Fallback triggered: ${String(failed)} -> ${String(next)}: ${error.message}`);
          },
        });
      }
    } catch (fbErr) {
      log.warn(`Failed to build fallback provider: ${String(fbErr)}`);
    }
  }

  if (chatAgentCache.size >= MAX_CHAT_AGENT_CACHE_SIZE) {
    const oldestKey = chatAgentCache.keys().next().value;
    if (oldestKey) chatAgentCache.delete(oldestKey);
  }

  const agent = createAgent(config, { tools, provider: providerInstance });

  // Store correlation ID for CLI agents (used by SSE stream to forward MCP events)
  if (isCliProvider && correlationId) {
    cliCorrelationIds.set(agent, correlationId);
  }

  if (!isCliProvider) {
    chatAgentCache.set(cacheKey, agent);
  }

  return agent;
}

/**
 * Reset chat agent context - creates new conversation, preserves old one.
 * Old conversations stay in memory until the agent cache entry is evicted.
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
    // Preserve old conversation — don't delete it so users can return to it
    const newConversation = memory.create(currentConversation.systemPrompt);
    agent.loadConversation(newConversation.id);

    log.info(`Reset context for ${provider}/${model}, new conversation: ${newConversation.id}`);
    return { reset: true, newSessionId: newConversation.id };
  }

  return { reset: false };
}

/**
 * Get session info — re-exported from session-info.ts for backward compat.
 * @see {@link module:services/agent/session-info}
 */
export { getSessionInfo } from './session-info.js';

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
// Context breakdown & compaction — extracted to agent-context.ts
// Re-exported for backward compatibility.
export {
  getContextBreakdown,
  compactContext,
  type ContextBreakdown,
  type CompactionResult,
} from './agent-context.js';

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
  // Check cloud providers — any configured provider means not demo mode
  const configured = await getConfiguredProviderIds();
  if (configured.size > 0) return false;

  // Check local providers (Ollama, LM Studio, etc.)
  const localProviders = await localProvidersRepo.listProviders();
  if (localProviders.some((p) => p.isEnabled)) return false;

  return true;
}
