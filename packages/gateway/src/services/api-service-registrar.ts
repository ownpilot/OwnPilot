/**
 * Config Service Registrar
 *
 * Auto-registers config services in the Config Center when tools or plugins
 * declare config dependencies. Manages the `required_by` field to track
 * which tools/plugins need each service.
 */

import { configServicesRepo } from '../db/repositories/config-services.js';
import type { ConfigServiceRequiredBy, ConfigFieldDefinition } from '@ownpilot/core';

/** Legacy format (from requiredApiKeys) */
interface RequiredKeyInput {
  name: string;
  displayName?: string;
  description?: string;
  category?: string;
  docsUrl?: string;
  envVarName?: string;
}

/** New format (from requiredConfigs) — includes optional schema */
interface RequiredConfigInput {
  name: string;
  displayName?: string;
  description?: string;
  category?: string;
  docsUrl?: string;
  multiEntry?: boolean;
  configSchema?: ConfigFieldDefinition[];
}

/**
 * Register config service dependencies for a custom tool.
 * Upserts each required service and adds the tool to its `required_by` list.
 *
 * Accepts both legacy RequiredKeyInput (from requiredApiKeys) and
 * new RequiredConfigInput (from requiredConfigs) formats.
 */
export async function registerToolApiDependencies(
  toolId: string,
  toolName: string,
  requiredKeys: (RequiredKeyInput | RequiredConfigInput)[]
): Promise<void> {
  const dependent: ConfigServiceRequiredBy = { type: 'tool', name: toolName, id: toolId };

  for (const key of requiredKeys) {
    await configServicesRepo.upsert({
      name: key.name,
      displayName: key.displayName ?? key.name,
      category: key.category ?? 'general',
      description: key.description,
      docsUrl: key.docsUrl,
      multiEntry: 'multiEntry' in key ? key.multiEntry : undefined,
      configSchema: 'configSchema' in key ? key.configSchema : undefined,
    });

    await configServicesRepo.addRequiredBy(key.name, dependent);
  }
}

/**
 * Register config service dependencies for a plugin.
 * Upserts each required service and adds the plugin to its `required_by` list.
 */
export async function registerPluginApiDependencies(
  pluginId: string,
  pluginName: string,
  requiredServices: (RequiredKeyInput | RequiredConfigInput)[]
): Promise<void> {
  const dependent: ConfigServiceRequiredBy = { type: 'plugin', name: pluginName, id: pluginId };

  for (const svc of requiredServices) {
    await configServicesRepo.upsert({
      name: svc.name,
      displayName: svc.displayName ?? svc.name,
      category: svc.category ?? 'general',
      description: svc.description,
      docsUrl: svc.docsUrl,
      multiEntry: 'multiEntry' in svc ? svc.multiEntry : undefined,
      configSchema: 'configSchema' in svc ? svc.configSchema : undefined,
    });

    await configServicesRepo.addRequiredBy(svc.name, dependent);
  }
}

/**
 * Remove a dependent (tool or plugin) from all services' `required_by` lists.
 * Call this when a tool or plugin is deleted.
 */
export async function unregisterDependencies(dependentId: string): Promise<void> {
  await configServicesRepo.removeRequiredById(dependentId);
}
