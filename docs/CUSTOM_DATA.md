# Custom Data System

The Custom Data system allows the OwnPilot AI agent to create, manage, and query user-defined data tables at runtime. Instead of relying on a fixed schema, the AI can dynamically define table structures with typed columns and then populate them with records -- all stored as JSONB in PostgreSQL for maximum flexibility.

This document covers every layer of the system: database schema, repository, REST API, AI tool definitions, tool executor, and the frontend UI.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Database Schema](#database-schema)
4. [Repository Layer](#repository-layer)
5. [REST API Reference](#rest-api-reference)
6. [AI Tool Definitions](#ai-tool-definitions)
7. [Tool Executor](#tool-executor)
8. [Frontend UI](#frontend-ui)
9. [Data Flow](#data-flow)
10. [Use Cases](#use-cases)
11. [Design Decisions](#design-decisions)
12. [File Reference](#file-reference)

---

## Overview

OwnPilot ships with several built-in data modules (bookmarks, tasks, notes, calendar, contacts, expenses, memories, goals, scheduled tasks). The Custom Data system exists for everything else -- any structured data the user or AI wants to persist that does not already have a dedicated module.

Key properties:

- **AI-driven schema creation.** The agent decides what columns a table needs and creates it on the fly.
- **JSONB storage.** Record data is stored as a single JSONB column, keeping the physical schema uniform while the logical schema varies per table.
- **Full CRUD.** Tables and records can be created, listed, queried, searched, updated, and deleted through both the REST API and AI tool calls.
- **Type safety at the application layer.** Column definitions carry a `type` field (`text`, `number`, `boolean`, `date`, `datetime`, `json`) that is enforced by the repository when adding or updating records.
- **Cascading deletes.** Deleting a table automatically removes all of its records via the `ON DELETE CASCADE` foreign key constraint.

---

## Architecture

```
+-----------------+       +------------------+       +--------------------+
|  AI Agent       |       |  Gateway Server  |       |  PostgreSQL        |
|  (tool calls)   | ----> |  (Hono routes +  | ----> |  (custom_table_    |
|                 |       |   executors)     |       |   schemas +        |
+-----------------+       +------------------+       |   custom_data_     |
                                ^                    |   records)         |
+-----------------+             |                    +--------------------+
|  Frontend UI    | ------------+
|  (React pages)  |   REST /api/v1/custom-data/*
+-----------------+
```

Three access paths reach the same data:

1. **AI tool calls** -- The agent invokes tools like `create_custom_table` or `add_custom_record`. The gateway's tool executor delegates to `executeCustomDataTool()`, which calls the repository.
2. **REST API** -- The Hono route handler at `/api/v1/custom-data` serves the frontend and any external client.
3. **Frontend UI** -- `CustomDataPage.tsx` provides a full table browser, and `DataBrowserPage.tsx` covers built-in data types (not custom tables).

---

## Database Schema

Defined in `packages/gateway/src/db/schema.ts`. Three tables participate in the custom data system.

### `custom_table_schemas`

Stores the metadata (name, display name, column definitions) for every AI-created table.

```sql
CREATE TABLE IF NOT EXISTS custom_table_schemas (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description  TEXT,
  columns      JSONB NOT NULL DEFAULT '[]',
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
);
```

| Column         | Type      | Constraints               | Description                                            |
| -------------- | --------- | ------------------------- | ------------------------------------------------------ |
| `id`           | TEXT      | PRIMARY KEY               | Generated as `table_<timestamp>_<random6>`             |
| `name`         | TEXT      | NOT NULL, UNIQUE          | Machine-readable name, lowercase with underscores only |
| `display_name` | TEXT      | NOT NULL                  | Human-readable name shown in the UI                    |
| `description`  | TEXT      | nullable                  | Optional prose description of the table's purpose      |
| `columns`      | JSONB     | NOT NULL, default `'[]'`  | Array of `ColumnDefinition` objects (see below)        |
| `created_at`   | TIMESTAMP | NOT NULL, default `NOW()` | Row creation timestamp                                 |
| `updated_at`   | TIMESTAMP | NOT NULL, default `NOW()` | Last modification timestamp                            |

**Index:**

```sql
CREATE INDEX IF NOT EXISTS idx_custom_table_schemas_name
  ON custom_table_schemas(name);
```

### `custom_data_records`

Stores the actual data rows. Each record belongs to exactly one table schema.

```sql
CREATE TABLE IF NOT EXISTS custom_data_records (
  id         TEXT PRIMARY KEY,
  table_id   TEXT NOT NULL REFERENCES custom_table_schemas(id) ON DELETE CASCADE,
  data       JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

| Column       | Type      | Constraints                                                 | Description                                    |
| ------------ | --------- | ----------------------------------------------------------- | ---------------------------------------------- |
| `id`         | TEXT      | PRIMARY KEY                                                 | Generated as `rec_<timestamp>_<random6>`       |
| `table_id`   | TEXT      | NOT NULL, FK -> `custom_table_schemas.id` ON DELETE CASCADE | The table this record belongs to               |
| `data`       | JSONB     | NOT NULL, default `'{}'`                                    | The record payload, keys matching column names |
| `created_at` | TIMESTAMP | NOT NULL, default `NOW()`                                   | Row creation timestamp                         |
| `updated_at` | TIMESTAMP | NOT NULL, default `NOW()`                                   | Last modification timestamp                    |

**Index:**

```sql
CREATE INDEX IF NOT EXISTS idx_custom_data_records_table
  ON custom_data_records(table_id);
```

The `ON DELETE CASCADE` constraint means that when a row is removed from `custom_table_schemas`, all corresponding rows in `custom_data_records` are automatically deleted by the database.

### `custom_data` (simple key-value store)

A separate, simpler table for flat key-value pairs scoped to a user. This is not directly managed by the custom table tools described in this document but is part of the broader custom data surface.

```sql
CREATE TABLE IF NOT EXISTS custom_data (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL DEFAULT 'default',
  key        TEXT NOT NULL,
  value      JSONB NOT NULL,
  metadata   JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, key)
);
```

| Column       | Type      | Constraints                    | Description                   |
| ------------ | --------- | ------------------------------ | ----------------------------- |
| `id`         | TEXT      | PRIMARY KEY                    | Unique row identifier         |
| `user_id`    | TEXT      | NOT NULL, default `'default'`  | Owner of this key-value entry |
| `key`        | TEXT      | NOT NULL, UNIQUE per `user_id` | The lookup key                |
| `value`      | JSONB     | NOT NULL                       | The stored value              |
| `metadata`   | JSONB     | default `'{}'`                 | Arbitrary metadata            |
| `created_at` | TIMESTAMP | NOT NULL, default `NOW()`      | Row creation timestamp        |
| `updated_at` | TIMESTAMP | NOT NULL, default `NOW()`      | Last modification timestamp   |

**Indexes:**

```sql
CREATE INDEX IF NOT EXISTS idx_custom_data_user ON custom_data(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_data_key  ON custom_data(user_id, key);
```

### Column Definition Schema (JSONB)

Each element in the `columns` JSONB array of `custom_table_schemas` conforms to the `ColumnDefinition` interface:

```typescript
interface ColumnDefinition {
  name: string; // Column name (lowercase, alphanumeric + underscore)
  type: 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'json';
  required?: boolean; // Whether the column must be present in every record
  defaultValue?: string | number | boolean | null; // Fallback when value is omitted
  description?: string; // Human-readable explanation of this column
}
```

| Field          | Type    | Required | Description                                                                                                                                                     |
| -------------- | ------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`         | string  | Yes      | Internal column name. Only `[a-zA-Z0-9_]` characters are allowed; the repository rejects names with other characters.                                           |
| `type`         | enum    | Yes      | One of `text`, `number`, `boolean`, `date`, `datetime`, `json`. Used by the UI to render appropriate input controls and by the AI tool description for context. |
| `required`     | boolean | No       | When `true`, the repository throws an error if a record is added or updated without this column. Defaults to `false`.                                           |
| `defaultValue` | mixed   | No       | Applied automatically when a record omits this column.                                                                                                          |
| `description`  | string  | No       | Free-text explanation. Not currently enforced but useful for AI comprehension.                                                                                  |

---

## Repository Layer

**File:** `packages/gateway/src/db/repositories/custom-data.ts`

The `CustomDataRepository` class extends `BaseRepository` and provides all database operations. It is instantiated via the factory function `getCustomDataRepository()` (aliased from `createCustomDataRepository()`).

### TypeScript Interfaces

```typescript
interface CustomTableSchema {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  columns: ColumnDefinition[];
  createdAt: string;
  updatedAt: string;
}

interface CustomDataRecord {
  id: string;
  tableId: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
```

### Methods

#### `createTable(name, displayName, columns, description?)`

Creates a new table schema row.

- Sanitizes `name` to lowercase, replacing any non-`[a-z0-9_]` character with `_`.
- Validates every column name against `[^a-zA-Z0-9_]`; throws if invalid.
- Generates the ID as `table_<Date.now()>_<random6chars>`.
- Returns the full `CustomTableSchema` object.

#### `getTable(nameOrId)`

Looks up a table by either its `id` or `name` column (`WHERE id = $1 OR name = $1`).

Returns `CustomTableSchema | null`.

#### `listTables()`

Returns all tables ordered by `display_name`.

#### `updateTable(nameOrId, updates)`

Partial update of `displayName`, `description`, or `columns`. Fetches the existing row, merges the provided fields, and writes back.

Returns the updated `CustomTableSchema` or `null` if not found.

#### `deleteTable(nameOrId)`

Deletes all records for the table first, then deletes the schema row. Returns `boolean`.

Note: The explicit record deletion is a safety measure on top of the `ON DELETE CASCADE` constraint.

#### `addRecord(tableNameOrId, data)`

1. Resolves the table via `getTable()`.
2. Validates that all `required` columns are present.
3. Applies `defaultValue` for any missing optional columns.
4. Generates ID as `rec_<Date.now()>_<random6chars>`.
5. Inserts and returns the full `CustomDataRecord`.

#### `getRecord(recordId)`

Fetches a single record by its primary key. Returns `CustomDataRecord | null`.

#### `listRecords(tableNameOrId, options?)`

Lists records belonging to a table.

**Options:**

| Option     | Type                      | Default | Description                                                               |
| ---------- | ------------------------- | ------- | ------------------------------------------------------------------------- |
| `limit`    | number                    | 100     | Maximum rows to return                                                    |
| `offset`   | number                    | 0       | Pagination offset                                                         |
| `orderBy`  | string                    | --      | (Accepted but currently unused; records are ordered by `created_at DESC`) |
| `orderDir` | `'asc'` \| `'desc'`       | --      | (Accepted but currently unused)                                           |
| `filter`   | `Record<string, unknown>` | --      | Key-value pairs; records where `data[key] !== value` are excluded         |

Returns `{ records: CustomDataRecord[]; total: number }`.

The `total` count is fetched with a separate `COUNT(*)` query. Filtering is applied **in memory** after the SQL fetch, meaning `total` reflects the unfiltered count while the returned `records` array may be shorter.

#### `updateRecord(recordId, data)`

Merges the provided `data` into the existing record's data (`{ ...existing.data, ...data }`), re-validates required columns against the parent table schema, and writes back.

Returns `CustomDataRecord | null`.

#### `deleteRecord(recordId)`

Deletes a single record. Returns `true` if at least one row was affected.

#### `searchRecords(tableNameOrId, query, options?)`

Full-text search across all fields by casting the JSONB `data` column to text and applying a case-insensitive `LIKE`:

```sql
WHERE table_id = $1 AND LOWER(data::text) LIKE $2
```

The search term is wrapped with `%` wildcards on both sides.

**Options:**

| Option  | Type   | Default | Description     |
| ------- | ------ | ------- | --------------- |
| `limit` | number | 50      | Maximum results |

Returns `CustomDataRecord[]`.

#### `getTableStats(tableNameOrId)`

Returns aggregate statistics for a table.

```typescript
{
  recordCount: number;
  firstRecord?: string;  // ISO timestamp of the earliest record
  lastRecord?: string;   // ISO timestamp of the latest record
}
```

Returns `null` if the table does not exist.

---

## REST API Reference

**Base path:** `/api/v1/custom-data`

Mounted in `packages/gateway/src/app.ts`:

```typescript
app.route('/api/v1/custom-data', customDataRoutes);
```

All responses follow the standard envelope:

```json
{
  "success": true,
  "data": { ... }
}
```

Or on error:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message"
  }
}
```

### Table Endpoints

#### `GET /api/v1/custom-data/tables`

List all custom tables with record counts.

**Response** `200 OK`:

```json
{
  "success": true,
  "data": [
    {
      "id": "table_1706000000000_abc123",
      "name": "movies",
      "displayName": "My Movies",
      "description": "Movies I want to watch",
      "columns": [
        { "name": "title", "type": "text", "required": true },
        { "name": "genre", "type": "text" },
        { "name": "rating", "type": "number" }
      ],
      "recordCount": 42,
      "createdAt": "2025-01-23T10:00:00.000Z",
      "updatedAt": "2025-01-23T10:00:00.000Z"
    }
  ]
}
```

#### `POST /api/v1/custom-data/tables`

Create a new custom table.

**Request Body:**

```json
{
  "name": "movies",
  "displayName": "My Movies",
  "description": "Movies I want to watch",
  "columns": [
    { "name": "title", "type": "text", "required": true },
    { "name": "genre", "type": "text" },
    { "name": "rating", "type": "number" }
  ]
}
```

| Field         | Type               | Required | Description                                         |
| ------------- | ------------------ | -------- | --------------------------------------------------- |
| `name`        | string             | Yes      | Machine name (sanitized to lowercase + underscores) |
| `displayName` | string             | Yes      | Human-readable name                                 |
| `description` | string             | No       | Table description                                   |
| `columns`     | ColumnDefinition[] | Yes      | At least one column required                        |

**Response** `201 Created`:

```json
{
  "success": true,
  "data": {
    "id": "table_1706000000000_abc123",
    "name": "movies",
    "displayName": "My Movies",
    "columns": [ ... ],
    "createdAt": "2025-01-23T10:00:00.000Z",
    "updatedAt": "2025-01-23T10:00:00.000Z"
  }
}
```

**Errors:**

| Status | Code              | Cause                                       |
| ------ | ----------------- | ------------------------------------------- |
| 400    | `INVALID_REQUEST` | Missing `name`, `displayName`, or `columns` |
| 400    | `CREATE_FAILED`   | Duplicate name or invalid column names      |

#### `GET /api/v1/custom-data/tables/:table`

Get a single table's schema and statistics.

**Path Parameters:**

| Parameter | Description      |
| --------- | ---------------- |
| `table`   | Table ID or name |

**Response** `200 OK`:

```json
{
  "success": true,
  "data": {
    "id": "table_1706000000000_abc123",
    "name": "movies",
    "displayName": "My Movies",
    "description": "Movies I want to watch",
    "columns": [ ... ],
    "stats": {
      "recordCount": 42,
      "firstRecord": "2025-01-23T10:05:00.000Z",
      "lastRecord": "2025-01-25T14:30:00.000Z"
    },
    "createdAt": "2025-01-23T10:00:00.000Z",
    "updatedAt": "2025-01-23T10:00:00.000Z"
  }
}
```

**Errors:**

| Status | Code        | Cause                |
| ------ | ----------- | -------------------- |
| 404    | `NOT_FOUND` | Table does not exist |

#### `PUT /api/v1/custom-data/tables/:table`

Update a table's display name, description, or column definitions.

**Request Body (all fields optional):**

```json
{
  "displayName": "Updated Name",
  "description": "Updated description",
  "columns": [ ... ]
}
```

**Response** `200 OK` -- returns the updated table.

**Errors:**

| Status | Code        | Cause                |
| ------ | ----------- | -------------------- |
| 404    | `NOT_FOUND` | Table does not exist |

#### `DELETE /api/v1/custom-data/tables/:table`

Delete a table and all of its records. This is irreversible.

**Response** `200 OK`:

```json
{
  "success": true,
  "data": { "deleted": true }
}
```

**Errors:**

| Status | Code        | Cause                |
| ------ | ----------- | -------------------- |
| 404    | `NOT_FOUND` | Table does not exist |

### Record Endpoints

#### `GET /api/v1/custom-data/tables/:table/records`

List records in a table with optional filtering and pagination.

**Query Parameters:**

| Parameter | Type        | Default | Description                                                                    |
| --------- | ----------- | ------- | ------------------------------------------------------------------------------ |
| `limit`   | number      | 50      | Maximum records to return                                                      |
| `offset`  | number      | 0       | Pagination offset                                                              |
| `filter`  | JSON string | --      | URL-encoded JSON object for exact-match filtering (e.g., `{"genre":"sci-fi"}`) |

**Response** `200 OK`:

```json
{
  "success": true,
  "data": {
    "records": [
      {
        "id": "rec_1706000001000_xyz789",
        "tableId": "table_1706000000000_abc123",
        "data": {
          "title": "Blade Runner 2049",
          "genre": "sci-fi",
          "rating": 8.5
        },
        "createdAt": "2025-01-23T10:05:00.000Z",
        "updatedAt": "2025-01-23T10:05:00.000Z"
      }
    ],
    "total": 42,
    "limit": 50,
    "offset": 0,
    "hasMore": false
  }
}
```

**Errors:**

| Status | Code          | Cause                          |
| ------ | ------------- | ------------------------------ |
| 400    | `LIST_FAILED` | Table not found or query error |

#### `POST /api/v1/custom-data/tables/:table/records`

Add a single record.

**Request Body:**

```json
{
  "data": {
    "title": "Dune",
    "genre": "sci-fi",
    "rating": 9.0
  }
}
```

**Response** `201 Created`:

```json
{
  "success": true,
  "data": {
    "id": "rec_1706000002000_def456",
    "tableId": "table_1706000000000_abc123",
    "data": { "title": "Dune", "genre": "sci-fi", "rating": 9.0 },
    "createdAt": "2025-01-23T10:10:00.000Z",
    "updatedAt": "2025-01-23T10:10:00.000Z"
  }
}
```

**Errors:**

| Status | Code              | Cause                                       |
| ------ | ----------------- | ------------------------------------------- |
| 400    | `INVALID_REQUEST` | Missing `data` field                        |
| 400    | `ADD_FAILED`      | Table not found, or required column missing |

#### `GET /api/v1/custom-data/tables/:table/search`

Full-text search across all columns in a table.

**Query Parameters:**

| Parameter | Type   | Required | Description                   |
| --------- | ------ | -------- | ----------------------------- |
| `q`       | string | Yes      | Search query                  |
| `limit`   | number | No       | Maximum results (default: 20) |

**Response** `200 OK`:

```json
{
  "success": true,
  "data": [
    {
      "id": "rec_...",
      "tableId": "table_...",
      "data": { ... },
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

**Errors:**

| Status | Code              | Cause                 |
| ------ | ----------------- | --------------------- |
| 400    | `INVALID_REQUEST` | Missing `q` parameter |
| 400    | `SEARCH_FAILED`   | Table not found       |

#### `GET /api/v1/custom-data/records/:id`

Get a single record by its ID.

**Response** `200 OK`:

```json
{
  "success": true,
  "data": {
    "id": "rec_...",
    "tableId": "table_...",
    "data": { ... },
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

**Errors:**

| Status | Code        | Cause                 |
| ------ | ----------- | --------------------- |
| 404    | `NOT_FOUND` | Record does not exist |

#### `PUT /api/v1/custom-data/records/:id`

Update a record. Only the provided fields are merged; existing fields not mentioned are preserved.

**Request Body:**

```json
{
  "data": {
    "rating": 9.5
  }
}
```

**Response** `200 OK` -- returns the full updated record.

**Errors:**

| Status | Code              | Cause                           |
| ------ | ----------------- | ------------------------------- |
| 400    | `INVALID_REQUEST` | Missing `data` field            |
| 400    | `UPDATE_FAILED`   | Required field removed by merge |
| 404    | `NOT_FOUND`       | Record does not exist           |

#### `DELETE /api/v1/custom-data/records/:id`

Delete a single record.

**Response** `200 OK`:

```json
{
  "success": true,
  "data": { "deleted": true }
}
```

**Errors:**

| Status | Code        | Cause                 |
| ------ | ----------- | --------------------- |
| 404    | `NOT_FOUND` | Record does not exist |

---

## AI Tool Definitions

**File:** `packages/core/src/agent/tools/custom-data.ts`

All 11 tools are exported as the `CUSTOM_DATA_TOOLS` array and registered with the agent's tool registry at startup.

### Table Management Tools

#### `list_custom_tables`

List all custom data tables. Returns table names, descriptions, column counts, and record counts.

**Parameters:** None.

**Return shape (from executor):**

```json
{
  "message": "Found 3 custom table(s).",
  "tables": [
    {
      "name": "movies",
      "displayName": "My Movies",
      "description": "Movies I want to watch",
      "columnCount": 3,
      "recordCount": 42
    }
  ]
}
```

---

#### `describe_custom_table`

Get detailed schema information about a single table, including column definitions and statistics.

**Parameters:**

| Name    | Type   | Required | Description      |
| ------- | ------ | -------- | ---------------- |
| `table` | string | Yes      | Table name or ID |

**Return shape:**

```json
{
  "message": "Table \"My Movies\" has 3 columns and 42 records.",
  "table": {
    "id": "table_...",
    "name": "movies",
    "displayName": "My Movies",
    "columns": [ ... ],
    "stats": {
      "recordCount": 42,
      "firstRecord": "2025-01-23T10:05:00.000Z",
      "lastRecord": "2025-01-25T14:30:00.000Z"
    }
  }
}
```

---

#### `create_custom_table`

Create a new table with a defined column schema.

The tool description includes an explicit warning to the AI: do not create custom tables for data types that already have dedicated built-in tools (bookmarks, tasks, notes, calendar, contacts, expenses, memories, goals, scheduled tasks).

**Parameters:**

| Name          | Type   | Required | Description                                          |
| ------------- | ------ | -------- | ---------------------------------------------------- |
| `name`        | string | Yes      | Machine name (lowercase, no spaces, e.g., `"books"`) |
| `displayName` | string | Yes      | Human-readable name (e.g., `"My Books"`)             |
| `description` | string | No       | What this table stores                               |
| `columns`     | array  | Yes      | Array of column definition objects                   |

Each column object:

| Name          | Type    | Required | Description                                         |
| ------------- | ------- | -------- | --------------------------------------------------- |
| `name`        | string  | Yes      | Column name (lowercase, no spaces)                  |
| `displayName` | string  | Yes      | Human-readable column name                          |
| `type`        | string  | Yes      | One of: `text`, `number`, `boolean`, `date`, `json` |
| `required`    | boolean | No       | Whether the column is mandatory                     |

**Return shape:**

```json
{
  "message": "Created table \"My Books\" with 4 columns.",
  "table": { ... }
}
```

---

#### `delete_custom_table`

Delete a table and all its records. Requires explicit confirmation.

**Parameters:**

| Name      | Type    | Required | Description               |
| --------- | ------- | -------- | ------------------------- |
| `table`   | string  | Yes      | Table name to delete      |
| `confirm` | boolean | Yes      | Must be `true` to proceed |

**Return shape:**

```json
{
  "message": "Deleted table \"My Books\" and all its data."
}
```

---

### Record Management Tools

#### `add_custom_record`

Add a single record to a table.

**Parameters:**

| Name    | Type   | Required | Description                                                                           |
| ------- | ------ | -------- | ------------------------------------------------------------------------------------- |
| `table` | string | Yes      | Table name or ID                                                                      |
| `data`  | object | Yes      | Key-value pairs matching the table's columns (e.g., `{"title": "Dune", "rating": 9}`) |

**Return shape:**

```json
{
  "message": "Added new record to \"My Movies\".",
  "record": {
    "id": "rec_...",
    "tableId": "table_...",
    "data": { ... },
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

---

#### `batch_add_custom_records`

Add multiple records to a table in one call.

**Parameters:**

| Name      | Type   | Required | Description                                           |
| --------- | ------ | -------- | ----------------------------------------------------- |
| `table`   | string | Yes      | Table name or ID                                      |
| `records` | array  | Yes      | Array of data objects, each matching the table schema |

**Return shape:**

```json
{
  "message": "Added 5 record(s) to \"My Movies\".",
  "records": [ ... ],
  "count": 5
}
```

Records are inserted sequentially (not in a single transaction). If one record fails validation, earlier records will already have been committed.

---

#### `list_custom_records`

List records with optional filtering and pagination.

**Parameters:**

| Name     | Type   | Required | Default | Description                                                            |
| -------- | ------ | -------- | ------- | ---------------------------------------------------------------------- |
| `table`  | string | Yes      | --      | Table name or ID                                                       |
| `limit`  | number | No       | 20      | Maximum records to return                                              |
| `offset` | number | No       | 0       | Pagination offset                                                      |
| `filter` | object | No       | --      | Exact-match filter as column-value pairs (e.g., `{"genre": "sci-fi"}`) |

**Return shape:**

```json
{
  "message": "Found 42 record(s) in \"My Movies\". Showing 20.",
  "records": [
    { "id": "rec_...", "title": "Dune", "genre": "sci-fi", "rating": 9, "_createdAt": "..." }
  ],
  "total": 42,
  "hasMore": true
}
```

Note: The executor flattens each record into `{ id, ...data, _createdAt }` for easier consumption by the AI.

---

#### `search_custom_records`

Full-text search across all text values in a table's records.

**Parameters:**

| Name    | Type   | Required | Default | Description      |
| ------- | ------ | -------- | ------- | ---------------- |
| `table` | string | Yes      | --      | Table name or ID |
| `query` | string | Yes      | --      | Search text      |
| `limit` | number | No       | 20      | Maximum results  |

**Return shape:**

```json
{
  "message": "Found 3 record(s) matching \"dune\" in \"My Movies\".",
  "records": [
    { "id": "rec_...", "title": "Dune", "genre": "sci-fi", "rating": 9, "_createdAt": "..." }
  ]
}
```

---

#### `get_custom_record`

Retrieve a single record by its ID.

**Parameters:**

| Name       | Type   | Required | Description   |
| ---------- | ------ | -------- | ------------- |
| `recordId` | string | Yes      | The record ID |

**Return shape:**

```json
{
  "message": "Record found.",
  "record": {
    "id": "rec_...",
    "title": "Dune",
    "genre": "sci-fi",
    "rating": 9,
    "_createdAt": "...",
    "_updatedAt": "..."
  }
}
```

---

#### `update_custom_record`

Partially update a record. Only the provided fields are changed; all other fields remain intact.

**Parameters:**

| Name       | Type   | Required | Description                               |
| ---------- | ------ | -------- | ----------------------------------------- |
| `recordId` | string | Yes      | The record ID to update                   |
| `data`     | object | Yes      | Fields to update (e.g., `{"rating": 10}`) |

**Return shape:**

```json
{
  "message": "Record updated.",
  "record": {
    "id": "rec_...",
    "title": "Dune",
    "genre": "sci-fi",
    "rating": 10,
    "_updatedAt": "..."
  }
}
```

---

#### `delete_custom_record`

Delete a single record.

**Parameters:**

| Name       | Type   | Required | Description             |
| ---------- | ------ | -------- | ----------------------- |
| `recordId` | string | Yes      | The record ID to delete |

**Return shape:**

```json
{
  "message": "Record deleted."
}
```

---

## Tool Executor

**File:** `packages/gateway/src/routes/custom-data.ts` (function `executeCustomDataTool`)

The executor is the bridge between AI tool calls and the repository. It is a single `async function` that switches on the tool name, extracts parameters, calls the appropriate repository method, and returns a standardized `ToolExecutionResult`:

```typescript
interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
}
```

The executor is imported and wired up in three places:

1. **`packages/gateway/src/routes/agents.ts`** -- The main chat agent registers each `CUSTOM_DATA_TOOLS` entry with a wrapper that calls `executeCustomDataTool()` and converts the result into a `CoreToolResult`.
2. **`packages/gateway/src/services/tool-executor.ts`** -- The centralized tool executor service, used for background and automated tool execution, registers the same tools.
3. **`packages/gateway/src/services/tool-source.ts`** -- The tool source registry maps custom data tool names to the executor module for dynamic tool resolution.

In every registration site, the pattern is identical:

```typescript
for (const toolDef of CUSTOM_DATA_TOOLS) {
  tools.register(toolDef, async (args): Promise<CoreToolResult> => {
    const result = await executeCustomDataTool(toolDef.name, args);
    if (result.success) {
      return { content: JSON.stringify(result.result) };
    } else {
      return { content: result.error ?? 'Unknown error', isError: true };
    }
  });
}
```

---

## Frontend UI

### CustomDataPage (`packages/ui/src/pages/CustomDataPage.tsx`)

This is the primary interface for users to browse and manage custom tables and their records.

**Layout:**

- **Header** -- Shows the total table count and a "New Table" button.
- **Sidebar** (left, 256px) -- Lists all tables with their display names and record counts. Clicking a table selects it.
- **Main area** (right) -- Shows the selected table's records in a data grid, or a placeholder prompting the user to select or create a table.

**Features:**

- **Create Table modal** -- Form with fields for table name, display name, description, and a dynamic list of column definitions (name, type, required checkbox). Columns can be added or removed.
- **Add/Edit Record modal** -- Dynamically renders input controls based on the selected table's column types:
  - `text` -> `<input type="text">`
  - `number` -> `<input type="number">`
  - `boolean` -> `<select>` with Yes/No/empty options
  - `date` -> `<input type="date">`
  - `datetime` -> `<input type="datetime-local">`
  - `json` -> `<textarea>` with JSON parsing
- **Search** -- A text input that triggers `GET /tables/:table/search?q=...` on every keystroke change.
- **Delete table** -- Confirmation dialog before calling `DELETE /tables/:table`.
- **Delete record** -- Confirmation dialog before calling `DELETE /records/:id`.
- **Edit record** -- Opens the Record modal pre-populated with the existing data.

**API calls made by this page:**

| Action         | Method | Endpoint                                           |
| -------------- | ------ | -------------------------------------------------- |
| Load tables    | GET    | `/api/v1/custom-data/tables`                       |
| Create table   | POST   | `/api/v1/custom-data/tables`                       |
| Delete table   | DELETE | `/api/v1/custom-data/tables/:id`                   |
| Load records   | GET    | `/api/v1/custom-data/tables/:id/records?limit=100` |
| Search records | GET    | `/api/v1/custom-data/tables/:id/search?q=...`      |
| Add record     | POST   | `/api/v1/custom-data/tables/:id/records`           |
| Update record  | PUT    | `/api/v1/custom-data/records/:id`                  |
| Delete record  | DELETE | `/api/v1/custom-data/records/:id`                  |

### DataBrowserPage (`packages/ui/src/pages/DataBrowserPage.tsx`)

This page is a companion that covers the **built-in** data types (tasks, bookmarks, notes, calendar, contacts). It does not manage custom tables but shares a similar tabular UI pattern. Custom tables are intentionally separated into their own page to keep the distinction clear.

---

## Data Flow

### AI Creates a Table

```
1. User: "Track my movie watchlist with title, genre, and rating"
2. AI decides to call `create_custom_table`
   -> name: "movies"
   -> displayName: "Movie Watchlist"
   -> description: "Movies to watch"
   -> columns: [
        { name: "title", displayName: "Title", type: "text", required: true },
        { name: "genre", displayName: "Genre", type: "text" },
        { name: "rating", displayName: "Rating", type: "number" }
      ]
3. Gateway: executeCustomDataTool("create_custom_table", params)
4. Repository: INSERT INTO custom_table_schemas (...)
5. AI receives: { message: "Created table \"Movie Watchlist\" with 3 columns.", table: { ... } }
6. AI responds to user confirming creation
```

### AI Adds Records

```
1. User: "Add Dune (sci-fi, 9/10) and Interstellar (sci-fi, 9.5/10)"
2. AI calls `batch_add_custom_records`
   -> table: "movies"
   -> records: [
        { title: "Dune", genre: "sci-fi", rating: 9 },
        { title: "Interstellar", genre: "sci-fi", rating: 9.5 }
      ]
3. Gateway: executeCustomDataTool("batch_add_custom_records", params)
4. Repository: For each record -> validate required fields, apply defaults, INSERT
5. AI receives: { message: "Added 2 record(s) to \"Movie Watchlist\".", count: 2 }
```

### AI Queries Data

```
1. User: "What sci-fi movies do I have?"
2. AI calls `list_custom_records`
   -> table: "movies"
   -> filter: { genre: "sci-fi" }
3. Gateway: executeCustomDataTool("list_custom_records", params)
4. Repository: SELECT * FROM custom_data_records WHERE table_id = ... + in-memory filter
5. AI receives: { records: [...], total: 42, hasMore: true }
6. AI formats and presents the results to the user
```

### User Browses via UI

```
1. User navigates to Custom Data page
2. React: GET /api/v1/custom-data/tables -> renders sidebar
3. User clicks "Movie Watchlist"
4. React: GET /api/v1/custom-data/tables/{id}/records?limit=100 -> renders data grid
5. User types in search box: "dune"
6. React: GET /api/v1/custom-data/tables/{id}/search?q=dune -> updates grid
```

---

## Use Cases

| Scenario             | Table Name      | Example Columns                                                                                          |
| -------------------- | --------------- | -------------------------------------------------------------------------------------------------------- |
| Movie watchlist      | `movies`        | `title` (text, required), `genre` (text), `rating` (number), `watched` (boolean)                         |
| Recipe collection    | `recipes`       | `name` (text, required), `ingredients` (json), `steps` (json), `cooking_time` (number), `cuisine` (text) |
| Book lending tracker | `book_lending`  | `book_title` (text, required), `borrower` (text, required), `lent_date` (date), `returned` (boolean)     |
| Research results     | `research`      | `topic` (text, required), `source` (text), `findings` (text), `date` (date), `relevance` (number)        |
| Workout log          | `workouts`      | `exercise` (text, required), `sets` (number), `reps` (number), `weight` (number), `date` (date)          |
| Inventory tracking   | `inventory`     | `item` (text, required), `quantity` (number), `location` (text), `last_checked` (date)                   |
| Project ideas        | `project_ideas` | `title` (text, required), `description` (text), `priority` (text), `status` (text), `tags` (json)        |
| Knowledge base       | `knowledge`     | `topic` (text, required), `content` (text, required), `source` (text), `confidence` (number)             |

The AI should prefer built-in modules when applicable:

- Bookmarks -> `add_bookmark`, `list_bookmarks`
- Tasks/TODO -> `add_task`, `list_tasks`, `complete_task`
- Notes -> `add_note`, `list_notes`
- Calendar events -> `add_event`, `list_events`
- Contacts -> `add_contact`, `list_contacts`
- Expenses -> `add_expense`, `query_expenses`
- Memories -> `remember`, `recall`
- Goals -> `create_goal`, `update_goal`

Custom tables are the correct choice when the data does not fit any of the above.

---

## Design Decisions

### Why JSONB instead of dynamic ALTER TABLE?

Physical schema changes (`ALTER TABLE ADD COLUMN`) are risky in a user-facing system where the AI decides the schema. JSONB provides:

- Zero-downtime schema evolution (columns are just keys in the JSON).
- No migration scripts needed when the AI adds or removes columns.
- PostgreSQL still supports indexing JSONB paths if performance becomes a concern.

The trade-off is that type enforcement and constraints live in the application layer (the repository's `addRecord` and `updateRecord` methods) rather than in the database itself.

### Why separate `custom_table_schemas` and `custom_data_records`?

Keeping schema metadata separate from record data allows:

- Efficient listing of tables without scanning records.
- Clean cascading deletes via the foreign key.
- The ability to update a table's schema (e.g., add a column) without touching existing records.

### Why in-memory filtering?

The `listRecords` method fetches rows from the database and then applies the `filter` parameter in JavaScript. This simplifies the query builder (no need to construct dynamic `WHERE data->>'key' = $N` clauses) and works well for the expected data volumes (hundreds to low thousands of records per table). For larger datasets, JSONB path queries could be added as an optimization.

### Why does `delete_custom_table` require a `confirm` parameter?

This is a safety mechanism for the AI. The tool description explicitly warns that deletion is irreversible, and the executor rejects the call unless `confirm` is set to `true`. This gives the AI an extra friction point to avoid accidental data loss.

### ID generation strategy

Both table IDs (`table_<timestamp>_<random>`) and record IDs (`rec_<timestamp>_<random>`) are generated in application code rather than using database sequences or UUIDs. The timestamp prefix provides natural rough ordering, and the random suffix prevents collisions.

---

## File Reference

| File                                                   | Purpose                                                                                 |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `packages/core/src/agent/tools/custom-data.ts`         | AI tool definitions (11 tools) and `CUSTOM_DATA_TOOLS` export                           |
| `packages/gateway/src/services/custom-data-service.ts` | CustomDataService -- business logic layer for custom data operations, EventBus emission |
| `packages/gateway/src/routes/custom-data.ts`           | Hono REST routes (thin HTTP handler, delegates to CustomDataService)                    |
| `packages/gateway/src/db/repositories/custom-data.ts`  | `CustomDataRepository` class with all database operations                               |
| `packages/gateway/src/db/schema.ts`                    | SQL DDL for `custom_table_schemas`, `custom_data_records`, and `custom_data`            |
| `packages/gateway/src/app.ts`                          | Mounts routes at `/api/v1/custom-data`                                                  |
| `packages/gateway/src/routes/index.ts`                 | Re-exports `customDataRoutes` and `executeCustomDataTool`                               |
| `packages/gateway/src/routes/agents.ts`                | Registers custom data tools with the chat agent                                         |
| `packages/gateway/src/services/tool-executor.ts`       | Registers custom data tools in the centralized executor                                 |
| `packages/gateway/src/services/tool-source.ts`         | Maps custom data tool names for dynamic resolution                                      |
| `packages/ui/src/pages/CustomDataPage.tsx`             | React UI for browsing custom tables and records                                         |
| `packages/ui/src/pages/DataBrowserPage.tsx`            | React UI for built-in data types (companion page)                                       |
