/**
 * Context Injection Middleware
 *
 * Injects memories and goals into the agent's system prompt
 * before the agent execution stage.
 */

import type { MessageMiddleware } from '@ownpilot/core';
import { buildEnhancedSystemPrompt } from '../../assistant/index.js';
import { getLog } from '../log.js';

const log = getLog('Middleware:ContextInjection');

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

    try {
      const { prompt: enhancedPrompt, stats } = await buildEnhancedSystemPrompt(
        agent.getConversation().systemPrompt || 'You are a helpful AI assistant.',
        {
          userId,
          agentId,
          maxMemories: 10,
          maxGoals: 5,
          enableTriggers: true,
          enableAutonomy: true,
        },
      );
      agent.updateSystemPrompt(enhancedPrompt);

      if (stats.memoriesUsed > 0 || stats.goalsUsed > 0) {
        log.info(`Injected ${stats.memoriesUsed} memories, ${stats.goalsUsed} goals`);
      }

      ctx.set('contextStats', stats);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.warn('Failed to build enhanced prompt', { error: errorMsg });
      ctx.addWarning(`Context injection failed: ${errorMsg}`);
    }

    return next();
  };
}
