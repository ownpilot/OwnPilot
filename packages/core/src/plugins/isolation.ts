/**
 * Plugin Isolation Layer — facade.
 *
 * Provides complete isolation between plugins and system resources.
 * Plugins CANNOT access:
 *   - User memory (SecureMemoryStore)
 *   - User credentials (UserCredentialStore)
 *   - Other plugins' data
 *   - System internals
 *
 * All access is mediated through capability-based proxies. The actual
 * implementations live under `./isolation/` (one module per concern:
 * enforcer, storage, network, events, logger, plugin-api, manager).
 * This file preserves the original import path used by sibling modules
 * and external consumers.
 */

export type {
  PluginCapability,
  ForbiddenResource,
  IsolationConfig,
  IsolatedPluginContext,
  IsolatedStorage,
  StorageError,
  IsolatedNetwork,
  IsolatedFetchOptions,
  IsolatedResponse,
  NetworkError,
  IsolatedEvents,
  AllowedPluginEvent,
  IsolatedLogger,
  IsolatedPluginAPI,
  PluginCommError,
  AccessViolation,
  PluginRegistryInterface,
} from './isolation/types.js';

export { IsolationEnforcer } from './isolation/enforcer.js';
export { PluginIsolatedStorage } from './isolation/storage.js';
export { PluginIsolatedNetwork } from './isolation/network.js';
export { PluginIsolatedEvents } from './isolation/events.js';
export { PluginIsolatedLogger } from './isolation/logger.js';
export { PluginIsolatedPluginAPI } from './isolation/plugin-api.js';
export {
  PluginIsolationManager,
  createIsolationManager,
  STORAGE_QUOTAS,
  DEFAULT_ISOLATION_LIMITS,
} from './isolation/manager.js';
