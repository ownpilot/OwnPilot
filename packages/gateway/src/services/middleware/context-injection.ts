/**
 * Context Injection Middleware
 *
 * Injects memories and goals into the agent's system prompt
 * before the agent execution stage.
 *
 * Caches the enhanced prompt per userId+agentId to avoid redundant DB queries
 * on every message. Cache invalidates after TTL or when memories/goals change.
 */

import type { MessageMiddleware } from '@ownpilot/core';
import { buildEnhancedSystemPrompt } from '../../assistant/index.js';
import { getErrorMessage } from '../../routes/helpers.js';
import { getLog } from '../log.js';

const log = getLog('Middleware:ContextInjection');

/** Cached context injection result per user+agent */
interface CachedInjection {
  /** The injected sections (everything after the base prompt) */
  injectedSuffix: string;
  stats: { memoriesUsed: number; goalsUsed: number };
  cachedAt: number;
}

/** Cache TTL: 2 minutes — memories/goals rarely change within a conversation */
const INJECTION_CACHE_TTL_MS = 2 * 60 * 1000;

const injectionCache = new Map<string, CachedInjection>();

/** Clear injection cache (call on new session, memory updates, etc.) */
export function clearInjectionCache(userId?: string): void {
  if (userId) {
    for (const key of injectionCache.keys()) {
      if (key.startsWith(`${userId}|`)) injectionCache.delete(key);
    }
  } else {
    injectionCache.clear();
  }
}

/**
 * Create middleware that injects memories/goals into the agent's system prompt.
 *
 * Expects `ctx.get('agent')` to be set by the route handler before processing.
 */
export function createContextInjectionMiddleware(): MessageMiddleware {
  return async (message, ctx, next) => {
    const agent = ctx.get<{ getConversation(): { systemPrompt?: string }; updateSystemPrompt(p: string): void }>('agent');
    if (!agent) {
      ctx.addWarning('No agent in context, skipping context injection');
      return next();
    }

    const userId = ctx.get<string>('userId') ?? 'default';
    const agentId = ctx.get<string>('agentId') ?? 'chat';
    const cacheKey = `${userId}|${agentId}`;

    try {
      const currentSystemPrompt = agent.getConversation().systemPrompt || 'You are a helpful AI assistant.';

      // Check cache — if we have a recent injection for this user+agent, reuse it
      const cached = injectionCache.get(cacheKey);
      if (cached && (Date.now() - cached.cachedAt) < INJECTION_CACHE_TTL_MS) {
        // Re-apply cached suffix if not already present
        if (!currentSystemPrompt.includes(cached.injectedSuffix)) {
          // Strip old injected sections, append cached
          const basePrompt = stripInjectedSections(currentSystemPrompt);
          agent.updateSystemPrompt(basePrompt + cached.injectedSuffix);
        }
        ctx.set('contextStats', cached.stats);
        return next();
      }

      // Cache miss or expired — rebuild from DB
      const { prompt: enhancedPrompt, stats } = await buildEnhancedSystemPrompt(
        currentSystemPrompt,
        {
          userId,
          agentId,
          maxMemories: 10,
          maxGoals: 5,
          enableTriggers: true,
          enableAutonomy: true,
        },
      );

      // Extract the injected suffix (everything buildEnhancedSystemPrompt added)
      const basePrompt = stripInjectedSections(currentSystemPrompt);
      const injectedSuffix = enhancedPrompt.slice(basePrompt.length);

      // Cache it
      // Evict oldest before insert to enforce cap
      if (injectionCache.size >= 50) {
        const oldest = injectionCache.keys().next().value;
        if (oldest) injectionCache.delete(oldest);
      }

      injectionCache.set(cacheKey, {
        injectedSuffix,
        stats,
        cachedAt: Date.now(),
      });

      // Only update if prompt actually changed
      if (enhancedPrompt !== currentSystemPrompt) {
        agent.updateSystemPrompt(enhancedPrompt);
        if (stats.memoriesUsed > 0 || stats.goalsUsed > 0) {
          log.info(`Injected ${stats.memoriesUsed} memories, ${stats.goalsUsed} goals`);
        }
      }

      ctx.set('contextStats', stats);
    } catch (error) {
      const errorMsg = getErrorMessage(error, String(error));
      log.warn('Failed to build enhanced prompt', { error: errorMsg });
      ctx.addWarning(`Context injection failed: ${errorMsg}`);
    }

    return next();
  };
}

/**
 * Strip previously injected sections from a system prompt.
 * Must match the headers used by buildEnhancedSystemPrompt in orchestrator.ts.
 */
function stripInjectedSections(prompt: string): string {
  const markers = [
    '\n---\n## User Context (from memory)',
    '\n---\n## Active Goals',
    '\n---\n## Available Data Resources',
    '\n---\n## Autonomy Level:',
  ];
  let earliest = prompt.length;
  for (const marker of markers) {
    const idx = prompt.indexOf(marker);
    if (idx >= 0 && idx < earliest) earliest = idx;
  }
  return earliest < prompt.length ? prompt.slice(0, earliest) : prompt;
}
