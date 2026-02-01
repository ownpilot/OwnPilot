/**
 * Database Adapters
 *
 * PostgreSQL is the only supported database
 */

export * from './types.js';
export { PostgresAdapter } from './postgres-adapter.js';

import type { DatabaseAdapter, DatabaseConfig } from './types.js';
import { getDatabaseConfig } from './types.js';
import { PostgresAdapter } from './postgres-adapter.js';
import { initializeSchema } from '../schema.js';
import { getLog } from '../../services/log.js';

const log = getLog('DbAdapter');

let adapter: DatabaseAdapter | null = null;
let schemaInitialized = false;

/**
 * Create and initialize a PostgreSQL database adapter
 */
export async function createAdapter(config?: DatabaseConfig): Promise<DatabaseAdapter> {
  const dbConfig = config ?? getDatabaseConfig();
  const pgAdapter = new PostgresAdapter(dbConfig);
  await pgAdapter.initialize();

  // Initialize schema on first connection
  if (!schemaInitialized) {
    await initializeSchema(async (sql) => pgAdapter.exec(sql));
    schemaInitialized = true;
  }

  return pgAdapter;
}

/**
 * Get the global database adapter instance
 * Creates one if not exists
 */
export async function getAdapter(): Promise<DatabaseAdapter> {
  if (!adapter) {
    adapter = await createAdapter();
  }
  return adapter;
}

/**
 * Get the global adapter synchronously (must be initialized first)
 * For backwards compatibility with existing synchronous code
 */
export function getAdapterSync(): DatabaseAdapter {
  if (!adapter) {
    throw new Error('Database adapter not initialized. Call initializeAdapter() first.');
  }
  return adapter;
}

/**
 * Initialize the global adapter
 */
export async function initializeAdapter(config?: DatabaseConfig): Promise<DatabaseAdapter> {
  if (adapter) {
    log.info('[Database] Adapter already initialized');
    return adapter;
  }
  adapter = await createAdapter(config);
  return adapter;
}

/**
 * Close the global adapter
 */
export async function closeAdapter(): Promise<void> {
  if (adapter) {
    await adapter.close();
    adapter = null;
  }
}

/**
 * Check if using PostgreSQL (always true)
 */
export function isPostgres(): boolean {
  return true;
}

/**
 * Check if using SQLite (always false - SQLite is deprecated)
 * @deprecated SQLite is no longer supported
 */
export function isSQLite(): boolean {
  return false;
}
