/**
 * PluginService Implementation
 *
 * Wraps the existing PluginRegistry to provide IPluginService interface.
 * This is an adapter — the existing plugin registration code continues to work.
 *
 * Usage:
 *   const plugins = registry.get(Services.Plugin);
 *   const all = plugins.list();
 *   const tool = plugins.getTool('my_tool');
 */

import type { IPluginService, PluginInfo, PluginToolEntry } from '@ownpilot/core';
import type { Plugin, PluginManifest, PluginRegistry } from '@ownpilot/core';
import { getDefaultPluginRegistry } from '@ownpilot/core';

// ============================================================================
// PluginServiceImpl Adapter
// ============================================================================

export class PluginServiceImpl implements IPluginService {
  constructor(private readonly registry: PluginRegistry) {}

  async register(manifest: PluginManifest, implementation: Partial<Plugin>): Promise<Plugin> {
    return this.registry.register(manifest, implementation);
  }

  async unregister(pluginId: string): Promise<boolean> {
    return this.registry.unregister(pluginId);
  }

  get(pluginId: string): Plugin | undefined {
    return this.registry.get(pluginId);
  }

  getAll(): Plugin[] {
    return this.registry.getAll();
  }

  getEnabled(): Plugin[] {
    return this.registry.getEnabled();
  }

  async enable(pluginId: string): Promise<boolean> {
    return this.registry.enable(pluginId);
  }

  async disable(pluginId: string): Promise<boolean> {
    return this.registry.disable(pluginId);
  }

  getAllTools(): PluginToolEntry[] {
    return this.registry.getAllTools().map((t) => ({
      pluginId: t.pluginId,
      definition: t.definition,
      executor: t.executor,
    }));
  }

  getTool(name: string): PluginToolEntry | undefined {
    const result = this.registry.getTool(name);
    if (!result) return undefined;
    return {
      pluginId: result.plugin.manifest.id,
      definition: result.definition,
      executor: result.executor,
    };
  }

  list(): PluginInfo[] {
    return this.registry.getAll().map((plugin) => ({
      id: plugin.manifest.id,
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      status: plugin.status,
      description: plugin.manifest.description,
      category: plugin.manifest.category,
      toolCount: plugin.tools.size,
    }));
  }

  getCount(): number {
    return this.registry.getAll().length;
  }
}

/**
 * Create a new PluginService instance.
 * Uses the default plugin registry (initializes if needed).
 */
export async function createPluginService(): Promise<IPluginService> {
  const registry = await getDefaultPluginRegistry();
  return new PluginServiceImpl(registry);
}
