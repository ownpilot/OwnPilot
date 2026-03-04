/**
 * System Settings Repository — simple key-value store for gateway-level config.
 *
 * Persists pairing key and per-platform owner identity across restarts.
 */

import { BaseRepository } from './base.js';

interface SettingRow {
  key: string;
  value: string | null;
}

class SystemSettingsRepository extends BaseRepository {
  async get(key: string): Promise<string | null> {
    const row = await this.queryOne<SettingRow>(
      'SELECT key, value FROM system_settings WHERE key = $1',
      [key]
    );
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.execute(
      `INSERT INTO system_settings (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [key, value]
    );
  }

  async delete(key: string): Promise<void> {
    await this.execute('DELETE FROM system_settings WHERE key = $1', [key]);
  }
}

// Singleton instance
let _repo: SystemSettingsRepository | null = null;
export function getSystemSettingsRepository(): SystemSettingsRepository {
  if (!_repo) _repo = new SystemSettingsRepository();
  return _repo;
}
