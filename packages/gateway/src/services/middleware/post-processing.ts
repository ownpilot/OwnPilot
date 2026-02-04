/**
 * Post-Processing Middleware
 *
 * Runs after agent execution to extract memories, update goals,
 * and evaluate triggers. All operations are fire-and-forget to
 * avoid blocking the response.
 */

import type { MessageMiddleware, ToolCall } from '@ownpilot/core';
import {
  extractMemories,
  updateGoalProgress,
  evaluateTriggers,
} from '../../assistant/index.js';
import { getLog } from '../log.js';

const log = getLog('Middleware:PostProcess');

/**
 * Create middleware that runs post-processing tasks after agent execution.
 *
 * Reads from context:
 *   ctx.get('agentResult') — raw agent result (for tool calls)
 *   ctx.get('userId')
 *   ctx.get('pipelineResult') — the response from agent execution
 */
export function createPostProcessingMiddleware(): MessageMiddleware {
  return async (message, ctx, next) => {
    // Let downstream middleware run first
    const result = await next();

    // Don't post-process if there was an error
    const agentResult = ctx.get<{ ok: boolean; value?: { content: string; toolCalls?: readonly ToolCall[] } }>('agentResult');
    if (!agentResult?.ok) return result;

    const userId = ctx.get<string>('userId') ?? 'default';
    const content = result.response.content;

    // Fire-and-forget post-processing
    Promise.all([
      extractMemories(userId, message.content, content).catch(e =>
        log.warn('Memory extraction failed', { error: e }),
      ),
      updateGoalProgress(userId, message.content, content, agentResult.value?.toolCalls).catch(e =>
        log.warn('Goal progress update failed', { error: e }),
      ),
      evaluateTriggers(userId, message.content, content).catch(e =>
        log.warn('Trigger evaluation failed', { error: e }),
      ),
    ]).then(([memoriesExtracted, _, triggerResult]) => {
      if (memoriesExtracted && (memoriesExtracted as number) > 0) {
        log.info(`Extracted ${memoriesExtracted} new memories`);
      }
      if (triggerResult && typeof triggerResult === 'object') {
        const { triggered, executed } = triggerResult as { triggered: string[]; executed: string[] };
        if (triggered.length > 0) log.info(`${triggered.length} triggers evaluated`);
        if (executed.length > 0) log.info(`${executed.length} triggers executed`);
      }
    }).catch(e => {
      log.warn('Post-processing chain failed', { error: e });
    });

    return result;
  };
}
