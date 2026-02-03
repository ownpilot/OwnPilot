/**
 * IPluginService - Unified Plugin Management Interface
 *
 * Wraps the PluginRegistry to provide a consistent service interface.
 * Exposes plugin lifecycle, discovery, and tool access.
 * Internal methods (createContext, createStorage, routeMessage) are excluded.
 *
 * Usage:
 *   const plugins = registry.get(Services.Plugin);
 *   const all = plugins.getAll();
 *   const tool = plugins.getTool('my_tool');
 */

import type { ToolDefinition, ToolExecutor } from '../agent/types.js';
import type { Plugin, PluginManifest } from '../plugins/index.js';

// ============================================================================
// Plugin Info DTO (lightweight summary)
// ============================================================================

export interface PluginInfo {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly status: string;
  readonly description?: string;
  readonly category?: string;
  readonly toolCount: number;
}

// ============================================================================
// Plugin Tool Entry
// ============================================================================

export interface PluginToolEntry {
  readonly pluginId: string;
  readonly definition: ToolDefinition;
  readonly executor: ToolExecutor;
}

// ============================================================================
// IPluginService
// ============================================================================

export interface IPluginService {
  /**
   * Register a new plugin.
   */
  register(manifest: PluginManifest, implementation: Partial<Plugin>): Promise<Plugin>;

  /**
   * Unregister a plugin by ID.
   */
  unregister(pluginId: string): Promise<boolean>;

  /**
   * Get a plugin by ID.
   */
  get(pluginId: string): Plugin | undefined;

  /**
   * Get all registered plugins.
   */
  getAll(): Plugin[];

  /**
   * Get all enabled plugins.
   */
  getEnabled(): Plugin[];

  /**
   * Enable a plugin.
   */
  enable(pluginId: string): Promise<boolean>;

  /**
   * Disable a plugin.
   */
  disable(pluginId: string): Promise<boolean>;

  /**
   * Get all tools from all enabled plugins.
   */
  getAllTools(): PluginToolEntry[];

  /**
   * Get a specific tool by name.
   */
  getTool(name: string): PluginToolEntry | undefined;

  /**
   * List all plugins as lightweight info DTOs.
   */
  list(): PluginInfo[];

  /**
   * Get total number of registered plugins.
   */
  getCount(): number;
}
