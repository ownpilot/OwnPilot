/**
 * Context Injection Middleware
 *
 * Injects memories, goals, and relevant extension/skill sections into
 * the agent's system prompt before the agent execution stage.
 *
 * When the request-preprocessor middleware has set routing decisions in
 * PipelineContext, only relevant extension sections are injected.
 * Otherwise, falls back to injecting all enabled extension sections.
 *
 * Caches the orchestrator injection (memories/goals) per userId+agentId
 * to avoid redundant DB queries on every message. Extension injection
 * is always per-request (routing differs per message).
 */

import type { MessageMiddleware } from '@ownpilot/core';
import { getServiceRegistry, Services, type IExtensionService } from '@ownpilot/core';
import { buildEnhancedSystemPrompt } from '../../assistant/index.js';
import { getErrorMessage } from '../../routes/helpers.js';
import type { RequestRouting } from './request-preprocessor.js';
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
 * Create middleware that injects memories/goals and relevant extension sections
 * into the agent's system prompt.
 *
 * Expects `ctx.get('agent')` to be set by the route handler before processing.
 */
export function createContextInjectionMiddleware(): MessageMiddleware {
  return async (message, ctx, next) => {
    const agent = ctx.get<{
      getConversation(): { systemPrompt?: string };
      updateSystemPrompt(p: string): void;
    }>('agent');
    if (!agent) {
      ctx.addWarning('No agent in context, skipping context injection');
      return next();
    }

    const userId = ctx.get<string>('userId') ?? 'default';
    const agentId = ctx.get<string>('agentId') ?? 'chat';
    const cacheKey = `${userId}|${agentId}`;

    try {
      const currentSystemPrompt =
        agent.getConversation().systemPrompt || 'You are a helpful AI assistant.';

      // 1. Strip all previously injected sections to get the base prompt
      const basePrompt = stripInjectedSections(currentSystemPrompt);

      // 2. Build extension sections based on routing (per-request)
      const extensionSuffix = buildExtensionSections(ctx);

      // 3. Build orchestrator sections (memories, goals, resources, autonomy) — cached
      let orchestratorSuffix: string;
      let stats: { memoriesUsed: number; goalsUsed: number };

      const cached = injectionCache.get(cacheKey);
      if (cached && Date.now() - cached.cachedAt < INJECTION_CACHE_TTL_MS) {
        orchestratorSuffix = cached.injectedSuffix;
        stats = cached.stats;
      } else {
        // Cache miss or expired — rebuild from DB
        const { prompt: enhancedPrompt, stats: freshStats } = await buildEnhancedSystemPrompt(
          basePrompt,
          {
            userId,
            agentId,
            maxMemories: 10,
            maxGoals: 5,
            enableTriggers: true,
            enableAutonomy: true,
          }
        );

        // Extract the suffix that buildEnhancedSystemPrompt added
        orchestratorSuffix = enhancedPrompt.slice(basePrompt.length);
        stats = freshStats;

        // Cache it (evict oldest before insert to enforce cap)
        if (injectionCache.size >= 50) {
          const oldest = injectionCache.keys().next().value;
          if (oldest) injectionCache.delete(oldest);
        }
        injectionCache.set(cacheKey, {
          injectedSuffix: orchestratorSuffix,
          stats,
          cachedAt: Date.now(),
        });

        if (stats.memoriesUsed > 0 || stats.goalsUsed > 0) {
          log.info(`Injected ${stats.memoriesUsed} memories, ${stats.goalsUsed} goals`);
        }
      }

      // 4. Build request focus hint
      const routing = ctx.get<RequestRouting>('routing');
      const focusSuffix = routing?.intentHint
        ? `\n---\n## Request Focus\n${routing.intentHint}`
        : '';

      // 5. Combine: base + extensions + orchestrator + focus
      const finalPrompt = basePrompt + extensionSuffix + orchestratorSuffix + focusSuffix;

      if (finalPrompt !== currentSystemPrompt) {
        agent.updateSystemPrompt(finalPrompt);
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
 * Build extension sections based on routing decisions.
 * If routing is present, only inject selected extensions.
 * Otherwise, inject all enabled extensions (backward compat).
 */
function buildExtensionSections(ctx: { get<T>(key: string): T | undefined }): string {
  try {
    const extService = getServiceRegistry().get(Services.Extension) as IExtensionService & {
      getSystemPromptSectionsForIds?(ids: string[]): string[];
    };
    if (!extService) return '';

    const routing = ctx.get<RequestRouting>('routing');
    let sections: string[];

    if (routing?.relevantExtensionIds && extService.getSystemPromptSectionsForIds) {
      sections = extService.getSystemPromptSectionsForIds(routing.relevantExtensionIds);
    } else {
      // No routing or old service — inject all (backward compat)
      sections = extService.getSystemPromptSections();
    }

    if (sections.length === 0) return '';
    return '\n\n' + sections.join('\n\n');
  } catch {
    // Extension service not available
    return '';
  }
}

/**
 * Strip previously injected sections from a system prompt.
 * Strips: extension sections, request focus, orchestrator sections
 * (memories, goals, resources, autonomy).
 */
function stripInjectedSections(prompt: string): string {
  const markers = [
    // Extension sections (injected by context-injection or agent-service at creation)
    '\n\n## Extension:',
    '\n\n## Skill:',
    // Request focus (from request-preprocessor)
    '\n---\n## Request Focus',
    // Orchestrator sections (from buildEnhancedSystemPrompt)
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
