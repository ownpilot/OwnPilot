# Custom Tools System

OwnPilot supports a dynamic custom tools system that allows both the LLM agent and human users to create, manage, and execute reusable tools at runtime. Custom tools are JavaScript functions stored in the database, sandboxed for security, and integrated seamlessly into the agent's tool catalog so they can be invoked in any conversation.

This document covers the full architecture, lifecycle, security model, API surface, and extension points of the custom tools system.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Database Schema](#database-schema)
4. [Core Types](#core-types)
5. [Tool Lifecycle](#tool-lifecycle)
6. [Meta-Tools (LLM Interface)](#meta-tools-llm-interface)
7. [Sandbox Execution Engine](#sandbox-execution-engine)
8. [Security Model](#security-model)
9. [Sandbox Utility Helpers](#sandbox-utility-helpers)
10. [Config Center Integration](#config-center-integration)
11. [Gateway REST API](#gateway-rest-api)
12. [UI Management (CustomToolsPage)](#ui-management-customtoolspage)
13. [Dynamic Tool Registry](#dynamic-tool-registry)
14. [Writing Custom Tool Code](#writing-custom-tool-code)
15. [Examples](#examples)
16. [Troubleshooting](#troubleshooting)

---

## Overview

The custom tools system bridges three layers of the OwnPilot stack:

```
+---------------------+       +---------------------+       +---------------------+
|   @ownpilot/core    |       |  @ownpilot/gateway   |       |    @ownpilot/ui      |
|                     |       |                     |       |                     |
| DynamicToolRegistry |<----->| CustomToolsRepo     |<----->| CustomToolsPage.tsx |
| SandboxExecutor     |       | REST routes         |       | Create / Test / UI  |
| Meta-tool defs      |       | Meta-tool executors  |       |                     |
+---------------------+       +---------------------+       +---------------------+
```

| Layer | Package | Responsibility |
|-------|---------|----------------|
| Core | `packages/core` | Type definitions, sandbox execution, registry, meta-tool schemas |
| Gateway | `packages/gateway` | Database persistence, REST API, meta-tool executors, Config Center integration |
| UI | `packages/ui` | Visual management page for creating, testing, approving, and deleting tools |

---

## Architecture

### Data Flow: Creating a Custom Tool via the LLM

```
User: "Create a tool that fetches weather data"
       |
       v
  LLM decides to call create_tool meta-tool
       |
       v
  Gateway: executeCustomToolTool('create_tool', params, userId)
       |
       +--> Validate name format (^[a-z][a-z0-9_]*$)
       +--> Validate code (dangerous pattern scan)
       +--> Check for name conflicts
       +--> Determine status: 'active' or 'pending_approval'
       +--> Insert into custom_tools table
       +--> Register API dependencies in Config Center
       +--> Sync to DynamicToolRegistry (if active)
       +--> Invalidate agent cache
       |
       v
  Tool is now available in the agent's tool catalog
```

### Data Flow: Executing a Custom Tool

```
LLM calls custom tool by name (e.g., fetch_weather)
       |
       v
  Gateway: executeActiveCustomTool('fetch_weather', args, userId)
       |
       +--> Fetch tool record from database
       +--> Verify status is 'active'
       +--> Sync tool to DynamicToolRegistry
       |
       v
  DynamicToolRegistry.execute(name, args, context)
       |
       +--> Map permissions to SandboxPermissions
       +--> Create SandboxExecutor with resource limits
       +--> Inject globals (args, context, utils, fetch, console)
       +--> Wrap code in async IIFE
       +--> Execute via Node.js vm module with timeout
       |
       v
  Return ToolExecutionResult
       |
       +--> Record usage (increment usage_count, update last_used_at)
       +--> Return result to LLM
```

---

## Database Schema

Custom tools are stored in the `custom_tools` table. The schema is defined in the PostgreSQL migration at `packages/gateway/src/db/migrations/postgres/001_initial_schema.sql`.

```sql
CREATE TABLE IF NOT EXISTS custom_tools (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL DEFAULT 'default',
  name              TEXT NOT NULL,
  description       TEXT NOT NULL,
  parameters        JSONB NOT NULL,
  code              TEXT NOT NULL,
  category          TEXT,
  permissions       JSONB DEFAULT '[]'::jsonb,
  status            TEXT NOT NULL DEFAULT 'active'
                      CHECK(status IN ('active', 'disabled', 'pending_approval', 'rejected')),
  requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
  created_by        TEXT NOT NULL DEFAULT 'user',
  execution_count   INTEGER NOT NULL DEFAULT 0,
  last_executed_at  TIMESTAMP WITH TIME ZONE,
  created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, name)
);
```

### Indexes

```sql
CREATE INDEX IF NOT EXISTS idx_custom_tools_user   ON custom_tools(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_tools_name   ON custom_tools(user_id, name);
CREATE INDEX IF NOT EXISTS idx_custom_tools_status ON custom_tools(status);
```

### Column Reference

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | Primary key. Format: `tool_<16-char-hex>` (e.g., `tool_a1b2c3d4e5f67890`) |
| `user_id` | TEXT | Owner user ID. Defaults to `'default'`. All queries are scoped to this user. |
| `name` | TEXT | Unique tool name within the user scope. Must match `^[a-z][a-z0-9_]*$`. |
| `description` | TEXT | Human-readable description shown to the LLM and in the UI. |
| `parameters` | JSONB | JSON Schema object describing the tool's input parameters. |
| `code` | TEXT | JavaScript source code executed in the sandbox. |
| `category` | TEXT | Optional category for UI grouping (e.g., `"Weather"`, `"Utilities"`). |
| `permissions` | JSONB | Array of permission strings the tool requires. |
| `status` | TEXT | One of: `active`, `disabled`, `pending_approval`, `rejected`. |
| `requires_approval` | BOOLEAN | If true, each execution requires user confirmation. |
| `created_by` | TEXT | Either `'user'` (created via UI/API) or `'llm'` (created by the agent). |
| `execution_count` | INTEGER | Total number of times this tool has been executed. |
| `last_executed_at` | TIMESTAMPTZ | Timestamp of the most recent execution. |
| `created_at` | TIMESTAMPTZ | When the tool was created. |
| `updated_at` | TIMESTAMPTZ | When the tool was last modified. |

**Note:** The repository layer (`CustomToolsRepository`) also handles `version`, `metadata`, and `requiredApiKeys` fields that are stored in extended columns managed through application-level logic. The `version` field is auto-incremented on code or parameter changes. The `requiredApiKeys` field stores API service dependencies as JSON.

---

## Core Types

All core types are defined in `packages/core/src/agent/tools/dynamic-tools.ts`.

### DynamicToolPermission

```typescript
type DynamicToolPermission =
  | 'network'      // HTTP requests via fetch
  | 'filesystem'   // File read/write access
  | 'database'     // Custom data access (handled via injected APIs)
  | 'shell'        // Shell command execution
  | 'email'        // Send emails (handled via injected APIs)
  | 'scheduling';  // Create scheduled tasks (handled via injected APIs)
```

### DynamicToolDefinition

The core interface for a custom tool's in-memory representation:

```typescript
interface DynamicToolDefinition {
  /** Unique tool name (lowercase, underscores, starts with letter) */
  name: string;
  /** Human-readable description */
  description: string;
  /** JSON Schema for parameters */
  parameters: {
    type: 'object';
    properties: Record<string, JSONSchemaProperty>;
    required?: string[];
  };
  /** JavaScript code that implements the tool */
  code: string;
  /** Tool category for organization */
  category?: string;
  /** Required permissions */
  permissions?: DynamicToolPermission[];
  /** Whether this tool requires user approval before each execution */
  requiresApproval?: boolean;
  /** API keys this tool requires */
  requiredApiKeys?: RequiredApiKey[];
}
```

### RequiredApiKey (deprecated -- use RequiredConfigService)

```typescript
interface RequiredApiKey {
  /** Service name (used as lookup key in Config Center) */
  name: string;
  /** Human-readable display name */
  displayName?: string;
  /** Description of what this API key is used for */
  description?: string;
  /** Category for grouping in Config Center */
  category?: string;
  /** Link to the API provider's docs/signup page */
  docsUrl?: string;
}
```

### RequiredConfigService

The modern replacement for `RequiredApiKey`, supporting rich config schemas:

```typescript
interface RequiredConfigService {
  /** Service name (lookup key in Config Center) */
  name: string;
  /** Human-readable display name */
  displayName?: string;
  /** Description */
  description?: string;
  /** Category for grouping */
  category?: string;
  /** Link to API docs/signup page */
  docsUrl?: string;
  /** Whether this service supports multiple entries */
  multiEntry?: boolean;
  /** Config schema (if not provided, defaults to api_key + base_url) */
  configSchema?: ConfigFieldDefinition[];
}
```

### CustomToolRecord (Database Record)

The full record shape returned from the repository layer:

```typescript
interface CustomToolRecord {
  id: string;
  userId: string;
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  code: string;
  category?: string;
  status: ToolStatus;               // 'active' | 'disabled' | 'pending_approval' | 'rejected'
  permissions: ToolPermission[];
  requiresApproval: boolean;
  createdBy: 'user' | 'llm';
  version: number;
  usageCount: number;
  lastUsedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
  requiredApiKeys?: Array<{
    name: string;
    displayName?: string;
    description?: string;
    category?: string;
    docsUrl?: string;
  }>;
}
```

### ToolStatus

```typescript
type ToolStatus = 'active' | 'disabled' | 'pending_approval' | 'rejected';
```

---

## Tool Lifecycle

A custom tool moves through a well-defined lifecycle of states. The following diagram shows every valid state transition:

```
                    +---------+
      LLM creates   |         |   User creates
   (dangerous perm) | pending |  (always active)
         +--------->| approval|           |
         |          |         |           |
         |          +----+----+           |
         |               |                |
         |        +------+------+         |
         |        |             |         |
         |     approve       reject       |
         |        |             |         |
         |        v             v         |
         |   +--------+   +--------+     |
         +-->| active |   |rejected|     |
             |        |   +--------+     |
             +---+----+                  |
                 ^  |                    |
                 |  | disable            |
          enable |  v                    |
                 +---+----+              |
                 |disabled|<-------------+
                 +--------+   (user can disable)
```

### State Descriptions

| Status | Meaning |
|--------|---------|
| `active` | Tool is live. It appears in the tool catalog and can be executed by the LLM or via the API. |
| `disabled` | Tool exists but is hidden from the LLM and cannot be executed. Can be re-enabled at any time. |
| `pending_approval` | Tool was created by the LLM with dangerous permissions. A human must approve or reject it before it becomes usable. |
| `rejected` | A human reviewed a pending tool and rejected it. The tool remains in the database for audit purposes but cannot be used. |

### Automatic Status Assignment on Creation

When a tool is created, its initial status is determined by two factors: who created it and what permissions it requests.

**User-created tools** (via UI or API with `createdBy: 'user'`):
- Always start as `active` regardless of permissions.

**LLM-created tools** (via the `create_tool` meta-tool with `createdBy: 'llm'`):
- If the tool requests any **dangerous permission** (`shell`, `filesystem`, or `email`), the status is set to `pending_approval`.
- If the tool requests only safe permissions (e.g., `network`, `database`, `scheduling`) or no permissions at all, the status is set to `active`.

The logic is in `CustomToolsRepository.create()`:

```typescript
const dangerousPermissions: ToolPermission[] = ['shell', 'filesystem', 'email'];
const hasDangerous = input.permissions?.some(p => dangerousPermissions.includes(p));
const status: ToolStatus =
  input.createdBy === 'llm' && hasDangerous ? 'pending_approval' : 'active';
```

### Version Tracking

The `version` field starts at `1` and auto-increments whenever the `code` or `parameters` fields are updated via `CustomToolsRepository.update()`. This allows auditing which version of a tool was active at any given time.

### Usage Counting

Every successful or failed execution increments `usage_count` and updates `last_used_at` via `CustomToolsRepository.recordUsage()`.

---

## Meta-Tools (LLM Interface)

The LLM interacts with the custom tools system through four **meta-tools**. These are standard tool definitions registered in the agent's tool catalog under the `Meta` category.

All meta-tool definitions are in `packages/core/src/agent/tools/dynamic-tools.ts`. Their execution logic is in `packages/gateway/src/routes/custom-tools.ts` in the `executeCustomToolTool()` function.

### create_tool

Creates a new custom tool and persists it in the database.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique tool name. Must match `^[a-z][a-z0-9_]*$`. |
| `description` | string | Yes | Clear description of what the tool does. |
| `parameters` | string | Yes | JSON Schema for tool parameters, provided as a JSON string. Must have `type: "object"`. |
| `code` | string | Yes | JavaScript code implementing the tool. Access arguments via the `args` object. Return the result. |
| `category` | string | No | Category for organization (e.g., `"Weather"`, `"Utilities"`). |
| `permissions` | string[] | No | Required permissions. Values: `"network"`, `"filesystem"`, `"database"`, `"shell"`, `"email"`, `"scheduling"`. |
| `required_api_keys` | object[] | No | API key dependencies. Each entry is auto-registered in Config Center. |

**Requires user confirmation:** Yes (the `requiresConfirmation` flag is set).

**Behavior:**
1. Validates name format, uniqueness, and code safety.
2. Parses the `parameters` JSON string into a schema object.
3. Creates the database record with appropriate status (see [Automatic Status Assignment](#automatic-status-assignment-on-creation)).
4. Registers any `required_api_keys` in the Config Center.
5. Syncs the tool to the `DynamicToolRegistry` if active.
6. Invalidates the agent cache so the new tool appears immediately.

### list_custom_tools

Lists all custom tools with optional filtering.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `category` | string | No | Filter by category. |
| `status` | string | No | Filter by status: `"active"`, `"disabled"`, `"pending_approval"`. |

**Returns:** Array of tool summaries (id, name, description, status, category, createdBy, usageCount) plus aggregate stats (total, active, pendingApproval).

### delete_custom_tool

Deletes a custom tool by name.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Name of the tool to delete. |
| `confirm` | boolean | No | Must be `true` to confirm deletion. If omitted, a confirmation prompt is returned. |

**Requires user confirmation:** Yes.

**Protection rules:**
- The LLM **cannot** delete tools where `createdBy === 'user'`. Attempting to do so returns an explicit error instructing the user to delete it manually.
- The LLM **can** delete tools it created (`createdBy === 'llm'`) but must pass `confirm: true`.

**Behavior on deletion:**
1. Unregisters the tool from the `DynamicToolRegistry`.
2. Unregisters API dependencies from Config Center.
3. Deletes the database record.
4. Invalidates the agent cache.

### toggle_custom_tool

Enables or disables a custom tool.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Name of the tool to toggle. |
| `enabled` | boolean | Yes | `true` to enable, `false` to disable. |

**Behavior:**
- Enabling sets status to `active` and syncs to the registry.
- Disabling sets status to `disabled` and removes from the registry.
- Invalidates the agent cache in both cases.

---

## Sandbox Execution Engine

Custom tool code runs inside a multi-layered sandbox built on Node.js's `vm` module. The sandbox is designed to prevent untrusted code from accessing the host system, while still providing useful capabilities through controlled APIs.

### Sandbox Components

The sandbox system lives in `packages/core/src/sandbox/` and consists of:

| File | Purpose |
|------|---------|
| `executor.ts` | `SandboxExecutor` class -- creates a VM context and executes code with timeouts |
| `worker-sandbox.ts` | `WorkerSandbox` class -- executes code in a separate Worker thread for maximum isolation |
| `context.ts` | `buildSandboxContext()` -- assembles the restricted global scope |
| `types.ts` | All type definitions (`SandboxConfig`, `ResourceLimits`, `SandboxPermissions`, etc.) |

### Resource Limits

Every custom tool execution is constrained by resource limits:

| Limit | Default | Description |
|-------|---------|-------------|
| `maxMemory` | 128 MB | Maximum V8 heap memory (enforced via Worker `resourceLimits`) |
| `maxCpuTime` | 5,000 ms | Maximum synchronous CPU time (enforced via `vm.Script` timeout) |
| `maxExecutionTime` | 30,000 ms | Maximum wall-clock time including async operations |
| `maxNetworkRequests` | 10 | Maximum number of HTTP requests per execution |
| `maxFsOperations` | 100 | Maximum number of file system operations per execution |

For custom tools specifically, the dynamic tools module applies slightly tighter defaults:

```typescript
const sandbox = createSandbox({
  pluginId,
  permissions: mapPermissions(tool.permissions ?? []),
  limits: {
    maxExecutionTime: 30000,  // 30 seconds
    maxCpuTime: 5000,         // 5 seconds CPU
    maxMemory: 50 * 1024 * 1024,  // 50 MB (tighter than default)
  },
  globals: { /* ... */ },
});
```

### VM Context Restrictions

The sandbox context explicitly blocks dangerous globals:

| Blocked Global | Reason |
|----------------|--------|
| `process` | Prevents access to environment, signals, and exit |
| `require` | Prevents loading arbitrary Node.js modules |
| `module`, `exports` | Prevents CJS module manipulation |
| `__dirname`, `__filename` | Prevents filesystem path discovery |
| `global`, `globalThis` | Prevents sandbox escape via global object |
| `eval` | Prevents dynamic code evaluation |
| `Function` | Prevents constructor-based code evaluation |
| `Atomics`, `SharedArrayBuffer` | Prevents shared memory attacks |

Code generation from strings and WebAssembly are also disabled at the VM context level:

```typescript
const vmContext = createContext(sandboxGlobals, {
  codeGeneration: {
    strings: false,  // Disable eval-like functions
    wasm: false,     // Disable WebAssembly
  },
});
```

### Permission Mapping

Tool permissions are mapped to sandbox permissions before execution:

| Tool Permission | Sandbox Effect |
|-----------------|----------------|
| `network` | `sandboxPermissions.network = true`; `fetch` is injected into globals |
| `filesystem` | `sandboxPermissions.fsRead = true`, `fsWrite = true` |
| `shell` | `sandboxPermissions.spawn = true` |
| `database` | Handled through injected APIs, not raw permissions |
| `email` | Handled through injected APIs, not raw permissions |
| `scheduling` | Handled through injected APIs, not raw permissions |

### Code Execution Flow

1. The tool's `code` string is wrapped:
   ```javascript
   const args = __args__;
   const context = __context__;
   // Tool implementation
   <user code here>
   ```

2. The wrapper is further wrapped in an async IIFE:
   ```javascript
   (async () => { <wrapped code> })()
   ```

3. The `Script` is compiled and executed in the VM context with a CPU timeout.

4. The result promise races against a wall-clock timeout.

5. On success, the returned value is captured. On failure, the error is caught and returned as a `ToolExecutionResult` with `isError: true`.

---

## Security Model

The custom tools system implements defense in depth through multiple security layers:

### Layer 1: Static Code Validation

Before a tool is stored or executed, the code is scanned for forbidden patterns. This validation occurs in three places:
- `DynamicToolRegistry.register()` (in-memory registration)
- `customToolsRoutes.post('/')` (REST API creation)
- `validateCode()` in `context.ts` (sandbox executor)

**Forbidden patterns (registration-time):**

| Pattern | What it prevents |
|---------|-----------------|
| `process.exit` | Crashing the host process |
| `require(` | Loading Node.js modules |
| `import(` | Dynamic ESM imports |
| `__dirname` | File path discovery |
| `__filename` | File path discovery |
| `global.` | Global object access |
| `globalThis.` | Global object access |

**Forbidden patterns (execution-time, `validateCode()`):**

| Pattern | What it prevents |
|---------|-----------------|
| `eval(` | Dynamic code evaluation |
| `Function(` | Constructor-based code generation |
| `import(` | Dynamic imports |
| `require(` | Module loading |
| `process` | Process access |
| `__proto__` | Prototype pollution |
| `constructor[` | Constructor property exploitation |
| `with(` | Scope manipulation |

### Layer 2: Permission System

Tools must declare what permissions they need upfront. If a tool tries to use `fetch` without the `network` permission, `fetch` is simply `undefined` in its sandbox context.

**Dangerous permissions** (`shell`, `filesystem`, `email`) automatically trigger the approval workflow for LLM-created tools, placing them in `pending_approval` status until a human reviews them.

### Layer 3: Sandbox Isolation

Code runs inside a `vm.createContext()` with a carefully constructed global scope. The sandbox provides:
- No access to Node.js APIs (`require`, `process`, `fs`, etc.)
- No code generation from strings (`eval`, `Function`, WebAssembly disabled)
- No shared memory (`Atomics`, `SharedArrayBuffer` blocked)
- Resource-limited execution (CPU timeout, memory limits, request caps)

### Layer 4: Worker Thread Isolation (Optional)

The `WorkerSandbox` class runs code in a separate Worker thread with V8 resource limits:
- `maxOldGenerationSizeMb`: Limits heap memory
- `maxYoungGenerationSizeMb`: 32 MB
- `codeRangeSizeMb`: 16 MB

This provides true process-level isolation.

### Layer 5: Approval Workflow

Tools created by the LLM with dangerous permissions are held in `pending_approval` status. They cannot be executed until a human explicitly approves them through the UI or REST API.

### Layer 6: LLM Deletion Protection

The LLM cannot delete user-created tools. This prevents the agent from removing tools the user depends on.

### Layer 7: Tool Name Validation

Tool names must match `^[a-z][a-z0-9_]*$`:
- Must start with a lowercase letter.
- May contain only lowercase letters, digits, and underscores.
- This prevents name collision attacks and ensures safe use as identifiers.

### Layer 8: Execution Confirmation

All LLM-created tools have `requiresApproval: true`, meaning each execution triggers a user confirmation dialog before proceeding. The `create_tool` meta-tool itself also has `requiresConfirmation: true`.

---

## Sandbox Utility Helpers

Custom tool code has access to a comprehensive `utils` object that provides safe, pre-built helper functions. These are injected into the sandbox via the `globals` property.

### Config Center Access

| Function | Signature | Description |
|----------|-----------|-------------|
| `utils.getApiKey` | `(serviceName: string) => string \| undefined` | Get an API key by service name from Config Center. |
| `utils.getServiceConfig` | `(serviceName: string) => object \| null` | Get full service configuration. |
| `utils.getConfigEntry` | `(serviceName: string, entryLabel?: string) => object \| null` | Get a specific config entry's data. |
| `utils.getConfigEntries` | `(serviceName: string) => object[]` | Get all config entries for a multi-entry service. |
| `utils.getFieldValue` | `(serviceName: string, fieldName: string, entryLabel?: string) => any` | Get a resolved field value from a config entry. |

### Tool Interoperability

| Function | Signature | Description |
|----------|-----------|-------------|
| `utils.callTool` | `(toolName: string, args?: object) => Promise<any>` | Call any built-in tool by name. Returns the parsed result. |
| `utils.listTools` | `() => Array<{name, description, parameters}>` | List all available built-in tools. |

### Hashing and Cryptography

| Function | Signature | Description |
|----------|-----------|-------------|
| `utils.hash` | `(text: string, algorithm?: string) => string` | Hash a string (default: SHA-256). |
| `utils.uuid` | `() => string` | Generate a random UUID v4. |
| `utils.generatePassword` | `(length?: number) => string` | Generate a secure random password (default: 16 chars). |

### Encoding and Decoding

| Function | Signature | Description |
|----------|-----------|-------------|
| `utils.base64Encode` | `(text: string) => string` | Encode to Base64. |
| `utils.base64Decode` | `(text: string) => string` | Decode from Base64. |
| `utils.urlEncode` | `(text: string) => string` | URL-encode a string. |
| `utils.urlDecode` | `(text: string) => string` | URL-decode a string. |
| `utils.hexEncode` | `(text: string) => string` | Encode to hexadecimal. |
| `utils.hexDecode` | `(hex: string) => string` | Decode from hexadecimal. |

### Date and Time

| Function | Signature | Description |
|----------|-----------|-------------|
| `utils.now` | `() => string` | Current time as ISO 8601 string. |
| `utils.timestamp` | `() => number` | Current time as Unix timestamp (milliseconds). |
| `utils.dateDiff` | `(date1: string, date2: string, unit?: string) => number` | Difference between two dates. Units: `seconds`, `minutes`, `hours`, `days`, `weeks`. |
| `utils.dateAdd` | `(date: string, amount: number, unit?: string) => string` | Add time to a date. Pass `"now"` for current time. Units: `seconds` through `years`. |
| `utils.formatDate` | `(date: string, locale?: string) => string` | Format a date as human-readable string. |

### Text Transforms

| Function | Signature | Description |
|----------|-----------|-------------|
| `utils.slugify` | `(text: string) => string` | Convert to URL-safe slug. |
| `utils.camelCase` | `(text: string) => string` | Convert to camelCase. |
| `utils.snakeCase` | `(text: string) => string` | Convert to snake_case. |
| `utils.kebabCase` | `(text: string) => string` | Convert to kebab-case. |
| `utils.titleCase` | `(text: string) => string` | Convert to Title Case. |
| `utils.truncate` | `(text: string, maxLength?: number, suffix?: string) => string` | Truncate with ellipsis. |
| `utils.countWords` | `(text: string) => number` | Count words in text. |
| `utils.removeDiacritics` | `(text: string) => string` | Strip accent marks. |

### Validation

| Function | Signature | Description |
|----------|-----------|-------------|
| `utils.isEmail` | `(value: string) => boolean` | Validate email format. |
| `utils.isUrl` | `(value: string) => boolean` | Validate URL format. |
| `utils.isJson` | `(value: string) => boolean` | Check if string is valid JSON. |
| `utils.isUuid` | `(value: string) => boolean` | Validate UUID format. |

### Math

| Function | Signature | Description |
|----------|-----------|-------------|
| `utils.clamp` | `(value: number, min: number, max: number) => number` | Clamp a value to a range. |
| `utils.round` | `(value: number, decimals?: number) => number` | Round to N decimal places. |
| `utils.randomInt` | `(min?: number, max?: number) => number` | Random integer in range. |
| `utils.sum` | `(numbers: number[]) => number` | Sum an array. |
| `utils.avg` | `(numbers: number[]) => number` | Average an array. |

### Data Processing

| Function | Signature | Description |
|----------|-----------|-------------|
| `utils.parseJson` | `(text: string) => unknown` | Parse JSON string. |
| `utils.toJson` | `(data: unknown, indent?: number) => string` | Stringify to JSON. |
| `utils.parseCsv` | `(csv: string, delimiter?: string) => Record<string, string>[]` | Parse CSV into array of objects. |
| `utils.flatten` | `(obj: object, prefix?: string) => Record<string, unknown>` | Flatten nested object to dot-notation keys. |
| `utils.getPath` | `(obj: unknown, path: string) => unknown` | Get nested value by dot path (supports `[0]` array syntax). |

### Array Utilities

| Function | Signature | Description |
|----------|-----------|-------------|
| `utils.unique` | `(arr: T[]) => T[]` | Remove duplicates. |
| `utils.chunk` | `(arr: T[], size: number) => T[][]` | Split into chunks. |
| `utils.shuffle` | `(arr: T[]) => T[]` | Randomly shuffle. |
| `utils.sample` | `(arr: T[], n?: number) => T[]` | Pick N random elements. |
| `utils.groupBy` | `(arr: T[], key: keyof T) => Record<string, T[]>` | Group by a key. |

### Standard JavaScript Globals

The sandbox also exposes standard built-in objects: `JSON`, `Math`, `Date`, `Array`, `Object`, `String`, `Number`, `Boolean`, `RegExp`, `Map`, `Set`, `parseInt`, `parseFloat`, `isNaN`, `isFinite`, `encodeURIComponent`, `decodeURIComponent`, `encodeURI`, `decodeURI`.

---

## Config Center Integration

Custom tools can declare API key and service configuration dependencies. When a tool is created with `required_api_keys`, those services are automatically registered in the Config Center.

### Declaring Dependencies

When creating a tool via the `create_tool` meta-tool, pass the `required_api_keys` array:

```json
{
  "required_api_keys": [
    {
      "name": "weatherapi",
      "displayName": "WeatherAPI",
      "description": "Weather data provider for current and forecast data",
      "category": "weather",
      "docsUrl": "https://www.weatherapi.com/docs/"
    }
  ]
}
```

### Accessing Config in Tool Code

Inside the tool's JavaScript code, use the `utils` helpers:

```javascript
// Get just the API key
const apiKey = utils.getApiKey('weatherapi');

// Get the full config entry
const config = utils.getConfigEntry('weatherapi');

// Get a specific field
const baseUrl = utils.getFieldValue('weatherapi', 'base_url');

// For multi-entry services (e.g., multiple SMTP accounts)
const allEntries = utils.getConfigEntries('smtp');
```

### Registration and Cleanup

- **On creation/update:** `registerToolApiDependencies(toolId, toolName, requiredApiKeys)` is called to register the services in Config Center.
- **On deletion/update:** `unregisterDependencies(toolId)` is called to clean up.

The registrar module is at `packages/gateway/src/services/api-service-registrar.ts`.

---

## Gateway REST API

All custom tool routes are mounted at `/api/v1/custom-tools` via the Hono router in `packages/gateway/src/routes/custom-tools.ts`.

### Endpoints

#### GET /api/v1/custom-tools

List custom tools with optional filtering.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Filter by status: `active`, `disabled`, `pending_approval`, `rejected` |
| `category` | string | Filter by category |
| `createdBy` | string | Filter by creator: `user` or `llm` |
| `limit` | number | Maximum results to return |
| `offset` | number | Number of results to skip (pagination) |

**Response:**

```json
{
  "success": true,
  "data": {
    "tools": [ /* array of CustomToolRecord objects */ ],
    "count": 5
  },
  "meta": { "requestId": "...", "timestamp": "..." }
}
```

#### GET /api/v1/custom-tools/stats

Get aggregate statistics about custom tools.

**Response:**

```json
{
  "success": true,
  "data": {
    "total": 12,
    "active": 8,
    "disabled": 2,
    "pendingApproval": 1,
    "createdByLLM": 7,
    "createdByUser": 5,
    "totalUsage": 342
  }
}
```

#### GET /api/v1/custom-tools/pending

Get all tools currently awaiting approval.

**Response:** Same shape as the list endpoint, filtered to `status = 'pending_approval'`.

#### GET /api/v1/custom-tools/active/definitions

Get active tools formatted as LLM tool definitions. Used internally to inject custom tools into the agent's tool catalog.

**Response:**

```json
{
  "success": true,
  "data": {
    "tools": [
      {
        "name": "fetch_weather",
        "description": "Fetch current weather for a city",
        "parameters": { "type": "object", "properties": { /* ... */ } },
        "category": "Weather",
        "requiresConfirmation": true
      }
    ],
    "count": 1
  }
}
```

#### GET /api/v1/custom-tools/:id

Get a single custom tool by ID.

**Response:** Full `CustomToolRecord` in `data`.

#### POST /api/v1/custom-tools

Create a new custom tool.

**Request Body:**

```json
{
  "name": "fetch_weather",
  "description": "Fetch current weather for a city",
  "parameters": {
    "type": "object",
    "properties": {
      "city": { "type": "string", "description": "City name" }
    },
    "required": ["city"]
  },
  "code": "const key = utils.getApiKey('weatherapi');\nconst res = await fetch(`https://api.weatherapi.com/v1/current.json?key=${key}&q=${args.city}`);\nreturn await res.json();",
  "category": "Weather",
  "permissions": ["network"],
  "createdBy": "user",
  "requiredApiKeys": [
    { "name": "weatherapi", "displayName": "WeatherAPI", "description": "Weather data API" }
  ]
}
```

**Validations:**
- `name`, `description`, `parameters`, `code` are required.
- `name` must match `^[a-z][a-z0-9_]*$`.
- `code` must not contain forbidden patterns.
- `name` must be unique within the user scope.

**Response:** `201 Created` with the full `CustomToolRecord`.

#### PATCH /api/v1/custom-tools/:id

Update a custom tool. Only provided fields are updated.

**Request Body:** Any subset of: `name`, `description`, `parameters`, `code`, `category`, `permissions`, `requiresApproval`, `metadata`, `requiredApiKeys`.

**Behavior:** If `code` or `parameters` are changed, the `version` is incremented. The agent cache is invalidated.

**Response:** Updated `CustomToolRecord`.

#### DELETE /api/v1/custom-tools/:id

Delete a custom tool permanently.

**Behavior:**
1. Unregisters from `DynamicToolRegistry`.
2. Unregisters API dependencies.
3. Deletes the database record.
4. Invalidates agent cache.

**Response:**

```json
{
  "success": true,
  "data": { "deleted": true }
}
```

#### POST /api/v1/custom-tools/:id/enable

Set a tool's status to `active`.

#### POST /api/v1/custom-tools/:id/disable

Set a tool's status to `disabled`.

#### POST /api/v1/custom-tools/:id/approve

Approve a tool that is in `pending_approval` status. Sets status to `active`. Returns `400` if the tool is not pending.

#### POST /api/v1/custom-tools/:id/reject

Reject a tool that is in `pending_approval` status. Sets status to `rejected`. Returns `400` if the tool is not pending.

#### POST /api/v1/custom-tools/:id/execute

Execute a custom tool directly via the API (outside of the LLM agent flow).

**Request Body:**

```json
{
  "arguments": { "city": "London" }
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "tool": "fetch_weather",
    "result": { /* tool output */ },
    "isError": false,
    "duration": 245,
    "metadata": { "executionTime": 243, "dynamicTool": "fetch_weather" }
  }
}
```

Returns `400` if the tool is not active.

#### POST /api/v1/custom-tools/test

Dry-run a tool without saving it. Creates a temporary sandbox and executes the code.

**Request Body:**

```json
{
  "name": "test_tool",
  "description": "Test description",
  "parameters": { "type": "object", "properties": {} },
  "code": "return { hello: 'world' };",
  "permissions": [],
  "testArguments": {}
}
```

**Response:** Same shape as the execute endpoint, with `testMode: true` in the data.

---

## UI Management (CustomToolsPage)

The UI component at `packages/ui/src/pages/CustomToolsPage.tsx` provides a full management interface for custom tools.

### Features

| Feature | Description |
|---------|-------------|
| **Tool List** | Grid of tool cards showing name, status, description, creator, category, version, and usage count. |
| **Status Filters** | Filter by All, Active, Disabled, Pending Approval, Rejected. |
| **Search** | Text search across tool name, description, and category. |
| **Stats Bar** | Shows active, disabled, and pending counts plus total usage. |
| **Pending Badge** | Header badge showing the number of tools awaiting approval. |
| **Quick Actions** | Approve/Reject buttons directly on pending tool cards. |
| **Tool Detail Modal** | Three-tab view (Details, Code, Test) for any selected tool. |
| **Details Tab** | Shows creator, version, usage count, last used time, permissions, and parameter schema. |
| **Code Tab** | Displays the full JavaScript implementation. |
| **Test Tab** | JSON input editor with a "Run Tool" button for live testing. |
| **Create Tool Modal** | Full form with name, description, category, JSON Schema editor, code editor, permission toggles, and approval checkbox. |
| **Enable/Disable** | Toggle tool availability from the detail modal. |
| **Delete** | Remove a tool from the detail modal. |

### Status Colors

| Status | Color |
|--------|-------|
| Active | Green |
| Disabled | Gray |
| Pending Approval | Yellow |
| Rejected | Red |

### Creator Indicators

| Creator | Color | Label |
|---------|-------|-------|
| LLM | Purple | "AI Created" |
| User | Blue | "User Created" |

---

## Dynamic Tool Registry

The `DynamicToolRegistry` is an in-memory registry that holds active custom tools and provides the execution bridge between the agent and the sandbox.

> **Note:** Custom tools use the `DynamicToolRegistry` for runtime-created user tools. For built-in tool families (memory, goals, custom data, etc.), the system uses the **ToolProvider** pattern (`ToolProvider` interface with `registerProvider()`) as described in [TOOLS.md](TOOLS.md#tool-provider-pattern).

### Interface

Defined in `packages/core/src/agent/tools/dynamic-tools.ts`:

```typescript
interface DynamicToolRegistry {
  /** All registered dynamic tools */
  tools: Map<string, DynamicToolDefinition>;

  /** Get tool definition for LLM (as ToolDefinition) */
  getDefinition(name: string): ToolDefinition | undefined;

  /** Get all tool definitions */
  getAllDefinitions(): ToolDefinition[];

  /** Execute a dynamic tool in sandbox */
  execute(
    name: string,
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolExecutionResult>;

  /** Register a new tool */
  register(tool: DynamicToolDefinition): void;

  /** Unregister a tool */
  unregister(name: string): boolean;

  /** Check if tool exists */
  has(name: string): boolean;
}
```

### Factory Function

```typescript
function createDynamicToolRegistry(
  callableTools?: Array<{ definition: ToolDefinition; executor: ToolExecutor }>
): DynamicToolRegistry;
```

The optional `callableTools` parameter passes all built-in tools to the registry. This makes them available to custom tool code via `utils.callTool()`. The gateway creates the registry with `ALL_TOOLS`:

```typescript
const dynamicRegistry = createDynamicToolRegistry(ALL_TOOLS);
```

### Registry Synchronization

The gateway syncs the database state with the in-memory registry through `syncToolToRegistry()`:

```typescript
function syncToolToRegistry(tool: CustomToolRecord): void {
  if (tool.status === 'active') {
    dynamicRegistry.register(dynamicTool);
  } else {
    dynamicRegistry.unregister(tool.name);
  }
}
```

This is called on every CRUD operation, status change, and before tool execution.

### Agent Cache Invalidation

After any change to the custom tools state, `invalidateAgentCache()` is called. This ensures the LLM's tool catalog is refreshed and includes or excludes tools as appropriate.

---

## Writing Custom Tool Code

### Code Environment

Custom tool code executes inside an `async` function body. It has access to:

| Variable | Type | Description |
|----------|------|-------------|
| `args` | object | The arguments passed by the LLM, matching the tool's parameter schema. |
| `context` | object | Execution context with `toolName`, `callId`, `conversationId`, `userId`. |
| `utils` | object | The full utility helpers object (see [Sandbox Utility Helpers](#sandbox-utility-helpers)). |
| `fetch` | function | Global `fetch` (only if `network` permission is granted, otherwise `undefined`). |
| `console` | object | Sandbox console with `log`, `warn`, `error` (prefixed with tool name). |

### Rules

1. **Return a value.** The return value is serialized and sent back to the LLM. If you return an object, it will be JSON-stringified.
2. **Use `args` for input.** Do not reference parameters by any other mechanism.
3. **Declare permissions.** If you need `fetch`, declare `"network"`. If you need file access, declare `"filesystem"`.
4. **Handle errors.** Use try/catch. Unhandled errors become `isError: true` results.
5. **Stay within limits.** Code that exceeds the 5-second CPU time or 30-second wall clock is terminated.
6. **No forbidden patterns.** `require`, `import()`, `process`, `eval`, `Function`, `__proto__`, `global`, `globalThis` are all prohibited.

### Parameter Schema

Parameters must be a valid JSON Schema with `type: "object"`. Example:

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Search query"
    },
    "limit": {
      "type": "number",
      "description": "Maximum results (default: 10)"
    }
  },
  "required": ["query"]
}
```

---

## Examples

### Example 1: Simple Utility Tool (No Permissions)

**Name:** `word_frequency`
**Description:** Count word frequency in a text
**Permissions:** None
**Parameters:**
```json
{
  "type": "object",
  "properties": {
    "text": { "type": "string", "description": "Text to analyze" }
  },
  "required": ["text"]
}
```
**Code:**
```javascript
const words = args.text.toLowerCase().match(/\b\w+\b/g) || [];
const freq = {};
for (const word of words) {
  freq[word] = (freq[word] || 0) + 1;
}
const sorted = Object.entries(freq)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20);
return { totalWords: words.length, uniqueWords: Object.keys(freq).length, top20: sorted };
```

### Example 2: Network Tool with API Key

**Name:** `fetch_weather`
**Description:** Get current weather for a location
**Permissions:** `["network"]`
**required_api_keys:**
```json
[{ "name": "weatherapi", "displayName": "WeatherAPI", "docsUrl": "https://www.weatherapi.com" }]
```
**Parameters:**
```json
{
  "type": "object",
  "properties": {
    "city": { "type": "string", "description": "City name" }
  },
  "required": ["city"]
}
```
**Code:**
```javascript
const apiKey = utils.getApiKey('weatherapi');
if (!apiKey) return { error: 'WeatherAPI key not configured. Please add it in Config Center.' };

const url = `https://api.weatherapi.com/v1/current.json?key=${apiKey}&q=${utils.urlEncode(args.city)}`;
const response = await fetch(url);
if (!response.ok) return { error: `API error: ${response.status}` };

const data = await response.json();
return {
  location: data.location.name,
  country: data.location.country,
  temp_c: data.current.temp_c,
  condition: data.current.condition.text,
  humidity: data.current.humidity,
  wind_kph: data.current.wind_kph,
};
```

### Example 3: Tool That Calls Other Tools

**Name:** `summarize_url`
**Description:** Fetch a URL and summarize the content
**Permissions:** `["network"]`
**Parameters:**
```json
{
  "type": "object",
  "properties": {
    "url": { "type": "string", "description": "URL to summarize" }
  },
  "required": ["url"]
}
```
**Code:**
```javascript
// Use the built-in web_fetch tool to get the page
const content = await utils.callTool('web_fetch', { url: args.url });

// Process and return a summary
const text = typeof content === 'string' ? content : JSON.stringify(content);
const words = text.split(/\s+/).length;

return {
  url: args.url,
  wordCount: words,
  preview: utils.truncate(text, 500),
  fetchedAt: utils.now(),
};
```

### Example 4: Data Processing with Utils

**Name:** `csv_analyzer`
**Description:** Analyze a CSV string and return statistics
**Permissions:** None
**Parameters:**
```json
{
  "type": "object",
  "properties": {
    "csv": { "type": "string", "description": "CSV data as string" },
    "numeric_column": { "type": "string", "description": "Column name with numeric data" }
  },
  "required": ["csv"]
}
```
**Code:**
```javascript
const records = utils.parseCsv(args.csv);
if (records.length === 0) return { error: 'No records found in CSV' };

const columns = Object.keys(records[0]);
const result = {
  rowCount: records.length,
  columns: columns,
  id: utils.uuid(),
  analyzedAt: utils.now(),
};

if (args.numeric_column && columns.includes(args.numeric_column)) {
  const values = records
    .map(r => parseFloat(r[args.numeric_column]))
    .filter(v => !isNaN(v));
  result.stats = {
    count: values.length,
    sum: utils.sum(values),
    avg: utils.round(utils.avg(values), 2),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

return result;
```

---

## Troubleshooting

### Tool is stuck in "pending_approval"

The tool was created by the LLM with dangerous permissions (`shell`, `filesystem`, or `email`). Go to the Custom Tools page in the UI, find the tool in the "Pending Approval" filter, and click Approve or Reject.

### "Tool code contains forbidden pattern" error

The code contains a pattern that is explicitly blocked for security. Check for:
- `require()` or `import()` calls -- use `utils.callTool()` instead.
- `process.exit` or `process.env` references -- use `utils.getApiKey()` for config.
- `global.` or `globalThis.` references -- use local variables.
- `eval()` or `Function()` calls -- restructure the logic to avoid dynamic code execution.

### Tool executes but returns `undefined`

Make sure the code ends with a `return` statement. The tool code runs inside an async function body, and the returned value becomes the tool's output.

### "Tool execution timed out"

The code exceeded the 5-second CPU limit or 30-second wall-clock limit. Optimize the logic, reduce data sizes, or break the work into multiple tool calls.

### "Custom tool not found" when LLM tries to use it

Check that the tool's status is `active`. Disabled, pending, or rejected tools are not available to the LLM. Also verify the tool name matches exactly (case-sensitive, underscores).

### LLM says it cannot delete a tool

The LLM cannot delete tools where `createdBy` is `'user'`. User-created tools must be deleted through the UI or REST API. This is an intentional safety measure.

### fetch is undefined inside tool code

The tool needs the `"network"` permission. Add it to the `permissions` array when creating the tool.

---

## Source File Reference

| File | Description |
|------|-------------|
| `packages/core/src/agent/tools/dynamic-tools.ts` | Core types, registry, meta-tool definitions, sandbox execution |
| `packages/core/src/sandbox/executor.ts` | `SandboxExecutor` class (vm-based execution) |
| `packages/core/src/sandbox/worker-sandbox.ts` | `WorkerSandbox` class (Worker thread isolation) |
| `packages/core/src/sandbox/context.ts` | Sandbox context builder, code validation |
| `packages/core/src/sandbox/types.ts` | Sandbox type definitions, default limits |
| `packages/core/src/agent/types.ts` | `ToolContext`, `ToolDefinition`, `ToolExecutionResult` types |
| `packages/gateway/src/db/repositories/custom-tools.ts` | `CustomToolsRepository` database layer |
| `packages/gateway/src/routes/custom-tools.ts` | REST routes, meta-tool executors |
| `packages/gateway/src/services/api-service-registrar.ts` | Config Center dependency registration |
| `packages/gateway/src/db/migrations/postgres/001_initial_schema.sql` | Database schema |
| `packages/gateway/data/tools/custom-data-tools.json` | Built-in custom data management tools |
| `packages/ui/src/pages/CustomToolsPage.tsx` | UI management page |
