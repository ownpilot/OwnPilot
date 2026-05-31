/**
 * Custom Data Routes
 *
 * API for managing dynamic custom tables and data.
 * Also provides tool executors for AI to manage user's custom data.
 *
 * All business logic is delegated to CustomDataService.
 */

import { Hono } from 'hono';
import {
  apiResponse,
  apiError,
  getIntParam,
  getUserId,
  ERROR_CODES,
  notFoundError,
  getErrorMessage,
  parseJsonBody,
} from './helpers.js';
import { pagination } from '../middleware/pagination.js';
import type { ColumnDefinition } from '../db/repositories/custom/data.js';
import { CustomDataServiceError } from '../services/custom/data-service.js';
import { getDatabaseService } from '@ownpilot/core';
import { wsGateway } from '../ws/server.js';

export const customDataRoutes = new Hono();

// ============================================================================
// Table Management Routes
// ============================================================================

/**
 * GET /custom-data/tables - List all custom tables
 */
customDataRoutes.get('/tables', async (c) => {
  const service = getDatabaseService();
  const tables = await service.listTablesWithStats();

  return apiResponse(c, tables);
});

/**
 * GET /custom-data/tables/by-plugin/:pluginId - List tables owned by a plugin
 */
customDataRoutes.get('/tables/by-plugin/:pluginId', async (c) => {
  const pluginId = c.req.param('pluginId');
  const service = getDatabaseService();
  const tables = await service.listTablesWithStats({ pluginId });

  return apiResponse(c, tables);
});

/**
 * POST /custom-data/tables - Create a new custom table
 */
customDataRoutes.post('/tables', async (c) => {
  const rawBody = await parseJsonBody(c);
  const { validateBody, createCustomTableSchema } = await import('../middleware/validation.js');
  const body = validateBody(createCustomTableSchema, rawBody) as {
    name: string;
    displayName: string;
    description?: string;
    columns: ColumnDefinition[];
  };

  try {
    const service = getDatabaseService();
    const table = await service.createTable(
      body.name,
      body.displayName,
      body.columns,
      body.description
    );

    wsGateway.broadcast('data:changed', {
      entity: 'custom_table',
      action: 'created',
      id: table.id,
    });

    return apiResponse(c, table, 201);
  } catch (err) {
    if (err instanceof CustomDataServiceError && err.code === 'VALIDATION_ERROR') {
      return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: err.message }, 400);
    }
    return apiError(
      c,
      { code: ERROR_CODES.CREATE_FAILED, message: getErrorMessage(err, 'Failed to create table') },
      400
    );
  }
});

/**
 * GET /custom-data/tables/:table - Get table details
 */
customDataRoutes.get('/tables/:table', async (c) => {
  const tableId = c.req.param('table');
  const service = getDatabaseService();

  const table = await service.getTable(tableId);
  if (!table) {
    return notFoundError(c, 'Table', tableId);
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
  const rawBody = await parseJsonBody(c);
  const { validateBody, updateCustomTableSchema } = await import('../middleware/validation.js');
  const body = validateBody(updateCustomTableSchema, rawBody) as {
    displayName?: string;
    description?: string;
    columns?: ColumnDefinition[];
  };

  const service = getDatabaseService();
  const updated = await service.updateTable(tableId, body);

  if (!updated) {
    return notFoundError(c, 'Table', tableId);
  }

  wsGateway.broadcast('data:changed', { entity: 'custom_table', action: 'updated', id: tableId });

  return apiResponse(c, updated);
});

/**
 * DELETE /custom-data/tables/:table - Delete table and all data
 * Protected tables cannot be deleted through this endpoint.
 */
customDataRoutes.delete('/tables/:table', async (c) => {
  const tableId = c.req.param('table');
  const service = getDatabaseService();

  try {
    const deleted = await service.deleteTable(tableId);

    if (!deleted) {
      return notFoundError(c, 'Table', tableId);
    }

    wsGateway.broadcast('data:changed', { entity: 'custom_table', action: 'deleted', id: tableId });

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
customDataRoutes.get(
  '/tables/:table/records',
  pagination({ defaultLimit: 50, maxLimit: 1000 }),
  async (c) => {
    const tableId = c.req.param('table');
    const { limit, offset } = c.get('pagination')!;
    const filterParam = c.req.query('filter');

    let filter: Record<string, unknown> | undefined;
    if (filterParam) {
      try {
        filter = JSON.parse(filterParam);
      } catch {
        return apiError(
          c,
          { code: ERROR_CODES.INVALID_INPUT, message: 'Invalid JSON in filter parameter' },
          400
        );
      }
    }

    try {
      const service = getDatabaseService();
      const { records, total } = await service.listRecords(tableId, { limit, offset, filter });

      return apiResponse(c, {
        records,
        total,
        limit,
        offset,
        hasMore: offset + records.length < total,
      });
    } catch (err) {
      return apiError(
        c,
        { code: ERROR_CODES.LIST_FAILED, message: getErrorMessage(err, 'Failed to list records') },
        400
      );
    }
  }
);

/**
 * POST /custom-data/tables/:table/records - Add a record
 */
customDataRoutes.post('/tables/:table/records', async (c) => {
  const tableId = c.req.param('table');
  const rawBody = await parseJsonBody(c);
  const { validateBody, createCustomRecordSchema } = await import('../middleware/validation.js');
  const body = validateBody(createCustomRecordSchema, rawBody) as { data: Record<string, unknown> };

  if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
    return apiError(
      c,
      { code: ERROR_CODES.INVALID_REQUEST, message: 'data must be a non-empty object' },
      400
    );
  }

  try {
    const service = getDatabaseService();
    const record = await service.addRecord(tableId, body.data);

    wsGateway.broadcast('data:changed', {
      entity: 'custom_record',
      action: 'created',
      id: record.id,
    });

    return apiResponse(c, record, 201);
  } catch (err) {
    return apiError(
      c,
      { code: ERROR_CODES.ADD_FAILED, message: getErrorMessage(err, 'Failed to add record') },
      400
    );
  }
});

/**
 * GET /custom-data/tables/:table/search - Search records
 */
customDataRoutes.get('/tables/:table/search', async (c) => {
  const tableId = c.req.param('table');
  const query = c.req.query('q') ?? '';
  const limit = getIntParam(c, 'limit', 20, 1, 100);

  if (!query) {
    return apiError(
      c,
      { code: ERROR_CODES.INVALID_REQUEST, message: 'Search query (q) is required' },
      400
    );
  }

  try {
    const service = getDatabaseService();
    const records = await service.searchRecords(tableId, query, { limit });

    return apiResponse(c, records);
  } catch (err) {
    return apiError(
      c,
      {
        code: ERROR_CODES.SEARCH_FAILED,
        message: getErrorMessage(err, 'Failed to search records'),
      },
      400
    );
  }
});

/**
 * GET /custom-data/records/:id - Get a single record
 */
customDataRoutes.get('/records/:id', async (c) => {
  const recordId = c.req.param('id');
  const userId = getUserId(c);
  if ((!userId || userId === 'default') && !c.get('sessionAuthenticated')) {
    return apiError(c, { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' }, 401);
  }
  const service = getDatabaseService();

  const record = await service.getRecord(recordId);
  if (!record) {
    return notFoundError(c, 'Record', recordId);
  }

  // IDOR-007: Verify the table is not protected before returning records
  const table = await service.getTable(record.tableId);
  if (table?.isProtected) {
    return apiError(
      c,
      { code: ERROR_CODES.FORBIDDEN, message: 'Access to protected table records denied' },
      403
    );
  }

  return apiResponse(c, record);
});

/**
 * PUT /custom-data/records/:id - Update a record
 */
customDataRoutes.put('/records/:id', async (c) => {
  const recordId = c.req.param('id');
  const userId = getUserId(c);
  if ((!userId || userId === 'default') && !c.get('sessionAuthenticated')) {
    return apiError(c, { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' }, 401);
  }
  const rawBody = await parseJsonBody(c);
  const { validateBody, updateCustomRecordSchema } = await import('../middleware/validation.js');
  const body = validateBody(updateCustomRecordSchema, rawBody) as { data: Record<string, unknown> };

  if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
    return apiError(
      c,
      { code: ERROR_CODES.INVALID_REQUEST, message: 'data must be a non-empty object' },
      400
    );
  }

  try {
    const service = getDatabaseService();

    // IDOR-007: Enforce ownership before updating
    const existing = await service.getRecord(recordId);
    if (!existing) {
      return notFoundError(c, 'Record', recordId);
    }
    // Verify table is not protected
    const table = await service.getTable(existing.tableId);
    if (table?.isProtected) {
      return apiError(
        c,
        { code: ERROR_CODES.FORBIDDEN, message: 'Access to protected table records denied' },
        403
      );
    }

    const updated = await service.updateRecord(recordId, body.data);

    if (!updated) {
      return notFoundError(c, 'Record', recordId);
    }

    wsGateway.broadcast('data:changed', {
      entity: 'custom_record',
      action: 'updated',
      id: recordId,
    });

    return apiResponse(c, updated);
  } catch (err) {
    return apiError(
      c,
      { code: ERROR_CODES.UPDATE_FAILED, message: getErrorMessage(err, 'Failed to update record') },
      400
    );
  }
});

/**
 * DELETE /custom-data/records/:id - Delete a record
 */
customDataRoutes.delete('/records/:id', async (c) => {
  const recordId = c.req.param('id');
  const userId = getUserId(c);
  if ((!userId || userId === 'default') && !c.get('sessionAuthenticated')) {
    return apiError(c, { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' }, 401);
  }
  const service = getDatabaseService();

  // IDOR-007: Enforce ownership before deleting
  const existing = await service.getRecord(recordId);
  if (!existing) {
    return notFoundError(c, 'Record', recordId);
  }
  // Verify table is not protected
  const table = await service.getTable(existing.tableId);
  if (table?.isProtected) {
    return apiError(
      c,
      { code: ERROR_CODES.FORBIDDEN, message: 'Access to protected table records denied' },
      403
    );
  }

  const deleted = await service.deleteRecord(recordId);
  if (!deleted) {
    return notFoundError(c, 'Record', recordId);
  }

  wsGateway.broadcast('data:changed', { entity: 'custom_record', action: 'deleted', id: recordId });

  return apiResponse(c, { deleted: true });
});

// ============================================================================
// Tool Executors for AI
// ============================================================================
// Moved to tools/custom-data-tools.ts. Re-exported here for legacy callers.
export { executeCustomDataTool } from '../tools/custom-data-tools.js';
