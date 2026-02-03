/**
 * Config Center - Centralized service configuration management.
 *
 * Provides schema-driven configuration for external services.
 * Each service declares a schema of typed fields; each service
 * can have one or multiple config entries (e.g. multiple email accounts).
 *
 * Interfaces live in core (no gateway dependency).
 * Implementation lives in gateway (backed by PostgreSQL).
 */

// =============================================================================
// SCHEMA TYPES
// =============================================================================

/** Supported field types for config schemas */
export type ConfigFieldType =
  | 'string'   // plain text
  | 'secret'   // masked in UI and API responses
  | 'url'      // validated URL
  | 'number'   // numeric input
  | 'boolean'  // toggle
  | 'select'   // dropdown from options list
  | 'json';    // freeform JSON (textarea + validation)

/** A single field definition within a service config schema */
export interface ConfigFieldDefinition {
  /** Machine key, e.g. 'api_key', 'base_url', 'smtp_host' */
  name: string;
  /** Human label, e.g. 'API Key' */
  label: string;
  /** Field type — controls rendering and validation */
  type: ConfigFieldType;
  /** Optional longer description / help text */
  description?: string;
  /** Whether this field must have a value */
  required?: boolean;
  /** Default value */
  defaultValue?: unknown;
  /** Environment variable fallback name (checked when DB value is empty) */
  envVar?: string;
  /** Placeholder text for the input */
  placeholder?: string;
  /** For 'select' type: the allowed options */
  options?: Array<{ value: string; label: string }>;
  /** Display order (lower = first). Defaults to array index. */
  order?: number;
}

// =============================================================================
// SERVICE & ENTRY TYPES
// =============================================================================

/** Dependency tracking — which tool or plugin needs this service */
export interface ConfigServiceRequiredBy {
  type: 'tool' | 'plugin';
  name: string;
  id: string;
}

/** A config service definition (schema + metadata) */
export interface ConfigServiceDefinition {
  readonly name: string;
  readonly displayName: string;
  readonly category: string;
  readonly description?: string;
  readonly docsUrl?: string;
  /** Schema — array of field definitions */
  readonly configSchema: ConfigFieldDefinition[];
  /** Whether multiple entries are supported */
  readonly multiEntry: boolean;
  readonly isActive: boolean;
  readonly requiredBy: ConfigServiceRequiredBy[];
}

/** A config entry — one filled-in instance of a service's schema */
export interface ConfigEntry {
  readonly id: string;
  readonly serviceName: string;
  readonly label: string;
  /** Field values keyed by field name */
  readonly data: Record<string, unknown>;
  readonly isDefault: boolean;
  readonly isActive: boolean;
}

// =============================================================================
// BACKWARD-COMPAT: ApiServiceConfig
// =============================================================================

/**
 * Legacy configuration shape for an external API service.
 * Kept for backward compatibility with existing tools.
 */
export interface ApiServiceConfig {
  /** Machine-readable unique name */
  readonly name: string;
  /** Human-readable display name */
  readonly displayName: string;
  /** Category for grouping */
  readonly category: string;
  /** Optional description */
  readonly description?: string;
  /** API key (from default entry's 'api_key' field) */
  readonly apiKey?: string;
  /** Base URL (from default entry's 'base_url' field) */
  readonly baseUrl?: string;
  /** Extra config fields (all non-api_key/non-base_url values from default entry) */
  readonly extraConfig: Record<string, unknown>;
  /** Whether this service is active/enabled */
  readonly isActive: boolean;
}

// =============================================================================
// CONFIG CENTER INTERFACE
// =============================================================================

/**
 * Runtime interface for looking up service configuration.
 * Tools use this to retrieve config values without knowing the storage mechanism.
 *
 * Backward compatible: getApiKey() still works alongside the richer entry-based methods.
 */
export interface ConfigCenter {
  // --- Backward-compatible methods ---

  /**
   * Get the API key for a named service.
   * Reads the 'api_key' field from the default entry, with env var fallback.
   * Returns undefined if the service is not configured or not active.
   */
  getApiKey(serviceName: string): string | undefined;

  /**
   * Get the legacy-shaped config for a named service.
   * Returns the default entry's values mapped to the ApiServiceConfig shape.
   */
  getServiceConfig(serviceName: string): ApiServiceConfig | null;

  /**
   * Check whether a service is configured and active (has at least one entry with data).
   */
  isServiceAvailable(serviceName: string): boolean;

  /**
   * List all configured services in legacy ApiServiceConfig shape.
   */
  listServices(category?: string): ApiServiceConfig[];

  // --- New config entry methods ---

  /**
   * Get a config entry's data by service name and optional label.
   * If entryLabel is omitted, returns the default entry.
   */
  getConfigEntry(serviceName: string, entryLabel?: string): ConfigEntry | null;

  /**
   * Get all entries for a service (for multi-entry services).
   */
  getConfigEntries(serviceName: string): ConfigEntry[];

  /**
   * Get a resolved field value (checks DB value, then envVar fallback).
   * If entryLabel is omitted, reads from the default entry.
   */
  getFieldValue(serviceName: string, fieldName: string, entryLabel?: string): unknown;

  /**
   * Get the service definition (schema + metadata).
   */
  getServiceDefinition(serviceName: string): ConfigServiceDefinition | null;
}

