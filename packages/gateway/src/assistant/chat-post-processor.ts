/**
 * Chat Post-Processor
 *
 * Runs asynchronous post-chat processing: memory extraction, goal progress
 * updates, and trigger evaluation. Executes without blocking the chat response.
 *
 * Extracted from conversation-service.ts to break circular dependency:
 * conversation-service should only handle persistence, not orchestrate
 * memory/goal/trigger side effects.
 */

import type { ToolCall } from '@ownpilot/core';
import { getLog } from '../services/log.js';
import { extractMemories, updateGoalProgress, evaluateTriggers } from './index.js';
import { getErrorMessage } from '../routes/helpers.js';

const log = getLog('ChatPostProcessor');

/** Track in-flight post-processing for graceful shutdown. */
const pendingTasks = new Set<Promise<unknown>>();

/** Wait for all in-flight post-processing tasks to complete. */
export function waitForPendingProcessing(): Promise<void> {
  return Promise.allSettled([...pendingTasks]).then(() => {});
}

/**
 * Run post-chat processing: extract memories, update goals, evaluate triggers.
 * Runs asynchronously to not block the response.
 */
export function runPostChatProcessing(
  userId: string,
  userMessage: string,
  assistantContent: string,
  toolCalls?: readonly ToolCall[]
): void {
  const task = Promise.all([
    extractMemories(userId, userMessage, assistantContent).catch((e) =>
      log.warn('Memory extraction failed:', e)
    ),
    updateGoalProgress(userId, userMessage, assistantContent, toolCalls).catch((e) =>
      log.warn('Goal progress update failed:', e)
    ),
    evaluateTriggers(userId, userMessage, assistantContent).catch((e) =>
      log.warn('Trigger evaluation failed:', e)
    ),
  ])
    .then(([memoriesExtracted, _, triggerResult]) => {
      if (memoriesExtracted && (memoriesExtracted as number) > 0) {
        log.info(`Extracted ${memoriesExtracted} new memories from conversation`);
      }
      if (triggerResult && typeof triggerResult === 'object') {
        const { triggered, pending, executed } = triggerResult as {
          triggered: string[];
          pending: string[];
          executed: string[];
        };
        if (triggered.length > 0) log.info(`${triggered.length} triggers evaluated`);
        if (executed.length > 0) log.info(`${executed.length} triggers executed successfully`);
        if (pending.length > 0) log.info(`${pending.length} triggers pending/failed`);
      }
    })
    .catch((error) => {
      log.error('Post-chat processing failed', { error: getErrorMessage(error) });
    });

  pendingTasks.add(task);
  task.finally(() => pendingTasks.delete(task));
}
