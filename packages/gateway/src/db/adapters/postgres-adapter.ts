/**
 * PostgreSQL Database Adapter
 *
 * Uses the 'pg' package with connection pooling
 */

import type { DatabaseAdapter, DatabaseConfig, Row, QueryParams } from './types.js';
import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import { getLog } from '../../services/log.js';
import {
  DB_POOL_MAX,
  DB_IDLE_TIMEOUT_MS,
  DB_CONNECT_TIMEOUT_MS,
  DB_STATEMENT_TIMEOUT_MS,
  DB_IDLE_TX_TIMEOUT_MS,
} from '../../config/defaults.js';

/**
 * AsyncLocalStorage to thread the transaction client through repository calls.
 * When inside a transaction, query/queryOne/execute use this client instead of the pool.
 */
const txClientStorage = new AsyncLocalStorage<pg.PoolClient>();

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

    // H-D10 fix: install per-connection statement_timeout and
    // idle_in_transaction_session_timeout. Setting these via SET at connect
    // time scopes them to the connection (no global server change required)
    // and applies to every query issued through the pool. Setting to 0
    // disables the timeout (matches Postgres semantics).
    if (DB_STATEMENT_TIMEOUT_MS > 0 || DB_IDLE_TX_TIMEOUT_MS > 0) {
      this.pool.on('connect', (client) => {
        const statements: string[] = [];
        if (DB_STATEMENT_TIMEOUT_MS > 0) {
          statements.push(`SET statement_timeout = ${DB_STATEMENT_TIMEOUT_MS}`);
        }
        if (DB_IDLE_TX_TIMEOUT_MS > 0) {
          statements.push(`SET idle_in_transaction_session_timeout = ${DB_IDLE_TX_TIMEOUT_MS}`);
        }
        client.query(statements.join('; ')).catch((err: Error) => {
          log.warn('[PostgreSQL] Failed to apply per-connection timeouts:', err.message);
        });
      });
    }

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

  /**
   * Get the query target: transaction client (if inside a transaction) or pool.
   */
  private getQueryTarget(): pg.PoolClient | PoolType {
    return txClientStorage.getStore() ?? this.pool!;
  }

  async query<T extends object = Row>(sql: string, params: QueryParams = []): Promise<T[]> {
    if (!this.pool) throw new Error('Database not initialized');
    const convertedSql = this.convertPlaceholders(sql);
    const result = await this.getQueryTarget().query(convertedSql, params);
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
    const result = await this.getQueryTarget().query(convertedSql, params);
    return {
      changes: result.rowCount ?? 0,
    };
  }

  async transaction<T>(fn: () => Promise<T>, timeoutMs = 30000): Promise<T> {
    if (!this.pool) throw new Error('Database not initialized');
    const client = await this.pool.connect();

    // CRIT-1 fix: race fn against a timeout instead of letting a timer fire
    // concurrently with fn. The previous design released the client to the
    // pool on timeout while fn was still running — fn's later queries could
    // land on a different request's transaction or throw asynchronously.
    //
    // The race ensures that either fn finishes (commit/rollback as usual) or
    // the wrapper throws a TimeoutError (rollback in catch). The client is
    // released exactly once, in finally. On timeout we pass an Error to
    // release(): pg-pool DISCARDS the client (closes the underlying socket)
    // instead of returning it to the pool, so any in-flight fn() query
    // observes a destroyed connection and any subsequent fn() queries fail
    // loudly instead of corrupting another caller's state.
    let timeoutHandle: NodeJS.Timeout | undefined;
    let timedOut = false;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        reject(new Error(`Transaction timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      await client.query('BEGIN');
      const result = await Promise.race([txClientStorage.run(client, fn), timeoutPromise]);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        log.error('[PostgreSQL] Rollback failed:', rollbackError);
      }
      throw error;
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      try {
        // On timeout, force the pool to destroy this client (the connection
        // may still be servicing fn's in-flight query). On the happy path,
        // call release() with no arg so the client returns to the pool.
        if (timedOut) {
          client.release(new Error('Transaction timed out — client discarded'));
        } else {
          client.release();
        }
      } catch (releaseError) {
        log.error('[PostgreSQL] Client release failed:', releaseError);
      }
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
