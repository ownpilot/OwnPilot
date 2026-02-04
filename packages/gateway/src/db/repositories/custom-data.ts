/**
 * Custom Data Repository
 *
 * Handles dynamic tables with AI-decided schemas.
 * Allows the AI to create tables, define columns, and manage data on the fly.
 */

import { BaseRepository } from './base.js';

/**
 * Column definition for custom tables
 */
export interface ColumnDefinition {
  name: string;
  type: 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'json';
  required?: boolean;
  defaultValue?: string | number | boolean | null;
  description?: string;
}

/**
 * Custom table schema
 */
export interface CustomTableSchema {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  columns: ColumnDefinition[];
  ownerPluginId?: string;
  isProtected: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Custom data record
 */
export interface CustomDataRecord {
  id: string;
  tableId: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface SchemaRow {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  columns: string;
  owner_plugin_id: string | null;
  is_protected: boolean;
  created_at: string;
  updated_at: string;
}

interface RecordRow {
  id: string;
  table_id: string;
  data: string;
  created_at: string;
  updated_at: string;
}

/**
 * Custom Data Repository class
 */
export class CustomDataRepository extends BaseRepository {
  /**
   * Create a new custom table with the given schema
   */
  async createTable(
    name: string,
    displayName: string,
    columns: ColumnDefinition[],
    description?: string,
    options?: { ownerPluginId?: string; isProtected?: boolean }
  ): Promise<CustomTableSchema> {
    const id = `table_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    // Validate column names
    const invalidChars = /[^a-zA-Z0-9_]/;
    for (const col of columns) {
      if (invalidChars.test(col.name)) {
        throw new Error(`Invalid column name: ${col.name}. Only alphanumeric and underscore allowed.`);
      }
    }

    // Sanitize table name
    const sanitizedName = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const ownerPluginId = options?.ownerPluginId ?? null;
    const isProtected = options?.isProtected ?? false;

    await this.execute(
      `INSERT INTO custom_table_schemas (id, name, display_name, description, columns, owner_plugin_id, is_protected, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, sanitizedName, displayName, description ?? null, JSON.stringify(columns), ownerPluginId, isProtected, now, now]
    );

    return {
      id,
      name: sanitizedName,
      displayName,
      description,
      columns,
      ownerPluginId: ownerPluginId ?? undefined,
      isProtected,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Get a custom table schema by name or ID
   */
  async getTable(nameOrId: string): Promise<CustomTableSchema | null> {
    const row = await this.queryOne<SchemaRow>(
      'SELECT * FROM custom_table_schemas WHERE id = $1 OR name = $1',
      [nameOrId]
    );

    if (!row) return null;

    return this.mapSchemaRow(row);
  }

  /**
   * List all custom tables
   */
  async listTables(): Promise<CustomTableSchema[]> {
    const rows = await this.query<SchemaRow>(
      'SELECT * FROM custom_table_schemas ORDER BY display_name'
    );

    return rows.map((row) => this.mapSchemaRow(row));
  }

  /**
   * List tables owned by a specific plugin
   */
  async getTablesByPlugin(pluginId: string): Promise<CustomTableSchema[]> {
    const rows = await this.query<SchemaRow>(
      'SELECT * FROM custom_table_schemas WHERE owner_plugin_id = $1 ORDER BY display_name',
      [pluginId]
    );
    return rows.map((row) => this.mapSchemaRow(row));
  }

  private mapSchemaRow(row: SchemaRow): CustomTableSchema {
    return {
      id: row.id,
      name: row.name,
      displayName: row.display_name,
      description: row.description ?? undefined,
      columns: typeof row.columns === 'string' ? JSON.parse(row.columns) : row.columns,
      ownerPluginId: row.owner_plugin_id ?? undefined,
      isProtected: !!row.is_protected,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Update a custom table schema
   */
  async updateTable(
    nameOrId: string,
    updates: Partial<Pick<CustomTableSchema, 'displayName' | 'description' | 'columns'>>
  ): Promise<CustomTableSchema | null> {
    const existing = await this.getTable(nameOrId);
    if (!existing) return null;

    const now = new Date().toISOString();
    const newDisplayName = updates.displayName ?? existing.displayName;
    const newDescription = updates.description ?? existing.description;
    const newColumns = updates.columns ?? existing.columns;

    await this.execute(
      `UPDATE custom_table_schemas
       SET display_name = $1, description = $2, columns = $3, updated_at = $4
       WHERE id = $5`,
      [newDisplayName, newDescription ?? null, JSON.stringify(newColumns), now, existing.id]
    );

    return {
      ...existing,
      displayName: newDisplayName,
      description: newDescription,
      columns: newColumns,
      updatedAt: now,
    };
  }

  /**
   * Delete a custom table and all its data.
   * Protected tables require `force: true` (used during plugin uninstall).
   */
  async deleteTable(nameOrId: string, options?: { force?: boolean }): Promise<boolean> {
    const table = await this.getTable(nameOrId);
    if (!table) return false;

    // Protection check
    if (table.isProtected && !options?.force) {
      throw new Error(
        `Table "${table.displayName}" is protected by plugin "${table.ownerPluginId}". Cannot delete.`
      );
    }

    // Delete all records first
    await this.execute('DELETE FROM custom_data_records WHERE table_id = $1', [table.id]);

    // Delete the table schema
    await this.execute('DELETE FROM custom_table_schemas WHERE id = $1', [table.id]);

    return true;
  }

  /**
   * Force-delete all tables owned by a plugin (for uninstall).
   */
  async deletePluginTables(pluginId: string): Promise<number> {
    const tables = await this.getTablesByPlugin(pluginId);
    if (tables.length === 0) return 0;

    const ids = tables.map((t) => t.id);
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');

    // Batch delete: records first (FK), then schemas
    await this.execute(`DELETE FROM custom_data_records WHERE table_id IN (${placeholders})`, ids);
    await this.execute(`DELETE FROM custom_table_schemas WHERE id IN (${placeholders})`, ids);

    return tables.length;
  }

  /**
   * Create a plugin-owned table if it doesn't exist (idempotent).
   * Used during plugin initialization.
   */
  async ensurePluginTable(
    pluginId: string,
    name: string,
    displayName: string,
    columns: ColumnDefinition[],
    description?: string,
  ): Promise<CustomTableSchema> {
    const existing = await this.getTable(name);
    if (existing) {
      // Verify ownership
      if (existing.ownerPluginId && existing.ownerPluginId !== pluginId) {
        throw new Error(`Table "${name}" is owned by plugin "${existing.ownerPluginId}", not "${pluginId}"`);
      }
      return existing;
    }
    return this.createTable(name, displayName, columns, description, {
      ownerPluginId: pluginId,
      isProtected: true,
    });
  }

  /**
   * Add a record to a custom table
   */
  async addRecord(tableNameOrId: string, data: Record<string, unknown>): Promise<CustomDataRecord> {
    const table = await this.getTable(tableNameOrId);
    if (!table) {
      throw new Error(`Table not found: ${tableNameOrId}`);
    }

    // Validate required fields
    for (const col of table.columns) {
      if (col.required && (data[col.name] === undefined || data[col.name] === null)) {
        throw new Error(`Missing required field: ${col.name}`);
      }
    }

    // Apply default values
    const processedData: Record<string, unknown> = {};
    for (const col of table.columns) {
      if (data[col.name] !== undefined) {
        processedData[col.name] = data[col.name];
      } else if (col.defaultValue !== undefined) {
        processedData[col.name] = col.defaultValue;
      }
    }

    const id = `rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    await this.execute(
      `INSERT INTO custom_data_records (id, table_id, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, table.id, JSON.stringify(processedData), now, now]
    );

    return {
      id,
      tableId: table.id,
      data: processedData,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Get a record by ID
   */
  async getRecord(recordId: string): Promise<CustomDataRecord | null> {
    const row = await this.queryOne<RecordRow>(
      'SELECT * FROM custom_data_records WHERE id = $1',
      [recordId]
    );

    if (!row) return null;

    return {
      id: row.id,
      tableId: row.table_id,
      data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * List records in a table with optional filtering
   */
  async listRecords(
    tableNameOrId: string,
    options?: {
      limit?: number;
      offset?: number;
      orderBy?: string;
      orderDir?: 'asc' | 'desc';
      filter?: Record<string, unknown>;
    }
  ): Promise<{ records: CustomDataRecord[]; total: number }> {
    const table = await this.getTable(tableNameOrId);
    if (!table) {
      throw new Error(`Table not found: ${tableNameOrId}`);
    }

    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;

    // Get total count
    const countResult = await this.queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM custom_data_records WHERE table_id = $1',
      [table.id]
    );
    const total = parseInt(countResult?.count ?? '0', 10);

    // Get records
    const rows = await this.query<RecordRow>(
      `SELECT * FROM custom_data_records
       WHERE table_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [table.id, limit, offset]
    );

    let records = rows.map((row) => ({
      id: row.id,
      tableId: row.table_id,
      data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    // Apply filter in memory (for JSON data)
    if (options?.filter) {
      records = records.filter((rec) => {
        for (const [key, value] of Object.entries(options.filter!)) {
          if (rec.data[key] !== value) {
            return false;
          }
        }
        return true;
      });
    }

    return { records, total };
  }

  /**
   * Update a record
   */
  async updateRecord(recordId: string, data: Record<string, unknown>): Promise<CustomDataRecord | null> {
    const existing = await this.getRecord(recordId);
    if (!existing) return null;

    const table = await this.getTable(existing.tableId);
    if (!table) return null;

    // Merge with existing data
    const newData = { ...existing.data, ...data };

    // Validate required fields
    for (const col of table.columns) {
      if (col.required && (newData[col.name] === undefined || newData[col.name] === null)) {
        throw new Error(`Missing required field: ${col.name}`);
      }
    }

    const now = new Date().toISOString();

    await this.execute(
      'UPDATE custom_data_records SET data = $1, updated_at = $2 WHERE id = $3',
      [JSON.stringify(newData), now, recordId]
    );

    return {
      ...existing,
      data: newData,
      updatedAt: now,
    };
  }

  /**
   * Delete a record
   */
  async deleteRecord(recordId: string): Promise<boolean> {
    const result = await this.execute('DELETE FROM custom_data_records WHERE id = $1', [recordId]);
    return result.changes > 0;
  }

  /**
   * Search records across a table
   */
  async searchRecords(
    tableNameOrId: string,
    query: string,
    options?: { limit?: number }
  ): Promise<CustomDataRecord[]> {
    const table = await this.getTable(tableNameOrId);
    if (!table) {
      throw new Error(`Table not found: ${tableNameOrId}`);
    }

    const limit = options?.limit ?? 50;
    const searchTerm = `%${query.toLowerCase()}%`;

    // Search in JSON data (PostgreSQL ILIKE on cast)
    const rows = await this.query<RecordRow>(
      `SELECT * FROM custom_data_records
       WHERE table_id = $1 AND LOWER(data::text) LIKE $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [table.id, searchTerm, limit]
    );

    return rows.map((row) => ({
      id: row.id,
      tableId: row.table_id,
      data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Get statistics for a table
   */
  async getTableStats(tableNameOrId: string): Promise<{
    recordCount: number;
    firstRecord?: string;
    lastRecord?: string;
  } | null> {
    const table = await this.getTable(tableNameOrId);
    if (!table) return null;

    const countResult = await this.queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM custom_data_records WHERE table_id = $1',
      [table.id]
    );

    const firstResult = await this.queryOne<{ created_at: string }>(
      'SELECT created_at FROM custom_data_records WHERE table_id = $1 ORDER BY created_at ASC LIMIT 1',
      [table.id]
    );

    const lastResult = await this.queryOne<{ created_at: string }>(
      'SELECT created_at FROM custom_data_records WHERE table_id = $1 ORDER BY created_at DESC LIMIT 1',
      [table.id]
    );

    return {
      recordCount: parseInt(countResult?.count ?? '0', 10),
      firstRecord: firstResult?.created_at,
      lastRecord: lastResult?.created_at,
    };
  }
}

// Factory function
export function createCustomDataRepository(): CustomDataRepository {
  return new CustomDataRepository();
}

// Alias for backwards compatibility
export const getCustomDataRepository = createCustomDataRepository;
