/**
 * Extension Trigger Manager
 *
 * Manages trigger lifecycle for extensions:
 * - Activate triggers when extensions are enabled
 * - Deactivate triggers when extensions are disabled/uninstalled
 * - Clean up orphan triggers on startup
 *
 * Extracted from extension-service.ts to separate trigger orchestration
 * from extension lifecycle management.
 */

import { getServiceRegistry, Services } from '@ownpilot/core';
import type { ExtensionManifest } from './extension-types.js';
import { extensionsRepo } from '../db/repositories/extensions.js';
import { getLog } from './log.js';

const log = getLog('ExtTriggerManager');

/**
 * Activate all triggers defined in an extension manifest.
 * De-duplicates by removing existing triggers with the same prefix first.
 */
export async function activateExtensionTriggers(
  manifest: ExtensionManifest,
  userId: string
): Promise<void> {
  if (!manifest.triggers?.length) return;

  let triggerService;
  try {
    triggerService = getServiceRegistry().get(Services.Trigger);
  } catch {
    log.debug(`Trigger service not yet available, skipping trigger activation for ${manifest.id}`);
    return;
  }
  const prefix = `[Ext:${manifest.id}]`;

  // De-duplicate: remove existing triggers for this extension before creating new ones
  try {
    const existing = await triggerService.listTriggers(userId);
    for (const trigger of existing) {
      if (trigger.name.startsWith(prefix)) {
        await triggerService.deleteTrigger(userId, trigger.id);
      }
    }
  } catch (e) {
    log.warn(`Failed to clean existing triggers for ${manifest.id}`, { error: String(e) });
  }

  for (const trigger of manifest.triggers) {
    try {
      await triggerService.createTrigger(userId, {
        name: `${prefix} ${trigger.name}`,
        description: trigger.description ?? `Auto-managed by extension: ${manifest.name}`,
        type: trigger.type,
        config: trigger.config,
        action: trigger.action,
        enabled: trigger.enabled !== false,
      });
    } catch (e) {
      log.warn(`Failed to create trigger for extension ${manifest.id}`, {
        trigger: trigger.name,
        error: String(e),
      });
    }
  }
}

/**
 * Deactivate all triggers owned by an extension.
 */
export async function deactivateExtensionTriggers(
  extensionId: string,
  userId: string
): Promise<void> {
  let triggerService;
  try {
    triggerService = getServiceRegistry().get(Services.Trigger);
  } catch {
    return; // Trigger service not yet available
  }
  const prefix = `[Ext:${extensionId}]`;

  try {
    const triggers = await triggerService.listTriggers(userId);
    for (const trigger of triggers) {
      if (trigger.name.startsWith(prefix)) {
        await triggerService.deleteTrigger(userId, trigger.id);
      }
    }
  } catch (e) {
    log.warn(`Failed to deactivate triggers for extension ${extensionId}`, { error: String(e) });
  }
}

/**
 * Remove triggers that reference extensions no longer in the database.
 * Call on startup to clean stale state.
 */
export async function cleanupOrphanTriggers(userId = 'default'): Promise<number> {
  let cleaned = 0;
  try {
    let triggerService;
    try {
      triggerService = getServiceRegistry().get(Services.Trigger);
    } catch {
      return 0; // Trigger service not yet available
    }
    const triggers = await triggerService.listTriggers(userId);
    const extensionIds = new Set(extensionsRepo.getAll().map((e) => e.id));

    for (const trigger of triggers) {
      const match = trigger.name.match(/^\[Ext:([^\]]+)\]/);
      if (match?.[1] && !extensionIds.has(match[1])) {
        await triggerService.deleteTrigger(userId, trigger.id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      log.info(`Cleaned up ${cleaned} orphan extension triggers`);
    }
  } catch (e) {
    log.warn('Failed to clean orphan triggers', { error: String(e) });
  }
  return cleaned;
}
