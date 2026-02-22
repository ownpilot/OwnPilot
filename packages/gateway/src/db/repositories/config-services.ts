/**
 * Config Services Repository
 *
 * Centralized storage for schema-driven service configurations.
 * Manages two tables: config_services (service definitions with typed schemas)
 * and config_entries (actual configuration values per service).
 *
 * Uses in-memory cache for fast synchronous access (same pattern as
 * SettingsRepository and ApiServicesRepository).
 */

import { randomUUID } from 'node:crypto';
import { BaseRepository, parseJsonField, parseBool } from './base.js';
import type {
  ConfigFieldDefinition,
  ConfigServiceRequiredBy,
  ConfigServiceDefinition,
  ConfigEntry,
} from '@ownpilot/core';
import { getLog } from '../../services/log.js';

const log = getLog('ConfigServicesRepo');

// =============================================================================
// ROW TYPES (database representation)
// =============================================================================

interface ConfigServiceRow {
  id: string;
  name: string;
  display_name: string;
  category: string;
  description: string | null;
  docs_url: string | null;
  config_schema: string; // JSONB
  multi_entry: boolean;
  required_by: string;   // JSONB
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface ConfigEntryRow {
  id: string;
  service_name: string;
  label: string;
  data: string;  // JSONB
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// INPUT TYPES
// =============================================================================

export interface CreateConfigServiceInput {
  name: string;
  displayName: string;
  category: string;
  description?: string;
  docsUrl?: string;
  configSchema?: ConfigFieldDefinition[];
  multiEntry?: boolean;
  isActive?: boolean;
}

export interface UpdateConfigServiceInput {
  displayName?: string;
  category?: string;
  description?: string;
  docsUrl?: string;
  configSchema?: ConfigFieldDefinition[];
  multiEntry?: boolean;
  isActive?: boolean;
}

export interface CreateConfigEntryInput {
  label?: string;
  data?: Record<string, unknown>;
  isDefault?: boolean;
  isActive?: boolean;
}

export interface UpdateConfigEntryInput {
  label?: string;
  data?: Record<string, unknown>;
  isDefault?: boolean;
  isActive?: boolean;
}

// =============================================================================
// CACHE
// =============================================================================

let servicesCache = new Map<string, ConfigServiceDefinition>();
let entriesCache = new Map<string, ConfigEntry[]>(); // keyed by service_name
let cacheInitialized = false;

// =============================================================================
// ROW-TO-MODEL CONVERSION
// =============================================================================


function rowToService(row: ConfigServiceRow): ConfigServiceDefinition {
  return {
    name: row.name,
    displayName: row.display_name,
    category: row.category,
    description: row.description ?? undefined,
    docsUrl: row.docs_url ?? undefined,
    configSchema: parseJsonField<ConfigFieldDefinition[]>(row.config_schema, []),
    multiEntry: parseBool(row.multi_entry),
    isActive: parseBool(row.is_active),
    requiredBy: parseJsonField<ConfigServiceRequiredBy[]>(row.required_by, []),
  };
}

function rowToEntry(row: ConfigEntryRow): ConfigEntry {
  return {
    id: row.id,
    serviceName: row.service_name,
    label: row.label,
    data: parseJsonField<Record<string, unknown>>(row.data, {}),
    isDefault: parseBool(row.is_default),
    isActive: parseBool(row.is_active),
  };
}

// =============================================================================
// REPOSITORY
// =============================================================================

export class ConfigServicesRepository extends BaseRepository {
  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  /**
   * Load cache from database.
   * Tables are created via schema.ts migrations, not here.
   */
  async initialize(): Promise<void> {
    await this.refreshCache();
  }

  /**
   * Reload every service and entry into the in-memory caches.
   */
  async refreshCache(): Promise<void> {
    const [serviceRows, entryRows] = await Promise.all([
      this.query<ConfigServiceRow>('SELECT * FROM config_services'),
      this.query<ConfigEntryRow>('SELECT * FROM config_entries ORDER BY created_at ASC'),
    ]);

    servicesCache = new Map(serviceRows.map(r => [r.name, rowToService(r)]));

    const grouped = new Map<string, ConfigEntry[]>();
    for (const row of entryRows) {
      const entry = rowToEntry(row);
      const list = grouped.get(entry.serviceName);
      if (list) {
        list.push(entry);
      } else {
        grouped.set(entry.serviceName, [entry]);
      }
    }
    entriesCache = grouped;
    cacheInitialized = true;
  }

  /**
   * Refresh the cache for a single service and its entries.
   */
  private async refreshServiceCache(serviceName: string): Promise<void> {
    const [serviceRow, entryRows] = await Promise.all([
      this.queryOne<ConfigServiceRow>(
        'SELECT * FROM config_services WHERE name = $1',
        [serviceName],
      ),
      this.query<ConfigEntryRow>(
        'SELECT * FROM config_entries WHERE service_name = $1 ORDER BY created_at ASC',
        [serviceName],
      ),
    ]);

    if (serviceRow) {
      servicesCache.set(serviceName, rowToService(serviceRow));
    } else {
      servicesCache.delete(serviceName);
    }

    if (entryRows.length > 0) {
      entriesCache.set(serviceName, entryRows.map(rowToEntry));
    } else {
      entriesCache.delete(serviceName);
    }
  }

  // ---------------------------------------------------------------------------
  // Service accessors (sync, from cache)
  // ---------------------------------------------------------------------------

  /**
   * Get a service definition by name (sync, from cache).
   */
  getByName(name: string): ConfigServiceDefinition | null {
    if (!cacheInitialized) {
      log.warn(`[ConfigServices] Cache not initialized, returning null for: ${name}`);
      return null;
    }
    return servicesCache.get(name) ?? null;
  }

  /**
   * List all service definitions, optionally filtered by category (sync, from cache).
   */
  list(category?: string): ConfigServiceDefinition[] {
    const all = Array.from(servicesCache.values());
    return category ? all.filter(s => s.category === category) : all;
  }

  // ---------------------------------------------------------------------------
  // Service CRUD (async, writes to DB + refreshes cache)
  // ---------------------------------------------------------------------------

  /**
   * Create a new service definition.
   */
  async create(input: CreateConfigServiceInput): Promise<ConfigServiceDefinition> {
    const id = randomUUID();
    const now = new Date().toISOString();

    await this.execute(
      `INSERT INTO config_services
        (id, name, display_name, category, description, docs_url, config_schema, multi_entry, required_by, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id,
        input.name,
        input.displayName,
        input.category,
        input.description ?? null,
        input.docsUrl ?? null,
        JSON.stringify(input.configSchema ?? []),
        input.multiEntry === true,
        '[]',
        input.isActive !== false,
        now,
        now,
      ],
    );

    await this.refreshServiceCache(input.name);
    return servicesCache.get(input.name)!;
  }

  /**
   * Update a service definition by name. Returns null if not found.
   */
  async update(name: string, input: UpdateConfigServiceInput): Promise<ConfigServiceDefinition | null> {
    const existing = servicesCache.get(name);
    if (!existing) return null;

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (input.displayName !== undefined) {
      updates.push(`display_name = $${paramIndex++}`);
      values.push(input.displayName);
    }
    if (input.category !== undefined) {
      updates.push(`category = $${paramIndex++}`);
      values.push(input.category);
    }
    if (input.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(input.description);
    }
    if (input.docsUrl !== undefined) {
      updates.push(`docs_url = $${paramIndex++}`);
      values.push(input.docsUrl);
    }
    if (input.configSchema !== undefined) {
      updates.push(`config_schema = $${paramIndex++}`);
      values.push(JSON.stringify(input.configSchema));
    }
    if (input.multiEntry !== undefined) {
      updates.push(`multi_entry = $${paramIndex++}`);
      values.push(input.multiEntry);
    }
    if (input.isActive !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(input.isActive);
    }

    if (updates.length === 0) return existing;

    updates.push(`updated_at = $${paramIndex++}`);
    values.push(new Date().toISOString());

    values.push(name); // WHERE clause
    await this.execute(
      `UPDATE config_services SET ${updates.join(', ')} WHERE name = $${paramIndex}`,
      values,
    );

    await this.refreshServiceCache(name);
    return servicesCache.get(name) ?? null;
  }

  /**
   * Delete a service definition and all its entries. Returns true if deleted.
   */
  async delete(name: string): Promise<boolean> {
    // Delete entries first (no FK cascade in schema, so do it manually)
    await this.execute('DELETE FROM config_entries WHERE service_name = $1', [name]);
    const result = await this.execute('DELETE FROM config_services WHERE name = $1', [name]);

    servicesCache.delete(name);
    entriesCache.delete(name);

    return result.changes > 0;
  }

  /**
   * Upsert a service definition (for seeding).
   *
   * On conflict:
   *  - Always updates display_name, category, description, docs_url, multi_entry.
   *  - Updates config_schema only when the existing value is the default empty array.
   *  - Never overwrites is_active or required_by (user-managed fields).
   */
  async upsert(input: CreateConfigServiceInput): Promise<ConfigServiceDefinition> {
    const id = randomUUID();
    const now = new Date().toISOString();

    // Determine if config_schema and multi_entry were explicitly provided
    const hasExplicitSchema = input.configSchema !== undefined && input.configSchema.length > 0;
    const hasExplicitMultiEntry = input.multiEntry !== undefined;

    await this.execute(
      `INSERT INTO config_services
        (id, name, display_name, category, description, docs_url, config_schema, multi_entry, required_by, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT(name) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         category = EXCLUDED.category,
         description = COALESCE(NULLIF(EXCLUDED.description, ''), config_services.description),
         docs_url = COALESCE(NULLIF(EXCLUDED.docs_url, ''), config_services.docs_url),
         config_schema = CASE WHEN $13::boolean THEN EXCLUDED.config_schema ELSE config_services.config_schema END,
         multi_entry = CASE WHEN $14::boolean THEN EXCLUDED.multi_entry ELSE config_services.multi_entry END,
         updated_at = EXCLUDED.updated_at`,
      [
        id,
        input.name,
        input.displayName,
        input.category,
        input.description ?? null,
        input.docsUrl ?? null,
        JSON.stringify(input.configSchema ?? []),
        input.multiEntry === true,
        '[]',
        input.isActive !== false,
        now,
        now,
        hasExplicitSchema,
        hasExplicitMultiEntry,
      ],
    );

    await this.refreshServiceCache(input.name);
    return servicesCache.get(input.name)!;
  }

  // ---------------------------------------------------------------------------
  // Entry accessors (sync, from cache)
  // ---------------------------------------------------------------------------

  /**
   * Get all entries for a service (sync, from cache).
   */
  getEntries(serviceName: string): ConfigEntry[] {
    return entriesCache.get(serviceName) ?? [];
  }

  /**
   * Get the default entry for a service (sync, from cache).
   */
  getDefaultEntry(serviceName: string): ConfigEntry | null {
    const entries = entriesCache.get(serviceName);
    if (!entries) return null;
    return entries.find(e => e.isDefault) ?? null;
  }

  /**
   * Get an entry by service name and label (sync, from cache).
   */
  getEntryByLabel(serviceName: string, label: string): ConfigEntry | null {
    const entries = entriesCache.get(serviceName);
    if (!entries) return null;
    return entries.find(e => e.label === label) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Entry CRUD (async, writes to DB + refreshes cache)
  // ---------------------------------------------------------------------------

  /**
   * Create a new config entry for a service.
   *
   * Automatically sets is_default=true if this is the first entry for the service.
   */
  async createEntry(serviceName: string, input: CreateConfigEntryInput): Promise<ConfigEntry> {
    const id = randomUUID();
    const now = new Date().toISOString();

    // Determine if this should be the default entry
    const existingEntries = entriesCache.get(serviceName);
    const isFirstEntry = !existingEntries || existingEntries.length === 0;
    const isDefault = input.isDefault === true || isFirstEntry;

    // If marking this as default, unset existing defaults
    if (isDefault && !isFirstEntry) {
      await this.execute(
        'UPDATE config_entries SET is_default = FALSE WHERE service_name = $1 AND is_default = TRUE',
        [serviceName],
      );
    }

    await this.execute(
      `INSERT INTO config_entries
        (id, service_name, label, data, is_default, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        serviceName,
        input.label ?? 'Default',
        JSON.stringify(input.data ?? {}),
        isDefault,
        input.isActive !== false,
        now,
        now,
      ],
    );

    await this.refreshServiceCache(serviceName);

    // Return the newly created entry from cache
    const entries = entriesCache.get(serviceName) ?? [];
    return entries.find(e => e.id === id)!;
  }

  /**
   * Update an existing config entry by id. Returns null if not found.
   *
   * When isDefault is set to true, all other defaults for the same service
   * are unset first.
   */
  async updateEntry(id: string, input: UpdateConfigEntryInput): Promise<ConfigEntry | null> {
    // Find the entry in cache to get its service_name
    const entryRow = await this.queryOne<ConfigEntryRow>(
      'SELECT * FROM config_entries WHERE id = $1',
      [id],
    );
    if (!entryRow) return null;

    const serviceName = entryRow.service_name;

    // If setting as default, unset other defaults first
    if (input.isDefault === true) {
      await this.execute(
        'UPDATE config_entries SET is_default = FALSE WHERE service_name = $1 AND is_default = TRUE',
        [serviceName],
      );
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (input.label !== undefined) {
      updates.push(`label = $${paramIndex++}`);
      values.push(input.label);
    }
    if (input.data !== undefined) {
      updates.push(`data = $${paramIndex++}`);
      values.push(JSON.stringify(input.data));
    }
    if (input.isDefault !== undefined) {
      updates.push(`is_default = $${paramIndex++}`);
      values.push(input.isDefault);
    }
    if (input.isActive !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(input.isActive);
    }

    if (updates.length === 0) {
      return rowToEntry(entryRow);
    }

    updates.push(`updated_at = $${paramIndex++}`);
    values.push(new Date().toISOString());

    values.push(id); // WHERE clause
    await this.execute(
      `UPDATE config_entries SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
      values,
    );

    await this.refreshServiceCache(serviceName);

    const entries = entriesCache.get(serviceName) ?? [];
    return entries.find(e => e.id === id) ?? null;
  }

  /**
   * Delete a config entry by id. Returns true if deleted.
   */
  async deleteEntry(id: string): Promise<boolean> {
    // Find the entry to get its service_name for cache refresh
    const entryRow = await this.queryOne<ConfigEntryRow>(
      'SELECT * FROM config_entries WHERE id = $1',
      [id],
    );
    if (!entryRow) return false;

    const serviceName = entryRow.service_name;
    const result = await this.execute('DELETE FROM config_entries WHERE id = $1', [id]);

    if (result.changes > 0) {
      await this.refreshServiceCache(serviceName);
      return true;
    }
    return false;
  }

  /**
   * Set the default entry for a service.
   * Unsets all other defaults, then marks the given entry.
   */
  async setDefaultEntry(serviceName: string, entryId: string): Promise<void> {
    // Atomic: unset all defaults then set the new one in a single statement
    await this.execute(
      `WITH unset AS (
        UPDATE config_entries SET is_default = FALSE
        WHERE service_name = $1 AND is_default = TRUE
      )
      UPDATE config_entries SET is_default = TRUE, updated_at = $2
      WHERE id = $3`,
      [serviceName, new Date().toISOString(), entryId],
    );

    await this.refreshServiceCache(serviceName);
  }

  // ---------------------------------------------------------------------------
  // Dependency tracking
  // ---------------------------------------------------------------------------

  /**
   * Replace the required_by list for a service.
   */
  async updateRequiredBy(name: string, requiredBy: ConfigServiceRequiredBy[]): Promise<void> {
    await this.execute(
      'UPDATE config_services SET required_by = $1, updated_at = $2 WHERE name = $3',
      [JSON.stringify(requiredBy), new Date().toISOString(), name],
    );

    // Refresh only the service definition (entries are unaffected)
    const row = await this.queryOne<ConfigServiceRow>(
      'SELECT * FROM config_services WHERE name = $1',
      [name],
    );
    if (row) {
      servicesCache.set(name, rowToService(row));
    }
  }

  /**
   * Add a dependent to a service's required_by list (idempotent).
   * Replaces any existing entry with the same id.
   */
  async addRequiredBy(serviceName: string, dependent: ConfigServiceRequiredBy): Promise<void> {
    const svc = servicesCache.get(serviceName);
    if (!svc) return;

    const filtered = svc.requiredBy.filter(d => d.id !== dependent.id);
    filtered.push(dependent);
    await this.updateRequiredBy(serviceName, filtered);
  }

  /**
   * Remove a dependent from all services' required_by lists by dependent id.
   */
  async removeRequiredById(dependentId: string): Promise<void> {
    const all = Array.from(servicesCache.values());
    for (const svc of all) {
      if (svc.requiredBy.some(d => d.id === dependentId)) {
        const filtered = svc.requiredBy.filter(d => d.id !== dependentId);
        await this.updateRequiredBy(svc.name, filtered);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Config value resolution (sync, from cache)
  // ---------------------------------------------------------------------------

  /**
   * Get the API key for a service.
   *
   * Resolution order:
   *  1. Default entry's data.api_key field
   *  2. envVar from the schema field definition named 'api_key'
   */
  getApiKey(serviceName: string): string | undefined {
    const svc = servicesCache.get(serviceName);
    if (!svc || !svc.isActive) return undefined;

    const defaultEntry = this.getDefaultEntry(serviceName);

    // Check the stored value first
    if (defaultEntry?.data?.api_key) {
      const val = defaultEntry.data.api_key;
      if (typeof val === 'string' && val.length > 0) return val;
    }

    // Fall back to environment variable from schema
    const field = (svc.configSchema ?? []).find(f => f.name === 'api_key');
    if (field?.envVar) {
      const envVal = process.env[field.envVar];
      if (envVal) return envVal;
    }

    return undefined;
  }

  /**
   * Get a resolved field value for a service.
   *
   * Resolution order:
   *  1. Entry's data[fieldName] (uses entryLabel to pick entry, or default)
   *  2. envVar from the matching schema field definition
   *  3. defaultValue from the matching schema field definition
   */
  getFieldValue(serviceName: string, fieldName: string, entryLabel?: string): unknown {
    const svc = servicesCache.get(serviceName);
    if (!svc) return undefined;

    // Pick the entry
    const entry = entryLabel
      ? this.getEntryByLabel(serviceName, entryLabel)
      : this.getDefaultEntry(serviceName);

    // Check the stored value
    if (entry?.data?.[fieldName] !== undefined && entry.data[fieldName] !== '') {
      return entry.data[fieldName];
    }

    // Look up the schema field for fallbacks
    const field = (svc.configSchema ?? []).find(f => f.name === fieldName);
    if (!field) return undefined;

    // Fall back to environment variable
    if (field.envVar) {
      const envVal = process.env[field.envVar];
      if (envVal !== undefined && envVal !== '') return envVal;
    }

    // Fall back to default value
    if (field.defaultValue !== undefined) return field.defaultValue;

    return undefined;
  }

  /**
   * Check whether a service is configured and available.
   *
   * A service is available when it has a default entry whose data
   * contains at least one non-empty value.
   */
  isAvailable(serviceName: string): boolean {
    const svc = servicesCache.get(serviceName);
    if (!svc || !svc.isActive) return false;

    const defaultEntry = this.getDefaultEntry(serviceName);
    if (!defaultEntry) return false;

    // Check if any data field has a non-empty value
    const data = defaultEntry.data;
    for (const key of Object.keys(data)) {
      const val = data[key];
      if (val !== null && val !== undefined && val !== '') return true;
    }

    return false;
  }

  // ---------------------------------------------------------------------------
  // Statistics
  // ---------------------------------------------------------------------------

  /**
   * Get aggregate statistics about config services.
   */
  async getStats(): Promise<{
    total: number;
    active: number;
    configured: number;
    categories: string[];
    neededByTools: number;
    neededButUnconfigured: number;
  }> {
    const all = Array.from(servicesCache.values());
    const categories = [...new Set(all.map(s => s.category))];
    const needed = all.filter(s => s.requiredBy.length > 0);

    return {
      total: all.length,
      active: all.filter(s => s.isActive).length,
      configured: all.filter(s => {
        const entries = entriesCache.get(s.name);
        if (!entries || entries.length === 0) return false;
        return entries.some(e => {
          const data = e.data;
          return Object.keys(data).some(k => {
            const v = data[k];
            return v !== null && v !== undefined && v !== '';
          });
        });
      }).length,
      categories,
      neededByTools: needed.length,
      neededButUnconfigured: needed.filter(s => !this.isAvailable(s.name)).length,
    };
  }
}

// =============================================================================
// SINGLETON & INIT
// =============================================================================

export const configServicesRepo = new ConfigServicesRepository();

export async function initializeConfigServicesRepo(): Promise<void> {
  await configServicesRepo.initialize();
}
