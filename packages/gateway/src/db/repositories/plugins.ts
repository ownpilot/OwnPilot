/**
 * Plugins Repository
 *
 * Manages plugin state persistence (status, settings, permissions).
 * Plugin manifest data (tools, schemas, capabilities) lives in code,
 * not in the DB -- this table only stores user-mutable state.
 *
 * Uses in-memory cache for fast synchronous access (same pattern as
 * ConfigServicesRepository and SettingsRepository).
 */

import { BaseRepository, parseJsonField } from './base.js';
import { getLog } from '../../services/log.js';

const log = getLog('PluginsRepo');

// =============================================================================
// ROW TYPES (database representation)
// =============================================================================

interface PluginRow {
  id: string;
  name: string;
  version: string;
  status: string;
  settings: string; // JSONB string
  granted_permissions: string; // JSONB string
  error_message: string | null;
  installed_at: string;
  updated_at: string;
}

// =============================================================================
// PUBLIC TYPES
// =============================================================================

export interface PluginRecord {
  id: string;
  name: string;
  version: string;
  status: 'enabled' | 'disabled' | 'error';
  settings: Record<string, unknown>;
  grantedPermissions: string[];
  errorMessage?: string;
  installedAt: string;
  updatedAt: string;
}

export interface UpsertPluginInput {
  id: string;
  name: string;
  version: string;
  status?: string;
  settings?: Record<string, unknown>;
  grantedPermissions?: string[];
}

// =============================================================================
// CACHE
// =============================================================================

let pluginsCache = new Map<string, PluginRecord>();
let cacheInitialized = false;

// =============================================================================
// ROW-TO-MODEL CONVERSION
// =============================================================================

function rowToRecord(row: PluginRow): PluginRecord {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    status: row.status as PluginRecord['status'],
    settings: parseJsonField<Record<string, unknown>>(row.settings, {}),
    grantedPermissions: parseJsonField<string[]>(row.granted_permissions, []),
    errorMessage: row.error_message ?? undefined,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
  };
}

// =============================================================================
// REPOSITORY
// =============================================================================

export class PluginsRepository extends BaseRepository {
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
   * Reload every plugin into the in-memory cache.
   */
  async refreshCache(): Promise<void> {
    const rows = await this.query<PluginRow>('SELECT * FROM plugins');
    pluginsCache = new Map(rows.map((r) => [r.id, rowToRecord(r)]));
    cacheInitialized = true;
  }

  /**
   * Refresh the cache for a single plugin by id.
   */
  private async refreshPluginCache(id: string): Promise<void> {
    const row = await this.queryOne<PluginRow>('SELECT * FROM plugins WHERE id = $1', [id]);

    if (row) {
      pluginsCache.set(id, rowToRecord(row));
    } else {
      pluginsCache.delete(id);
    }
  }

  // ---------------------------------------------------------------------------
  // Accessors (sync, from cache)
  // ---------------------------------------------------------------------------

  /**
   * Get a plugin by id (sync, from cache).
   */
  getById(id: string): PluginRecord | null {
    if (!cacheInitialized) {
      log.warn(`[Plugins] Cache not initialized, returning null for: ${id}`);
      return null;
    }
    return pluginsCache.get(id) ?? null;
  }

  /**
   * List all plugins (sync, from cache).
   */
  getAll(): PluginRecord[] {
    if (!cacheInitialized) {
      log.warn('[Plugins] Cache not initialized, returning empty list');
      return [];
    }
    return Array.from(pluginsCache.values());
  }

  // ---------------------------------------------------------------------------
  // CRUD (async, writes to DB + refreshes cache)
  // ---------------------------------------------------------------------------

  /**
   * Upsert a plugin record.
   *
   * On conflict (id already exists):
   *  - Updates name and version (metadata from code).
   *  - Does NOT override status, settings, or granted_permissions (user-managed).
   */
  async upsert(input: UpsertPluginInput): Promise<PluginRecord> {
    await this.execute(
      `INSERT INTO plugins (id, name, version, status, settings, granted_permissions, installed_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         version = EXCLUDED.version,
         updated_at = NOW()`,
      [
        input.id,
        input.name,
        input.version,
        input.status ?? 'enabled',
        JSON.stringify(input.settings ?? {}),
        JSON.stringify(input.grantedPermissions ?? []),
      ]
    );

    await this.refreshPluginCache(input.id);
    return pluginsCache.get(input.id)!;
  }

  /**
   * Update a plugin's settings. Returns null if not found.
   */
  async updateSettings(
    id: string,
    settings: Record<string, unknown>
  ): Promise<PluginRecord | null> {
    const existing = pluginsCache.get(id);
    if (!existing) return null;

    await this.execute('UPDATE plugins SET settings = $1, updated_at = NOW() WHERE id = $2', [
      JSON.stringify(settings),
      id,
    ]);

    await this.refreshPluginCache(id);
    return pluginsCache.get(id) ?? null;
  }

  /**
   * Update a plugin's status (and optionally its error message).
   * Returns null if not found.
   */
  async updateStatus(
    id: string,
    status: PluginRecord['status'],
    errorMessage?: string
  ): Promise<PluginRecord | null> {
    const existing = pluginsCache.get(id);
    if (!existing) return null;

    await this.execute(
      'UPDATE plugins SET status = $1, error_message = $2, updated_at = NOW() WHERE id = $3',
      [status, errorMessage ?? null, id]
    );

    await this.refreshPluginCache(id);
    return pluginsCache.get(id) ?? null;
  }

  /**
   * Update a plugin's granted permissions. Returns null if not found.
   */
  async updatePermissions(id: string, permissions: string[]): Promise<PluginRecord | null> {
    const existing = pluginsCache.get(id);
    if (!existing) return null;

    await this.execute(
      'UPDATE plugins SET granted_permissions = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(permissions), id]
    );

    await this.refreshPluginCache(id);
    return pluginsCache.get(id) ?? null;
  }

  /**
   * Delete a plugin by id. Returns true if deleted.
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.execute('DELETE FROM plugins WHERE id = $1', [id]);

    pluginsCache.delete(id);

    return result.changes > 0;
  }
}

// =============================================================================
// SINGLETON & INIT
// =============================================================================

export const pluginsRepo = new PluginsRepository();

export async function initializePluginsRepo(): Promise<void> {
  await pluginsRepo.initialize();
}
