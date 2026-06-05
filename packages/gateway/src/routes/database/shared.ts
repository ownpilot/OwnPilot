/**
 * Database Routes - Shared State and Utilities
 *
 * Constants, validation functions, and in-memory operation state
 * shared across all database sub-route modules.
 */

import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getDataPaths } from '../../paths/index.js';

// Tables to export (in dependency order) — also serves as whitelist for SQL operations
export const EXPORT_TABLES = [
  'settings',
  'agents',
  'conversations',
  'messages',
  'request_logs',
  'channels',
  'channel_messages',
  'costs',
  'bookmarks',
  'notes',
  'tasks',
  'calendar_events',
  'contacts',
  'captures',
  'pomodoro_settings',
  'pomodoro_sessions',
  'pomodoro_daily_stats',
  'habits',
  'habit_logs',
  'memories',
  'goals',
  'goal_steps',
  'triggers',
  'trigger_history',
  'plans',
  'plan_steps',
  'plan_history',
  'oauth_integrations',
  'media_provider_settings',
  'user_workspaces',
  'user_containers',
  'code_executions',
  'workspace_audit',
  'user_model_configs',
  'custom_providers',
  'user_provider_configs',
  'custom_data',
  'custom_tools',
  'custom_table_schemas',
  'custom_data_records',
  // Agent/Soul system
  'agent_souls',
  'agent_soul_versions',
  // Browser automation
  'browser_workflows',
  // Artifacts
  'artifacts',
  // Crew/Orchestration
  'agent_crews',
  'agent_crew_members',
  'crew_shared_memory',
  'crew_task_queue',
  // Claws
  'claws',
  'claw_sessions',
  'claw_history',
  'claw_audit_log',
  // Extensions & Plugins
  'user_extensions',
  'plugins',
  // Providers
  'local_providers',
  'local_models',
  // Edge
  'edge_devices',
  // SECURITY (EXPOSE-002): `system_settings` is intentionally NOT exportable.
  // It holds only regenerable runtime secrets (gateway API keys, JWT secret,
  // channel pairing/ownership keys) — never user data — so dumping it into a
  // portable, unencrypted backup/CSV leaked auth secrets to anyone with the
  // export. Removing it from this allowlist blocks export, CSV download, and
  // import of the table. Secrets are recreated by the gateway on next start.
];

// --- SQL Injection Protection ---
const SAFE_IDENTIFIER_REGEX = /^[a-z_][a-z0-9_]*$/;

export function validateTableName(name: string): string {
  const trimmed = name.trim().toLowerCase();
  if (!SAFE_IDENTIFIER_REGEX.test(trimmed)) {
    throw new Error(`Invalid table name: ${trimmed}`);
  }
  if (!EXPORT_TABLES.includes(trimmed)) {
    throw new Error(`Table not in whitelist: ${trimmed}`);
  }
  return trimmed;
}

export function validateColumnName(name: string): string {
  const trimmed = name.trim().toLowerCase();
  if (!SAFE_IDENTIFIER_REGEX.test(trimmed)) {
    throw new Error(`Invalid column name: ${trimmed}`);
  }
  return trimmed;
}

// --- Per-user export filtering (Plan 11 Step 3, CSV-002) -------------------
//
// The export routes used to dump every row of every whitelisted table, so
// user A's GET /db/export leaked user B's data. Each table now has a
// declared "scope" that determines the filter applied to SELECT *:
//
//   - 'per-user'  — table has a `user_id TEXT NOT NULL` column; the filter
//                   is `WHERE user_id = $1` (one param).
//   - 'child'     — table has no user_id, but has a FK to a per-user parent
//                   (e.g. messages → conversations). The filter is
//                   `WHERE EXISTS (SELECT 1 FROM <parent> WHERE
//                   <parent>.id = <child>.<fk_col> AND <parent>.user_id = $1)`
//                   (still one param).
//   - 'system'    — table is shared system state with no per-user row
//                   (e.g. settings, channels). No filter is applied.
//
// Tables that are not in either map default to 'system' — the export is
// still gated by the EXPORT_TABLES allowlist, and a missed entry is the
// least-bad outcome (operator sees all rows of a system table, not all
// users' data).

/** Per-user tables — the user's own row(s) are identified by `user_id`. */
const PER_USER_TABLES = new Set<string>([
  // core personal
  'conversations',
  'request_logs',
  'bookmarks',
  'notes',
  'tasks',
  'calendar_events',
  'contacts',
  'captures',
  // pomodoro / habits
  'pomodoro_settings',
  'pomodoro_sessions',
  'pomodoro_daily_stats',
  'habits',
  'habit_logs',
  // memory / goals
  'memories',
  'goals',
  'triggers',
  'plans',
  // oauth / media
  'oauth_integrations',
  'user_workspaces',
  'user_containers',
  'code_executions',
  'workspace_audit',
  // model / provider configs
  'user_model_configs',
  'custom_providers',
  'user_provider_configs',
  // custom data
  'custom_data',
  'custom_tools',
  // browser
  'browser_workflows',
  // artifacts
  'artifacts',
  // claws
  'claws',
  // extensions
  'user_extensions',
  // providers / edge
  'local_providers',
  'local_models',
  'edge_devices',
]);

/**
 * Child tables — no own user_id, but the parent row is per-user.
 * key = child table, value = { parent, fkColumn }.
 * The filter is `EXISTS (SELECT 1 FROM <parent> WHERE
 * <parent>.id = <child>.<fkColumn> AND <parent>.user_id = $1)`.
 */
const CHILD_TABLES: Record<string, { parent: string; fkColumn: string }> = {
  messages: { parent: 'conversations', fkColumn: 'conversation_id' },
  goal_steps: { parent: 'goals', fkColumn: 'goal_id' },
  plan_steps: { parent: 'plans', fkColumn: 'plan_id' },
  plan_history: { parent: 'plans', fkColumn: 'plan_id' },
  // crew_* are system-wide in the current schema (agent_crews has no
  // user_id), so they are NOT child tables here — they fall through to
  // the system scope. See plan/follow-up note in the docstring.
  claw_sessions: { parent: 'claws', fkColumn: 'claw_id' },
  claw_history: { parent: 'claws', fkColumn: 'claw_id' },
  claw_audit_log: { parent: 'claws', fkColumn: 'claw_id' },
};

/** Distinguishes the per-row ownership strategy for a table. */
type TableScope = 'per-user' | 'child' | 'system';

/**
 * Return the ownership scope of a table.
 *
 * The export routes call this to decide which WHERE clause (if any) to
 * append to `SELECT * FROM <table>`. The default is `'system'`, which
 * preserves the operator-visible behavior for shared infrastructure
 * tables like `settings` and `channels`.
 */
export function getTableScope(table: string): TableScope {
  if (PER_USER_TABLES.has(table)) return 'per-user';
  if (table in CHILD_TABLES) return 'child';
  return 'system';
}

/**
 * Build the user-scoping SQL fragment for a SELECT against `table`.
 *
 * Returns `{ where, params }` where `where` is a SQL fragment to append
 * after `FROM <table>` (e.g. ` WHERE user_id = $1`) and `params` is the
 * array of bind values. Returns `{ where: '', params: [] }` for
 * system tables.
 *
 * @param table       — already-validated table name (whitelisted)
 * @param userId      — the requesting user; if undefined, no filter is
 *                      applied even for per-user tables (backward-compat
 *                      fallback for routes that don't yet wire auth).
 *                      Plan 11 Step 3 sets this strictly to a real id.
 * @param paramOffset — 1-based offset for the `$N` placeholder. Defaults
 *                      to 1, which is what every caller uses today.
 *                      Provided so future composed queries can stack
 *                      other predicates.
 */
export function getUserFilter(
  table: string,
  userId: string | undefined,
  paramOffset = 1
): { where: string; params: unknown[] } {
  if (!userId) return { where: '', params: [] };
  // Pre-compute the `$N` placeholder. We can't put `$$` directly in a
  // template literal because some toolchains mangle it — the cleanest
  // fix is to build the literal `$` separately and concat. See
  // git history for the "WHERE user_id = 1" vs "WHERE user_id = $1"
  // bug that motivated this.
  const placeholder = '$' + paramOffset;
  const scope = getTableScope(table);
  if (scope === 'per-user') {
    return {
      where: ' WHERE user_id = ' + placeholder,
      params: [userId],
    };
  }
  if (scope === 'child') {
    const { parent, fkColumn } = CHILD_TABLES[table]!;
    return {
      where:
        ' WHERE EXISTS (SELECT 1 FROM ' +
        quoteIdentifier(parent) +
        ' WHERE ' +
        quoteIdentifier(parent) +
        '.id = ' +
        quoteIdentifier(table) +
        '.' +
        quoteIdentifier(fkColumn) +
        ' AND ' +
        quoteIdentifier(parent) +
        '.user_id = ' +
        placeholder +
        ')',
      params: [userId],
    };
  }
  return { where: '', params: [] };
}

export function quoteIdentifier(name: string): string {
  // Double-quote PostgreSQL identifier (escape any embedded quotes)
  return `"${name.replace(/"/g, '""')}"`;
}

// Backup directory
export const getBackupDir = () => {
  const dataPaths = getDataPaths();
  const dir = join(dataPaths.root, 'backups');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
};

interface OperationStatus {
  isRunning: boolean;
  operation?: 'backup' | 'restore' | 'migrate' | 'maintenance';
  lastRun?: string;
  lastResult?: 'success' | 'failure';
  lastError?: string;
  output?: string[];
}

// In-memory operation status (shared across all database sub-routes)
export let operationStatus: OperationStatus = {
  isRunning: false,
};

export function setOperationStatus(status: OperationStatus): void {
  operationStatus = status;
}
