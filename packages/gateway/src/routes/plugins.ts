/**
 * Plugins routes
 * Provides endpoints for listing, enabling/disabling, and managing plugins
 */

import { Hono } from 'hono';
import {
  getServiceRegistry,
  Services,
  type Plugin,
  type PluginCapability,
  type PluginPermission,
  type PluginStatus,
  type IPluginService,
} from '@ownpilot/core';
import type { ConfigFieldDefinition } from '@ownpilot/core';
import { apiResponse, apiError, ERROR_CODES, sanitizeId, notFoundError, validateQueryEnum } from './helpers.js';
import { pluginsRepo } from '../db/repositories/plugins.js';
import { configServicesRepo } from '../db/repositories/config-services.js';
import { getLog } from '../services/log.js';

const log = getLog('Plugins');

export const pluginsRoutes = new Hono();

function getPluginService(): IPluginService {
  return getServiceRegistry().get(Services.Plugin);
}

/**
 * Plugin info response type
 */
interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: {
    name: string;
    email?: string;
    url?: string;
  };
  status: PluginStatus;
  capabilities: PluginCapability[];
  permissions: PluginPermission[];
  grantedPermissions: PluginPermission[];
  toolCount: number;
  tools: string[];
  handlerCount: number;
  icon?: string;
  docs?: string;
  installedAt: string;
  updatedAt: string;
  category: string;
  pluginConfigSchema: ConfigFieldDefinition[];
  settings: Record<string, unknown>;
  hasSettings: boolean;
  requiredServices: {
    name: string;
    displayName: string;
    isConfigured: boolean;
  }[];
  hasUnconfiguredServices: boolean;
}

/**
 * Convert Plugin to PluginInfo
 */
function toPluginInfo(plugin: Plugin): PluginInfo {
  return {
    id: plugin.manifest.id,
    name: plugin.manifest.name,
    version: plugin.manifest.version,
    description: plugin.manifest.description,
    author: plugin.manifest.author,
    status: plugin.status,
    capabilities: plugin.manifest.capabilities,
    permissions: plugin.manifest.permissions,
    grantedPermissions: plugin.config.grantedPermissions,
    toolCount: plugin.tools.size,
    tools: Array.from(plugin.tools.keys()),
    handlerCount: plugin.handlers.length,
    icon: plugin.manifest.icon,
    docs: plugin.manifest.docs,
    installedAt: plugin.config.installedAt,
    updatedAt: plugin.config.updatedAt,
    category: plugin.manifest.category ?? 'other',
    pluginConfigSchema: plugin.manifest.pluginConfigSchema ?? [],
    settings: plugin.config.settings ?? {},
    hasSettings: (plugin.manifest.pluginConfigSchema ?? []).length > 0,
    requiredServices: (plugin.manifest.requiredServices ?? []).map(svc => ({
      name: svc.name,
      displayName: svc.displayName ?? svc.name,
      isConfigured: configServicesRepo.getEntries(svc.name).length > 0,
    })),
    hasUnconfiguredServices: (plugin.manifest.requiredServices ?? []).some(
      svc => configServicesRepo.getEntries(svc.name).length === 0
    ),
  };
}

/**
 * List all plugins
 */
pluginsRoutes.get('/', async (c) => {
  const registry = getPluginService();
  const plugins = registry.getAll();

  const status = validateQueryEnum(c.req.query('status'), ['installed', 'enabled', 'disabled', 'error', 'updating'] as const);
  const capability = validateQueryEnum(c.req.query('capability'), ['tools', 'handlers', 'storage', 'scheduled', 'notifications', 'ui', 'integrations'] as const);

  let filtered = plugins;

  // Filter by status
  if (status) {
    filtered = filtered.filter((p) => p.status === status);
  }

  // Filter by capability
  if (capability) {
    filtered = filtered.filter((p) => p.manifest.capabilities.includes(capability));
  }

  return apiResponse(c, filtered.map(toPluginInfo));
});

/**
 * Get plugins statistics
 */
pluginsRoutes.get('/stats', async (c) => {
  const registry = getPluginService();
  const plugins = registry.getAll();

  const stats = {
    total: plugins.length,
    enabled: plugins.filter((p) => p.status === 'enabled').length,
    disabled: plugins.filter((p) => p.status === 'disabled').length,
    error: plugins.filter((p) => p.status === 'error').length,
    totalTools: plugins.reduce((sum, p) => sum + p.tools.size, 0),
    totalHandlers: plugins.reduce((sum, p) => sum + p.handlers.length, 0),
    byCapability: {} as Record<PluginCapability, number>,
    byPermission: {} as Record<PluginPermission, number>,
  };

  // Count by capability
  for (const plugin of plugins) {
    for (const cap of plugin.manifest.capabilities) {
      stats.byCapability[cap] = (stats.byCapability[cap] || 0) + 1;
    }
    for (const perm of plugin.manifest.permissions) {
      stats.byPermission[perm] = (stats.byPermission[perm] || 0) + 1;
    }
  }

  return apiResponse(c, stats);
});

/**
 * Get all tools from enabled plugins
 */
pluginsRoutes.get('/tools', async (c) => {
  const registry = getPluginService();
  const tools = registry.getAllTools();

  return apiResponse(c, tools.map((t) => ({
    pluginId: t.pluginId,
    name: t.definition.name,
    description: t.definition.description,
    parameters: t.definition.parameters,
  })));
});

/**
 * Get plugin by ID
 */
pluginsRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const registry = getPluginService();
  const plugin = registry.get(id);

  if (!plugin) {
    return notFoundError(c, 'Plugin', id);
  }

  // Get detailed tool info
  const toolsDetailed = Array.from(plugin.tools.entries()).map(([name, tool]) => ({
    name,
    description: tool.definition.description,
    parameters: tool.definition.parameters,
  }));

  // Get handler info
  const handlersInfo = plugin.handlers.map((h) => ({
    name: h.name,
    description: h.description,
    priority: h.priority,
  }));

  return apiResponse(c, {
    ...toPluginInfo(plugin),
    toolsDetailed,
    handlersInfo,
    config: plugin.config.settings,
    configSchema: plugin.manifest.pluginConfigSchema,
  });
});

/**
 * Enable a plugin
 */
pluginsRoutes.post('/:id/enable', async (c) => {
  const id = c.req.param('id');
  const registry = getPluginService();

  const success = await registry.enable(id);

  if (!success) {
    return notFoundError(c, 'Plugin', id);
  }

  await pluginsRepo.updateStatus(id, 'enabled');

  const plugin = registry.get(id)!;

  return apiResponse(c, {
    message: `Plugin ${plugin.manifest.name} enabled`,
    plugin: toPluginInfo(plugin),
  });
});

/**
 * Disable a plugin
 */
pluginsRoutes.post('/:id/disable', async (c) => {
  const id = c.req.param('id');
  const registry = getPluginService();

  const success = await registry.disable(id);

  if (!success) {
    return notFoundError(c, 'Plugin', id);
  }

  await pluginsRepo.updateStatus(id, 'disabled');

  const plugin = registry.get(id)!;

  return apiResponse(c, {
    message: `Plugin ${plugin.manifest.name} disabled`,
    plugin: toPluginInfo(plugin),
  });
});

/**
 * Update plugin configuration
 */
pluginsRoutes.put('/:id/config', async (c) => {
  const id = c.req.param('id');
  const registry = getPluginService();
  const plugin = registry.get(id);

  if (!plugin) {
    return notFoundError(c, 'Plugin', id);
  }

  const body = await c.req.json<{ settings: Record<string, unknown> }>();

  // Update settings
  plugin.config.settings = { ...plugin.config.settings, ...body.settings };
  plugin.config.updatedAt = new Date().toISOString();

  // Call onConfigChange if available
  if (plugin.lifecycle.onConfigChange) {
    await plugin.lifecycle.onConfigChange(plugin.config.settings);
  }

  return apiResponse(c, {
    message: 'Configuration updated',
    settings: plugin.config.settings,
  });
});

/**
 * Grant permissions to a plugin
 */
pluginsRoutes.post('/:id/permissions', async (c) => {
  const id = c.req.param('id');
  const registry = getPluginService();
  const plugin = registry.get(id);

  if (!plugin) {
    return notFoundError(c, 'Plugin', id);
  }

  const body = await c.req.json<{ permissions: PluginPermission[] }>();

  // Validate permissions
  for (const perm of body.permissions) {
    if (!plugin.manifest.permissions.includes(perm)) {
      return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: `Plugin does not request permission: ${perm}` }, 400);
    }
  }

  plugin.config.grantedPermissions = body.permissions;
  plugin.config.updatedAt = new Date().toISOString();

  await pluginsRepo.updatePermissions(id, body.permissions);

  return apiResponse(c, {
    message: 'Permissions updated',
    grantedPermissions: plugin.config.grantedPermissions,
  });
});

/**
 * Get plugin settings schema and current values
 */
pluginsRoutes.get('/:id/settings', async (c) => {
  const id = c.req.param('id');
  const registry = getPluginService();
  const plugin = registry.get(id);

  if (!plugin) {
    return notFoundError(c, 'Plugin', id);
  }

  return apiResponse(c, {
    pluginId: id,
    pluginConfigSchema: plugin.manifest.pluginConfigSchema ?? [],
    settings: plugin.config.settings ?? {},
    defaultConfig: plugin.manifest.defaultConfig ?? {},
  });
});

/**
 * Update plugin settings
 */
pluginsRoutes.put('/:id/settings', async (c) => {
  const id = c.req.param('id');
  const registry = getPluginService();
  const plugin = registry.get(id);

  if (!plugin) {
    return notFoundError(c, 'Plugin', id);
  }

  const body = await c.req.json<{ settings: Record<string, unknown> }>();
  if (!body.settings || typeof body.settings !== 'object') {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'settings object required' }, 400);
  }

  // Merge with existing settings
  const mergedSettings = { ...plugin.config.settings, ...body.settings };

  // Persist to DB
  await pluginsRepo.updateSettings(id, mergedSettings);

  // Update in-memory
  plugin.config.settings = mergedSettings;
  plugin.config.updatedAt = new Date().toISOString();

  // Notify plugin via lifecycle hook
  if (plugin.lifecycle.onConfigChange) {
    try {
      await plugin.lifecycle.onConfigChange(mergedSettings);
    } catch (err) {
      log.error(`onConfigChange hook failed for ${sanitizeId(id)}:`, err);
    }
  }

  return apiResponse(c, { settings: mergedSettings });
});

/**
 * Get plugin required services with Config Center status
 */
pluginsRoutes.get('/:id/required-services', async (c) => {
  const id = c.req.param('id');
  const registry = getPluginService();
  const plugin = registry.get(id);

  if (!plugin) {
    return notFoundError(c, 'Plugin', id);
  }

  const requiredServices = (plugin.manifest.requiredServices ?? []).map(svc => {
    const serviceDef = configServicesRepo.getByName(svc.name);
    const entries = serviceDef ? configServicesRepo.getEntries(svc.name) : [];
    return {
      name: svc.name,
      displayName: svc.displayName ?? svc.name,
      category: svc.category,
      docsUrl: svc.docsUrl,
      multiEntry: svc.multiEntry ?? false,
      isRegistered: serviceDef !== null,
      isConfigured: entries.length > 0,
      entryCount: entries.length,
    };
  });

  return apiResponse(c, {
    pluginId: id,
    pluginName: plugin.manifest.name,
    services: requiredServices,
    allConfigured: requiredServices.every(s => s.isConfigured),
  });
});

/**
 * Uninstall a plugin
 */
pluginsRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const registry = getPluginService();
  const plugin = registry.get(id);

  if (!plugin) {
    return notFoundError(c, 'Plugin', id);
  }

  const name = plugin.manifest.name;
  const success = await registry.unregister(id);

  return apiResponse(c, {
    message: `Plugin ${name} uninstalled`,
    uninstalled: success,
  });
});

/**
 * List available capabilities
 */
pluginsRoutes.get('/meta/capabilities', (c) => {
  const capabilities: Record<PluginCapability, string> = {
    tools: 'Provides tools that can be invoked by the AI',
    handlers: 'Message handlers for custom processing',
    storage: 'Has persistent storage needs',
    scheduled: 'Has scheduled/recurring tasks',
    notifications: 'Can send notifications',
    ui: 'Has UI components',
    integrations: 'External service integrations',
  };

  return apiResponse(c, capabilities);
});

/**
 * List available permissions
 */
pluginsRoutes.get('/meta/permissions', (c) => {
  const permissions: Record<PluginPermission, string> = {
    file_read: 'Read files from the file system',
    file_write: 'Write files to the file system',
    network: 'Make network requests',
    code_execute: 'Execute code/scripts',
    memory_access: 'Access persistent memory',
    notifications: 'Send notifications',
    calendar: 'Access calendar data',
    email: 'Send/receive emails',
    storage: 'Use plugin storage',
  };

  return apiResponse(c, permissions);
});
