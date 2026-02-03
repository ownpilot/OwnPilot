/**
 * IDatabaseService - Unified Custom Database Interface
 *
 * Wraps the CustomDataService to provide a consistent service interface
 * for plugin-managed tables and records.
 *
 * Usage:
 *   const db = registry.get(Services.Database);
 *   const table = await db.createTable('users', 'Users', columns);
 *   const record = await db.addRecord('users', { name: 'Alice' });
 */

// ============================================================================
// Table & Column Types
// ============================================================================

export interface TableColumn {
  readonly name: string;
  readonly type: 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'json';
  readonly required?: boolean;
  readonly defaultValue?: string | number | boolean | null;
  readonly description?: string;
}

export interface TableSchema {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly description?: string;
  readonly columns: TableColumn[];
  readonly ownerPluginId?: string;
  readonly isProtected: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ============================================================================
// Record Types
// ============================================================================

export interface DataRecord {
  readonly id: string;
  readonly tableId: string;
  readonly data: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ============================================================================
// Stats
// ============================================================================

export interface TableStats {
  readonly recordCount: number;
  readonly firstRecord?: string;
  readonly lastRecord?: string;
}

// ============================================================================
// IDatabaseService
// ============================================================================

export interface IDatabaseService {
  // ---- Table operations ----

  /**
   * Create a new custom table.
   */
  createTable(
    name: string,
    displayName: string,
    columns: TableColumn[],
    description?: string,
    options?: { ownerPluginId?: string; isProtected?: boolean },
  ): Promise<TableSchema>;

  /**
   * Get a table by name or ID.
   */
  getTable(nameOrId: string): Promise<TableSchema | null>;

  /**
   * List all tables.
   */
  listTables(filter?: { pluginId?: string }): Promise<TableSchema[]>;

  /**
   * List tables with record stats.
   */
  listTablesWithStats(
    filter?: { pluginId?: string },
  ): Promise<Array<TableSchema & { stats: TableStats }>>;

  /**
   * Update table metadata.
   */
  updateTable(
    nameOrId: string,
    updates: Partial<Pick<TableSchema, 'displayName' | 'description' | 'columns'>>,
  ): Promise<TableSchema | null>;

  /**
   * Delete a table.
   */
  deleteTable(nameOrId: string, options?: { force?: boolean }): Promise<boolean>;

  // ---- Plugin table operations ----

  /**
   * Ensure a plugin-owned table exists (idempotent).
   */
  ensurePluginTable(
    pluginId: string,
    name: string,
    displayName: string,
    columns: TableColumn[],
    description?: string,
  ): Promise<TableSchema>;

  /**
   * Get all tables owned by a plugin.
   */
  getTablesByPlugin(pluginId: string): Promise<TableSchema[]>;

  /**
   * Delete all tables owned by a plugin.
   */
  deletePluginTables(pluginId: string): Promise<number>;

  // ---- Record operations ----

  /**
   * Add a record to a table.
   */
  addRecord(tableNameOrId: string, data: Record<string, unknown>): Promise<DataRecord>;

  /**
   * Batch add records.
   */
  batchAddRecords(
    tableNameOrId: string,
    records: Array<Record<string, unknown>>,
  ): Promise<DataRecord[]>;

  /**
   * Get a record by ID.
   */
  getRecord(recordId: string): Promise<DataRecord | null>;

  /**
   * List records with pagination.
   */
  listRecords(
    tableNameOrId: string,
    options?: {
      limit?: number;
      offset?: number;
      orderBy?: string;
      orderDir?: 'asc' | 'desc';
      filter?: Record<string, unknown>;
    },
  ): Promise<{ records: DataRecord[]; total: number }>;

  /**
   * Update a record.
   */
  updateRecord(recordId: string, data: Record<string, unknown>): Promise<DataRecord | null>;

  /**
   * Delete a record.
   */
  deleteRecord(recordId: string): Promise<boolean>;

  /**
   * Search records by text query.
   */
  searchRecords(
    tableNameOrId: string,
    query: string,
    options?: { limit?: number },
  ): Promise<DataRecord[]>;

  /**
   * Get table statistics.
   */
  getTableStats(tableNameOrId: string): Promise<TableStats | null>;
}
