/**
 * Plugin System Types
 *
 * All plugin-related interfaces, types, and contracts.
 */

import type { ToolDefinition, ToolExecutor } from '../agent/types.js';
import type { PluginId } from '../types/branded.js';
import type { ConfigFieldDefinition } from '../services/config-center.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Plugin capability types
 */
export type PluginCapability =
  | 'tools' // Provides tools
  | 'handlers' // Message handlers
  | 'events' // Emits/subscribes to events
  | 'storage' // Has storage needs
  | 'scheduled' // Has scheduled tasks
  | 'notifications' // Can send notifications
  | 'ui' // Has UI components
  | 'integrations'; // External integrations

/**
 * Plugin permission requirements
 */
export type PluginPermission =
  | 'file_read'
  | 'file_write'
  | 'network'
  | 'code_execute'
  | 'memory_access'
  | 'notifications'
  | 'calendar'
  | 'email'
  | 'storage';

/**
 * Plugin status
 */
export type PluginStatus = 'installed' | 'enabled' | 'disabled' | 'error' | 'updating';

/**
 * Plugin category for UI grouping
 */
export type PluginCategoryType =
  | 'core'
  | 'productivity'
  | 'communication'
  | 'utilities'
  | 'data'
  | 'integrations'
  | 'media'
  | 'developer'
  | 'lifestyle'
  | 'channel'
  | 'other';

/**
 * External Config Center service required by a plugin
 */
export interface PluginRequiredService {
  /** Config Center service name (e.g. 'openweathermap', 'smtp') */
  name: string;
  /** Human display name (used if service doesn't exist yet) */
  displayName?: string;
  /** Description (used if service doesn't exist yet) */
  description?: string;
  /** Config Center category */
  category?: string;
  /** Documentation URL */
  docsUrl?: string;
  /** Whether the service supports multiple entries */
  multiEntry?: boolean;
  /** Schema to auto-register if the service doesn't exist */
  configSchema?: ConfigFieldDefinition[];
}

/**
 * Column definition for plugin database tables
 */
export interface PluginDatabaseColumn {
  name: string;
  type: 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'json';
  required?: boolean;
  defaultValue?: string | number | boolean | null;
  description?: string;
}

/**
 * Database table declaration for plugins.
 * Used by PluginBuilder.database() to auto-create protected tables on startup.
 */
export interface PluginDatabaseTable {
  name: string;
  displayName: string;
  description?: string;
  columns: PluginDatabaseColumn[];
}

/**
 * Plugin manifest
 */
export interface PluginManifest {
  /** Unique plugin ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Version (semver) */
  version: string;
  /** Description */
  description: string;
  /** Author information */
  author?: {
    name: string;
    email?: string;
    url?: string;
  };
  /** Plugin capabilities */
  capabilities: PluginCapability[];
  /** Required permissions */
  permissions: PluginPermission[];
  /** Dependencies on other plugins */
  dependencies?: Record<string, string>;
  /** Entry point file */
  main: string;
  /** Icon URL or data URI */
  icon?: string;
  /** Documentation URL */
  docs?: string;
  /** Plugin category for UI grouping */
  category?: PluginCategoryType;
  /** Plugin's own settings schema (rendered via DynamicConfigForm) */
  pluginConfigSchema?: ConfigFieldDefinition[];
  /** Default values for plugin's own settings */
  defaultConfig?: Record<string, unknown>;
  /** External Config Center services this plugin needs */
  requiredServices?: PluginRequiredService[];
  /** @deprecated Use pluginConfigSchema */
  configSchema?: Record<string, unknown>;
  /** @deprecated Use requiredServices */
  requiredApiServices?: Array<{
    name: string;
    displayName?: string;
    description?: string;
    category?: string;
    docsUrl?: string;
    envVarName?: string;
  }>;
  /** Database tables this plugin needs (auto-created on startup, protected from deletion) */
  databaseTables?: PluginDatabaseTable[];
}

/**
 * Plugin configuration
 */
export interface PluginConfig {
  /** Whether plugin is enabled */
  enabled: boolean;
  /** User-specific settings */
  settings: Record<string, unknown>;
  /** Granted permissions */
  grantedPermissions: PluginPermission[];
  /** Installation date */
  installedAt: string;
  /** Last updated */
  updatedAt: string;
}

/**
 * Plugin context provided to plugin code
 */
export interface PluginContext {
  /** Plugin ID */
  pluginId: PluginId;
  /** Plugin configuration */
  config: PluginConfig;
  /** Storage API */
  storage: PluginStorage;
  /** Logger */
  log: PluginLogger;
  /** Event emitter for inter-plugin communication */
  events: PluginEvents;
  /** Access to other plugins' public APIs */
  getPlugin: (id: string) => PluginPublicAPI | undefined;
}

/**
 * Plugin storage API
 */
export interface PluginStorage {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list(): Promise<string[]>;
  clear(): Promise<void>;
}

/**
 * Plugin logger
 */
export interface PluginLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * Plugin events for inter-plugin communication
 */
export interface PluginEvents {
  emit(event: string, data: unknown): void;
  on(event: string, handler: (data: unknown) => void): void;
  off(event: string, handler: (data: unknown) => void): void;
}

/**
 * Plugin public API (exposed to other plugins)
 */
export interface PluginPublicAPI {
  [key: string]: unknown;
}

/**
 * Plugin instance
 */
export interface Plugin {
  /** Plugin manifest */
  manifest: PluginManifest;
  /** Plugin status */
  status: PluginStatus;
  /** Configuration */
  config: PluginConfig;
  /** Registered tools */
  tools: Map<string, { definition: ToolDefinition; executor: ToolExecutor }>;
  /** Message handlers */
  handlers: MessageHandler[];
  /** Public API */
  api?: PluginPublicAPI;
  /** Lifecycle hooks */
  lifecycle: {
    onLoad?: () => Promise<void>;
    onUnload?: () => Promise<void>;
    onEnable?: () => Promise<void>;
    onDisable?: () => Promise<void>;
    onConfigChange?: (newConfig: Record<string, unknown>) => Promise<void>;
  };
}

/**
 * Message handler for processing user requests
 */
export interface MessageHandler {
  /** Handler name */
  name: string;
  /** Description of what this handler does */
  description: string;
  /** Priority (higher = checked first) */
  priority: number;
  /** Check if this handler can handle the message */
  canHandle: (message: string, context: HandlerContext) => boolean | Promise<boolean>;
  /** Handle the message */
  handle: (message: string, context: HandlerContext) => Promise<HandlerResult>;
}

/**
 * Handler context
 */
export interface HandlerContext {
  userId: string;
  conversationId: string;
  channel: string;
  metadata?: Record<string, unknown>;
}

/**
 * Handler result
 */
export interface HandlerResult {
  /** Whether the handler handled the message */
  handled: boolean;
  /** Response to send */
  response?: string;
  /** Tools to invoke */
  toolCalls?: Array<{ tool: string; args: Record<string, unknown> }>;
  /** Metadata */
  metadata?: Record<string, unknown>;
}
