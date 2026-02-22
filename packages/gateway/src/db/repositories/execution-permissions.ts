/**
 * Execution Permissions Repository
 *
 * Manages per-user, per-category execution permission settings.
 * Permissions persist across sessions (stored in DB).
 */

import { BaseRepository } from './base.js';
import type { ExecutionPermissions, PermissionMode } from '@ownpilot/core';
import { DEFAULT_EXECUTION_PERMISSIONS } from '@ownpilot/core';

const CATEGORIES = [
  'execute_javascript',
  'execute_python',
  'execute_shell',
  'compile_code',
  'package_manager',
] as const;
const VALID_MODES: ReadonlySet<string> = new Set(['local', 'docker', 'auto']);

interface PermissionRow {
  user_id: string;
  enabled: number | boolean;
  mode: string;
  execute_javascript: string;
  execute_python: string;
  execute_shell: string;
  compile_code: string;
  package_manager: string;
  updated_at: string;
}

function rowToPermissions(row: PermissionRow): ExecutionPermissions {
  return {
    enabled: Boolean(row.enabled),
    mode: (VALID_MODES.has(row.mode) ? row.mode : 'local') as 'local' | 'docker' | 'auto',
    execute_javascript: (row.execute_javascript as PermissionMode) ?? 'blocked',
    execute_python: (row.execute_python as PermissionMode) ?? 'blocked',
    execute_shell: (row.execute_shell as PermissionMode) ?? 'blocked',
    compile_code: (row.compile_code as PermissionMode) ?? 'blocked',
    package_manager: (row.package_manager as PermissionMode) ?? 'blocked',
  };
}

class ExecutionPermissionsRepository extends BaseRepository {
  /**
   * Get execution permissions for a user (returns defaults if no row exists)
   */
  async get(userId: string): Promise<ExecutionPermissions> {
    const row = await this.queryOne<PermissionRow>(
      'SELECT * FROM execution_permissions WHERE user_id = ?',
      [userId]
    );
    if (!row) return { ...DEFAULT_EXECUTION_PERMISSIONS };
    return rowToPermissions(row);
  }

  /**
   * Update execution permissions (partial merge with UPSERT)
   */
  async set(userId: string, partial: Partial<ExecutionPermissions>): Promise<ExecutionPermissions> {
    // Get current permissions
    const current = await this.get(userId);
    const merged = { ...current } as Record<string, unknown>;

    // Apply enabled toggle
    if (typeof partial.enabled === 'boolean') {
      merged.enabled = partial.enabled;
    }

    // Apply mode
    if (partial.mode && VALID_MODES.has(partial.mode)) {
      merged.mode = partial.mode;
    }

    // Apply partial updates (only valid categories and modes)
    for (const cat of CATEGORIES) {
      if (cat in partial) {
        const val = partial[cat];
        if (val === 'blocked' || val === 'prompt' || val === 'allowed') {
          merged[cat] = val;
        }
      }
    }

    const result = merged as unknown as ExecutionPermissions;

    await this.execute(
      `INSERT INTO execution_permissions (user_id, enabled, mode, execute_javascript, execute_python, execute_shell, compile_code, package_manager, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON CONFLICT(user_id) DO UPDATE SET
         enabled = excluded.enabled,
         mode = excluded.mode,
         execute_javascript = excluded.execute_javascript,
         execute_python = excluded.execute_python,
         execute_shell = excluded.execute_shell,
         compile_code = excluded.compile_code,
         package_manager = excluded.package_manager,
         updated_at = excluded.updated_at`,
      [
        userId,
        result.enabled,
        result.mode,
        result.execute_javascript,
        result.execute_python,
        result.execute_shell,
        result.compile_code,
        result.package_manager,
      ]
    );

    return result;
  }

  /**
   * Reset permissions to all-blocked defaults (delete the row)
   */
  async reset(userId: string): Promise<void> {
    await this.execute('DELETE FROM execution_permissions WHERE user_id = ?', [userId]);
  }
}

export const executionPermissionsRepo = new ExecutionPermissionsRepository();
