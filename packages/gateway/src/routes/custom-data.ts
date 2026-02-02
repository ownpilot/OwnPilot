/**
 * Custom Data Routes
 *
 * API for managing dynamic custom tables and data.
 * Also provides tool executors for AI to manage user's custom data.
 *
 * All business logic is delegated to CustomDataService.
 */

import { Hono } from 'hono';
import { apiResponse, apiError } from './helpers.js'
import { ERROR_CODES } from './helpers.js';
import type { ColumnDefinition } from '../db/repositories/custom-data.js';
import { getCustomDataService, CustomDataServiceError } from '../services/custom-data-service.js';

export const customDataRoutes = new Hono();

// ============================================================================
// Table Management Routes
// ============================================================================

/**
 * GET /custom-data/tables - List all custom tables
 */
customDataRoutes.get('/tables', async (c) => {
  const service = getCustomDataService();
  const tables = await service.listTablesWithStats();

  return apiResponse(c, tables);
});

/**
 * GET /custom-data/tables/by-plugin/:pluginId - List tables owned by a plugin
 */
customDataRoutes.get('/tables/by-plugin/:pluginId', async (c) => {
  const pluginId = c.req.param('pluginId');
  const service = getCustomDataService();
  const tables = await service.listTablesWithStats({ pluginId });

  return apiResponse(c, tables);
});

/**
 * POST /custom-data/tables - Create a new custom table
 */
customDataRoutes.post('/tables', async (c) => {
  const body = await c.req.json<{
    name: string;
    displayName: string;
    description?: string;
    columns: ColumnDefinition[];
  }>();

  try {
    const service = getCustomDataService();
    const table = await service.createTable(
      body.name,
      body.displayName,
      body.columns,
      body.description,
    );

    return apiResponse(c, table, 201);
  } catch (err) {
    if (err instanceof CustomDataServiceError && err.code === 'VALIDATION_ERROR') {
      return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: err.message }, 400);
    }
    return apiError(c, { code: ERROR_CODES.CREATE_FAILED, message: err instanceof Error ? err.message : 'Failed to create table' }, 400);
  }
});

/**
 * GET /custom-data/tables/:table - Get table details
 */
customDataRoutes.get('/tables/:table', async (c) => {
  const tableId = c.req.param('table');
  const service = getCustomDataService();

  const table = await service.getTable(tableId);
  if (!table) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Table not found: ${tableId}` }, 404);
  }

  const stats = await service.getTableStats(tableId);

  return apiResponse(c, {
      ...table,
      stats,
    });
});

/**
 * PUT /custom-data/tables/:table - Update table schema
 */
customDataRoutes.put('/tables/:table', async (c) => {
  const tableId = c.req.param('table');
  const body = await c.req.json<{
    displayName?: string;
    description?: string;
    columns?: ColumnDefinition[];
  }>();

  const service = getCustomDataService();
  const updated = await service.updateTable(tableId, body);

  if (!updated) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Table not found: ${tableId}` }, 404);
  }

  return apiResponse(c, updated);
});

/**
 * DELETE /custom-data/tables/:table - Delete table and all data
 * Protected tables cannot be deleted through this endpoint.
 */
customDataRoutes.delete('/tables/:table', async (c) => {
  const tableId = c.req.param('table');
  const service = getCustomDataService();

  try {
    const deleted = await service.deleteTable(tableId);

    if (!deleted) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Table not found: ${tableId}` }, 404);
    }

    return apiResponse(c, { deleted: true });
  } catch (err) {
    if (err instanceof CustomDataServiceError && err.code === 'PROTECTED') {
      return apiError(c, { code: ERROR_CODES.PROTECTED, message: err.message }, 403);
    }
    throw err;
  }
});

// ============================================================================
// Record Management Routes
// ============================================================================

/**
 * GET /custom-data/tables/:table/records - List records
 */
customDataRoutes.get('/tables/:table/records', async (c) => {
  const tableId = c.req.param('table');
  const limit = parseInt(c.req.query('limit') ?? '50');
  const offset = parseInt(c.req.query('offset') ?? '0');
  const filterParam = c.req.query('filter');

  let filter: Record<string, unknown> | undefined;
  if (filterParam) {
    try {
      filter = JSON.parse(filterParam);
    } catch {
      // Ignore invalid filter
    }
  }

  try {
    const service = getCustomDataService();
    const { records, total } = await service.listRecords(tableId, { limit, offset, filter });

    return apiResponse(c, {
        records,
        total,
        limit,
        offset,
        hasMore: offset + records.length < total,
      });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.LIST_FAILED, message: err instanceof Error ? err.message : 'Failed to list records' }, 400);
  }
});

/**
 * POST /custom-data/tables/:table/records - Add a record
 */
customDataRoutes.post('/tables/:table/records', async (c) => {
  const tableId = c.req.param('table');
  const body = await c.req.json<{ data: Record<string, unknown> }>();

  if (!body.data) {
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.INVALID_REQUEST,
          message: 'data is required',
        },
      },
      400
    );
  }

  try {
    const service = getCustomDataService();
    const record = await service.addRecord(tableId, body.data);

    return apiResponse(c, record, 201);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.ADD_FAILED, message: err instanceof Error ? err.message : 'Failed to add record' }, 400);
  }
});

/**
 * GET /custom-data/tables/:table/search - Search records
 */
customDataRoutes.get('/tables/:table/search', async (c) => {
  const tableId = c.req.param('table');
  const query = c.req.query('q') ?? '';
  const limit = parseInt(c.req.query('limit') ?? '20');

  if (!query) {
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.INVALID_REQUEST,
          message: 'Search query (q) is required',
        },
      },
      400
    );
  }

  try {
    const service = getCustomDataService();
    const records = await service.searchRecords(tableId, query, { limit });

    return apiResponse(c, records);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.SEARCH_FAILED, message: err instanceof Error ? err.message : 'Failed to search records' }, 400);
  }
});

/**
 * GET /custom-data/records/:id - Get a single record
 */
customDataRoutes.get('/records/:id', async (c) => {
  const recordId = c.req.param('id');
  const service = getCustomDataService();

  const record = await service.getRecord(recordId);
  if (!record) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Record not found: ${recordId}` }, 404);
  }

  return apiResponse(c, record);
});

/**
 * PUT /custom-data/records/:id - Update a record
 */
customDataRoutes.put('/records/:id', async (c) => {
  const recordId = c.req.param('id');
  const body = await c.req.json<{ data: Record<string, unknown> }>();

  if (!body.data) {
    return c.json(
      {
        success: false,
        error: {
          code: ERROR_CODES.INVALID_REQUEST,
          message: 'data is required',
        },
      },
      400
    );
  }

  try {
    const service = getCustomDataService();
    const updated = await service.updateRecord(recordId, body.data);

    if (!updated) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Record not found: ${recordId}` }, 404);
    }

    return apiResponse(c, updated);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.UPDATE_FAILED, message: err instanceof Error ? err.message : 'Failed to update record' }, 400);
  }
});

/**
 * DELETE /custom-data/records/:id - Delete a record
 */
customDataRoutes.delete('/records/:id', async (c) => {
  const recordId = c.req.param('id');
  const service = getCustomDataService();

  const deleted = await service.deleteRecord(recordId);
  if (!deleted) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `Record not found: ${recordId}` }, 404);
  }

  return apiResponse(c, { deleted: true });
});

// ============================================================================
// Tool Executors for AI
// ============================================================================

export interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

/**
 * Execute custom data tool - delegates to CustomDataService
 */
export async function executeCustomDataTool(
  toolId: string,
  params: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const service = getCustomDataService();

  try {
    switch (toolId) {
      case 'create_custom_table': {
        const { name, displayName, description, columns } = params as {
          name: string;
          displayName: string;
          description?: string;
          columns: ColumnDefinition[];
        };
        const table = await service.createTable(name, displayName, columns, description);
        return {
          success: true,
          result: {
            message: `Created table "${table.displayName}" with ${columns.length} columns.`,
            table,
          },
        };
      }

      case 'list_custom_tables': {
        const tablesWithStats = await service.listTablesWithStats();
        if (tablesWithStats.length === 0) {
          return {
            success: true,
            result: {
              message: 'No custom tables have been created yet.',
              tables: [],
            },
          };
        }
        return {
          success: true,
          result: {
            message: `Found ${tablesWithStats.length} custom table(s).`,
            tables: tablesWithStats.map((t) => ({
              name: t.name,
              displayName: t.displayName,
              description: t.description,
              columnCount: t.columns.length,
              recordCount: t.recordCount,
              ownerPluginId: t.ownerPluginId ?? null,
              isProtected: t.isProtected,
            })),
          },
        };
      }

      case 'describe_custom_table': {
        const { table: tableId } = params as { table: string };
        const table = await service.getTable(tableId);
        if (!table) {
          return { success: false, error: `Table not found: ${tableId}` };
        }
        const stats = await service.getTableStats(table.id);
        return {
          success: true,
          result: {
            message: `Table "${table.displayName}" has ${table.columns.length} columns and ${stats?.recordCount ?? 0} records.`,
            table: {
              ...table,
              stats,
            },
          },
        };
      }

      case 'delete_custom_table': {
        const { table: tableId, confirm } = params as { table: string; confirm: boolean };
        if (!confirm) {
          return { success: false, error: 'Must set confirm: true to delete a table' };
        }
        // Get display name before deletion
        const table = await service.getTable(tableId);
        if (!table) {
          return { success: false, error: `Table not found: ${tableId}` };
        }
        const displayName = table.displayName;

        // Service handles protection check
        await service.deleteTable(tableId);

        return {
          success: true,
          result: {
            message: `Deleted table "${displayName}" and all its data.`,
          },
        };
      }

      case 'add_custom_record': {
        const { table: tableId, data } = params as {
          table: string;
          data: Record<string, unknown>;
        };
        const record = await service.addRecord(tableId, data);
        const table = await service.getTable(tableId);
        return {
          success: true,
          result: {
            message: `Added new record to "${table?.displayName ?? tableId}".`,
            record,
          },
        };
      }

      case 'batch_add_custom_records': {
        const { table: tableId, records: recordsInput } = params as {
          table: string;
          records: Array<Record<string, unknown>>;
        };

        if (!recordsInput || !Array.isArray(recordsInput)) {
          return { success: false, error: 'records must be an array' };
        }

        const results = await service.batchAddRecords(tableId, recordsInput);
        const table = await service.getTable(tableId);

        return {
          success: true,
          result: {
            message: `Added ${results.length} record(s) to "${table?.displayName ?? tableId}".`,
            records: results,
            count: results.length,
          },
        };
      }

      case 'list_custom_records': {
        const { table: tableId, limit = 20, offset = 0, filter } = params as {
          table: string;
          limit?: number;
          offset?: number;
          filter?: Record<string, unknown>;
        };
        const { records, total } = await service.listRecords(tableId, { limit, offset, filter });
        const table = await service.getTable(tableId);
        return {
          success: true,
          result: {
            message: `Found ${total} record(s) in "${table?.displayName ?? tableId}". Showing ${records.length}.`,
            records: records.map((r) => ({ id: r.id, ...r.data, _createdAt: r.createdAt })),
            total,
            hasMore: offset + records.length < total,
          },
        };
      }

      case 'search_custom_records': {
        const { table: tableId, query, limit = 20 } = params as {
          table: string;
          query: string;
          limit?: number;
        };
        const records = await service.searchRecords(tableId, query, { limit });
        const table = await service.getTable(tableId);
        return {
          success: true,
          result: {
            message: `Found ${records.length} record(s) matching "${query}" in "${table?.displayName ?? tableId}".`,
            records: records.map((r) => ({ id: r.id, ...r.data, _createdAt: r.createdAt })),
          },
        };
      }

      case 'get_custom_record': {
        const { recordId } = params as { recordId: string };
        const record = await service.getRecord(recordId);
        if (!record) {
          return { success: false, error: `Record not found: ${recordId}` };
        }
        return {
          success: true,
          result: {
            message: 'Record found.',
            record: { id: record.id, ...record.data, _createdAt: record.createdAt, _updatedAt: record.updatedAt },
          },
        };
      }

      case 'update_custom_record': {
        const { recordId, data } = params as {
          recordId: string;
          data: Record<string, unknown>;
        };
        const updated = await service.updateRecord(recordId, data);
        if (!updated) {
          return { success: false, error: `Record not found: ${recordId}` };
        }
        return {
          success: true,
          result: {
            message: 'Record updated.',
            record: { id: updated.id, ...updated.data, _updatedAt: updated.updatedAt },
          },
        };
      }

      case 'delete_custom_record': {
        const { recordId } = params as { recordId: string };
        const deleted = await service.deleteRecord(recordId);
        if (!deleted) {
          return { success: false, error: `Record not found: ${recordId}` };
        }
        return {
          success: true,
          result: {
            message: 'Record deleted.',
          },
        };
      }

      default:
        return { success: false, error: `Unknown tool: ${toolId}` };
    }
  } catch (err) {
    if (err instanceof CustomDataServiceError) {
      return { success: false, error: err.message };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
