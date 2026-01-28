/**
 * Database Connection (DEPRECATED - Use PostgreSQL)
 *
 * This file is kept for backward compatibility but all operations
 * should use PostgreSQL via the adapters module.
 *
 * SQLite support has been removed. Use PostgreSQL instead.
 */

/**
 * @deprecated Use PostgreSQL adapter instead
 * @throws Error - SQLite is no longer supported
 */
export function getDatabase(): never {
  throw new Error(
    '[Database] SQLite is no longer supported. Use PostgreSQL via initializeAdapter() from ./adapters/index.js'
  );
}

/**
 * @deprecated Use PostgreSQL adapter instead
 */
export function closeDatabase(): void {
  // No-op for backward compatibility
  console.warn('[Database] closeDatabase() called but SQLite is no longer supported');
}

/**
 * @deprecated Use PostgreSQL adapter instead
 */
export function getRawDatabase(): null {
  console.warn('[Database] getRawDatabase() called but SQLite is no longer supported');
  return null;
}

// Re-export types for backward compatibility
export interface DatabaseConfig {
  path?: string;
  inMemory?: boolean;
  verbose?: boolean;
}
