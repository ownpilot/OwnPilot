/**
 * Plugins routes
 * Provides endpoints for listing, enabling/disabling, and managing plugins
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import {
  getDefaultPluginRegistry,
  type Plugin,
  type PluginManifest,
  type PluginCapability,
  type PluginPermission,
  type PluginStatus,
} from '@ownpilot/core';
import type { ApiResponse } from '../types/index.js';

export const pluginsRoutes = new Hono();

// Plugin registry singleton
let pluginRegistry: Awaited<ReturnType<typeof getDefaultPluginRegistry>> | undefined;

async function getRegistry() {
  if (!pluginRegistry) {
    pluginRegistry = await getDefaultPluginRegistry();
  }
  return pluginRegistry;
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
  };
}

/**
 * List all plugins
 */
pluginsRoutes.get('/', async (c) => {
  const registry = await getRegistry();
  const plugins = registry.getAll();

  const status = c.req.query('status') as PluginStatus | undefined;
  const capability = c.req.query('capability') as PluginCapability | undefined;

  let filtered = plugins;

  // Filter by status
  if (status) {
    filtered = filtered.filter((p) => p.status === status);
  }

  // Filter by capability
  if (capability) {
    filtered = filtered.filter((p) => p.manifest.capabilities.includes(capability));
  }

  const response: ApiResponse<PluginInfo[]> = {
    success: true,
    data: filtered.map(toPluginInfo),
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Get plugins statistics
 */
pluginsRoutes.get('/stats', async (c) => {
  const registry = await getRegistry();
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

  const response: ApiResponse = {
    success: true,
    data: stats,
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Get all tools from enabled plugins
 */
pluginsRoutes.get('/tools', async (c) => {
  const registry = await getRegistry();
  const tools = registry.getAllTools();

  const response: ApiResponse = {
    success: true,
    data: tools.map((t) => ({
      pluginId: t.pluginId,
      name: t.definition.name,
      description: t.definition.description,
      parameters: t.definition.parameters,
    })),
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Get plugin by ID
 */
pluginsRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const registry = await getRegistry();
  const plugin = registry.get(id);

  if (!plugin) {
    throw new HTTPException(404, {
      message: `Plugin not found: ${id}`,
    });
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

  const response: ApiResponse = {
    success: true,
    data: {
      ...toPluginInfo(plugin),
      toolsDetailed,
      handlersInfo,
      config: plugin.config.settings,
      configSchema: plugin.manifest.configSchema,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Enable a plugin
 */
pluginsRoutes.post('/:id/enable', async (c) => {
  const id = c.req.param('id');
  const registry = await getRegistry();

  const success = await registry.enable(id);

  if (!success) {
    throw new HTTPException(404, {
      message: `Plugin not found: ${id}`,
    });
  }

  const plugin = registry.get(id)!;

  const response: ApiResponse = {
    success: true,
    data: {
      message: `Plugin ${plugin.manifest.name} enabled`,
      plugin: toPluginInfo(plugin),
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Disable a plugin
 */
pluginsRoutes.post('/:id/disable', async (c) => {
  const id = c.req.param('id');
  const registry = await getRegistry();

  const success = await registry.disable(id);

  if (!success) {
    throw new HTTPException(404, {
      message: `Plugin not found: ${id}`,
    });
  }

  const plugin = registry.get(id)!;

  const response: ApiResponse = {
    success: true,
    data: {
      message: `Plugin ${plugin.manifest.name} disabled`,
      plugin: toPluginInfo(plugin),
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Update plugin configuration
 */
pluginsRoutes.put('/:id/config', async (c) => {
  const id = c.req.param('id');
  const registry = await getRegistry();
  const plugin = registry.get(id);

  if (!plugin) {
    throw new HTTPException(404, {
      message: `Plugin not found: ${id}`,
    });
  }

  const body = await c.req.json<{ settings: Record<string, unknown> }>();

  // Update settings
  plugin.config.settings = { ...plugin.config.settings, ...body.settings };
  plugin.config.updatedAt = new Date().toISOString();

  // Call onConfigChange if available
  if (plugin.lifecycle.onConfigChange) {
    await plugin.lifecycle.onConfigChange(plugin.config.settings);
  }

  const response: ApiResponse = {
    success: true,
    data: {
      message: 'Configuration updated',
      settings: plugin.config.settings,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Grant permissions to a plugin
 */
pluginsRoutes.post('/:id/permissions', async (c) => {
  const id = c.req.param('id');
  const registry = await getRegistry();
  const plugin = registry.get(id);

  if (!plugin) {
    throw new HTTPException(404, {
      message: `Plugin not found: ${id}`,
    });
  }

  const body = await c.req.json<{ permissions: PluginPermission[] }>();

  // Validate permissions
  for (const perm of body.permissions) {
    if (!plugin.manifest.permissions.includes(perm)) {
      throw new HTTPException(400, {
        message: `Plugin does not request permission: ${perm}`,
      });
    }
  }

  plugin.config.grantedPermissions = body.permissions;
  plugin.config.updatedAt = new Date().toISOString();

  const response: ApiResponse = {
    success: true,
    data: {
      message: 'Permissions updated',
      grantedPermissions: plugin.config.grantedPermissions,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});

/**
 * Uninstall a plugin
 */
pluginsRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const registry = await getRegistry();
  const plugin = registry.get(id);

  if (!plugin) {
    throw new HTTPException(404, {
      message: `Plugin not found: ${id}`,
    });
  }

  const name = plugin.manifest.name;
  const success = await registry.unregister(id);

  const response: ApiResponse = {
    success: true,
    data: {
      message: `Plugin ${name} uninstalled`,
      uninstalled: success,
    },
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
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

  const response: ApiResponse = {
    success: true,
    data: capabilities,
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
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

  const response: ApiResponse = {
    success: true,
    data: permissions,
    meta: {
      requestId: c.get('requestId') ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(response);
});
