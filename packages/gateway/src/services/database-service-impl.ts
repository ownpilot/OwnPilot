/**
 * DatabaseService Implementation
 *
 * Wraps the existing CustomDataService to provide IDatabaseService interface.
 * Maps gateway CustomTableSchema/CustomDataRecord to core TableSchema/DataRecord.
 *
 * Usage:
 *   const db = registry.get(Services.Database);
 *   const table = await db.createTable('users', 'Users', columns);
 *   const record = await db.addRecord('users', { name: 'Alice' });
 */

import type {
  IDatabaseService,
  TableColumn,
  TableSchema,
  DataRecord,
  DatabaseTableStats as TableStats,
} from '@ownpilot/core';
import { getCustomDataService } from './custom-data-service.js';

// ============================================================================
// DatabaseServiceImpl Adapter
// ============================================================================

export class DatabaseServiceImpl implements IDatabaseService {
  private get service() {
    return getCustomDataService();
  }

  // ---- Table operations ----

  async createTable(
    name: string,
    displayName: string,
    columns: TableColumn[],
    description?: string,
    options?: { ownerPluginId?: string; isProtected?: boolean },
  ): Promise<TableSchema> {
    return this.service.createTable(name, displayName, columns, description, options);
  }

  async getTable(nameOrId: string): Promise<TableSchema | null> {
    return this.service.getTable(nameOrId);
  }

  async listTables(filter?: { pluginId?: string }): Promise<TableSchema[]> {
    if (filter?.pluginId) {
      return this.service.getTablesByPlugin(filter.pluginId);
    }
    return this.service.listTables();
  }

  async listTablesWithStats(
    filter?: { pluginId?: string },
  ): Promise<Array<TableSchema & { stats: TableStats }>> {
    const results = await this.service.listTablesWithStats(
      filter?.pluginId ? { pluginId: filter.pluginId } : undefined,
    );
    return results.map((t) => ({
      ...t,
      stats: {
        recordCount: t.recordCount,
        firstRecord: undefined,
        lastRecord: undefined,
      },
    }));
  }

  async updateTable(
    nameOrId: string,
    updates: Partial<Pick<TableSchema, 'displayName' | 'description' | 'columns'>>,
  ): Promise<TableSchema | null> {
    return this.service.updateTable(nameOrId, updates);
  }

  async deleteTable(nameOrId: string, options?: { force?: boolean }): Promise<boolean> {
    return this.service.deleteTable(nameOrId, options);
  }

  // ---- Plugin table operations ----

  async ensurePluginTable(
    pluginId: string,
    name: string,
    displayName: string,
    columns: TableColumn[],
    description?: string,
  ): Promise<TableSchema> {
    return this.service.ensurePluginTable(pluginId, name, displayName, columns, description);
  }

  async getTablesByPlugin(pluginId: string): Promise<TableSchema[]> {
    return this.service.getTablesByPlugin(pluginId);
  }

  async deletePluginTables(pluginId: string): Promise<number> {
    return this.service.deletePluginTables(pluginId);
  }

  // ---- Record operations ----

  async addRecord(tableNameOrId: string, data: Record<string, unknown>): Promise<DataRecord> {
    return this.service.addRecord(tableNameOrId, data);
  }

  async batchAddRecords(
    tableNameOrId: string,
    records: Array<Record<string, unknown>>,
  ): Promise<DataRecord[]> {
    return this.service.batchAddRecords(tableNameOrId, records);
  }

  async getRecord(recordId: string): Promise<DataRecord | null> {
    return this.service.getRecord(recordId);
  }

  async listRecords(
    tableNameOrId: string,
    options?: {
      limit?: number;
      offset?: number;
      orderBy?: string;
      orderDir?: 'asc' | 'desc';
      filter?: Record<string, unknown>;
    },
  ): Promise<{ records: DataRecord[]; total: number }> {
    return this.service.listRecords(tableNameOrId, options);
  }

  async updateRecord(
    recordId: string,
    data: Record<string, unknown>,
  ): Promise<DataRecord | null> {
    return this.service.updateRecord(recordId, data);
  }

  async deleteRecord(recordId: string): Promise<boolean> {
    return this.service.deleteRecord(recordId);
  }

  async searchRecords(
    tableNameOrId: string,
    query: string,
    options?: { limit?: number },
  ): Promise<DataRecord[]> {
    return this.service.searchRecords(tableNameOrId, query, options);
  }

  async getTableStats(tableNameOrId: string): Promise<TableStats | null> {
    return this.service.getTableStats(tableNameOrId);
  }
}

/**
 * Create a new DatabaseServiceImpl instance.
 */
export function createDatabaseServiceImpl(): IDatabaseService {
  return new DatabaseServiceImpl();
}
