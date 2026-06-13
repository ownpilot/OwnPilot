/**
 * Custom Data Tool Executor
 *
 * Execute the LLM-facing custom-table tools (create_custom_table,
 * add_custom_record, search_custom_records, etc.) by delegating to the
 * DatabaseService.
 *
 * Extracted from `routes/custom-data.ts` so the tool registry doesn't have
 * to reach back into the routes/ layer for executors.
 */

import { getDatabaseService } from '@ownpilot/core/services';
import type { ColumnDefinition } from '../db/repositories/custom/data.js';
import { CustomDataServiceError } from '../services/custom/data-service.js';
import { sanitizeId, sanitizeText, getErrorMessage } from '../utils/common.js';
import type { ToolExecutionResult } from '../services/tool/executor.js';

/**
 * Execute custom data tool — delegates to CustomDataService.
 */
export async function executeCustomDataTool(
  toolId: string,
  params: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const service = getDatabaseService();

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
            message: `Created table "${sanitizeText(table.displayName)}" with ${columns.length} columns.`,
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
              recordCount: t.stats.recordCount,
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
          return { success: false, error: `Table not found: ${sanitizeId(tableId)}` };
        }
        const stats = await service.getTableStats(table.id);
        return {
          success: true,
          result: {
            message: `Table "${sanitizeText(table.displayName)}" has ${table.columns.length} columns and ${stats?.recordCount ?? 0} records.`,
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
        const table = await service.getTable(tableId);
        if (!table) {
          return { success: false, error: `Table not found: ${sanitizeId(tableId)}` };
        }
        const displayName = table.displayName;

        await service.deleteTable(tableId);

        return {
          success: true,
          result: {
            message: `Deleted table "${sanitizeText(displayName)}" and all its data.`,
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
            message: `Added new record to "${sanitizeText(table?.displayName ?? tableId)}".`,
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
            message: `Added ${results.length} record(s) to "${sanitizeText(table?.displayName ?? tableId)}".`,
            records: results,
            count: results.length,
          },
        };
      }

      case 'list_custom_records': {
        const {
          table: tableId,
          limit = 20,
          offset = 0,
          filter,
        } = params as {
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
            message: `Found ${total} record(s) in "${sanitizeText(table?.displayName ?? tableId)}". Showing ${records.length}.`,
            records: records.map((r) => ({ id: r.id, ...r.data, _createdAt: r.createdAt })),
            total,
            hasMore: offset + records.length < total,
          },
        };
      }

      case 'search_custom_records': {
        const {
          table: tableId,
          query,
          limit = 20,
        } = params as {
          table: string;
          query: string;
          limit?: number;
        };
        const records = await service.searchRecords(tableId, query, { limit });
        const table = await service.getTable(tableId);
        return {
          success: true,
          result: {
            message: `Found ${records.length} record(s) matching "${sanitizeText(query)}" in "${sanitizeText(table?.displayName ?? tableId)}".`,
            records: records.map((r) => ({ id: r.id, ...r.data, _createdAt: r.createdAt })),
          },
        };
      }

      case 'get_custom_record': {
        const { recordId } = params as { recordId: string };
        const record = await service.getRecord(recordId);
        if (!record) {
          return { success: false, error: `Record not found: ${sanitizeId(recordId)}` };
        }
        return {
          success: true,
          result: {
            message: 'Record found.',
            record: {
              id: record.id,
              ...record.data,
              _createdAt: record.createdAt,
              _updatedAt: record.updatedAt,
            },
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
          return { success: false, error: `Record not found: ${sanitizeId(recordId)}` };
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
          return { success: false, error: `Record not found: ${sanitizeId(recordId)}` };
        }
        return {
          success: true,
          result: {
            message: 'Record deleted.',
          },
        };
      }

      default:
        return { success: false, error: `Unknown tool: ${sanitizeId(toolId)}` };
    }
  } catch (err) {
    if (err instanceof CustomDataServiceError) {
      return { success: false, error: err.message };
    }
    return {
      success: false,
      error: getErrorMessage(err),
    };
  }
}
