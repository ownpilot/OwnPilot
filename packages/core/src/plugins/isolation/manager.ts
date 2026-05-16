/**
 * Plugin isolation manager — creates and lifecycle-manages isolated
 * contexts; the single composition root for the isolation subsystem.
 *
 * Also exports the public `createIsolationManager` factory and the
 * tier/limits constants.
 */

import { err } from '../../types/result.js';
import { IsolationEnforcer } from './enforcer.js';
import { PluginIsolatedEvents } from './events.js';
import { PluginIsolatedLogger } from './logger.js';
import { PluginIsolatedNetwork } from './network.js';
import { PluginIsolatedPluginAPI } from './plugin-api.js';
import { PluginIsolatedStorage } from './storage.js';
import type {
  IsolatedPluginAPI,
  IsolatedPluginContext,
  IsolationConfig,
  PluginCapability,
  PluginCommError,
  PluginRegistryInterface,
} from './types.js';

export class PluginIsolationManager {
  private readonly enforcer: IsolationEnforcer;
  private readonly contexts: Map<string, IsolatedPluginContext> = new Map();
  private readonly storages: Map<string, PluginIsolatedStorage> = new Map();
  private registry?: PluginRegistryInterface;

  constructor(config: { maxViolations?: number } = {}) {
    this.enforcer = new IsolationEnforcer(config);
  }

  setRegistry(registry: PluginRegistryInterface): void {
    this.registry = registry;
  }

  createContext(config: IsolationConfig): IsolatedPluginContext {
    const { pluginId, capabilities, allowedDomains, storageQuota } = config;

    const storage = new PluginIsolatedStorage(pluginId, storageQuota);
    this.storages.set(pluginId, storage);

    const hasNetworkCapability =
      capabilities.includes('network:fetch') ||
      capabilities.includes('network:domains:*') ||
      capabilities.includes('network:domains:specific');

    const network = hasNetworkCapability
      ? new PluginIsolatedNetwork(pluginId, allowedDomains ?? [])
      : null;

    const events = new PluginIsolatedEvents(pluginId);
    const log = new PluginIsolatedLogger(pluginId);

    const plugins = this.registry
      ? new PluginIsolatedPluginAPI(pluginId, this.registry, this.enforcer)
      : ({
          getPublicAPI: async () => null,
          sendMessage: async () =>
            err({ type: 'plugin_not_found', pluginId: '' } as PluginCommError),
          listPlugins: async () => [],
        } as IsolatedPluginAPI);

    const context: IsolatedPluginContext = {
      pluginId,
      version: '1.0.0',
      capabilities: Object.freeze([...capabilities]),
      storage,
      network,
      events,
      log,
      plugins,
    };

    this.contexts.set(pluginId, context);
    return context;
  }

  getContext(pluginId: string): IsolatedPluginContext | undefined {
    return this.contexts.get(pluginId);
  }

  async destroyContext(pluginId: string): Promise<void> {
    const context = this.contexts.get(pluginId);
    if (context) {
      context.events.removeAllListeners();
      await context.storage.clear();
      this.contexts.delete(pluginId);
      this.storages.delete(pluginId);
    }
  }

  getEnforcer(): IsolationEnforcer {
    return this.enforcer;
  }

  hasCapability(pluginId: string, capability: PluginCapability): boolean {
    const context = this.contexts.get(pluginId);
    return context?.capabilities.includes(capability) ?? false;
  }

  getActiveContexts(): string[] {
    return [...this.contexts.keys()];
  }
}

/**
 * Create a new isolation manager.
 */
export function createIsolationManager(
  config: { maxViolations?: number } = {}
): PluginIsolationManager {
  return new PluginIsolationManager(config);
}

/**
 * Default storage quotas by tier.
 */
export const STORAGE_QUOTAS = {
  free: 1 * 1024 * 1024, // 1MB
  basic: 10 * 1024 * 1024, // 10MB
  pro: 100 * 1024 * 1024, // 100MB
  enterprise: 1024 * 1024 * 1024, // 1GB
} as const;

/**
 * Default resource limits.
 */
export const DEFAULT_ISOLATION_LIMITS = {
  cpuLimit: 5000, // 5 seconds
  memoryLimit: 128 * 1024 * 1024, // 128MB
  executionTimeout: 30000, // 30 seconds
  storageQuota: STORAGE_QUOTAS.basic,
} as const;
