/**
 * Plugin API Boundary
 *
 * DEFINITIVE SPECIFICATION of what plugins can and cannot access.
 * This module serves as the single source of truth for plugin permissions.
 *
 * CRITICAL SECURITY INVARIANTS:
 * ============================
 * 1. Plugins CANNOT access user memory (SecureMemoryStore)
 * 2. Plugins CANNOT access user credentials (UserCredentialStore)
 * 3. Plugins CANNOT access other plugins' internal state
 * 4. Plugins CANNOT spawn system processes
 * 5. Plugins CANNOT access environment variables
 * 6. Plugins CANNOT modify audit logs
 * 7. Plugins CANNOT access encryption keys
 *
 * These invariants are ABSOLUTE and cannot be overridden by any capability.
 */

import type { PluginCapability } from './isolation.js';

// =============================================================================
// API Boundary Specification
// =============================================================================

/**
 * API that plugins ARE allowed to use (Whitelist)
 */
export interface PluginAllowedAPI {
  // ===== STORAGE =====
  /** Plugin's own isolated storage - key/value store */
  storage: {
    /** Read value by key */
    get(key: string): Promise<unknown>;
    /** Write value by key (quota enforced) */
    set(key: string, value: unknown): Promise<void>;
    /** Delete value by key */
    delete(key: string): Promise<boolean>;
    /** List all keys */
    keys(): Promise<string[]>;
    /** Get storage usage */
    usage(): Promise<{ used: number; quota: number }>;
  };

  // ===== NETWORK =====
  /** HTTP client (domain-restricted, rate-limited) */
  network: {
    /** Make HTTP request to allowed domains only */
    fetch(url: string, options?: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      timeout?: number;
    }): Promise<{
      status: number;
      body: string;
      headers: Record<string, string>;
    }>;
    /** Check if domain is allowed */
    isDomainAllowed(domain: string): boolean;
  };

  // ===== TOOLS =====
  /** Tool registration and invocation */
  tools: {
    /** Register a new tool */
    register(definition: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }, handler: (args: Record<string, unknown>) => Promise<unknown>): void;
    /** List available tools (own and shared) */
    list(): Array<{ name: string; description: string }>;
  };

  // ===== EVENTS =====
  /** Event subscription (filtered events only) */
  events: {
    /** Subscribe to allowed events */
    on(event: string, handler: (data: unknown) => void): () => void;
    /** Emit event (plugin namespace only) */
    emit(event: string, data: unknown): void;
  };

  // ===== LOGGING =====
  /** Sanitized logging */
  log: {
    debug(message: string, data?: Record<string, unknown>): void;
    info(message: string, data?: Record<string, unknown>): void;
    warn(message: string, data?: Record<string, unknown>): void;
    error(message: string, data?: Record<string, unknown>): void;
  };

  // ===== INTER-PLUGIN =====
  /** Communication with other plugins */
  plugins: {
    /** Get another plugin's public API */
    getPublicAPI(pluginId: string): Promise<Record<string, unknown> | null>;
    /** Send message to another plugin */
    sendMessage(pluginId: string, message: unknown): Promise<void>;
    /** List available plugins */
    list(): Promise<Array<{ id: string; name: string }>>;
  };

  // ===== UI =====
  /** UI capabilities (if granted) */
  ui: {
    /** Show notification */
    notify(title: string, body: string, options?: {
      type?: 'info' | 'success' | 'warning' | 'error';
      duration?: number;
    }): void;
    /** Show dialog */
    showDialog(options: {
      title: string;
      body: string;
      buttons: string[];
    }): Promise<number>;
  };

  // ===== UTILITIES =====
  /** Safe utilities */
  utils: {
    /** Generate UUID */
    uuid(): string;
    /** Get current timestamp */
    now(): number;
    /** Create hash (SHA-256) */
    hash(data: string): string;
    /** Parse JSON safely */
    parseJSON<T>(text: string): T | null;
    /** Stringify JSON safely */
    stringify(data: unknown): string;
  };
}

/**
 * API that plugins are FORBIDDEN from accessing (Blacklist)
 *
 * ANY attempt to access these will:
 * 1. Be blocked immediately
 * 2. Logged as security violation
 * 3. Potentially block the plugin after repeated attempts
 */
export interface PluginForbiddenAPI {
  // ===== MEMORY SYSTEM - ABSOLUTE BARRIER =====
  /** @forbidden User's secure memory store */
  SecureMemoryStore: never;
  /** @forbidden Memory entries */
  MemoryEntry: never;
  /** @forbidden Memory operations */
  memoryStore: never;
  /** @forbidden User memories */
  userMemory: never;
  /** @forbidden Memory retrieval */
  retrieveMemory: never;
  /** @forbidden Memory storage */
  storeMemory: never;

  // ===== CREDENTIAL SYSTEM - ABSOLUTE BARRIER =====
  /** @forbidden User credential store */
  UserCredentialStore: never;
  /** @forbidden Credentials */
  Credential: never;
  /** @forbidden Credential operations */
  credentialStore: never;
  /** @forbidden User credentials */
  userCredential: never;
  /** @forbidden API keys */
  apiKey: never;
  /** @forbidden OAuth tokens */
  oauthToken: never;

  // ===== ENCRYPTION - ABSOLUTE BARRIER =====
  /** @forbidden Encryption keys */
  encryptionKey: never;
  /** @forbidden Master keys */
  masterKey: never;
  /** @forbidden Private keys */
  privateKey: never;
  /** @forbidden Key derivation */
  deriveKey: never;
  /** @forbidden Vault operations */
  vault: never;

  // ===== AUDIT SYSTEM - ABSOLUTE BARRIER =====
  /** @forbidden Audit logs (read) */
  auditLog: never;
  /** @forbidden Audit events */
  AuditEvent: never;
  /** @forbidden Audit modification */
  modifyAuditLog: never;

  // ===== PROCESS/SYSTEM - ABSOLUTE BARRIER =====
  /** @forbidden Process spawning */
  spawn: never;
  /** @forbidden Child process */
  childProcess: never;
  /** @forbidden Environment variables */
  env: never;
  /** @forbidden Process object */
  process: never;
  /** @forbidden File system (unrestricted) */
  fs: never;
  /** @forbidden OS operations */
  os: never;

  // ===== INTERNAL STATE - ABSOLUTE BARRIER =====
  /** @forbidden Other plugins' internal state */
  pluginInternal: never;
  /** @forbidden System configuration */
  systemConfig: never;
  /** @forbidden Provider configuration */
  providerConfig: never;
}

// =============================================================================
// Capability to API Mapping
// =============================================================================

/**
 * Maps capabilities to allowed API access
 */
export const CAPABILITY_API_MAP: Record<PluginCapability, string[]> = {
  // Storage capabilities
  'storage:read': ['storage.get', 'storage.keys', 'storage.usage'],
  'storage:write': ['storage.set', 'storage.delete'],
  'storage:quota:1mb': [],
  'storage:quota:10mb': [],
  'storage:quota:100mb': [],

  // Network capabilities
  'network:fetch': ['network.fetch', 'network.isDomainAllowed'],
  'network:domains:*': [],
  'network:domains:specific': [],

  // Execution capabilities
  'execute:javascript': [],
  'execute:sandbox': [],

  // UI capabilities
  'ui:notifications': ['ui.notify'],
  'ui:dialogs': ['ui.showDialog'],
  'ui:widgets': [],

  // Tool capabilities
  'tools:register': ['tools.register'],
  'tools:invoke': ['tools.list'],

  // Event capabilities
  'events:subscribe': ['events.on'],
  'events:emit': ['events.emit'],

  // Inter-plugin capabilities
  'plugins:communicate': ['plugins.getPublicAPI', 'plugins.sendMessage', 'plugins.list'],
};

/**
 * Always available APIs (no capability required)
 */
export const ALWAYS_AVAILABLE_API = [
  'log.debug',
  'log.info',
  'log.warn',
  'log.error',
  'utils.uuid',
  'utils.now',
  'utils.hash',
  'utils.parseJSON',
  'utils.stringify',
];

// =============================================================================
// API Access Checker
// =============================================================================

/**
 * Check if a plugin can access a specific API
 */
export function canAccessAPI(
  apiPath: string,
  capabilities: PluginCapability[]
): { allowed: boolean; reason?: string } {
  // Check if always available
  if (ALWAYS_AVAILABLE_API.includes(apiPath)) {
    return { allowed: true };
  }

  // Check each capability
  for (const capability of capabilities) {
    const allowedAPIs = CAPABILITY_API_MAP[capability];
    if (allowedAPIs && allowedAPIs.includes(apiPath)) {
      return { allowed: true };
    }
  }

  // Check if it's a forbidden API
  const forbiddenPatterns = [
    'memory',
    'credential',
    'encryption',
    'masterKey',
    'privateKey',
    'vault',
    'audit',
    'spawn',
    'process',
    'env',
    'fs',
    'os',
  ];

  for (const pattern of forbiddenPatterns) {
    if (apiPath.toLowerCase().includes(pattern.toLowerCase())) {
      return {
        allowed: false,
        reason: `Access to ${apiPath} is forbidden - security boundary violation`,
      };
    }
  }

  return {
    allowed: false,
    reason: `No capability grants access to ${apiPath}`,
  };
}

// =============================================================================
// Security Boundary Verification
// =============================================================================

/**
 * Patterns that indicate forbidden access attempts
 */
export const FORBIDDEN_PATTERNS = [
  // Memory access
  /SecureMemoryStore/i,
  /MemoryEntry/i,
  /memoryStore/i,
  /userMemory/i,
  /retrieveMemory/i,
  /storeMemory/i,

  // Credential access
  /UserCredentialStore/i,
  /Credential(?!s:)/i,
  /credentialStore/i,
  /userCredential/i,
  /apiKey(?!s:)/i,
  /oauthToken/i,

  // Encryption access
  /encryptionKey/i,
  /masterKey/i,
  /privateKey/i,
  /deriveKey/i,
  /vault/i,

  // Audit access
  /auditLog/i,
  /AuditEvent/i,
  /modifyAudit/i,

  // Process access
  /child_process/i,
  /childProcess/i,
  /spawn/i,
  /exec(?:Sync)?/i,
  /fork/i,

  // System access
  /process\.env/i,
  /process\.exit/i,
  /require\s*\(\s*['"]fs['"]\)/i,
  /require\s*\(\s*['"]os['"]\)/i,
  /require\s*\(\s*['"]path['"]\)/i,

  // Dangerous globals
  /globalThis/i,
  /global\./i,
  /eval\s*\(/i,
  /Function\s*\(/i,
  /import\s*\(/i,
];

/**
 * Check if code contains forbidden patterns
 */
export function containsForbiddenPatterns(code: string): {
  safe: boolean;
  violations: string[];
} {
  const violations: string[] = [];

  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(code)) {
      violations.push(`Code contains forbidden pattern: ${pattern.source}`);
    }
  }

  return {
    safe: violations.length === 0,
    violations,
  };
}

// =============================================================================
// API Proxy Generator
// =============================================================================

/**
 * Runtime plugin API - only includes APIs that are actually granted
 */
export type RuntimePluginAPI = Partial<PluginAllowedAPI>;

/**
 * Generate a secure API proxy for a plugin
 *
 * This creates a frozen object that only exposes allowed APIs
 * and blocks all attempts to access forbidden resources.
 *
 * @returns Partial API - only includes APIs granted by capabilities
 */
export function createPluginAPIProxy(
  capabilities: PluginCapability[],
  implementations: Partial<PluginAllowedAPI>
): RuntimePluginAPI {
  const proxy: Record<string, unknown> = {};

  // Add always-available APIs
  if (implementations.log) {
    proxy.log = Object.freeze({ ...implementations.log });
  }
  if (implementations.utils) {
    proxy.utils = Object.freeze({ ...implementations.utils });
  }

  // Add capability-gated APIs
  for (const capability of capabilities) {
    switch (capability) {
      case 'storage:read':
      case 'storage:write':
        if (implementations.storage && !proxy.storage) {
          const storageProxy: Record<string, unknown> = {};

          if (capabilities.includes('storage:read')) {
            storageProxy.get = implementations.storage.get;
            storageProxy.keys = implementations.storage.keys;
            storageProxy.usage = implementations.storage.usage;
          }

          if (capabilities.includes('storage:write')) {
            storageProxy.set = implementations.storage.set;
            storageProxy.delete = implementations.storage.delete;
          }

          proxy.storage = Object.freeze(storageProxy);
        }
        break;

      case 'network:fetch':
        if (implementations.network) {
          proxy.network = Object.freeze({ ...implementations.network });
        }
        break;

      case 'tools:register':
      case 'tools:invoke':
        if (implementations.tools && !proxy.tools) {
          const toolsProxy: Record<string, unknown> = {};

          if (capabilities.includes('tools:register')) {
            toolsProxy.register = implementations.tools.register;
          }

          if (capabilities.includes('tools:invoke')) {
            toolsProxy.list = implementations.tools.list;
          }

          proxy.tools = Object.freeze(toolsProxy);
        }
        break;

      case 'events:subscribe':
      case 'events:emit':
        if (implementations.events && !proxy.events) {
          const eventsProxy: Record<string, unknown> = {};

          if (capabilities.includes('events:subscribe')) {
            eventsProxy.on = implementations.events.on;
          }

          if (capabilities.includes('events:emit')) {
            eventsProxy.emit = implementations.events.emit;
          }

          proxy.events = Object.freeze(eventsProxy);
        }
        break;

      case 'ui:notifications':
      case 'ui:dialogs':
        if (implementations.ui && !proxy.ui) {
          const uiProxy: Record<string, unknown> = {};

          if (capabilities.includes('ui:notifications')) {
            uiProxy.notify = implementations.ui.notify;
          }

          if (capabilities.includes('ui:dialogs')) {
            uiProxy.showDialog = implementations.ui.showDialog;
          }

          proxy.ui = Object.freeze(uiProxy);
        }
        break;

      case 'plugins:communicate':
        if (implementations.plugins) {
          proxy.plugins = Object.freeze({ ...implementations.plugins });
        }
        break;
    }
  }

  // Create and return frozen proxy
  return Object.freeze(proxy) as RuntimePluginAPI;
}

// =============================================================================
// Documentation
// =============================================================================

/**
 * Plugin API Documentation
 *
 * ## Security Model
 *
 * The plugin system uses a capability-based security model:
 *
 * 1. **Whitelist Approach**: Plugins can ONLY access explicitly granted APIs
 * 2. **Absolute Barriers**: Some resources (memory, credentials) are NEVER accessible
 * 3. **Defense in Depth**: Multiple layers of protection (sandbox, proxy, audit)
 *
 * ## Capability Levels
 *
 * | Capability | Access Granted |
 * |------------|----------------|
 * | storage:read | Read own storage |
 * | storage:write | Write own storage |
 * | network:fetch | HTTP requests to allowed domains |
 * | tools:register | Register new tools |
 * | tools:invoke | Use available tools |
 * | events:subscribe | Listen to events |
 * | events:emit | Emit events |
 * | ui:notifications | Show notifications |
 * | ui:dialogs | Show dialogs |
 * | plugins:communicate | Talk to other plugins |
 *
 * ## Absolute Barriers (NEVER Accessible)
 *
 * - User memory (SecureMemoryStore)
 * - User credentials (UserCredentialStore)
 * - Encryption keys
 * - Audit logs
 * - System processes
 * - Environment variables
 *
 * ## Best Practices
 *
 * 1. Request minimal capabilities
 * 2. Declare all network domains
 * 3. Encrypt sensitive stored data
 * 4. Handle errors gracefully
 * 5. Respect rate limits
 */
export const API_DOCUMENTATION = `
# Plugin API Reference

## Available APIs

### Storage (capability: storage:read, storage:write)
- get(key) - Read value
- set(key, value) - Write value
- delete(key) - Delete value
- keys() - List keys
- usage() - Get quota usage

### Network (capability: network:fetch)
- fetch(url, options) - HTTP request
- isDomainAllowed(domain) - Check domain

### Tools (capability: tools:register, tools:invoke)
- register(definition, handler) - Register tool
- list() - List tools

### Events (capability: events:subscribe, events:emit)
- on(event, handler) - Subscribe
- emit(event, data) - Emit

### Logging (always available)
- debug/info/warn/error(message, data)

### Utilities (always available)
- uuid() - Generate UUID
- now() - Timestamp
- hash(data) - SHA-256 hash
- parseJSON(text) - Safe JSON parse
- stringify(data) - JSON stringify

## Forbidden APIs (NEVER accessible)

- Memory system
- Credential system
- Encryption keys
- Audit logs
- Process spawning
- Environment variables
- File system (unrestricted)
`;
