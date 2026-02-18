/**
 * Agent management routes
 *
 * Agents are stored in the database for persistence.
 * Runtime Agent instances are cached in memory for active use.
 *
 * Implementation split:
 * - agent-prompt.ts:  BASE_SYSTEM_PROMPT constant
 * - agent-tools.ts:   Tool registration + meta-tool executors
 * - agent-cache.ts:   Cache infra, provider/config helpers
 * - agent-service.ts: Public API (create/fetch/manage agents, context, compaction)
 * - agents.ts:        Route handlers (this file) + backward compat re-exports
 */

import { Hono } from 'hono';
import type {
  CreateAgentRequest,
  UpdateAgentRequest,
  AgentInfo,
} from '../types/index.js';
import { apiResponse, apiError, ERROR_CODES, sanitizeId, notFoundError, getErrorMessage } from './helpers.js';
import { agentsRepo } from '../db/repositories/index.js';
import { wsGateway } from '../ws/server.js';
import {
  AGENT_CREATE_DEFAULT_MAX_TOKENS,
  AGENT_DEFAULT_TEMPERATURE,
  AGENT_DEFAULT_MAX_TURNS,
  AGENT_DEFAULT_MAX_TOOL_CALLS,
} from '../config/defaults.js';

// Internal imports from split modules
import { safeStringArray } from './agent-tools.js';
import {
  resolveToolGroups,
  resolveRecordTools,
  buildAgentConfigResponse,
  evictAgentFromCache,
  generateAgentId,
  agentCache,
  getProviderApiKey,
} from './agent-cache.js';
import { getOrCreateAgentInstance } from './agent-service.js';

// =============================================================================
// Backward compatibility re-exports
// =============================================================================
// These ensure that all existing imports from './agents.js' continue to work
// without any changes to the consuming files.

export { getAgent, getOrCreateDefaultAgent, getOrCreateChatAgent, isDemoMode, getWorkspaceContext, getSessionInfo, resetChatAgentContext, clearAllChatAgentCaches, getContextBreakdown, compactContext } from './agent-service.js';
export type { ContextBreakdown } from './agent-service.js';
export { invalidateAgentCache } from './agent-cache.js';
export { getDefaultModel } from './settings.js';

// =============================================================================
// Route handlers
// =============================================================================

export const agentRoutes = new Hono();

/**
 * List all agents (capped at 100)
 */
agentRoutes.get('/', async (c) => {
  const [total, records] = await Promise.all([
    agentsRepo.count(),
    agentsRepo.getPage(100, 0),
  ]);

  const agentList: AgentInfo[] = records.map((record) => {
    const { tools } = resolveRecordTools(record.config);

    return {
      id: record.id,
      name: record.name,
      provider: record.provider,
      model: record.model,
      tools,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  });

  return apiResponse(c, { items: agentList, total, limit: 100, hasMore: total > 100 });
});

/**
 * Create a new agent
 *
 * Provider and model default to 'default' which resolves to user's configured defaults at runtime.
 * Tools can be specified explicitly via 'tools' array or via 'toolGroups' array.
 */
agentRoutes.post('/', async (c) => {
  const rawBody = await c.req.json().catch(() => null);
  const { validateBody, createAgentSchema } = await import('../middleware/validation.js');
  const body = validateBody(createAgentSchema, rawBody) as CreateAgentRequest;

  // Default to 'default' for provider and model
  const provider = body.provider ?? 'default';
  const model = body.model ?? 'default';

  // Generate agent ID
  const id = generateAgentId();

  // Store in database with both tools and toolGroups
  const record = await agentsRepo.create({
    id,
    name: body.name,
    systemPrompt: body.systemPrompt,
    provider,
    model,
    config: {
      maxTokens: body.maxTokens ?? AGENT_CREATE_DEFAULT_MAX_TOKENS,
      temperature: body.temperature ?? AGENT_DEFAULT_TEMPERATURE,
      maxTurns: body.maxTurns ?? AGENT_DEFAULT_MAX_TURNS,
      maxToolCalls: body.maxToolCalls ?? AGENT_DEFAULT_MAX_TOOL_CALLS,
      tools: body.tools,
      toolGroups: body.toolGroups,
    },
  });

  // Return the stored record without creating runtime agent
  const config = record.config as Record<string, unknown>;
  const configuredTools = safeStringArray(config.tools);
  const configuredToolGroups = safeStringArray(config.toolGroups);
  const tools = resolveToolGroups(configuredToolGroups, configuredTools);

  wsGateway.broadcast('data:changed', { entity: 'agent', action: 'created', id: record.id });
  return apiResponse(c, {
    id: record.id,
    name: record.name,
    provider: record.provider,
    model: record.model,
    tools,
    createdAt: record.createdAt.toISOString(),
  }, 201);
});

/**
 * Get agent by ID (with full details)
 */
agentRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const record = await agentsRepo.getById(id);

  if (!record) {
    return notFoundError(c, 'Agent', id);
  }

  const { configuredTools, configuredToolGroups, tools: resolvedTools } = resolveRecordTools(record.config);
  let tools = resolvedTools.length > 0 ? resolvedTools : ['get_current_time', 'calculate'];

  // Try to get actual tools from runtime instance (if agent was already created)
  try {
    const cachedAgent = agentCache.get(record.id);
    if (cachedAgent) {
      tools = cachedAgent.getTools().map((t) => t.name);
    }
  } catch {
    // Use resolved tools from config
  }

  return apiResponse(c, {
    id: record.id,
    name: record.name,
    provider: record.provider,
    model: record.model,
    systemPrompt: record.systemPrompt ?? '',
    tools,
    config: buildAgentConfigResponse(record.config, configuredTools, configuredToolGroups),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
});

/**
 * Update agent
 *
 * Provider/model can be set to 'default' to use user's configured defaults.
 * Tools can be updated via 'tools' array or 'toolGroups' array.
 */
agentRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const rawBody = await c.req.json().catch(() => null);
  const { validateBody, updateAgentSchema } = await import('../middleware/validation.js');
  const body = validateBody(updateAgentSchema, rawBody) as UpdateAgentRequest;

  const existing = await agentsRepo.getById(id);
  if (!existing) {
    return notFoundError(c, 'Agent', id);
  }

  // If provider is being changed to a specific provider (not 'default'), validate API key
  if (body.provider && body.provider !== 'default' && body.provider !== existing.provider) {
    const apiKey = await getProviderApiKey(body.provider);
    if (!apiKey) {
      return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: `API key not configured for provider: ${sanitizeId(body.provider)}` }, 400);
    }
  }

  // Build config updates
  const existingConfig = existing.config as Record<string, unknown>;
  const newConfig = { ...existingConfig };

  if (body.maxTokens !== undefined) newConfig.maxTokens = body.maxTokens;
  if (body.temperature !== undefined) newConfig.temperature = body.temperature;
  if (body.maxTurns !== undefined) newConfig.maxTurns = body.maxTurns;
  if (body.maxToolCalls !== undefined) newConfig.maxToolCalls = body.maxToolCalls;
  if (body.tools !== undefined) newConfig.tools = body.tools;
  if (body.toolGroups !== undefined) newConfig.toolGroups = body.toolGroups;

  // Update database
  const updated = await agentsRepo.update(id, {
    name: body.name,
    systemPrompt: body.systemPrompt,
    provider: body.provider,
    model: body.model,
    config: newConfig,
  });

  if (!updated) {
    return apiError(c, { code: ERROR_CODES.UPDATE_FAILED, message: 'Failed to update agent' }, 500);
  }

  // Invalidate cache to force recreation with new config
  evictAgentFromCache(id);

  const { configuredTools, configuredToolGroups, tools } = resolveRecordTools(newConfig);

  wsGateway.broadcast('data:changed', { entity: 'agent', action: 'updated', id });
  return apiResponse(c, {
    id: updated.id,
    name: updated.name,
    provider: updated.provider,
    model: updated.model,
    systemPrompt: updated.systemPrompt ?? '',
    tools,
    config: buildAgentConfigResponse(newConfig, configuredTools, configuredToolGroups),
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
});

/**
 * Delete agent
 */
agentRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');

  const deleted = await agentsRepo.delete(id);

  if (!deleted) {
    return notFoundError(c, 'Agent', id);
  }

  // Clear from cache
  evictAgentFromCache(id);

  wsGateway.broadcast('data:changed', { entity: 'agent', action: 'deleted', id });
  return apiResponse(c, {});
});

/**
 * Reset agent conversation
 */
agentRoutes.post('/:id/reset', async (c) => {
  const id = c.req.param('id');
  const record = await agentsRepo.getById(id);

  if (!record) {
    return notFoundError(c, 'Agent', id);
  }

  const agent = await getOrCreateAgentInstance(record);
  const conversation = agent.reset();

  return apiResponse(c, {
    conversationId: conversation.id,
  });
});

/**
 * Resync agents from default JSON file
 * Updates existing agents with new toolGroups configuration
 */
agentRoutes.post('/resync', async (c) => {
  const { getDefaultAgents } = await import('../db/seeds/default-agents.js');
  const defaultAgents = getDefaultAgents();

  let updated = 0;
  let created = 0;
  const errors: string[] = [];

  for (const agent of defaultAgents) {
    try {
      const existing = await agentsRepo.getById(agent.id);

      if (existing) {
        // Update existing agent config with new toolGroups
        await agentsRepo.update(agent.id, {
          config: {
            ...existing.config,
            ...agent.config,
          },
        });
        // Clear cache to force recreation
        evictAgentFromCache(agent.id);
        updated++;
      } else {
        // Create new agent
        await agentsRepo.create({
          id: agent.id,
          name: agent.name,
          systemPrompt: agent.systemPrompt,
          provider: agent.provider,
          model: agent.model,
          config: agent.config,
        });
        created++;
      }
    } catch (error) {
      errors.push(`${agent.id}: ${getErrorMessage(error)}`);
    }
  }

  return apiResponse(c, {
    updated,
    created,
    total: defaultAgents.length,
    errors: errors.length > 0 ? errors : undefined,
  });
});
