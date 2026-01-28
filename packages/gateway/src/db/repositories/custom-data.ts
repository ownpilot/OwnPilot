/**
 * Custom Data Repository
 *
 * Handles dynamic tables with AI-decided schemas.
 * Allows the AI to create tables, define columns, and manage data on the fly.
 */

import { getDatabase } from '../index.js';

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

/**
 * Initialize custom data tables
 */
export function initCustomDataTables(): void {
  const db = getDatabase();

  // Table for storing custom table schemas
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_table_schemas (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT,
      columns TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // Table for storing custom data records (using JSON for flexible data)
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_data_records (
      id TEXT PRIMARY KEY,
      table_id TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (table_id) REFERENCES custom_table_schemas(id) ON DELETE CASCADE
    )
  `);

  // Index for faster queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_custom_data_table_id ON custom_data_records(table_id)
  `);
}

/**
 * Custom Data Repository class
 */
export class CustomDataRepository {
  private db = getDatabase();

  /**
   * Create a new custom table with the given schema
   */
  createTable(
    name: string,
    displayName: string,
    columns: ColumnDefinition[],
    description?: string
  ): CustomTableSchema {
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

    const stmt = this.db.prepare(`
      INSERT INTO custom_table_schemas (id, name, display_name, description, columns, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, sanitizedName, displayName, description ?? null, JSON.stringify(columns), now, now);

    return {
      id,
      name: sanitizedName,
      displayName,
      description,
      columns,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Get a custom table schema by name or ID
   */
  getTable(nameOrId: string): CustomTableSchema | null {
    const stmt = this.db.prepare(`
      SELECT * FROM custom_table_schemas WHERE id = ? OR name = ?
    `);

    const row = stmt.get(nameOrId, nameOrId) as {
      id: string;
      name: string;
      display_name: string;
      description: string | null;
      columns: string;
      created_at: string;
      updated_at: string;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      displayName: row.display_name,
      description: row.description ?? undefined,
      columns: JSON.parse(row.columns),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * List all custom tables
   */
  listTables(): CustomTableSchema[] {
    const stmt = this.db.prepare(`
      SELECT * FROM custom_table_schemas ORDER BY display_name
    `);

    const rows = stmt.all() as Array<{
      id: string;
      name: string;
      display_name: string;
      description: string | null;
      columns: string;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      displayName: row.display_name,
      description: row.description ?? undefined,
      columns: JSON.parse(row.columns),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Update a custom table schema
   */
  updateTable(
    nameOrId: string,
    updates: Partial<Pick<CustomTableSchema, 'displayName' | 'description' | 'columns'>>
  ): CustomTableSchema | null {
    const existing = this.getTable(nameOrId);
    if (!existing) return null;

    const now = new Date().toISOString();
    const newDisplayName = updates.displayName ?? existing.displayName;
    const newDescription = updates.description ?? existing.description;
    const newColumns = updates.columns ?? existing.columns;

    const stmt = this.db.prepare(`
      UPDATE custom_table_schemas
      SET display_name = ?, description = ?, columns = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(newDisplayName, newDescription ?? null, JSON.stringify(newColumns), now, existing.id);

    return {
      ...existing,
      displayName: newDisplayName,
      description: newDescription,
      columns: newColumns,
      updatedAt: now,
    };
  }

  /**
   * Delete a custom table and all its data
   */
  deleteTable(nameOrId: string): boolean {
    const table = this.getTable(nameOrId);
    if (!table) return false;

    // Delete all records first
    this.db.prepare(`DELETE FROM custom_data_records WHERE table_id = ?`).run(table.id);

    // Delete the table schema
    this.db.prepare(`DELETE FROM custom_table_schemas WHERE id = ?`).run(table.id);

    return true;
  }

  /**
   * Add a record to a custom table
   */
  addRecord(tableNameOrId: string, data: Record<string, unknown>): CustomDataRecord {
    const table = this.getTable(tableNameOrId);
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

    const stmt = this.db.prepare(`
      INSERT INTO custom_data_records (id, table_id, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(id, table.id, JSON.stringify(processedData), now, now);

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
  getRecord(recordId: string): CustomDataRecord | null {
    const stmt = this.db.prepare(`
      SELECT * FROM custom_data_records WHERE id = ?
    `);

    const row = stmt.get(recordId) as {
      id: string;
      table_id: string;
      data: string;
      created_at: string;
      updated_at: string;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      tableId: row.table_id,
      data: JSON.parse(row.data),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * List records in a table with optional filtering
   */
  listRecords(
    tableNameOrId: string,
    options?: {
      limit?: number;
      offset?: number;
      orderBy?: string;
      orderDir?: 'asc' | 'desc';
      filter?: Record<string, unknown>;
    }
  ): { records: CustomDataRecord[]; total: number } {
    const table = this.getTable(tableNameOrId);
    if (!table) {
      throw new Error(`Table not found: ${tableNameOrId}`);
    }

    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;

    // Get total count
    const countStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM custom_data_records WHERE table_id = ?
    `);
    const countRow = countStmt.get(table.id) as { count: number };
    const total = countRow.count;

    // Get records
    const stmt = this.db.prepare(`
      SELECT * FROM custom_data_records
      WHERE table_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);

    const rows = stmt.all(table.id, limit, offset) as Array<{
      id: string;
      table_id: string;
      data: string;
      created_at: string;
      updated_at: string;
    }>;

    let records = rows.map((row) => ({
      id: row.id,
      tableId: row.table_id,
      data: JSON.parse(row.data),
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
  updateRecord(recordId: string, data: Record<string, unknown>): CustomDataRecord | null {
    const existing = this.getRecord(recordId);
    if (!existing) return null;

    const table = this.getTable(existing.tableId);
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

    const stmt = this.db.prepare(`
      UPDATE custom_data_records
      SET data = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(JSON.stringify(newData), now, recordId);

    return {
      ...existing,
      data: newData,
      updatedAt: now,
    };
  }

  /**
   * Delete a record
   */
  deleteRecord(recordId: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM custom_data_records WHERE id = ?`);
    const result = stmt.run(recordId);
    return result.changes > 0;
  }

  /**
   * Search records across a table
   */
  searchRecords(
    tableNameOrId: string,
    query: string,
    options?: { limit?: number }
  ): CustomDataRecord[] {
    const table = this.getTable(tableNameOrId);
    if (!table) {
      throw new Error(`Table not found: ${tableNameOrId}`);
    }

    const limit = options?.limit ?? 50;
    const searchTerm = `%${query.toLowerCase()}%`;

    // Search in JSON data (SQLite JSON functions)
    const stmt = this.db.prepare(`
      SELECT * FROM custom_data_records
      WHERE table_id = ? AND LOWER(data) LIKE ?
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(table.id, searchTerm, limit) as Array<{
      id: string;
      table_id: string;
      data: string;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      tableId: row.table_id,
      data: JSON.parse(row.data),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Get statistics for a table
   */
  getTableStats(tableNameOrId: string): {
    recordCount: number;
    firstRecord?: string;
    lastRecord?: string;
  } | null {
    const table = this.getTable(tableNameOrId);
    if (!table) return null;

    const countStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM custom_data_records WHERE table_id = ?
    `);
    const countRow = countStmt.get(table.id) as { count: number };

    const firstStmt = this.db.prepare(`
      SELECT created_at FROM custom_data_records WHERE table_id = ? ORDER BY created_at ASC LIMIT 1
    `);
    const firstRow = firstStmt.get(table.id) as { created_at: string } | undefined;

    const lastStmt = this.db.prepare(`
      SELECT created_at FROM custom_data_records WHERE table_id = ? ORDER BY created_at DESC LIMIT 1
    `);
    const lastRow = lastStmt.get(table.id) as { created_at: string } | undefined;

    return {
      recordCount: countRow.count,
      firstRecord: firstRow?.created_at,
      lastRecord: lastRow?.created_at,
    };
  }
}

// Singleton instance
let customDataRepo: CustomDataRepository | null = null;

export function getCustomDataRepository(): CustomDataRepository {
  if (!customDataRepo) {
    initCustomDataTables();
    customDataRepo = new CustomDataRepository();
  }
  return customDataRepo;
}
