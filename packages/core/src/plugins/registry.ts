/**
 * Plugin Registry & Builder
 *
 * PluginRegistry: manages plugin lifecycle, tools, handlers, events, storage.
 * PluginBuilder: fluent API for constructing plugins.
 * Factory functions: createPlugin(), getDefaultPluginRegistry().
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ToolDefinition, ToolExecutor } from '../agent/types.js';
import type { PluginId } from '../types/branded.js';
import { getLog } from '../services/get-log.js';
import { getEventSystem, type PluginCustomData, type PluginStatusData } from '../events/index.js';
import type {
  HandlerContext,
  HandlerResult,
  MessageHandler,
  Plugin,
  PluginCapability,
  PluginConfig,
  PluginContext,
  PluginDatabaseColumn,
  PluginDatabaseTable,
  PluginEvents,
  PluginLogger,
  PluginManifest,
  PluginPublicAPI,
  PluginStorage,
} from './types.js';

const log = getLog('PluginRegistry');

// =============================================================================
// Plugin Registry
// =============================================================================

/**
 * Plugin Registry - manages all plugins
 */
export class PluginRegistry {
  private plugins: Map<string, Plugin> = new Map();
  private handlers: MessageHandler[] = [];
  private storageDir: string;
  /** Tracks event unsubscribe functions per plugin for cleanup */
  private pluginEventCleanups = new Map<string, Array<() => void>>();
  /** Simple async mutex for register/unregister serialization */
  private registryLock: Promise<void> = Promise.resolve();

  constructor(storageDir?: string) {
    const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '.';
    this.storageDir = storageDir ?? path.join(homeDir, '.ownpilot', 'plugins');
  }

  /** Run an async function under the registry lock to prevent concurrent mutations */
  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const acquire = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = this.registryLock;
    this.registryLock = acquire;
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Initialize the registry
   */
  async initialize(): Promise<void> {
    log.info(`Creating storage directory: ${this.storageDir}`);
    await fs.mkdir(this.storageDir, { recursive: true });
    log.info('Storage directory ready.');
    await this.loadInstalledPlugins();
    log.info('Installed plugins loaded.');
  }

  /**
   * Register a plugin
   */
  async register(manifest: PluginManifest, implementation: Partial<Plugin>): Promise<Plugin> {
    return this.withLock(async () => {
      // Check dependencies
      for (const [depId, depVersion] of Object.entries(manifest.dependencies ?? {})) {
        const dep = this.plugins.get(depId);
        if (!dep) {
          throw new Error(`Missing dependency: ${depId}`);
        }
        // Basic version check (in production, use semver)
        if (dep.manifest.version !== depVersion && depVersion !== '*') {
          log.warn(
            `Dependency version mismatch: ${depId} (want ${depVersion}, have ${dep.manifest.version})`
          );
        }
      }

      // Load existing config or create default
      const config = (await this.loadPluginConfig(manifest.id)) ?? {
        enabled: true,
        settings: manifest.defaultConfig ?? {},
        grantedPermissions: [],
        installedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Create plugin instance
      const plugin: Plugin = {
        manifest,
        status: config.enabled ? 'enabled' : 'disabled',
        config,
        tools: new Map(implementation.tools ?? []),
        handlers: implementation.handlers ?? [],
        api: implementation.api,
        lifecycle: implementation.lifecycle ?? {},
      };

      this.plugins.set(manifest.id, plugin);

      // Register handlers
      for (const handler of plugin.handlers) {
        this.handlers.push(handler);
      }
      this.handlers.sort((a, b) => b.priority - a.priority);

      // Call onLoad
      if (plugin.lifecycle.onLoad) {
        try {
          await plugin.lifecycle.onLoad();
        } catch (err) {
          log.error(`onLoad failed for ${manifest.id}:`, err);
          this.plugins.delete(manifest.id);
          this.handlers = this.handlers.filter((h) => !plugin.handlers.includes(h));
          throw err;
        }
      }

      // Call onEnable if enabled
      if (config.enabled && plugin.lifecycle.onEnable) {
        try {
          await plugin.lifecycle.onEnable();
        } catch (err) {
          log.error(`onEnable failed for ${manifest.id}:`, err);
          plugin.status = 'error';
        }
      }

      log.info(`Registered plugin: ${manifest.name} v${manifest.version}`);
      return plugin;
    }); // end withLock
  }

  /**
   * Get a plugin by ID
   */
  get(id: string): Plugin | undefined {
    return this.plugins.get(id);
  }

  /**
   * Get all plugins
   */
  getAll(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get all enabled plugins
   */
  getEnabled(): Plugin[] {
    return Array.from(this.plugins.values()).filter((p) => p.status === 'enabled');
  }

  /**
   * Enable a plugin
   */
  async enable(id: string): Promise<boolean> {
    const plugin = this.plugins.get(id);
    if (!plugin) return false;

    const oldStatus = plugin.status;
    plugin.status = 'enabled';
    plugin.config.enabled = true;
    plugin.config.updatedAt = new Date().toISOString();

    await this.savePluginConfig(id, plugin.config);

    if (plugin.lifecycle.onEnable) {
      try {
        await plugin.lifecycle.onEnable();
      } catch (err) {
        log.error(`onEnable failed for ${id}:`, err);
        plugin.status = 'error';
        return false;
      }
    }

    getEventSystem().emit('plugin.status', 'plugin-registry', {
      pluginId: id,
      oldStatus,
      newStatus: 'enabled',
    } as PluginStatusData);

    return true;
  }

  /**
   * Disable a plugin
   */
  async disable(id: string): Promise<boolean> {
    const plugin = this.plugins.get(id);
    if (!plugin) return false;

    if (plugin.lifecycle.onDisable) {
      try {
        await plugin.lifecycle.onDisable();
      } catch (err) {
        log.error(`onDisable failed for ${id}:`, err);
      }
    }

    const oldStatus = plugin.status;
    plugin.status = 'disabled';
    plugin.config.enabled = false;
    plugin.config.updatedAt = new Date().toISOString();

    await this.savePluginConfig(id, plugin.config);

    getEventSystem().emit('plugin.status', 'plugin-registry', {
      pluginId: id,
      oldStatus,
      newStatus: 'disabled',
    } as PluginStatusData);

    return true;
  }

  /**
   * Unregister a plugin
   */
  async unregister(id: string): Promise<boolean> {
    return this.withLock(async () => {
      const plugin = this.plugins.get(id);
      if (!plugin) return false;

      // Call onUnload
      if (plugin.lifecycle.onUnload) {
        try {
          await plugin.lifecycle.onUnload();
        } catch (err) {
          log.error(`onUnload failed for ${id}:`, err);
        }
      }

      // Clean up event subscriptions
      const cleanups = this.pluginEventCleanups.get(id);
      if (cleanups) {
        for (const unsub of cleanups) {
          try {
            unsub();
          } catch {
            /* already cleaned */
          }
        }
        this.pluginEventCleanups.delete(id);
      }

      // Remove handlers
      this.handlers = this.handlers.filter((h) => !plugin.handlers.includes(h));

      this.plugins.delete(id);
      return true;
    }); // end withLock
  }

  /**
   * Get all tools from enabled plugins
   */
  getAllTools(): Array<{ pluginId: string; definition: ToolDefinition; executor: ToolExecutor }> {
    const tools: Array<{ pluginId: string; definition: ToolDefinition; executor: ToolExecutor }> =
      [];

    for (const plugin of this.getEnabled()) {
      for (const [, tool] of plugin.tools) {
        tools.push({
          pluginId: plugin.manifest.id,
          ...tool,
        });
      }
    }

    return tools;
  }

  /**
   * Get tool by name
   */
  getTool(
    name: string
  ): { plugin: Plugin; definition: ToolDefinition; executor: ToolExecutor } | undefined {
    for (const plugin of this.getEnabled()) {
      const tool = plugin.tools.get(name);
      if (tool) {
        return { plugin, ...tool };
      }
    }
    return undefined;
  }

  /**
   * Route a message through handlers
   */
  async routeMessage(message: string, context: HandlerContext): Promise<HandlerResult> {
    for (const handler of this.handlers) {
      const canHandle = await handler.canHandle(message, context);
      if (canHandle) {
        return handler.handle(message, context);
      }
    }

    return { handled: false };
  }

  /**
   * Emit event to all plugins (delegates to unified EventSystem)
   */
  emitEvent(event: string, data: unknown): void {
    // Parse pluginId:eventName format (legacy convention)
    const parts = event.split(':');
    const pluginId = parts[0] ?? event;
    const eventName = parts.slice(1).join(':') || event;

    getEventSystem().emit('plugin.custom', `plugin:${pluginId}`, {
      pluginId,
      event: eventName,
      data,
    } as PluginCustomData);
  }

  /**
   * Subscribe to events (delegates to unified EventSystem)
   */
  onEvent(event: string, handler: (data: unknown) => void): void {
    getEventSystem().onAny(event, (e) => handler(e.data));
  }

  /**
   * Create plugin context
   */
  createContext(pluginId: string): PluginContext {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    return {
      pluginId: pluginId as PluginId,
      config: plugin.config,
      storage: this.createStorage(pluginId),
      log: this.createLogger(pluginId),
      events: this.createEvents(pluginId),
      getPlugin: (id: string) => this.plugins.get(id)?.api,
    };
  }

  /**
   * Create storage for a plugin
   */
  private createStorage(pluginId: string): PluginStorage {
    const storageFile = path.join(this.storageDir, `${pluginId}.storage.json`);

    return {
      async get<T>(key: string): Promise<T | undefined> {
        try {
          const content = await fs.readFile(storageFile, 'utf-8');
          const data = JSON.parse(content);
          return data[key];
        } catch {
          return undefined;
        }
      },

      async set<T>(key: string, value: T): Promise<void> {
        let data: Record<string, unknown> = {};
        try {
          const content = await fs.readFile(storageFile, 'utf-8');
          data = JSON.parse(content);
        } catch {
          // File doesn't exist yet
        }
        data[key] = value;
        try {
          await fs.writeFile(storageFile, JSON.stringify(data, null, 2), 'utf-8');
        } catch (err) {
          log.error(`Storage write failed: ${storageFile}`, err);
          throw err;
        }
      },

      async delete(key: string): Promise<boolean> {
        try {
          const content = await fs.readFile(storageFile, 'utf-8');
          const data = JSON.parse(content);
          if (key in data) {
            delete data[key];
            await fs.writeFile(storageFile, JSON.stringify(data, null, 2), 'utf-8');
            return true;
          }
        } catch {
          // Storage file doesn't exist or write failed
        }
        return false;
      },

      async list(): Promise<string[]> {
        try {
          const content = await fs.readFile(storageFile, 'utf-8');
          const data = JSON.parse(content);
          return Object.keys(data);
        } catch {
          return [];
        }
      },

      async clear(): Promise<void> {
        try {
          await fs.unlink(storageFile);
        } catch {
          // File doesn't exist or already deleted
        }
      },
    };
  }

  /**
   * Create logger for a plugin
   */
  private createLogger(pluginId: string): PluginLogger {
    const pluginLog = getLog(`Plugin:${pluginId}`);

    return {
      debug: (message, ...args) => pluginLog.debug(message, args.length ? args : undefined),
      info: (message, ...args) => pluginLog.info(message, args.length ? args : undefined),
      warn: (message, ...args) => pluginLog.warn(message, args.length ? args : undefined),
      error: (message, ...args) => pluginLog.error(message, args.length ? args : undefined),
    };
  }

  /**
   * Create events API for a plugin (backed by ScopedBus)
   */
  private createEvents(pluginId: string): PluginEvents {
    const bus = getEventSystem().scoped(`plugin.${pluginId}`, `plugin:${pluginId}`);
    const handlerMap = new Map<(...args: unknown[]) => void, () => void>();

    // Track all unsubscribe functions for cleanup on unregister
    if (!this.pluginEventCleanups.has(pluginId)) {
      this.pluginEventCleanups.set(pluginId, []);
    }
    const cleanups = this.pluginEventCleanups.get(pluginId)!;

    return {
      emit: (event, data) => bus.emit(event, data),
      on: (event, handler) => {
        const unsub = bus.on(event, (e) => handler(e.data));
        handlerMap.set(handler, unsub);
        cleanups.push(unsub);
      },
      off: (_event, handler) => {
        const unsub = handlerMap.get(handler);
        if (unsub) {
          unsub();
          handlerMap.delete(handler);
          const idx = cleanups.indexOf(unsub);
          if (idx >= 0) cleanups.splice(idx, 1);
        }
      },
    };
  }

  /**
   * Load plugin config from disk
   */
  private async loadPluginConfig(pluginId: string): Promise<PluginConfig | null> {
    const configFile = path.join(this.storageDir, `${pluginId}.config.json`);
    try {
      const content = await fs.readFile(configFile, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Save plugin config to disk
   */
  private async savePluginConfig(pluginId: string, config: PluginConfig): Promise<void> {
    const configFile = path.join(this.storageDir, `${pluginId}.config.json`);
    await fs.writeFile(configFile, JSON.stringify(config, null, 2), 'utf-8');
  }

  /**
   * Load installed plugins from disk
   */
  private async loadInstalledPlugins(): Promise<void> {
    // In production, this would scan plugin directories and load manifests
    // For now, plugins are registered programmatically
  }
}

// =============================================================================
// Plugin Builder
// =============================================================================

/**
 * Builder for creating plugins
 */
export class PluginBuilder {
  private manifest: Partial<PluginManifest> = {};
  private toolsMap: Map<string, { definition: ToolDefinition; executor: ToolExecutor }> = new Map();
  private handlers: MessageHandler[] = [];
  private api: PluginPublicAPI = {};
  private lifecycle: Plugin['lifecycle'] = {};
  private dbTables: PluginDatabaseTable[] = [];

  /**
   * Set plugin metadata
   */
  meta(manifest: Partial<PluginManifest>): this {
    this.manifest = { ...this.manifest, ...manifest };
    return this;
  }

  /**
   * Set plugin ID
   */
  id(id: string): this {
    this.manifest.id = id;
    return this;
  }

  /**
   * Set plugin name
   */
  name(name: string): this {
    this.manifest.name = name;
    return this;
  }

  /**
   * Set plugin version
   */
  version(version: string): this {
    this.manifest.version = version;
    return this;
  }

  /**
   * Set plugin description
   */
  description(description: string): this {
    this.manifest.description = description;
    return this;
  }

  /**
   * Set plugin capabilities
   */
  capabilities(capabilities: PluginCapability[]): this {
    this.manifest.capabilities = capabilities;
    return this;
  }

  /**
   * Set onLoad lifecycle hook
   */
  onLoad(hook: (context: PluginContext) => Promise<void>): this {
    this.lifecycle.onLoad = hook as () => Promise<void>;
    return this;
  }

  /**
   * Set onUnload lifecycle hook
   */
  onUnload(hook: (context: PluginContext) => Promise<void>): this {
    this.lifecycle.onUnload = hook as () => Promise<void>;
    return this;
  }

  /**
   * Set onEnable lifecycle hook
   */
  onEnable(hook: (context: PluginContext) => Promise<void>): this {
    this.lifecycle.onEnable = hook as () => Promise<void>;
    return this;
  }

  /**
   * Set onDisable lifecycle hook
   */
  onDisable(hook: (context: PluginContext) => Promise<void>): this {
    this.lifecycle.onDisable = hook as () => Promise<void>;
    return this;
  }

  /**
   * Add a tool
   */
  tool(definition: ToolDefinition, executor: ToolExecutor): this {
    this.toolsMap.set(definition.name, { definition, executor });
    return this;
  }

  /**
   * Add multiple tools
   */
  tools(toolsList: Array<{ definition: ToolDefinition; executor: ToolExecutor }>): this {
    for (const tool of toolsList) {
      this.toolsMap.set(tool.definition.name, tool);
    }
    return this;
  }

  /**
   * Add a message handler
   */
  handler(handler: MessageHandler): this {
    this.handlers.push(handler);
    return this;
  }

  /**
   * Set public API
   */
  publicApi(api: PluginPublicAPI): this {
    this.api = api;
    return this;
  }

  /**
   * Set lifecycle hooks
   */
  hooks(hooks: Plugin['lifecycle']): this {
    this.lifecycle = hooks;
    return this;
  }

  /**
   * Declare a database table for this plugin.
   * The table will be auto-created on startup and protected from deletion.
   */
  database(
    name: string,
    displayName: string,
    columns: PluginDatabaseColumn[],
    options?: { description?: string }
  ): this {
    this.dbTables.push({
      name,
      displayName,
      description: options?.description,
      columns,
    });
    return this;
  }

  /**
   * Build the plugin
   */
  build(): { manifest: PluginManifest; implementation: Partial<Plugin> } {
    if (!this.manifest.id || !this.manifest.name || !this.manifest.version) {
      throw new Error('Plugin must have id, name, and version');
    }

    const manifest: PluginManifest = {
      id: this.manifest.id,
      name: this.manifest.name,
      version: this.manifest.version,
      description: this.manifest.description ?? '',
      capabilities: this.manifest.capabilities ?? [],
      permissions: this.manifest.permissions ?? [],
      main: this.manifest.main ?? 'index.js',
      ...this.manifest,
      ...(this.dbTables.length > 0 ? { databaseTables: this.dbTables } : {}),
    };

    return {
      manifest,
      implementation: {
        tools: this.toolsMap,
        handlers: this.handlers,
        api: this.api,
        lifecycle: this.lifecycle,
      },
    };
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new plugin builder
 */
export function createPlugin(): PluginBuilder {
  return new PluginBuilder();
}

/**
 * Create a plugin registry (internal helper)
 */
function createPluginRegistry(storageDir?: string): PluginRegistry {
  return new PluginRegistry(storageDir);
}

/**
 * Default plugin registry singleton.
 *
 * @internal Used by server.ts startup, tool-executor.ts, and PluginServiceImpl adapter.
 * Prefer `getServiceRegistry().get(Services.Plugin)` for new code.
 */
let defaultRegistry: PluginRegistry | null = null;

export async function getDefaultPluginRegistry(): Promise<PluginRegistry> {
  if (!defaultRegistry) {
    defaultRegistry = createPluginRegistry();
    await defaultRegistry.initialize();
  }
  return defaultRegistry;
}
