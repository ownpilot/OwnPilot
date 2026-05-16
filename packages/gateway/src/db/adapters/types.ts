/**
 * Database Adapter Types
 *
 * Database Adapter abstract interface (PostgreSQL)
 */

export type DatabaseType = 'postgres';

/**
 * Query result row - generic object
 * Repositories should always provide explicit row interfaces via type parameters.
 */
export type Row = Record<string, unknown>;

/**
 * Query parameters
 */
export type QueryParams = unknown[];

/**
 * Database adapter interface
 * All database operations go through this interface
 */
export interface DatabaseAdapter {
  /** Database type identifier */
  readonly type: DatabaseType;

  /** Check if connection is active */
  isConnected(): boolean;

  /**
   * Execute a query that returns rows
   */
  query<T extends object = Row>(sql: string, params?: QueryParams): Promise<T[]>;

  /**
   * Execute a query that returns a single row
   */
  queryOne<T extends object = Row>(sql: string, params?: QueryParams): Promise<T | null>;

  /**
   * Execute a statement (INSERT, UPDATE, DELETE)
   * Returns the number of affected rows
   */
  execute(
    sql: string,
    params?: QueryParams
  ): Promise<{ changes: number; lastInsertRowid?: number | bigint }>;

  /**
   * Execute multiple statements in a transaction
   * @param fn - Function containing transaction operations
   * @param timeoutMs - Transaction timeout in milliseconds (default: 30000)
   */
  transaction<T>(fn: () => Promise<T>, timeoutMs?: number): Promise<T>;

  /**
   * Execute raw SQL (for schema changes)
   */
  exec(sql: string): Promise<void>;

  /**
   * Close the database connection
   */
  close(): Promise<void>;

  /**
   * Get current timestamp SQL expression
   * SQLite: datetime('now')
   * PostgreSQL: NOW()
   */
  now(): string;

  /**
   * Get date extraction SQL expression
   * SQLite: date(column)
   * PostgreSQL: DATE(column)
   */
  date(column: string): string;

  /**
   * Get date arithmetic SQL expression
   * SQLite: datetime(column, '-X days')
   * PostgreSQL: column - INTERVAL 'X days'
   */
  dateSubtract(column: string, amount: number, unit: 'days' | 'hours' | 'minutes'): string;

  /**
   * Get placeholder for parameterized query
   * SQLite: ?
   * PostgreSQL: $1, $2, etc.
   */
  placeholder(index: number): string;

  /**
   * Convert boolean for storage
   * SQLite: 0/1
   * PostgreSQL: true/false
   */
  boolean(value: boolean): unknown;

  /**
   * Parse boolean from storage
   */
  parseBoolean(value: unknown): boolean;
}

/**
 * Database configuration
 */
export interface DatabaseConfig {
  type: DatabaseType;
  // PostgreSQL options
  postgresUrl?: string;
  postgresHost?: string;
  postgresPort?: number;
  postgresUser?: string;
  postgresPassword?: string;
  postgresDatabase?: string;
  postgresPoolSize?: number;
  // Common options
  verbose?: boolean;
}

/**
 * Get database configuration from environment
 * Always returns PostgreSQL configuration
 *
 * In production (NODE_ENV=production), DATABASE_URL or explicit PostgreSQL env vars are required.
 * In development, defaults are used for local Docker Compose setup.
 */
/**
 * The default password baked into .env.example / docker-compose.yml.
 * Detecting this value in production indicates the operator copied the
 * sample env without changing the password — refuse to boot.
 */
export const DEFAULT_POSTGRES_PASSWORD = 'ownpilot_secret';

export function getDatabaseConfig(): DatabaseConfig {
  const isProduction = process.env.NODE_ENV === 'production';
  const hasExplicitConfig = !!(
    process.env.DATABASE_URL ||
    process.env.POSTGRES_HOST ||
    process.env.POSTGRES_PASSWORD
  );

  // Fail hard in production if using default credentials
  if (isProduction && !hasExplicitConfig) {
    throw new Error(
      '[Database] Running in production without explicit database credentials. ' +
        'Set DATABASE_URL or POSTGRES_* environment variables.'
    );
  }

  const effectivePassword = process.env.POSTGRES_PASSWORD || DEFAULT_POSTGRES_PASSWORD;

  // Fail hard if production is using the documented default password —
  // .env.example ships with it, so a careless deploy would otherwise succeed.
  if (isProduction && effectivePassword === DEFAULT_POSTGRES_PASSWORD) {
    throw new Error(
      '[Database] Refusing to start: POSTGRES_PASSWORD is set to the documented ' +
        'default value ("ownpilot_secret"). Change it before running with NODE_ENV=production.'
    );
  }

  // Build PostgreSQL URL if not provided directly
  const postgresUrl =
    process.env.DATABASE_URL ||
    `postgresql://${process.env.POSTGRES_USER || 'ownpilot'}:${effectivePassword}@${process.env.POSTGRES_HOST || 'localhost'}:${process.env.POSTGRES_PORT || '25432'}/${process.env.POSTGRES_DB || 'ownpilot'}`;

  return {
    type: 'postgres',
    postgresUrl,
    postgresHost: process.env.POSTGRES_HOST || 'localhost',
    postgresPort: process.env.POSTGRES_PORT ? parseInt(process.env.POSTGRES_PORT, 10) : 25432,
    postgresUser: process.env.POSTGRES_USER || 'ownpilot',
    postgresPassword: effectivePassword,
    postgresDatabase: process.env.POSTGRES_DB || 'ownpilot',
    postgresPoolSize: process.env.POSTGRES_POOL_SIZE
      ? parseInt(process.env.POSTGRES_POOL_SIZE, 10)
      : 10,
    verbose: process.env.DB_VERBOSE === 'true',
  };
}
