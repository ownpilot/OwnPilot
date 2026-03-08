/**
 * Plugin System
 *
 * Extensible plugin architecture for the AI Gateway.
 * This barrel re-exports all plugin types, classes, and functions.
 */

// Types
export type {
  PluginCapability,
  PluginPermission,
  PluginStatus,
  PluginCategoryType,
  PluginRequiredService,
  PluginDatabaseColumn,
  PluginDatabaseTable,
  PluginManifest,
  PluginConfig,
  PluginContext,
  PluginStorage,
  PluginLogger,
  PluginEvents,
  PluginPublicAPI,
  Plugin,
  MessageHandler,
  HandlerContext,
  HandlerResult,
} from './types.js';

// Registry, Builder, Factory functions
export {
  PluginRegistry,
  PluginBuilder,
  createPlugin,
  getDefaultPluginRegistry,
} from './registry.js';

// Isolation system - secure plugin boundaries
export {
  // Types
  type PluginCapability as IsolatedPluginCapability,
  type ForbiddenResource,
  type IsolationConfig,
  type IsolatedPluginContext,
  type IsolatedStorage,
  type StorageError,
  type IsolatedNetwork,
  type IsolatedFetchOptions,
  type IsolatedResponse,
  type NetworkError,
  type IsolatedEvents,
  type AllowedPluginEvent,
  type IsolatedLogger,
  type IsolatedPluginAPI,
  type PluginCommError,
  type AccessViolation,
  type PluginRegistryInterface,
  // Classes
  IsolationEnforcer,
  PluginIsolatedStorage,
  PluginIsolatedNetwork,
  PluginIsolatedEvents,
  PluginIsolatedLogger,
  PluginIsolatedPluginAPI,
  PluginIsolationManager,
  // Factory functions
  createIsolationManager,
  // Constants
  STORAGE_QUOTAS,
  DEFAULT_ISOLATION_LIMITS,
} from './isolation.js';

// Marketplace system - plugin distribution
export {
  // Types
  type TrustLevel,
  type SecurityRisk,
  type PluginCategory,
  type MarketplaceManifest,
  type PublisherInfo,
  type SecurityDeclaration,
  type PluginSignature,
  type VerificationResult,
  type RevocationEntry,
  type ManifestValidationError,
  type SearchCriteria,
  // Functions
  calculateSecurityRisk,
  generatePublisherKeys,
  signManifest,
  verifySignature,
  calculateContentHash,
  validateManifest,
  createMinimalSecurityDeclaration,
  createSecurityDeclaration,
  // Classes
  PluginVerifier,
  MarketplaceRegistry,
  // Factory functions
  createMarketplaceRegistry,
  createPluginVerifier,
} from './marketplace.js';

// Runtime system - secure plugin execution
export {
  // Types
  type PluginState,
  type PluginInstance,
  type LoadOptions,
  type RuntimeConfig,
  type RuntimeEvents,
  // Classes
  PluginSecurityBarrier,
  SecurePluginRuntime,
  // Factory functions
  createPluginRuntime,
  getDefaultRuntime,
  resetDefaultRuntime,
} from './runtime.js';

// API Boundary - definitive access control specification
export {
  // Types
  type PluginAllowedAPI,
  type PluginForbiddenAPI,
  type RuntimePluginAPI,
  // Constants
  CAPABILITY_API_MAP,
  ALWAYS_AVAILABLE_API,
  FORBIDDEN_PATTERNS,
  API_DOCUMENTATION,
  // Functions
  canAccessAPI,
  containsForbiddenPatterns,
  createPluginAPIProxy,
} from './api-boundary.js';

// CorePlugin - built-in tools packaged as a plugin
export { buildCorePlugin } from './core-plugin.js';
