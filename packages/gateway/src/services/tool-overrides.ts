/**
 * Tool Override Registration
 *
 * Registers custom tool executors that override placeholder implementations
 * when integrations are properly configured (Gmail, etc.)
 */

import type { ToolRegistry, ToolExecutor } from '@ownpilot/core';
import { GMAIL_TOOL_EXECUTORS } from './gmail-tool-executors.js';
import { oauthIntegrationsRepo } from '../db/repositories/index.js';
import { getLog } from './log.js';

const log = getLog('ToolOverrides');

/**
 * Check if Gmail integration is configured for a user
 */
async function isGmailConfigured(userId = 'default'): Promise<boolean> {
  const integration = await oauthIntegrationsRepo.getByUserProviderService(userId, 'google', 'gmail');
  return integration !== null && integration.status === 'active';
}

/**
 * Register Gmail tool executors if Gmail is configured
 */
export async function registerGmailToolOverrides(registry: ToolRegistry, userId = 'default'): Promise<number> {
  if (!(await isGmailConfigured(userId))) {
    return 0;
  }

  let count = 0;
  for (const [toolName, executor] of Object.entries(GMAIL_TOOL_EXECUTORS)) {
    if (registry.has(toolName)) {
      // Create a wrapper that passes userId to the executor
      const wrappedExecutor: ToolExecutor = async (params, context) => {
        return executor({ ...params, _userId: userId }, context);
      };

      if (registry.updateExecutor(toolName, wrappedExecutor)) {
        count++;
        log.info(`[tool-overrides] Gmail executor registered: ${toolName}`);
      }
    }
  }

  return count;
}

/**
 * Initialize all tool overrides
 * Call this during server startup after tool registry is created
 */
export async function initializeToolOverrides(registry: ToolRegistry, userId = 'default'): Promise<{
  gmail: number;
  total: number;
}> {
  const results = {
    gmail: 0,
    total: 0,
  };

  // Gmail overrides (only if configured)
  try {
    results.gmail = await registerGmailToolOverrides(registry, userId);
  } catch (error) {
    log.error('[tool-overrides] Failed to register Gmail overrides:', error);
  }

  results.total = results.gmail;

  if (results.total > 0) {
    log.info(`[tool-overrides] Registered ${results.total} tool overrides (Gmail: ${results.gmail})`);
  }

  return results;
}

/**
 * Refresh overrides when integration status changes
 */
export async function refreshToolOverrides(registry: ToolRegistry, userId = 'default'): Promise<void> {
  await initializeToolOverrides(registry, userId);
}
