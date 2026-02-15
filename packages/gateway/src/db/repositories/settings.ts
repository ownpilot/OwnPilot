/**
 * Settings Repository (PostgreSQL)
 *
 * Key-value store for application settings
 */

import { BaseRepository, ensureTable } from './base.js';
import { getLog } from '../../services/log.js';

const log = getLog('SettingsRepo');

export interface Setting {
  key: string;
  value: unknown;
  updatedAt: Date;
}

interface SettingRow {
  key: string;
  value: string;
  updated_at: string;
}

function safeParseJSON(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    log.warn('[Settings] Corrupt JSON value, returning raw string');
    return raw;
  }
}

function rowToSetting(row: SettingRow): Setting {
  return {
    key: row.key,
    value: safeParseJSON(row.value),
    updatedAt: new Date(row.updated_at),
  };
}

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW()
  )
`;

// In-memory cache for sync access (populated at startup)
let settingsCache: Map<string, unknown> = new Map();
let cacheInitialized = false;

export class SettingsRepository extends BaseRepository {
  /**
   * Initialize the settings table and cache
   */
  async initialize(): Promise<void> {
    await ensureTable('settings', CREATE_TABLE_SQL);
    await this.loadCache();
  }

  /**
   * Load all settings into cache for sync access
   */
  private async loadCache(): Promise<void> {
    const rows = await this.query<SettingRow>('SELECT * FROM settings');
    settingsCache.clear();
    for (const row of rows) {
      settingsCache.set(row.key, safeParseJSON(row.value));
    }
    cacheInitialized = true;
  }

  /**
   * Get a setting value (sync - uses cache)
   */
  get<T = unknown>(key: string): T | null {
    if (!cacheInitialized) {
      log.warn(`[Settings] Cache not initialized, returning null for key: ${key}`);
      return null;
    }
    return (settingsCache.get(key) as T) ?? null;
  }

  /**
   * Get a setting value (async - from database)
   */
  async getAsync<T = unknown>(key: string): Promise<T | null> {
    const row = await this.queryOne<SettingRow>('SELECT * FROM settings WHERE key = $1', [key]);
    return row ? (safeParseJSON(row.value) as T) : null;
  }

  /**
   * Set a setting value
   */
  async set<T = unknown>(key: string, value: T): Promise<void> {
    await this.execute(
      `INSERT INTO settings (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT(key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = EXCLUDED.updated_at`,
      [key, JSON.stringify(value)]
    );
    // Update cache
    settingsCache.set(key, value);
  }

  /**
   * Get all settings
   */
  async getAll(): Promise<Setting[]> {
    const rows = await this.query<SettingRow>('SELECT * FROM settings ORDER BY key ASC');
    return rows.map(rowToSetting);
  }

  /**
   * Get settings by prefix
   */
  async getByPrefix(prefix: string): Promise<Setting[]> {
    const rows = await this.query<SettingRow>(
      'SELECT * FROM settings WHERE key LIKE $1 ORDER BY key ASC',
      [`${prefix}%`]
    );
    return rows.map(rowToSetting);
  }

  /**
   * Delete a setting
   */
  async delete(key: string): Promise<boolean> {
    const result = await this.execute('DELETE FROM settings WHERE key = $1', [key]);
    settingsCache.delete(key);
    return result.changes > 0;
  }

  /**
   * Delete settings by prefix
   */
  async deleteByPrefix(prefix: string): Promise<number> {
    const result = await this.execute('DELETE FROM settings WHERE key LIKE $1', [`${prefix}%`]);
    // Clear affected cache entries
    for (const key of settingsCache.keys()) {
      if (key.startsWith(prefix)) {
        settingsCache.delete(key);
      }
    }
    return result.changes;
  }

  /**
   * Check if a setting exists
   */
  async has(key: string): Promise<boolean> {
    const row = await this.queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM settings WHERE key = $1',
      [key]
    );
    return parseInt(row?.count ?? '0', 10) > 0;
  }

  /**
   * Count all settings
   */
  async count(): Promise<number> {
    const row = await this.queryOne<{ count: string }>('SELECT COUNT(*) as count FROM settings');
    return parseInt(row?.count ?? '0', 10);
  }
}

export const settingsRepo = new SettingsRepository();

// Factory function
export function createSettingsRepository(): SettingsRepository {
  return new SettingsRepository();
}

/**
 * Initialize settings repository (call at startup)
 */
export async function initializeSettingsRepo(): Promise<void> {
  await settingsRepo.initialize();
}
