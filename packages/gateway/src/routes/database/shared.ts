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
  'projects',
  'tasks',
  'calendar_events',
  'contacts',
  'reminders',
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

export interface OperationStatus {
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
