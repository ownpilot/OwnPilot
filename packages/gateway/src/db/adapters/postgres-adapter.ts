/**
 * PostgreSQL Database Adapter
 *
 * Uses the 'pg' package with connection pooling
 */

import type { DatabaseAdapter, DatabaseConfig, Row, QueryParams } from './types.js';
import pg from 'pg';
import { getLog } from '../../services/log.js';
import { DB_POOL_MAX, DB_IDLE_TIMEOUT_MS, DB_CONNECT_TIMEOUT_MS } from '../../config/defaults.js';

// Fix pg timezone handling: TIMESTAMP WITHOUT TIME ZONE (OID 1114) values are stored
// as UTC in this codebase, but pg's default parser interprets them as local time.
// This causes shifted dates on non-UTC machines (e.g. UTC+3 → 3-hour shift).
// Force UTC interpretation by appending 'Z' before parsing.
pg.types.setTypeParser(1114, (str: string) => new Date(str + 'Z'));

const log = getLog('PostgresAdapter');

const { Pool } = pg;
type PoolType = InstanceType<typeof Pool>;

export class PostgresAdapter implements DatabaseAdapter {
  readonly type = 'postgres' as const;
  private pool: PoolType | null = null;
  private config: DatabaseConfig;

  constructor(config: DatabaseConfig) {
    this.config = config;
  }

  /**
   * Initialize the database connection pool
   */
  async initialize(): Promise<void> {
    this.pool = new Pool({
      connectionString: this.config.postgresUrl,
      max: this.config.postgresPoolSize || DB_POOL_MAX,
      idleTimeoutMillis: DB_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: DB_CONNECT_TIMEOUT_MS,
    });

    // Handle idle client errors gracefully — without this listener,
    // a terminated connection (e.g. admin restart) becomes an uncaught exception
    // that crashes the process. The pool will automatically replace dead clients.
    this.pool.on('error', (err: Error) => {
      log.warn('[PostgreSQL] Idle client error (pool will reconnect):', err.message);
    });

    // Test connection and register pgvector types
    const client = await this.pool.connect();
    try {
      await client.query('SELECT 1');

      // Register pgvector type handlers (vector <-> number[])
      try {
        const pgvectorModule = await import('pgvector/pg');
        await pgvectorModule.registerTypes(client);
        log.info(
          `[PostgreSQL] Connected to ${this.config.postgresHost || 'database'} (pgvector enabled)`
        );
      } catch {
        log.info(
          `[PostgreSQL] Connected to ${this.config.postgresHost || 'database'} (pgvector not available)`
        );
      }
    } finally {
      client.release();
    }
  }

  isConnected(): boolean {
    return this.pool !== null;
  }

  async query<T extends object = Row>(sql: string, params: QueryParams = []): Promise<T[]> {
    if (!this.pool) throw new Error('Database not initialized');
    const convertedSql = this.convertPlaceholders(sql);
    const result = await this.pool.query(convertedSql, params);
    return result.rows as T[];
  }

  async queryOne<T extends object = Row>(sql: string, params: QueryParams = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async execute(
    sql: string,
    params: QueryParams = []
  ): Promise<{ changes: number; lastInsertRowid?: number | bigint }> {
    if (!this.pool) throw new Error('Database not initialized');
    const convertedSql = this.convertPlaceholders(sql);
    const result = await this.pool.query(convertedSql, params);
    return {
      changes: result.rowCount ?? 0,
      // PostgreSQL doesn't have lastInsertRowid - use RETURNING clause if needed
    };
  }

  async transaction<T>(fn: () => Promise<T>, timeoutMs = 30000): Promise<T> {
    if (!this.pool) throw new Error('Database not initialized');
    const client = await this.pool.connect();

    let timedOut = false;
    let clientReleased = false;

    const releaseClient = () => {
      if (!clientReleased) {
        clientReleased = true;
        try {
          client.release();
        } catch (releaseError) {
          log.error('[PostgreSQL] Client release failed:', releaseError);
        }
      }
    };

    // Set up transaction timeout
    const timeoutId = setTimeout(async () => {
      timedOut = true;
      log.error('[PostgreSQL] Transaction timeout, forcing rollback');
      try {
        await client.query('ROLLBACK');
      } catch (err) {
        // Client might already be disconnected - log but don't throw
        log.debug('[PostgreSQL] Rollback during timeout cleanup failed:', err);
      }
      releaseClient();
    }, timeoutMs);

    try {
      await client.query('BEGIN');
      const result = await fn();
      if (!timedOut) {
        await client.query('COMMIT');
      }
      return result;
    } catch (error) {
      // Only rollback if not already rolled back by timeout
      if (!timedOut) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          log.error('[PostgreSQL] Rollback failed:', rollbackError);
        }
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
      releaseClient();
    }
  }

  async exec(sql: string): Promise<void> {
    if (!this.pool) throw new Error('Database not initialized');
    await this.pool.query(sql);
  }

  async close(): Promise<void> {
    if (this.pool) {
      const pool = this.pool;
      this.pool = null;
      await pool.end();
      log.info('[PostgreSQL] Connection pool closed');
    }
  }

  // SQL dialect helpers
  now(): string {
    return 'NOW()';
  }

  date(column: string): string {
    return `DATE(${column})`;
  }

  dateSubtract(column: string, amount: number, unit: 'days' | 'hours' | 'minutes'): string {
    // Validate amount to prevent SQL injection via string interpolation
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(`Invalid interval amount: ${amount}`);
    }
    return `${column} - INTERVAL '${Math.floor(amount)} ${unit}'`;
  }

  placeholder(index: number): string {
    return `$${index}`;
  }

  boolean(value: boolean): unknown {
    return value;
  }

  parseBoolean(value: unknown): boolean {
    return value === true || value === 't' || value === 'true' || value === 1;
  }

  /**
   * Convert SQLite-style ? placeholders to PostgreSQL $1, $2, etc.
   */
  private convertPlaceholders(sql: string): string {
    let index = 0;
    return sql.replace(/\?/g, () => {
      index++;
      return `$${index}`;
    });
  }
}
