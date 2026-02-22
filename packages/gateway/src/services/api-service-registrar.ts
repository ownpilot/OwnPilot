/**
 * Config Service Registrar
 *
 * Auto-registers config services in the Config Center when tools or plugins
 * declare config dependencies. Manages the `required_by` field to track
 * which tools/plugins need each service.
 */

import { configServicesRepo } from '../db/repositories/config-services.js';
import type {
  ConfigServiceRequiredBy,
  ConfigFieldDefinition,
  ToolSource,
  ToolConfigRequirement,
} from '@ownpilot/core';

/**
 * Unified config service registration for ALL tool sources (core, custom, plugin).
 * Auto-registers each required service in the Config Center and tracks the dependency.
 *
 * This is the single entry point called by ToolRegistry's config registration handler.
 */
export async function registerToolConfigRequirements(
  toolName: string,
  toolId: string,
  source: ToolSource,
  requirements: readonly ToolConfigRequirement[]
): Promise<void> {
  const dependentType = source === 'plugin' ? 'plugin' : 'tool';
  const dependent: ConfigServiceRequiredBy = { type: dependentType, name: toolName, id: toolId };

  for (const req of requirements) {
    await configServicesRepo.upsert({
      name: req.name,
      displayName: req.displayName ?? req.name,
      category: req.category ?? 'general',
      description: req.description,
      docsUrl: req.docsUrl,
      multiEntry: req.multiEntry,
      configSchema: req.configSchema as ConfigFieldDefinition[] | undefined,
    });

    await configServicesRepo.addRequiredBy(req.name, dependent);
  }
}

/**
 * Remove a dependent (tool or plugin) from all services' `required_by` lists.
 * Call this when a tool or plugin is deleted.
 */
export async function unregisterDependencies(dependentId: string): Promise<void> {
  await configServicesRepo.removeRequiredById(dependentId);
}
