/**
 * Custom Data Tools
 *
 * Structured data operations for AI agents.
 * Provides CRUD operations on user-defined tables without arbitrary code execution.
 * Much safer than code execution - all operations are controlled and auditable.
 */

import type { ToolDefinition } from '../types.js';

// ============================================================================
// TABLE MANAGEMENT TOOLS
// ============================================================================

/**
 * List available custom data tables
 */
export const listCustomTablesTool: ToolDefinition = {
  name: 'list_custom_tables',
  description: `List all custom data tables available for storing user data.
Use this to see what tables exist before adding or querying data.
Returns table names, descriptions, column counts, and record counts.

NOTE: For built-in data types, use dedicated tools instead of custom tables:
bookmarks, tasks, notes, calendar, contacts, expenses, memories, goals, scheduler.`,
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

/**
 * Describe a custom table's schema
 */
export const describeCustomTableTool: ToolDefinition = {
  name: 'describe_custom_table',
  description: `Get detailed information about a custom table including its columns and data types.
Use this before adding or querying records to understand the table structure.`,
  parameters: {
    type: 'object',
    properties: {
      table: {
        type: 'string',
        description: 'The table name (ID) to describe',
      },
    },
    required: ['table'],
  },
};

/**
 * Create a new custom table
 */
export const createCustomTableTool: ToolDefinition = {
  name: 'create_custom_table',
  description: `Create a new custom data table with specified columns.
Use this ONLY for truly custom data types that don't have built-in support.

⚠️ DO NOT use custom tables for these - use the dedicated tools instead:
- BOOKMARKS: Use the bookmarks API (add_bookmark, list_bookmarks, etc.)
- TASKS/TODO: Use the tasks API (add_task, list_tasks, complete_task, etc.)
- NOTES: Use the notes API (add_note, list_notes, etc.)
- CALENDAR/EVENTS: Use the calendar API (add_event, list_events, etc.)
- CONTACTS: Use the contacts API (add_contact, list_contacts, etc.)
- EXPENSES/FINANCE: Use the expense tracker tools (add_expense, query_expenses, etc.)
- MEMORIES: Use the memory tools (remember, recall, etc.)
- GOALS: Use the goal tools (create_goal, update_goal, etc.)
- SCHEDULED TASKS: Use the scheduler tools (create_scheduled_task, etc.)

Custom tables are for user-specific data like: book lending lists, recipe collections,
inventory tracking, workout logs, custom collections, etc.

Column types: text, number, boolean, date, json`,
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Table name (lowercase, no spaces, e.g., "books", "expenses")',
      },
      displayName: {
        type: 'string',
        description: 'Human-readable table name (e.g., "My Books", "Monthly Expenses")',
      },
      description: {
        type: 'string',
        description: 'Description of what this table stores',
      },
      columns: {
        type: 'array',
        description: 'Column definitions for the table',
        items: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Column name (lowercase, no spaces)',
            },
            displayName: {
              type: 'string',
              description: 'Human-readable column name',
            },
            type: {
              type: 'string',
              enum: ['text', 'number', 'boolean', 'date', 'json'],
              description: 'Data type for the column',
            },
            required: {
              type: 'boolean',
              description: 'Whether this column is required',
            },
          },
          required: ['name', 'displayName', 'type'],
        },
      },
    },
    required: ['name', 'displayName', 'columns'],
  },
};

/**
 * Delete a custom table
 */
export const deleteCustomTableTool: ToolDefinition = {
  name: 'delete_custom_table',
  description: `Delete a custom table and ALL its data. This is irreversible!
Only use when the user explicitly asks to delete a table.`,
  parameters: {
    type: 'object',
    properties: {
      table: {
        type: 'string',
        description: 'The table name to delete',
      },
      confirm: {
        type: 'boolean',
        description: 'Must be true to confirm deletion',
      },
    },
    required: ['table', 'confirm'],
  },
};

// ============================================================================
// RECORD MANAGEMENT TOOLS
// ============================================================================

/**
 * Add a record to a custom table
 */
export const addCustomRecordTool: ToolDefinition = {
  name: 'add_custom_record',
  description: `Add a new record to a custom data table.
Use describe_custom_table first to know what columns exist.
The data object should match the table's column schema.`,
  parameters: {
    type: 'object',
    properties: {
      table: {
        type: 'string',
        description: 'The table name to add the record to',
      },
      data: {
        type: 'object',
        description: 'The record data as key-value pairs matching table columns (e.g., {"title": "Book Name", "author": "John Doe"})',
      },
    },
    required: ['table', 'data'],
  },
};

/**
 * Batch add records to a custom table
 */
export const batchAddCustomRecordsTool: ToolDefinition = {
  name: 'batch_add_custom_records',
  description: `Add multiple records to a custom data table at once.
Use this for bulk imports or adding multiple items efficiently.
All records must be for the same table.`,
  parameters: {
    type: 'object',
    properties: {
      table: {
        type: 'string',
        description: 'The table name to add records to',
      },
      records: {
        type: 'array',
        description: 'Array of records to add, each matching the table schema',
        items: {
          type: 'object',
          description: 'Record data as key-value pairs matching table columns',
        },
      },
    },
    required: ['table', 'records'],
  },
};

/**
 * List records from a custom table
 */
export const listCustomRecordsTool: ToolDefinition = {
  name: 'list_custom_records',
  description: `List records from a custom data table with optional filtering.
Use this to show the user their data or to find specific records.`,
  parameters: {
    type: 'object',
    properties: {
      table: {
        type: 'string',
        description: 'The table name to list records from',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of records to return (default: 20)',
      },
      offset: {
        type: 'number',
        description: 'Number of records to skip (for pagination)',
      },
      filter: {
        type: 'object',
        description: 'Filter criteria as column-value pairs (e.g., {"status": "active", "category": "books"})',
      },
    },
    required: ['table'],
  },
};

/**
 * Search records in a custom table
 */
export const searchCustomRecordsTool: ToolDefinition = {
  name: 'search_custom_records',
  description: `Search for records in a custom table using a text query.
Searches across all text columns for matching content.`,
  parameters: {
    type: 'object',
    properties: {
      table: {
        type: 'string',
        description: 'The table name to search in',
      },
      query: {
        type: 'string',
        description: 'Search query text',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results (default: 20)',
      },
    },
    required: ['table', 'query'],
  },
};

/**
 * Get a single record by ID
 */
export const getCustomRecordTool: ToolDefinition = {
  name: 'get_custom_record',
  description: `Get a single record by its ID.
Use this to fetch details of a specific record.`,
  parameters: {
    type: 'object',
    properties: {
      recordId: {
        type: 'string',
        description: 'The record ID to fetch',
      },
    },
    required: ['recordId'],
  },
};

/**
 * Update a record
 */
export const updateCustomRecordTool: ToolDefinition = {
  name: 'update_custom_record',
  description: `Update an existing record with new data.
Only the provided fields will be updated, others remain unchanged.`,
  parameters: {
    type: 'object',
    properties: {
      recordId: {
        type: 'string',
        description: 'The record ID to update',
      },
      data: {
        type: 'object',
        description: 'The fields to update as key-value pairs (e.g., {"status": "returned", "return_date": "2024-01-15"})',
      },
    },
    required: ['recordId', 'data'],
  },
};

/**
 * Delete a record
 */
export const deleteCustomRecordTool: ToolDefinition = {
  name: 'delete_custom_record',
  description: `Delete a record from a custom table.
Use this when the user wants to remove specific data.`,
  parameters: {
    type: 'object',
    properties: {
      recordId: {
        type: 'string',
        description: 'The record ID to delete',
      },
    },
    required: ['recordId'],
  },
};

// ============================================================================
// EXPORT ALL CUSTOM DATA TOOLS
// ============================================================================

export const CUSTOM_DATA_TOOLS: ToolDefinition[] = [
  // Table management
  listCustomTablesTool,
  describeCustomTableTool,
  createCustomTableTool,
  deleteCustomTableTool,
  // Record management
  addCustomRecordTool,
  batchAddCustomRecordsTool,
  listCustomRecordsTool,
  searchCustomRecordsTool,
  getCustomRecordTool,
  updateCustomRecordTool,
  deleteCustomRecordTool,
];

/**
 * Get tool names for custom data operations
 */
export const CUSTOM_DATA_TOOL_NAMES = CUSTOM_DATA_TOOLS.map((t) => t.name);
