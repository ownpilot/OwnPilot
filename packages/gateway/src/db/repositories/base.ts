/**
 * Base Repository Class for PostgreSQL
 *
 * All repositories should extend this class for PostgreSQL support
 */

import { getAdapter, getAdapterSync } from '../adapters/index.js';
import type { DatabaseAdapter, Row } from '../adapters/types.js';

/**
 * Base class for all PostgreSQL repositories
 * Provides common database access methods
 */
export abstract class BaseRepository {
  protected adapter: DatabaseAdapter | null = null;

  /**
   * Get the database adapter (async)
   */
  protected async getAdapter(): Promise<DatabaseAdapter> {
    if (!this.adapter) {
      this.adapter = await getAdapter();
    }
    return this.adapter;
  }

  /**
   * Get the database adapter (sync - must be initialized first)
   */
  protected getAdapterSync(): DatabaseAdapter {
    if (!this.adapter) {
      this.adapter = getAdapterSync();
    }
    return this.adapter;
  }

  /**
   * Execute a query that returns rows
   */
  protected async query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]> {
    const adapter = await this.getAdapter();
    return adapter.query<T>(sql, params);
  }

  /**
   * Execute a query that returns a single row
   */
  protected async queryOne<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T | null> {
    const adapter = await this.getAdapter();
    return adapter.queryOne<T>(sql, params);
  }

  /**
   * Execute a statement (INSERT, UPDATE, DELETE)
   */
  protected async execute(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowid?: number | bigint }> {
    const adapter = await this.getAdapter();
    return adapter.execute(sql, params);
  }

  /**
   * Execute raw SQL (for schema changes)
   */
  protected async exec(sql: string): Promise<void> {
    const adapter = await this.getAdapter();
    return adapter.exec(sql);
  }

  /**
   * Run operations in a transaction
   */
  protected async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const adapter = await this.getAdapter();
    return adapter.transaction(fn);
  }

  /**
   * Get current timestamp SQL
   */
  protected now(): string {
    return this.adapter?.now() ?? 'NOW()';
  }

  /**
   * Convert boolean for storage
   */
  protected boolean(value: boolean): unknown {
    return this.adapter?.boolean(value) ?? value;
  }

  /**
   * Parse boolean from storage
   */
  protected parseBoolean(value: unknown): boolean {
    return this.adapter?.parseBoolean(value) ?? Boolean(value);
  }
}

/**
 * Ensure the PostgreSQL schema exists for a table
 * Call this in repository initialization
 */
export async function ensureTable(tableName: string, createSQL: string): Promise<void> {
  const adapter = await getAdapter();

  // Check if table exists
  const result = await adapter.queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = $1
    ) as exists`,
    [tableName]
  );

  if (!result?.exists) {
    await adapter.exec(createSQL);
    console.log(`[PostgreSQL] Created table: ${tableName}`);
  }
}
