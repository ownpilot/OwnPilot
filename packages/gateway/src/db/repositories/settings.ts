/**
 * Settings Repository
 *
 * Key-value store for application settings
 */

import { getDatabase } from '../connection.js';

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

function rowToSetting(row: SettingRow): Setting {
  return {
    key: row.key,
    value: JSON.parse(row.value),
    updatedAt: new Date(row.updated_at),
  };
}

export class SettingsRepository {
  private db = getDatabase();

  get<T = unknown>(key: string): T | null {
    const stmt = this.db.prepare<string, SettingRow>(`
      SELECT * FROM settings WHERE key = ?
    `);

    const row = stmt.get(key);
    return row ? (JSON.parse(row.value) as T) : null;
  }

  set<T = unknown>(key: string, value: T): void {
    const stmt = this.db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);

    stmt.run(key, JSON.stringify(value));
  }

  getAll(): Setting[] {
    const stmt = this.db.prepare<[], SettingRow>(`
      SELECT * FROM settings ORDER BY key ASC
    `);

    return stmt.all().map(rowToSetting);
  }

  getByPrefix(prefix: string): Setting[] {
    const stmt = this.db.prepare<string, SettingRow>(`
      SELECT * FROM settings WHERE key LIKE ? ORDER BY key ASC
    `);

    return stmt.all(`${prefix}%`).map(rowToSetting);
  }

  delete(key: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM settings WHERE key = ?`);
    const result = stmt.run(key);
    return result.changes > 0;
  }

  deleteByPrefix(prefix: string): number {
    const stmt = this.db.prepare(`DELETE FROM settings WHERE key LIKE ?`);
    const result = stmt.run(`${prefix}%`);
    return result.changes;
  }

  has(key: string): boolean {
    const stmt = this.db.prepare<string, { count: number }>(`
      SELECT COUNT(*) as count FROM settings WHERE key = ?
    `);

    return (stmt.get(key)?.count ?? 0) > 0;
  }

  count(): number {
    const stmt = this.db.prepare<[], { count: number }>(`
      SELECT COUNT(*) as count FROM settings
    `);

    return stmt.get()?.count ?? 0;
  }
}

export const settingsRepo = new SettingsRepository();
