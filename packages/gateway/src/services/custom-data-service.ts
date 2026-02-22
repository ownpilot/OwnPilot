/**
 * Custom Data Service
 *
 * Central business logic for custom tables and records.
 * Handles protection enforcement and plugin ownership.
 */

import {
  getEventBus,
  createEvent,
  EventTypes,
  type ResourceCreatedData,
  type ResourceUpdatedData,
  type ResourceDeletedData,
} from '@ownpilot/core';
import {
  CustomDataRepository,
  createCustomDataRepository,
  type CustomTableSchema,
  type CustomDataRecord,
  type ColumnDefinition,
} from '../db/repositories/custom-data.js';

// ============================================================================
// Types
// ============================================================================

export interface TableStats {
  recordCount: number;
  firstRecord?: string;
  lastRecord?: string;
}

// ============================================================================
// CustomDataService
// ============================================================================

export class CustomDataService {
  private getRepo(): CustomDataRepository {
    return createCustomDataRepository();
  }

  // --------------------------------------------------------------------------
  // Table Operations
  // --------------------------------------------------------------------------

  async createTable(
    name: string,
    displayName: string,
    columns: ColumnDefinition[],
    description?: string,
    options?: { ownerPluginId?: string; isProtected?: boolean },
  ): Promise<CustomTableSchema> {
    if (!name?.trim()) {
      throw new CustomDataServiceError('Table name is required', 'VALIDATION_ERROR');
    }
    if (!columns.length) {
      throw new CustomDataServiceError('At least one column is required', 'VALIDATION_ERROR');
    }
    const repo = this.getRepo();
    const table = await repo.createTable(name, displayName, columns, description, options);
    getEventBus().emit(createEvent<ResourceCreatedData>(
      EventTypes.RESOURCE_CREATED, 'resource', 'custom-data-service',
      { resourceType: 'custom_table', id: table.id },
    ));
    return table;
  }

  async getTable(nameOrId: string): Promise<CustomTableSchema | null> {
    const repo = this.getRepo();
    return repo.getTable(nameOrId);
  }

  async listTables(): Promise<CustomTableSchema[]> {
    const repo = this.getRepo();
    return repo.listTables();
  }

  async getTablesByPlugin(pluginId: string): Promise<CustomTableSchema[]> {
    const repo = this.getRepo();
    return repo.getTablesByPlugin(pluginId);
  }

  /**
   * List tables with record count stats attached.
   */
  async listTablesWithStats(
    options?: { pluginId?: string },
  ): Promise<Array<CustomTableSchema & { recordCount: number }>> {
    const repo = this.getRepo();

    // For plugin-specific queries, fall back to per-table stats (rare path)
    if (options?.pluginId) {
      const tables = await repo.getTablesByPlugin(options.pluginId);
      return Promise.all(
        tables.map(async (table) => {
          const stats = await repo.getTableStats(table.id);
          return { ...table, recordCount: stats?.recordCount ?? 0 };
        }),
      );
    }

    // Single JOIN query instead of N+1 per-table queries
    return repo.listTablesWithCounts();
  }

  async updateTable(
    nameOrId: string,
    updates: Partial<Pick<CustomTableSchema, 'displayName' | 'description' | 'columns'>>,
  ): Promise<CustomTableSchema | null> {
    const repo = this.getRepo();
    return repo.updateTable(nameOrId, updates);
  }

  /**
   * Delete a table. Throws if the table is protected by a plugin.
   * Use `force: true` for plugin uninstall scenarios.
   */
  async deleteTable(nameOrId: string, options?: { force?: boolean }): Promise<boolean> {
    const repo = this.getRepo();
    const table = await repo.getTable(nameOrId);
    if (!table) return false;

    if (table.isProtected && !options?.force) {
      throw new CustomDataServiceError(
        `Table "${table.displayName}" is protected by plugin "${table.ownerPluginId}". Cannot delete.`,
        'PROTECTED',
      );
    }

    const deleted = await repo.deleteTable(nameOrId, options);
    if (deleted) {
      getEventBus().emit(createEvent<ResourceDeletedData>(
        EventTypes.RESOURCE_DELETED, 'resource', 'custom-data-service',
        { resourceType: 'custom_table', id: table.id },
      ));
    }
    return deleted;
  }

  /**
   * Ensure a plugin-owned table exists (idempotent).
   */
  async ensurePluginTable(
    pluginId: string,
    name: string,
    displayName: string,
    columns: ColumnDefinition[],
    description?: string,
  ): Promise<CustomTableSchema> {
    const repo = this.getRepo();
    return repo.ensurePluginTable(pluginId, name, displayName, columns, description);
  }

  /**
   * Force-delete all tables owned by a plugin (for uninstall).
   */
  async deletePluginTables(pluginId: string): Promise<number> {
    const repo = this.getRepo();
    return repo.deletePluginTables(pluginId);
  }

  // --------------------------------------------------------------------------
  // Record Operations
  // --------------------------------------------------------------------------

  async addRecord(tableNameOrId: string, data: Record<string, unknown>): Promise<CustomDataRecord> {
    const repo = this.getRepo();
    const record = await repo.addRecord(tableNameOrId, data);
    getEventBus().emit(createEvent<ResourceCreatedData>(
      EventTypes.RESOURCE_CREATED, 'resource', 'custom-data-service',
      { resourceType: 'custom_record', id: record.id },
    ));
    return record;
  }

  /**
   * Add multiple records to a table.
   */
  async batchAddRecords(
    tableNameOrId: string,
    records: Array<Record<string, unknown>>,
  ): Promise<CustomDataRecord[]> {
    if (!records.length) return [];

    const repo = this.getRepo();
    // Validate table exists
    const table = await repo.getTable(tableNameOrId);
    if (!table) {
      throw new CustomDataServiceError(`Table not found: ${tableNameOrId}`, 'NOT_FOUND');
    }

    return repo.transaction(async () => {
      const created: CustomDataRecord[] = [];
      for (const data of records) {
        const record = await repo.insertRecord(table, data);
        created.push(record);
      }
      return created;
    });
  }

  async getRecord(recordId: string): Promise<CustomDataRecord | null> {
    const repo = this.getRepo();
    return repo.getRecord(recordId);
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
  ): Promise<{ records: CustomDataRecord[]; total: number }> {
    const repo = this.getRepo();
    return repo.listRecords(tableNameOrId, options);
  }

  async updateRecord(recordId: string, data: Record<string, unknown>): Promise<CustomDataRecord | null> {
    const repo = this.getRepo();
    const updated = await repo.updateRecord(recordId, data);
    if (updated) {
      getEventBus().emit(createEvent<ResourceUpdatedData>(
        EventTypes.RESOURCE_UPDATED, 'resource', 'custom-data-service',
        { resourceType: 'custom_record', id: recordId, changes: data },
      ));
    }
    return updated;
  }

  async deleteRecord(recordId: string): Promise<boolean> {
    const repo = this.getRepo();
    const deleted = await repo.deleteRecord(recordId);
    if (deleted) {
      getEventBus().emit(createEvent<ResourceDeletedData>(
        EventTypes.RESOURCE_DELETED, 'resource', 'custom-data-service',
        { resourceType: 'custom_record', id: recordId },
      ));
    }
    return deleted;
  }

  async searchRecords(
    tableNameOrId: string,
    query: string,
    options?: { limit?: number },
  ): Promise<CustomDataRecord[]> {
    if (!query?.trim()) {
      throw new CustomDataServiceError('Search query is required', 'VALIDATION_ERROR');
    }
    const repo = this.getRepo();
    return repo.searchRecords(tableNameOrId, query, options);
  }

  // --------------------------------------------------------------------------
  // Stats
  // --------------------------------------------------------------------------

  async getTableStats(tableNameOrId: string): Promise<TableStats | null> {
    const repo = this.getRepo();
    return repo.getTableStats(tableNameOrId);
  }
}

// ============================================================================
// Error Type
// ============================================================================

export type CustomDataServiceErrorCode = 'VALIDATION_ERROR' | 'NOT_FOUND' | 'PROTECTED' | 'INTERNAL_ERROR';

export class CustomDataServiceError extends Error {
  constructor(
    message: string,
    public readonly code: CustomDataServiceErrorCode,
  ) {
    super(message);
    this.name = 'CustomDataServiceError';
  }
}

// ============================================================================
// Singleton (internal — use ServiceRegistry instead)
// ============================================================================

let instance: CustomDataService | null = null;

/**
 * @internal Used only by DatabaseServiceImpl adapter.
 * @deprecated Use `getServiceRegistry().get(Services.Database)` instead.
 */
export function getCustomDataService(): CustomDataService {
  if (!instance) {
    instance = new CustomDataService();
  }
  return instance;
}
