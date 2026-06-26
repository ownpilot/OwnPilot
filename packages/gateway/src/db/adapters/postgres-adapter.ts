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
  DB_KEEPALIVE,
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
    // H-D10 fix: install per-connection statement_timeout and
    // idle_in_transaction_session_timeout. These are applied via the libpq
    // `options` startup parameter (`-c name=value`) rather than a post-connect
    // `SET` query. The SET approach raced the consumer's first query: pg-pool
    // does NOT await `connect` listeners, so it handed the fresh client to a
    // caller whose first query ran *concurrently* with the not-yet-finished
    // SET — that both triggered pg's "client is already executing a query"
    // deprecation warning AND let the first query on every new connection run
    // before statement_timeout was in effect. Startup options apply server-side
    // before any query, so there is no race and the first query is protected.
    // Values are milliseconds (Postgres GUC default unit), matching the prior
    // `SET statement_timeout = <ms>` semantics. 0 disables (option omitted).
    const startupOptions: string[] = [];
    if (DB_STATEMENT_TIMEOUT_MS > 0) {
      startupOptions.push(`-c statement_timeout=${DB_STATEMENT_TIMEOUT_MS}`);
    }
    if (DB_IDLE_TX_TIMEOUT_MS > 0) {
      startupOptions.push(`-c idle_in_transaction_session_timeout=${DB_IDLE_TX_TIMEOUT_MS}`);
    }

    this.pool = new Pool({
      connectionString: this.config.postgresUrl,
      max: this.config.postgresPoolSize || DB_POOL_MAX,
      idleTimeoutMillis: DB_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: DB_CONNECT_TIMEOUT_MS,
      // SO_KEEPALIVE so the OS probes idle sockets and the pool recycles a
      // dead connection (DB restart / host sleep) instead of handing it out
      // and failing the next query with "Connection terminated unexpectedly".
      keepAlive: DB_KEEPALIVE,
      ...(startupOptions.length > 0 ? { options: startupOptions.join(' ') } : {}),
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

  /**
   * Classify an error as a transient connection failure (dead/stale socket)
   * rather than a query-level error. These are safe to retry once on a fresh
   * pool connection: the failing socket has already been removed from the pool
   * by pg's internal error handling, so the retry pulls a healthy connection.
   *
   * Covers Node socket errors (ECONNRESET/EPIPE/ETIMEDOUT), Postgres connection
   * exception SQLSTATEs (class 08 + 57P01 admin shutdown), and the pg-pool
   * "Connection terminated…" messages that have no machine-readable code.
   */
  private isTransientConnectionError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const code = (err as { code?: string }).code;
    if (
      code &&
      ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', '57P01', '08000', '08003', '08006'].includes(code)
    ) {
      return true;
    }
    const msg = err.message.toLowerCase();
    return (
      msg.includes('connection terminated') ||
      msg.includes('connection ended') ||
      msg.includes('server closed the connection') ||
      msg.includes('terminating connection')
    );
  }

  /**
   * Run a query through the transaction client (if inside one) or the pool.
   *
   * When NOT in a transaction, a transient connection error is retried exactly
   * once against the pool — the stale client is gone and a fresh connect
   * succeeds. Inside a transaction we never retry: the statement is bound to a
   * single BEGIN-scoped client, and silently re-running it on a new connection
   * would break atomicity (and run outside the now-aborted transaction).
   */
  private async runQuery(sql: string, params: QueryParams): Promise<pg.QueryResult> {
    const txClient = txClientStorage.getStore();
    const target = txClient ?? this.pool!;
    try {
      return await target.query(sql, params);
    } catch (err) {
      if (txClient || !this.isTransientConnectionError(err)) throw err;
      log.warn(
        '[PostgreSQL] Transient connection error — retrying once on a fresh connection:',
        (err as Error).message
      );
      return await this.pool!.query(sql, params);
    }
  }

  async query<T extends object = Row>(sql: string, params: QueryParams = []): Promise<T[]> {
    if (!this.pool) throw new Error('Database not initialized');
    const convertedSql = this.convertPlaceholders(sql);
    const result = await this.runQuery(convertedSql, params);
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
    const result = await this.runQuery(convertedSql, params);
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
