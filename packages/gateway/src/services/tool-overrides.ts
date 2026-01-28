/**
 * Tool Override Registration
 *
 * Registers custom tool executors that override placeholder implementations
 * when integrations are properly configured (Gmail, Media services, etc.)
 */

import type { ToolRegistry, ToolExecutor } from '@ownpilot/core';
import { GMAIL_TOOL_EXECUTORS } from './gmail-tool-executors.js';
import { MEDIA_TOOL_EXECUTORS } from './media-tool-executors.js';
import { oauthIntegrationsRepo, mediaSettingsRepo } from '../db/repositories/index.js';

/**
 * Check if Gmail integration is configured for a user
 */
async function isGmailConfigured(userId = 'default'): Promise<boolean> {
  const integration = await oauthIntegrationsRepo.getByUserProviderService(userId, 'google', 'gmail');
  return integration !== null && integration.status === 'active';
}

/**
 * Check if any media settings are configured
 */
async function hasMediaSettings(): Promise<boolean> {
  // Check if any media provider is configured (for default user)
  const capabilities = ['image_generation', 'vision', 'tts', 'stt'] as const;
  for (const cap of capabilities) {
    const setting = await mediaSettingsRepo.getEffective('default', cap);
    if (setting) return true;
  }
  return false;
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
        console.log(`[tool-overrides] Gmail executor registered: ${toolName}`);
      }
    }
  }

  return count;
}

/**
 * Register Media tool executors if media settings are configured
 */
export async function registerMediaToolOverrides(registry: ToolRegistry): Promise<number> {
  let count = 0;

  for (const [toolName, executor] of Object.entries(MEDIA_TOOL_EXECUTORS)) {
    if (registry.has(toolName)) {
      if (registry.updateExecutor(toolName, executor)) {
        count++;
        console.log(`[tool-overrides] Media executor registered: ${toolName}`);
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
  media: number;
  total: number;
}> {
  const results = {
    gmail: 0,
    media: 0,
    total: 0,
  };

  // Gmail overrides (only if configured)
  try {
    results.gmail = await registerGmailToolOverrides(registry, userId);
  } catch (error) {
    console.error('[tool-overrides] Failed to register Gmail overrides:', error);
  }

  // Media overrides (always register - they check settings at runtime)
  try {
    results.media = await registerMediaToolOverrides(registry);
  } catch (error) {
    console.error('[tool-overrides] Failed to register Media overrides:', error);
  }

  results.total = results.gmail + results.media;

  if (results.total > 0) {
    console.log(`[tool-overrides] Registered ${results.total} tool overrides (Gmail: ${results.gmail}, Media: ${results.media})`);
  }

  return results;
}

/**
 * Refresh overrides when integration status changes
 */
export async function refreshToolOverrides(registry: ToolRegistry, userId = 'default'): Promise<void> {
  await initializeToolOverrides(registry, userId);
}
