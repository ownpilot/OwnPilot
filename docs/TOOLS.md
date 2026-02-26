# OwnPilot Tool System

Comprehensive reference for the OwnPilot tool architecture, all 170+ built-in tools, the registration lifecycle, execution model, and extensibility system.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Core Interfaces](#core-interfaces)
  - [ToolDefinition](#tooldefinition)
  - [ToolExecutor](#toolexecutor)
  - [ToolContext](#toolcontext)
  - [ToolExecutionResult](#toolexecutionresult)
  - [RegisteredTool](#registeredtool)
  - [ToolRegistry](#toolregistry)
- [Tool Registration Flow](#tool-registration-flow)
- [Tool Provider Pattern](#tool-provider-pattern)
- [Tool Middleware](#tool-middleware)
- [Batch Operations](#batch-operations)
- [Tool Execution Lifecycle](#tool-execution-lifecycle)
- [Tool Groups and Configuration](#tool-groups-and-configuration)
- [Tool Discovery System](#tool-discovery-system)
  - [Search Tags](#search-tags)
  - [Meta-Tools](#meta-tools)
- [Tool Max Limits](#tool-max-limits)
- [Tool Categories Reference](#tool-categories-reference)
  - [Tasks](#1-tasks)
  - [Bookmarks](#2-bookmarks)
  - [Notes](#3-notes)
  - [Calendar](#4-calendar)
  - [Contacts](#5-contacts)
  - [Custom Data](#6-custom-data)
  - [File System](#7-file-system)
  - [PDF](#8-pdf)
  - [Code Execution (Sandbox)](#9-code-execution-sandbox)
  - [Git](#10-git)
  - [Web and API](#11-web-and-api)
  - [Email](#12-email)
  - [Image](#13-image)
  - [Audio](#14-audio)
  - [Translation](#15-translation)
  - [Data Extraction](#16-data-extraction)
  - [Vector Search](#17-vector-search)
  - [Finance](#18-finance)
  - [Scheduler](#19-scheduler)
  - [Weather](#20-weather)
  - [Memory](#21-memory)
  - [Goals](#22-goals)
  - [Dynamic Tools](#23-dynamic-tools)
  - [Utilities](#24-utilities)
  - [CLI Tools](#25-cli-tools)
  - [Coding Agents](#26-coding-agents)
- [Security Model](#security-model)
- [Definition-Only vs Built-In Executor Tools](#definition-only-vs-built-in-executor-tools)
- [Dynamic Tool Creation](#dynamic-tool-creation)
- [Source File Map](#source-file-map)

---

## Architecture Overview

The OwnPilot tool system is the bridge between the AI agent and the outside world. When the LLM decides it needs to perform an action -- read a file, create a task, search the web, remember a fact -- it issues a **tool call**. The tool system validates, dispatches, and executes that call, then returns the result to the LLM for incorporation into its response.

```
User prompt
    |
    v
  LLM (AI Provider)
    |
    | (tool call request)
    v
  ToolRegistry.executeToolCall()
    |
    +---> parse JSON arguments
    +---> resolve RegisteredTool by name
    +---> build ToolContext (callId, userId, configCenter, ...)
    +---> invoke ToolExecutor(args, context)
    +---> serialize result to string
    |
    v
  ToolResult returned to LLM
    |
    v
  LLM continues generation
```

Key design decisions:

- **JSON Schema parameters** -- Every tool declares its parameters as a JSON Schema object. This schema is sent to the LLM so it knows what arguments to produce.
- **Two-tier tools** -- Some tools ship with built-in executor functions (file-system, code-execution, utilities). Others are **definition-only**: their schemas live in `packages/core`, but their executors are wired up in the gateway package where database access is available.
- **Parallel execution** -- The registry supports executing multiple tool calls concurrently via `executeToolCalls()`.
- **Plugin isolation** -- Tools can be associated with a `PluginId` and bulk-unregistered when the plugin is removed.
- **Config Center integration** -- Tools that need external API keys or service credentials access them through the `ToolContext` methods (`getApiKey`, `getServiceConfig`, `getConfigEntry`, etc.) rather than reading environment variables directly.

---

## Core Interfaces

All type definitions live in `packages/core/src/agent/types.ts`.

### ToolDefinition

The schema that describes a tool to the LLM.

```typescript
interface ToolDefinition {
  /** Unique tool name (1-64 chars, alphanumeric + underscores, starts with letter) */
  readonly name: string;
  /** Human-readable description sent to the LLM */
  readonly description: string;
  /** JSON Schema defining accepted parameters */
  readonly parameters: {
    readonly type: 'object';
    readonly properties: Record<string, JSONSchemaProperty>;
    readonly required?: readonly string[];
  };
  /** If true, the UI prompts the user for confirmation before execution */
  readonly requiresConfirmation?: boolean;
  /** Category for UI grouping (e.g., "Tasks", "File System", "Meta") */
  readonly category?: string;
  /** Hidden search tags for tool discovery via search_tools. NOT sent to the LLM API. */
  readonly tags?: readonly string[];
}
```

**JSONSchemaProperty** supports the types `string`, `number`, `integer`, `boolean`, `array`, and `object`, with optional `enum`, `items`, `properties`, `required`, `default`, and `additionalProperties` fields.

### ToolExecutor

The function that actually runs when a tool is called.

```typescript
type ToolExecutor = (
  args: Record<string, unknown>,
  context: ToolContext
) => Promise<ToolExecutionResult>;
```

- `args` contains the parsed JSON arguments from the LLM.
- `context` provides runtime metadata (user ID, conversation ID, workspace dir, Config Center accessors, abort signal).

### ToolContext

Runtime context passed to every tool executor.

```typescript
interface ToolContext {
  /** Unique ID for this specific tool invocation */
  readonly callId: string;
  /** The conversation this call belongs to */
  readonly conversationId: string;
  /** Authenticated user ID (if available) */
  readonly userId?: string;
  /** Plugin that registered this tool (if from a plugin) */
  readonly pluginId?: PluginId;
  /** AbortSignal for cooperative cancellation */
  readonly signal?: AbortSignal;
  /** Workspace directory override for file operations */
  readonly workspaceDir?: string;
  /** Retrieve an API key by service name from Config Center */
  readonly getApiKey?: (serviceName: string) => string | undefined;
  /** Retrieve full service configuration from Config Center */
  readonly getServiceConfig?: (serviceName: string) => ApiServiceConfig | null;
  /** Retrieve a config entry by service name and optional label */
  readonly getConfigEntry?: (serviceName: string, entryLabel?: string) => ConfigEntry | null;
  /** Retrieve all config entries for a multi-entry service */
  readonly getConfigEntries?: (serviceName: string) => ConfigEntry[];
  /** Retrieve a single field value from a service config entry */
  readonly getFieldValue?: (serviceName: string, fieldName: string, entryLabel?: string) => unknown;
}
```

### ToolExecutionResult

What a tool executor returns.

```typescript
interface ToolExecutionResult {
  /** Result payload (stringified if object) */
  readonly content: unknown;
  /** Whether execution failed */
  readonly isError?: boolean;
  /** Arbitrary metadata (execution time, provenance, etc.) */
  readonly metadata?: Record<string, unknown>;
}
```

### RegisteredTool

Internal representation of a tool once registered.

```typescript
interface RegisteredTool {
  readonly id: ToolId; // Branded string type
  readonly definition: ToolDefinition;
  executor: ToolExecutor; // Mutable -- allows executor replacement at runtime
  readonly pluginId?: PluginId;
}
```

The `executor` field is intentionally mutable so the gateway can replace placeholder executors with real database-backed implementations after startup.

### ToolRegistry

The central class that manages all tools. Defined in `packages/core/src/agent/tools.ts`.

```typescript
class ToolRegistry {
  register(definition, executor, pluginId?): Result<ToolId, ValidationError>;
  unregister(name): boolean;
  updateExecutor(name, executor): boolean;
  unregisterPlugin(pluginId): number;
  get(name): RegisteredTool | undefined;
  has(name): boolean;
  getDefinitions(): readonly ToolDefinition[];
  getDefinition(name): ToolDefinition | undefined;
  getDefinitionsByNames(names): readonly ToolDefinition[];
  getNames(): readonly string[];
  getPluginTools(pluginId): readonly RegisteredTool[];
  execute(name, args, context): Promise<Result<ToolExecutionResult, Error>>;
  executeToolCall(toolCall, conversationId, userId?): Promise<ToolResult>;
  executeToolCalls(toolCalls, conversationId, userId?): Promise<readonly ToolResult[]>;
  setWorkspaceDir(dir): void;
  setApiKeyCenter(center): void;
  getStats(): { totalTools; pluginTools; coreTools };
  clear(): void;
}
```

Key behaviors:

- **Name validation** on registration: must match `^[a-zA-Z][a-zA-Z0-9_]*$`, max 64 characters.
- **Duplicate detection**: `register()` returns an error if a tool with the same name already exists.
- **Plugin tracking**: every tool optionally carries a `pluginId`, enabling bulk `unregisterPlugin()`.
- **executeToolCall()**: parses the JSON arguments string, builds the full context (generating a `callId`, injecting Config Center accessors), calls the executor, serializes the result to a string, and logs timing via the debug module.
- **Parallel execution**: `executeToolCalls()` runs all calls concurrently with `Promise.all()`.

---

## Tool Registration Flow

```
Application startup
    |
    v
  registerAllTools(registry)            <-- packages/core/src/agent/tools/index.ts
    |
    +-- Iterate ALL_TOOLS array
    |     (file-system, code-execution, web-fetch, expense-tracker,
    |      scheduler, pdf, translation, image, email, git,
    |      vector-search, audio, data-extraction, weather, utilities)
    |
    +-- For each: registry.register(definition, executor)
    |
    v
  Gateway registers definition-only tools
    |
    +-- personal-data tools (tasks, bookmarks, notes, calendar, contacts)
    +-- custom-data tools
    +-- memory tools
    +-- goal tools
    +-- dynamic tool management (create_tool, list_custom_tools, etc.)
    |
    v
  Gateway wires up real executors
    (database-backed implementations replace placeholders)
    |
    v
  registry.setApiKeyCenter(configCenter)
    |
    v
  Tools ready for LLM consumption
```

**Two registration paths exist:**

1. **`ALL_TOOLS` array** -- tools that bundle both definition and executor in `packages/core`. These are registered by calling `registerAllTools(registry)` or `registerToolSet(registry, setName)`.

2. **Definition-only tools** -- exported as `ToolDefinition[]` arrays (e.g., `PERSONAL_DATA_TOOLS`, `MEMORY_TOOLS`, `GOAL_TOOLS`, `CUSTOM_DATA_TOOLS`). The gateway package imports these definitions and registers them with its own executor implementations that have access to the database layer.

You can also register individual tool sets:

```typescript
import { registerToolSet } from '@ownpilot/core/agent/tools';

registerToolSet(registry, 'fileSystem'); // Only file system tools
registerToolSet(registry, 'git'); // Only git tools
```

---

## Tool Provider Pattern

Tool providers allow modular registration of related tools. A provider bundles a set of tool definitions and their executors, making it easy to register entire tool families at once.

```typescript
interface ToolProvider {
  /** Unique provider name */
  readonly name: string;
  /** Returns tool definitions paired with their executors */
  getTools(): Array<{ definition: ToolDefinition; executor: ToolExecutor }>;
}
```

Providers are registered with the registry:

```typescript
// Register a provider -- all its tools are added to the registry
tools.registerProvider(new MemoryToolProvider(userId));
tools.registerProvider(new GoalToolProvider(userId));
tools.registerProvider(new CustomDataToolProvider(userId));

// Selectively apply providers to specific contexts
tools.useFor('conversation', [memoryProvider, goalProvider]);
```

This pattern replaces the manual loop of `register()` calls for each tool definition. The gateway uses providers for all service-backed tool families (memory, goals, custom data, personal data, etc.).

---

## Tool Middleware

Middleware intercepts tool execution for cross-cutting concerns like logging, validation, rate limiting, and event emission.

```typescript
interface ToolMiddleware {
  /** Middleware name for identification */
  name: string;
  /** Called before tool execution; can modify args or abort */
  before?(context: ToolContext, args: Record<string, unknown>): Promise<void>;
  /** Called after tool execution; can transform or augment the result */
  after?(context: ToolContext, result: ToolExecutionResult): Promise<ToolExecutionResult>;
}
```

Middleware is applied in registration order:

```
before(middleware1) → before(middleware2) → executor → after(middleware2) → after(middleware1)
```

Built-in middleware includes:

- **EventBus emission** -- emits `tool:before` and `tool:after` events for every tool call
- **Rate limiting** -- enforces per-tool and per-user call rate limits
- **Audit logging** -- records tool usage for analytics and debugging

---

## Batch Operations

Two batch mechanisms reduce round-trips between the LLM and the tool system:

### `batch_use_tool`

Executes multiple tool calls in a single request:

```typescript
// LLM calls batch_use_tool with an array of operations
{
  "tool_name": "batch_use_tool",
  "arguments": {
    "operations": [
      { "tool": "add_task", "args": { "title": "Buy groceries" } },
      { "tool": "add_task", "args": { "title": "Call dentist" } },
      { "tool": "add_bookmark", "args": { "url": "https://example.com", "title": "Example" } }
    ]
  }
}
```

All operations execute concurrently via `Promise.all()`. Each operation returns its own success/error status independently.

### `search_tools` with `include_params`

The `search_tools` meta-tool accepts an optional `include_params` flag. When set to `true`, the response includes the full parameter schema for each matching tool, eliminating the need for separate `get_tool_help` calls:

```
search_tools({ query: "email", include_params: true })
→ Returns tool names, descriptions, AND full parameter schemas
```

This reduces the typical three-step discovery workflow (search → help → use) to two steps (search+help → use).

---

## Tool Execution Lifecycle

When the LLM produces a tool call, this is the full sequence:

```
1. LLM returns CompletionResponse with toolCalls[]
2. For each ToolCall:
   a. Parse toolCall.arguments (JSON string -> object)
   b. Log the call via logToolCall() debug module
   c. Look up RegisteredTool by name
   d. Build full ToolContext:
      - Generate callId (UUID)
      - Inject pluginId from the registered tool
      - Attach workspaceDir
      - Attach Config Center accessors (getApiKey, getConfigEntry, etc.)
   e. Apply tool max limits (applyToolLimits) if applicable
   f. Call executor(args, context)
   g. Serialize result.content to string (JSON.stringify if object)
   h. Log result via logToolResult() (timing, success/failure, preview)
   i. Return ToolResult { toolCallId, content, isError }
3. ToolResults are sent back to LLM as tool role messages
4. LLM incorporates results and continues generation
```

Error handling at each stage:

- **JSON parse failure**: returns `ToolResult` with `isError: true` and error message.
- **Tool not found**: returns `NotFoundError`.
- **Executor throws**: caught and wrapped in `PluginError`.
- **Result serialization**: `undefined`/`null` content becomes empty string; objects are `JSON.stringify()`-ed.

---

## Tool Groups and Configuration

Defined in `packages/core/src/agent/tool-config.ts`, the `TOOL_GROUPS` constant organizes tools into configurable groups. Each group has:

```typescript
interface ToolGroupConfig {
  id: string; // e.g., "tasks", "codeExecution"
  name: string; // e.g., "Task Management"
  description: string;
  defaultEnabled: boolean; // Whether on by default
  tools: readonly string[];
  dependsOn?: string[]; // Dependencies on other groups
}
```

### Default-Enabled Groups

These groups are active out of the box for a personal assistant setup:

| Group         | Tools                                                                    | Description           |
| ------------- | ------------------------------------------------------------------------ | --------------------- |
| `core`        | get_current_time, calculate, generate_uuid                               | Essential utilities   |
| `filesystem`  | create_folder, write_file, read_file, list_files, delete_file, move_file | Workspace file ops    |
| `tasks`       | add_task, list_tasks, complete_task, update_task, delete_task            | Todo management       |
| `bookmarks`   | add_bookmark, list_bookmarks, delete_bookmark                            | URL bookmarks         |
| `notes`       | add_note, list_notes, update_note, delete_note                           | Text notes            |
| `calendar`    | add_calendar_event, list_calendar_events, delete_calendar_event          | Event scheduling      |
| `contacts`    | add_contact, list_contacts, update_contact, delete_contact               | People management     |
| `customData`  | 10 tools for dynamic table CRUD                                          | Flexible data storage |
| `memory`      | remember, recall, forget, list_memories                                  | AI persistent memory  |
| `goals`       | 7 tools for goal lifecycle                                               | Long-term objectives  |
| `customTools` | create_tool, list_custom_tools, delete_custom_tool, toggle_custom_tool   | Runtime tool creation |
| `textUtils`   | 9 text processing tools                                                  | Text transforms       |
| `dateTime`    | format_date, date_diff, add_to_date                                      | Date calculations     |
| `conversion`  | 10 unit/format conversion tools                                          | Unit conversion       |
| `generation`  | 5 random data tools                                                      | Random generation     |
| `extraction`  | extract_urls, extract_emails, extract_numbers                            | Data extraction       |
| `validation`  | validate_email, validate_url, test_regex                                 | Data validation       |
| `listOps`     | sort_list, deduplicate, create_table                                     | List processing       |
| `mathStats`   | calculate_percentage, calculate_statistics, count_words                  | Math/stats            |

### Disabled-by-Default Groups

These require additional infrastructure (Docker, API keys, SMTP config) and must be explicitly enabled:

| Group            | Reason Disabled                       |
| ---------------- | ------------------------------------- |
| `codeExecution`  | Requires Docker sandbox               |
| `webFetch`       | External HTTP access                  |
| `email`          | Requires SMTP/IMAP configuration      |
| `weather`        | Requires weather API key              |
| `git`            | Version control operations            |
| `image`          | Requires Vision/DALL-E API keys       |
| `audio`          | Requires Whisper/TTS API keys         |
| `pdf`            | PDF processing libraries              |
| `translation`    | Requires translation API              |
| `vectorSearch`   | Requires embedding API + vector store |
| `dataExtraction` | Requires AI extraction API            |

### Helper Functions

```typescript
// Get all tool names for currently enabled groups
getEnabledTools(enabledGroups?: string[]): string[]

// Get all group configs
getToolGroups(): ToolGroupConfig[]

// Find which group a tool belongs to
getGroupForTool(toolName: string): ToolGroupConfig | undefined

// Tool statistics
getToolStats(): { totalGroups, totalTools, enabledByDefault, disabledByDefault }
```

---

## Tool Discovery System

With 148+ tools, the LLM cannot have all tool schemas in every API request. OwnPilot solves this with a discovery-based architecture.

### Search Tags

Defined in `packages/core/src/agent/tools/tool-tags.ts`, the `TOOL_SEARCH_TAGS` registry maps tool names to arrays of search keywords. These keywords include:

- **Synonyms** (e.g., "todo" for `add_task`, "reminder" for `add_task`)
- **Related concepts** (e.g., "appointment" and "meeting" for `add_calendar_event`)
- **Common intents** (e.g., "send" and "notify" for `send_email`)
- **Technical terms** (e.g., "smtp" for email tools, "cron" for scheduler tools)

Example tag entries:

```typescript
TOOL_SEARCH_TAGS = {
  add_task: ['todo', 'to-do', 'plan', 'reminder', 'checklist', 'assignment', ...],
  remember: ['save', 'store', 'memorize', 'note', 'record', ...],
  search_web: ['google', 'internet', 'find', 'information', 'lookup', ...],
  // ... entries for every tool
}
```

Tags are **never sent to the LLM API** -- they are only used server-side by the `search_tools` meta-tool to find relevant tools.

### Meta-Tools

Three system-level meta-tools enable the LLM to discover and invoke tools dynamically:

#### `search_tools`

```
Name: search_tools
Category: System
Parameters:
  - query (string, required) -- Search keywords. Supports "all" to list everything.
  - category (string, optional) -- Filter by category name.
Returns: Matching tool names with short descriptions.
```

Uses word-by-word AND matching. The query "email send" finds `send_email` because both "email" and "send" appear in its name, description, or tags.

#### `get_tool_help`

```
Name: get_tool_help
Category: System
Parameters:
  - tool_name (string, required) -- Exact tool name from search_tools results.
Returns: Full parameter schema and usage details for the requested tool.
```

The LLM calls this after `search_tools` to learn exactly how to call a tool it discovered.

#### `use_tool`

```
Name: use_tool
Category: System
Parameters:
  - tool_name (string, required) -- Exact tool name.
  - arguments (object, required) -- Arguments matching the tool's parameter schema.
Returns: The tool's execution result.
```

This proxy tool executes any registered tool by name. It applies tool max limits automatically and includes parameter documentation in error messages so the LLM can self-correct.

**Discovery workflow:**

```
LLM receives user request
  |
  +--> search_tools("email send")
  |      returns: send_email, reply_email
  |
  +--> get_tool_help("send_email")
  |      returns: full parameter schema
  |
  +--> use_tool("send_email", { to: "...", subject: "...", body: "..." })
         returns: execution result
```

For tools that are directly in the LLM's context (loaded tool catalog), the LLM can skip discovery and call them by name directly.

---

## Tool Max Limits

Defined in `packages/core/src/agent/tools/tool-limits.ts`, the limit system prevents unbounded queries from list-returning tools. Every limit specifies:

```typescript
interface ToolLimit {
  readonly paramName: string; // Which argument controls count
  readonly maxValue: number; // Absolute ceiling
  readonly defaultValue: number; // Applied when LLM omits the parameter
}
```

The `applyToolLimits(toolName, args)` function is called in the `use_tool` proxy before execution. It:

1. Looks up the limit for the given tool name.
2. If the limit parameter is missing, injects the `defaultValue`.
3. If the limit parameter exceeds `maxValue`, caps it.
4. Returns a new args object (original is not mutated).

### Configured Limits

| Tool                    | Parameter  | Max | Default |
| ----------------------- | ---------- | --- | ------- |
| `list_emails`           | limit      | 50  | 20      |
| `search_emails`         | limit      | 100 | 50      |
| `list_tasks`            | limit      | 50  | 20      |
| `list_notes`            | limit      | 50  | 20      |
| `list_calendar_events`  | limit      | 50  | 20      |
| `list_contacts`         | limit      | 50  | 20      |
| `list_bookmarks`        | limit      | 50  | 20      |
| `query_expenses`        | limit      | 100 | 50      |
| `recall`                | limit      | 50  | 10      |
| `list_memories`         | limit      | 50  | 20      |
| `list_goals`            | limit      | 30  | 10      |
| `get_next_actions`      | limit      | 20  | 5       |
| `list_custom_records`   | limit      | 50  | 20      |
| `search_custom_records` | limit      | 50  | 20      |
| `git_log`               | limit      | 50  | 10      |
| `get_task_history`      | limit      | 50  | 10      |
| `search_files`          | maxResults | 100 | 50      |
| `search_web`            | maxResults | 20  | 10      |
| `semantic_search`       | topK       | 50  | 10      |

---

## Tool Categories Reference

All 24 categories and every tool within them. Each category section lists the tools, their parameters, and whether they have built-in executors or are definition-only.

---

### 1. Tasks

**Source:** `packages/core/src/agent/tools/personal-data.ts`
**Executor:** Definition-only (gateway provides executors with database access)

Tools for managing todo items with due dates, priorities, and categories.

| Tool              | Description                        | Required Params |
| ----------------- | ---------------------------------- | --------------- |
| `add_task`        | Add a new task/todo item           | `title`         |
| `batch_add_tasks` | Add multiple tasks at once         | `tasks` (array) |
| `list_tasks`      | List tasks with optional filtering | --              |
| `complete_task`   | Mark a task as completed           | `taskId`        |
| `update_task`     | Update task details                | `taskId`        |
| `delete_task`     | Delete a task permanently          | `taskId`        |

**`add_task` parameters:**

| Parameter  | Type   | Required | Description                                                |
| ---------- | ------ | -------- | ---------------------------------------------------------- |
| `title`    | string | Yes      | Task title/description                                     |
| `dueDate`  | string | No       | Due date in ISO format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss) |
| `priority` | string | No       | `low`, `normal`, `high`, or `urgent`                       |
| `category` | string | No       | Category name (e.g., "work", "personal", "shopping")       |
| `notes`    | string | No       | Additional notes or details                                |

**`list_tasks` parameters:**

| Parameter  | Type   | Required | Description                                           |
| ---------- | ------ | -------- | ----------------------------------------------------- |
| `status`   | string | No       | `pending`, `in_progress`, `completed`, or `cancelled` |
| `priority` | string | No       | `low`, `normal`, `high`, or `urgent`                  |
| `category` | string | No       | Filter by category                                    |
| `search`   | string | No       | Search in task titles                                 |
| `limit`    | number | No       | Max results (default: 20, max: 50)                    |

---

### 2. Bookmarks

**Source:** `packages/core/src/agent/tools/personal-data.ts`
**Executor:** Definition-only

Tools for saving and organizing URLs.

| Tool                  | Description                    | Required Params     |
| --------------------- | ------------------------------ | ------------------- |
| `add_bookmark`        | Save a URL as a bookmark       | `url`               |
| `batch_add_bookmarks` | Add multiple bookmarks at once | `bookmarks` (array) |
| `list_bookmarks`      | List bookmarks with filtering  | --                  |
| `delete_bookmark`     | Delete a bookmark              | `bookmarkId`        |

**`add_bookmark` parameters:**

| Parameter     | Type     | Required | Description                                   |
| ------------- | -------- | -------- | --------------------------------------------- |
| `url`         | string   | Yes      | The URL to bookmark                           |
| `title`       | string   | No       | Bookmark title (auto-detected if omitted)     |
| `description` | string   | No       | Brief description                             |
| `category`    | string   | No       | Category (e.g., "reading", "tech", "recipes") |
| `tags`        | string[] | No       | Tags for the bookmark                         |
| `isFavorite`  | boolean  | No       | Mark as favorite                              |

---

### 3. Notes

**Source:** `packages/core/src/agent/tools/personal-data.ts`
**Executor:** Definition-only

Tools for creating and managing text notes with markdown support.

| Tool              | Description                | Required Params    |
| ----------------- | -------------------------- | ------------------ |
| `add_note`        | Create a new note          | `title`, `content` |
| `batch_add_notes` | Add multiple notes at once | `notes` (array)    |
| `list_notes`      | List notes with filtering  | --                 |
| `update_note`     | Update an existing note    | `noteId`           |
| `delete_note`     | Delete a note permanently  | `noteId`           |

**`add_note` parameters:**

| Parameter  | Type     | Required | Description                               |
| ---------- | -------- | -------- | ----------------------------------------- |
| `title`    | string   | Yes      | Note title                                |
| `content`  | string   | Yes      | Note content (supports markdown)          |
| `category` | string   | No       | Category (e.g., "ideas", "meeting-notes") |
| `tags`     | string[] | No       | Tags for the note                         |
| `isPinned` | boolean  | No       | Whether to pin the note                   |

---

### 4. Calendar

**Source:** `packages/core/src/agent/tools/personal-data.ts`
**Executor:** Definition-only

Tools for scheduling events and appointments.

| Tool                        | Description                 | Required Params      |
| --------------------------- | --------------------------- | -------------------- |
| `add_calendar_event`        | Create a calendar event     | `title`, `startTime` |
| `batch_add_calendar_events` | Add multiple events at once | `events` (array)     |
| `list_calendar_events`      | List events with filtering  | --                   |
| `delete_calendar_event`     | Delete a calendar event     | `eventId`            |

**`add_calendar_event` parameters:**

| Parameter     | Type    | Required | Description                            |
| ------------- | ------- | -------- | -------------------------------------- |
| `title`       | string  | Yes      | Event title                            |
| `startTime`   | string  | Yes      | Start time in ISO format               |
| `endTime`     | string  | No       | End time in ISO format                 |
| `isAllDay`    | boolean | No       | Whether this is an all-day event       |
| `location`    | string  | No       | Event location                         |
| `description` | string  | No       | Event description                      |
| `category`    | string  | No       | Category (e.g., "meeting", "birthday") |
| `reminder`    | number  | No       | Reminder in minutes before event       |

---

### 5. Contacts

**Source:** `packages/core/src/agent/tools/personal-data.ts`
**Executor:** Definition-only

Tools for managing contact information.

| Tool                 | Description                   | Required Params    |
| -------------------- | ----------------------------- | ------------------ |
| `add_contact`        | Add a new contact             | `name`             |
| `batch_add_contacts` | Add multiple contacts at once | `contacts` (array) |
| `list_contacts`      | List contacts with filtering  | --                 |
| `update_contact`     | Update contact information    | `contactId`        |
| `delete_contact`     | Delete a contact              | `contactId`        |

**`add_contact` parameters:**

| Parameter      | Type    | Required | Description                                     |
| -------------- | ------- | -------- | ----------------------------------------------- |
| `name`         | string  | Yes      | Contact name                                    |
| `email`        | string  | No       | Email address                                   |
| `phone`        | string  | No       | Phone number                                    |
| `company`      | string  | No       | Company/organization                            |
| `jobTitle`     | string  | No       | Job title/role                                  |
| `relationship` | string  | No       | Relationship type (e.g., "friend", "colleague") |
| `birthday`     | string  | No       | Birthday in YYYY-MM-DD format                   |
| `address`      | string  | No       | Physical address                                |
| `notes`        | string  | No       | Additional notes                                |
| `isFavorite`   | boolean | No       | Mark as favorite                                |

---

### 6. Custom Data

**Source:** `packages/core/src/agent/tools/custom-data.ts`
**Executor:** Definition-only

A flexible dynamic table system for storing any data structure the user needs. Provides full CRUD operations on user-defined tables without arbitrary code execution. The system explicitly warns the LLM not to create custom tables for data types that already have dedicated tools (tasks, notes, bookmarks, etc.).

| Tool                       | Description                         | Required Params             |
| -------------------------- | ----------------------------------- | --------------------------- |
| `list_custom_tables`       | List all custom data tables         | --                          |
| `describe_custom_table`    | Get table schema and column details | `table`                     |
| `create_custom_table`      | Create a new custom table           | `table`, `columns`          |
| `delete_custom_table`      | Delete a custom table               | `table`                     |
| `add_custom_record`        | Add a record to a table             | `table`, `data`             |
| `batch_add_custom_records` | Add multiple records at once        | `table`, `records`          |
| `list_custom_records`      | List records with filtering         | `table`                     |
| `search_custom_records`    | Search records by field values      | `table`, `query`            |
| `get_custom_record`        | Get a single record by ID           | `table`, `recordId`         |
| `update_custom_record`     | Update a record                     | `table`, `recordId`, `data` |
| `delete_custom_record`     | Delete a record                     | `table`, `recordId`         |

---

### 7. File System

**Source:** `packages/core/src/agent/tools/file-system.ts`
**Executor:** Built-in (Node.js `fs` module)

Comprehensive file operations within a sandboxed workspace directory. Includes security measures:

- Path traversal prevention (all paths resolved against workspace directory)
- Symlink resolution to prevent escape attacks
- Configurable allowed directories (`WORKSPACE_DIR`, `/tmp`)
- Optional home directory access via `ALLOW_HOME_DIR_ACCESS` env var

| Tool             | Description                           | Required Params         |
| ---------------- | ------------------------------------- | ----------------------- |
| `read_file`      | Read file content                     | `path`                  |
| `write_file`     | Write content to a file               | `path`, `content`       |
| `list_directory` | List directory contents               | `path`                  |
| `search_files`   | Search for files by name/content      | `query`                 |
| `download_file`  | Download a file from URL              | `url`, `path`           |
| `file_info`      | Get file metadata (size, dates, type) | `path`                  |
| `delete_file`    | Delete a file                         | `path`                  |
| `copy_file`      | Copy a file to a new location         | `source`, `destination` |

---

### 8. PDF

**Source:** `packages/core/src/agent/tools/pdf-tools.ts`
**Executor:** Built-in

Tools for reading, creating, and extracting information from PDF documents.

| Tool         | Description                                 | Required Params         |
| ------------ | ------------------------------------------- | ----------------------- |
| `read_pdf`   | Extract text content from a PDF file        | `path`                  |
| `create_pdf` | Create a PDF document from content          | `content`, `outputPath` |
| `pdf_info`   | Get PDF metadata (page count, author, etc.) | `path`                  |

---

### 9. Code Execution (Sandbox)

**Source:** `packages/core/src/agent/tools/code-execution.ts`
**Executor:** Built-in (Docker sandbox required)
**Default Enabled:** No

Code execution is the most security-sensitive tool category. **Docker is mandatory** -- without Docker, all code execution is blocked with no exceptions. Additional safeguards:

- Maximum execution time: 30 seconds
- Maximum output size: 1MB
- Blocked dangerous shell commands (`rm -rf /`, `format c:`, `shutdown`, fork bombs, etc.)
- Sandboxed environment with no host access

| Tool                 | Description                                       | Required Params    |
| -------------------- | ------------------------------------------------- | ------------------ |
| `execute_javascript` | Execute JavaScript/Node.js code in Docker sandbox | `code`             |
| `execute_python`     | Execute Python code in Docker sandbox             | `code`             |
| `execute_shell`      | Execute shell commands in Docker sandbox          | `command`          |
| `compile_code`       | Compile code (supports multiple languages)        | `code`, `language` |
| `package_manager`    | Run package manager commands (npm, pip)           | `command`          |

**Security error (when Docker unavailable):**

```json
{
  "error": "Docker is REQUIRED for code execution.",
  "reason": "Code execution without Docker sandbox would allow arbitrary code to run on the host system.",
  "solution": "Please install and start Docker: https://docs.docker.com/get-docker/"
}
```

---

### 10. Git

**Source:** `packages/core/src/agent/tools/git-tools.ts`
**Executor:** Built-in
**Default Enabled:** No

Version control operations for the workspace directory.

| Tool           | Description                               | Required Params |
| -------------- | ----------------------------------------- | --------------- |
| `git_status`   | Show working tree status                  | --              |
| `git_diff`     | Show changes between commits/working tree | --              |
| `git_log`      | Show commit history                       | --              |
| `git_commit`   | Create a commit                           | `message`       |
| `git_add`      | Stage files for commit                    | `files`         |
| `git_branch`   | List, create, or delete branches          | --              |
| `git_checkout` | Switch branches or restore files          | `target`        |

---

### 11. Web and API

**Source:** `packages/core/src/agent/tools/web-fetch.ts`
**Executor:** Built-in
**Default Enabled:** No

HTTP requests and web interaction tools with security controls:

- Maximum response size: 5MB
- Request timeout: 30 seconds
- Blocked domains: localhost, private IP ranges (10.x, 172.16-31.x, 192.168.x), link-local (169.254.x)

| Tool             | Description                                       | Required Params |
| ---------------- | ------------------------------------------------- | --------------- |
| `http_request`   | Send HTTP requests (GET, POST, PUT, DELETE, etc.) | `url`, `method` |
| `fetch_web_page` | Fetch a web page and extract text content         | `url`           |
| `search_web`     | Search the web (requires search API)              | `query`         |
| `json_api`       | Simplified JSON API requests                      | `url`           |

---

### 12. Email

**Source:** `packages/core/src/agent/tools/email-tools.ts`
**Executor:** Built-in (requires SMTP/IMAP Config Center entries)
**Default Enabled:** No

Full email management via SMTP (sending) and IMAP (reading).

| Tool            | Description               | Required Params         |
| --------------- | ------------------------- | ----------------------- |
| `send_email`    | Send an email             | `to`, `subject`, `body` |
| `list_emails`   | List emails from inbox    | --                      |
| `read_email`    | Read a specific email     | `emailId`               |
| `delete_email`  | Delete an email           | `emailId`               |
| `search_emails` | Search emails by criteria | `query`                 |
| `reply_email`   | Reply to an email         | `emailId`, `body`       |

---

### 13. Image

**Source:** `packages/core/src/agent/tools/image-tools.ts`
**Executor:** Built-in (requires Vision/DALL-E API keys)
**Default Enabled:** No

Image analysis (Vision API) and generation (DALL-E).

| Tool              | Description                          | Required Params            |
| ----------------- | ------------------------------------ | -------------------------- |
| `analyze_image`   | Analyze an image using Vision API    | `image`                    |
| `generate_image`  | Generate an image from text (DALL-E) | `prompt`                   |
| `edit_image`      | Edit an existing image               | `image`, `prompt`          |
| `image_variation` | Create variations of an image        | `image`                    |
| `resize_image`    | Resize an image                      | `image`, `width`, `height` |

---

### 14. Audio

**Source:** `packages/core/src/agent/tools/audio-tools.ts`
**Executor:** Built-in (requires Whisper/TTS API keys)
**Default Enabled:** No

Text-to-speech, speech-to-text (Whisper), and audio processing.

| Tool              | Description                        | Required Params       |
| ----------------- | ---------------------------------- | --------------------- |
| `text_to_speech`  | Convert text to speech audio       | `text`                |
| `speech_to_text`  | Transcribe audio to text (Whisper) | `audio`               |
| `translate_audio` | Translate audio content            | `audio`               |
| `audio_info`      | Get audio file metadata            | `path`                |
| `split_audio`     | Split audio at specified points    | `path`, `splitPoints` |

---

### 15. Translation

**Source:** `packages/core/src/agent/tools/translation-tools.ts`
**Executor:** Built-in (requires translation API key)
**Default Enabled:** No

Multi-language translation and language detection.

| Tool              | Description                      | Required Params           |
| ----------------- | -------------------------------- | ------------------------- |
| `translate_text`  | Translate text between languages | `text`, `targetLanguage`  |
| `detect_language` | Detect the language of text      | `text`                    |
| `list_languages`  | List supported languages         | --                        |
| `batch_translate` | Translate multiple texts at once | `texts`, `targetLanguage` |

---

### 16. Data Extraction

**Source:** `packages/core/src/agent/tools/data-extraction-tools.ts`
**Executor:** Built-in (requires extraction API)
**Default Enabled:** No

Extract structured data from unstructured content using AI.

| Tool                      | Description                                      | Required Params  |
| ------------------------- | ------------------------------------------------ | ---------------- |
| `extract_structured_data` | Extract structured data from text using a schema | `text`, `schema` |
| `extract_entities`        | Extract named entities (people, dates, places)   | `text`           |
| `extract_table_data`      | Extract tabular data from text                   | `text`           |
| `summarize_text`          | Generate a summary of text                       | `text`           |

---

### 17. Vector Search

**Source:** `packages/core/src/agent/tools/vector-search-tools.ts`
**Executor:** Built-in (requires embedding API + vector store)
**Default Enabled:** No

Semantic search with embeddings for RAG (Retrieval-Augmented Generation) applications.

| Tool                       | Description                         | Required Params         |
| -------------------------- | ----------------------------------- | ----------------------- |
| `create_embedding`         | Create a vector embedding from text | `text`                  |
| `semantic_search`          | Search by semantic similarity       | `query`, `collection`   |
| `upsert_vectors`           | Insert or update vectors            | `collection`, `vectors` |
| `delete_vectors`           | Delete vectors from a collection    | `collection`, `ids`     |
| `list_vector_collections`  | List all vector collections         | --                      |
| `create_vector_collection` | Create a new vector collection      | `name`                  |
| `similarity_score`         | Calculate similarity between texts  | `text1`, `text2`        |

---

### 18. Finance

**Source:** `packages/core/src/agent/tools/expense-tracker.ts`
**Executor:** Built-in

Personal expense management with receipt parsing, CSV/JSON storage, and category tracking.

| Tool                 | Description                               | Required Params                     |
| -------------------- | ----------------------------------------- | ----------------------------------- |
| `add_expense`        | Record a new expense                      | `amount`, `category`, `description` |
| `batch_add_expenses` | Add multiple expenses at once             | `expenses` (array)                  |
| `parse_receipt`      | Extract expense data from a receipt image | `image`                             |
| `query_expenses`     | Query expenses with filters               | --                                  |
| `export_expenses`    | Export expenses to CSV/JSON               | `format`                            |
| `expense_summary`    | Get expense summary/analytics             | --                                  |
| `delete_expense`     | Delete an expense record                  | `expenseId`                         |

**Supported expense categories:** `food`, `transport`, `utilities`, `entertainment`, `shopping`, `health`, `education`, `travel`, `subscription`, `housing`, `other`.

---

### 19. Scheduler

**Source:** `packages/core/src/agent/tools/scheduler-tools.ts`
**Executor:** Built-in

Automation via scheduled/recurring tasks with cron-style scheduling.

| Tool                    | Description                       | Required Params    |
| ----------------------- | --------------------------------- | ------------------ |
| `create_scheduled_task` | Create a new scheduled task       | `name`, `schedule` |
| `list_scheduled_tasks`  | List all scheduled tasks          | --                 |
| `update_scheduled_task` | Update a scheduled task           | `taskId`           |
| `delete_scheduled_task` | Delete a scheduled task           | `taskId`           |
| `get_task_history`      | Get execution history for a task  | `taskId`           |
| `trigger_task`          | Manually trigger a scheduled task | `taskId`           |

---

### 20. Weather

**Source:** `packages/core/src/agent/tools/weather-tools.ts`
**Executor:** Built-in (requires weather API key)
**Default Enabled:** No

Current weather and forecast data.

| Tool                   | Description                          | Required Params |
| ---------------------- | ------------------------------------ | --------------- |
| `get_weather`          | Get current weather for a location   | `location`      |
| `get_weather_forecast` | Get weather forecast for coming days | `location`      |

---

### 21. Memory

**Source:** `packages/core/src/agent/tools/memory-tools.ts`
**Executor:** Definition-only (gateway provides database-backed executors)

Persistent memory system that allows the AI to store and retrieve facts, preferences, events, and skills across conversations. Memories have:

- A **type** (`fact`, `preference`, `event`, `skill`)
- An **importance score** (0-1) that determines recall priority and decay resistance
- Optional **tags** for categorization

| Tool             | Description                            | Required Params    |
| ---------------- | -------------------------------------- | ------------------ |
| `remember`       | Store information in persistent memory | `content`, `type`  |
| `batch_remember` | Store multiple memories at once        | `memories` (array) |
| `recall`         | Search memory for relevant information | `query`            |
| `forget`         | Remove a specific memory               | `memoryId`         |
| `list_memories`  | List recent memories                   | --                 |
| `boost_memory`   | Increase a memory's importance         | `memoryId`         |
| `memory_stats`   | Get memory system statistics           | --                 |

**`remember` parameters:**

| Parameter    | Type     | Required | Description                                           |
| ------------ | -------- | -------- | ----------------------------------------------------- |
| `content`    | string   | Yes      | The information to remember (concise but complete)    |
| `type`       | string   | Yes      | `fact`, `preference`, `event`, or `skill`             |
| `importance` | number   | No       | 0 to 1, higher = more important (default: 0.5)        |
| `tags`       | string[] | No       | Tags for categorization (e.g., ["work", "project-x"]) |

**`recall` parameters:**

| Parameter | Type     | Required | Description                        |
| --------- | -------- | -------- | ---------------------------------- |
| `query`   | string   | Yes      | Natural language search query      |
| `type`    | string   | No       | Filter by memory type              |
| `tags`    | string[] | No       | Filter by tags                     |
| `limit`   | number   | No       | Max results (default: 10, max: 50) |

---

### 22. Goals

**Source:** `packages/core/src/agent/tools/goal-tools.ts`
**Executor:** Definition-only (gateway provides database-backed executors)

Long-term objective tracking. Goals can be hierarchical (sub-goals via `parentId`), have priority levels (1-10), and go through a defined status lifecycle: `active` -> `paused` | `completed` | `abandoned`.

| Tool               | Description                             | Required Params |
| ------------------ | --------------------------------------- | --------------- |
| `create_goal`      | Create a new goal                       | `title`         |
| `list_goals`       | List goals by status                    | --              |
| `update_goal`      | Update goal status/progress/details     | `goalId`        |
| `decompose_goal`   | Break a goal into sub-goals/steps       | `goalId`        |
| `get_next_actions` | Get recommended next actions for goals  | --              |
| `complete_step`    | Mark a goal step as completed           | `stepId`        |
| `get_goal_details` | Get full goal information               | `goalId`        |
| `goal_stats`       | Get goal statistics and progress report | --              |

---

### 23. Dynamic Tools

**Source:** `packages/core/src/agent/tools/dynamic-tools.ts`
**Executor:** Built-in (sandboxed JavaScript execution)

The Dynamic Tools system allows the LLM (or users) to create, register, and execute custom tools at runtime. Created tools are stored in the database and executed in a sandboxed environment.

| Tool                 | Description                       | Required Params                             | Confirmation Required |
| -------------------- | --------------------------------- | ------------------------------------------- | --------------------- |
| `create_tool`        | Create a new reusable custom tool | `name`, `description`, `parameters`, `code` | Yes                   |
| `list_custom_tools`  | List all custom tools             | --                                          | No                    |
| `delete_custom_tool` | Delete a custom tool              | `name`                                      | Yes                   |
| `toggle_custom_tool` | Enable or disable a custom tool   | `name`, `enabled`                           | No                    |

See the [Dynamic Tool Creation](#dynamic-tool-creation) section for full details on the sandbox environment, permissions, and available utilities.

---

### 24. Utilities

**Source:** `packages/core/src/agent/tools/utility-tools.ts`
**Executor:** Built-in

A comprehensive collection of general-purpose tools for date/time, math, text, encoding, and data manipulation.

| Tool                   | Description                                              | Required Params          |
| ---------------------- | -------------------------------------------------------- | ------------------------ |
| `get_current_datetime` | Get current date/time with timezone support              | --                       |
| `date_diff`            | Calculate difference between two dates                   | `date1`, `date2`         |
| `date_add`             | Add/subtract time from a date                            | `date`, `amount`, `unit` |
| `calculate`            | Evaluate a mathematical expression                       | `expression`             |
| `statistics`           | Calculate statistical measures (mean, median, std, etc.) | `numbers`                |
| `convert_units`        | Convert between measurement units                        | `value`, `from`, `to`    |
| `generate_uuid`        | Generate a random UUID                                   | --                       |
| `generate_password`    | Generate a secure random password                        | --                       |
| `random_number`        | Generate a random number in range                        | `min`, `max`             |
| `hash_text`            | Hash text with various algorithms (SHA-256, MD5, etc.)   | `text`                   |
| `encode_decode`        | Base64, URL, hex encoding/decoding                       | `text`, `operation`      |
| `count_text`           | Count words, characters, sentences, lines                | `text`                   |
| `extract_from_text`    | Extract patterns from text using regex                   | `text`, `pattern`        |
| `transform_text`       | Transform text (uppercase, lowercase, trim, etc.)        | `text`, `operation`      |
| `compare_text`         | Compare two texts for differences/similarity             | `text1`, `text2`         |
| `regex`                | Execute regex operations (match, replace, test)          | `pattern`, `text`        |
| `format_json`          | Pretty-print/minify JSON                                 | `json`                   |
| `parse_csv`            | Parse CSV text to structured data                        | `csv`                    |
| `generate_csv`         | Generate CSV from structured data                        | `data`                   |
| `array_operations`     | Sort, filter, deduplicate, chunk arrays                  | `array`, `operation`     |
| `validate`             | Validate email, URL, phone, UUID, etc.                   | `value`, `type`          |
| `system_info`          | Get system information (OS, memory, CPU)                 | --                       |

**`get_current_datetime` returns:**

```json
{
  "iso": "2026-01-30T14:30:00.000Z",
  "formatted": "Thursday, 01/30/2026, 14:30:00",
  "unix": 1769862600,
  "unixMs": 1769862600000,
  "timezone": "Europe/Istanbul",
  "date": "2026-01-30",
  "time": "14:30:00",
  "dayOfWeek": "Friday",
  "weekNumber": 5,
  "quarter": 1,
  "isWeekend": false
}
```

---

## Security Model

The tool system implements defense-in-depth security:

### Path Security (File System)

- All file paths are resolved against the workspace directory.
- Symlinks are resolved via `realpath()` to prevent escape attacks.
- Path traversal (`../`) is detected and blocked.
- Only explicitly allowed directories are accessible (workspace, `/tmp`, optionally home).

### Code Execution Security

- Docker sandbox is **mandatory** -- no fallback to host execution.
- Blocked dangerous commands list (fork bombs, format, shutdown, etc.).
- Maximum 30-second execution time.
- Maximum 1MB output size.
- Resource limits enforced in sandbox (CPU, memory).

### Web Request Security

- Private/internal IP ranges are blocked (127.0.0.1, 10.x, 172.16-31.x, 192.168.x, 169.254.x).
- 30-second timeout.
- 5MB maximum response size.
- Invalid URLs are rejected.

### Dynamic Tool Security

- Forbidden code patterns are blocked: `process.exit`, `require()`, `import()`, `__dirname`, `global.`, `globalThis.`.
- Sandboxed execution with explicit permission grants (network, filesystem, shell).
- 30-second max execution time, 5-second CPU time, 50MB memory limit.
- `setTimeout` is explicitly blocked in the sandbox.

### Confirmation System

Tools with `requiresConfirmation: true` prompt the user in the UI before execution. This applies to destructive or sensitive operations like:

- `create_tool` (creating new dynamic tools)
- `delete_custom_tool` (deleting custom tools)

### Tool Max Limits

Prevent unbounded queries from overloading the system. List-returning tools have enforced maximum result counts that cannot be exceeded even if the LLM requests more.

---

## Definition-Only vs Built-In Executor Tools

OwnPilot uses a two-tier architecture for tools:

### Built-In Executor Tools

These tools have their executor functions defined right alongside their `ToolDefinition` in `packages/core`. They are self-contained and do not require database access.

**Source files with executors:**

| File                       | Tools                                               |
| -------------------------- | --------------------------------------------------- |
| `file-system.ts`           | File read/write/list/search/download/delete/copy    |
| `code-execution.ts`        | JS/Python/Shell execution, compile, package manager |
| `web-fetch.ts`             | HTTP requests, web page fetch, web search, JSON API |
| `expense-tracker.ts`       | Add/query/export/summarize expenses                 |
| `scheduler-tools.ts`       | Create/list/update/delete/trigger scheduled tasks   |
| `pdf-tools.ts`             | Read/create PDF, PDF info                           |
| `translation-tools.ts`     | Translate, detect language, list languages          |
| `image-tools.ts`           | Analyze/generate/edit/resize images                 |
| `email-tools.ts`           | Send/list/read/delete/search/reply emails           |
| `git-tools.ts`             | Status, diff, log, commit, add, branch, checkout    |
| `vector-search-tools.ts`   | Embeddings, semantic search, vector CRUD            |
| `audio-tools.ts`           | TTS, STT, translate, info, split                    |
| `data-extraction-tools.ts` | Structured data, entities, tables, summarize        |
| `weather-tools.ts`         | Current weather, forecast                           |
| `utility-tools.ts`         | Date/time, math, text, encoding, validation         |

### Definition-Only Tools

These export only `ToolDefinition[]` arrays. The gateway package imports these definitions and registers them with its own database-backed executor implementations.

| Export Array               | Module             | Description                                 |
| -------------------------- | ------------------ | ------------------------------------------- |
| `PERSONAL_DATA_TOOLS`      | `personal-data.ts` | Tasks, bookmarks, notes, calendar, contacts |
| `CUSTOM_DATA_TOOLS`        | `custom-data.ts`   | Dynamic table CRUD                          |
| `MEMORY_TOOLS`             | `memory-tools.ts`  | Persistent AI memory                        |
| `GOAL_TOOLS`               | `goal-tools.ts`    | Goal/objective tracking                     |
| `DYNAMIC_TOOL_DEFINITIONS` | `dynamic-tools.ts` | Tool creation/management meta-tools         |

The gateway wires up executors by calling `registry.register(definition, gatewayExecutor)` for each definition-only tool, or uses `registry.updateExecutor(name, executor)` to replace a placeholder with a real implementation.

---

## Dynamic Tool Creation

The Dynamic Tools system is the most powerful extensibility mechanism. The LLM can create entirely new tools at runtime by providing:

1. **Name** -- lowercase with underscores (validated: `^[a-z][a-z0-9_]*$`)
2. **Description** -- what the tool does
3. **Parameters** -- JSON Schema string for arguments
4. **Code** -- JavaScript implementation
5. **Permissions** -- what the code is allowed to do
6. **Required API Keys** -- services that auto-register in Config Center

### Sandbox Environment

Dynamic tool code runs in a secure sandbox with:

**Injected globals:**

- `args` -- the parsed tool arguments
- `context` -- `{ toolName, callId, conversationId, userId }`
- `fetch` -- only if `network` permission is granted
- `console` -- namespaced logging (`[DynamicTool:name]`)
- `JSON`, `Math`, `Date`, `Array`, `Object`, `String`, `Number`, `Boolean`, `RegExp`, `Map`, `Set`
- Standard functions: `parseInt`, `parseFloat`, `isNaN`, `isFinite`, `encodeURIComponent`, etc.
- `setTimeout` is explicitly **undefined** (blocked)

**`utils` helper object:**

| Category        | Functions                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Config Center   | `getApiKey(name)`, `getServiceConfig(name)`, `getConfigEntry(name, label?)`, `getConfigEntries(name)`, `getFieldValue(name, field, label?)` |
| Tool Invocation | `callTool(name, args)`, `listTools()`                                                                                                       |
| Hashing         | `hash(text, algo?)`                                                                                                                         |
| UUID            | `uuid()`                                                                                                                                    |
| Encoding        | `base64Encode`, `base64Decode`, `urlEncode`, `urlDecode`, `hexEncode`, `hexDecode`                                                          |
| Date/Time       | `now()`, `timestamp()`, `dateDiff(d1, d2, unit?)`, `dateAdd(date, amt, unit?)`, `formatDate(date, locale?)`                                 |
| Text            | `slugify`, `camelCase`, `snakeCase`, `kebabCase`, `titleCase`, `truncate`, `countWords`, `removeDiacritics`                                 |
| Validation      | `isEmail`, `isUrl`, `isJson`, `isUuid`                                                                                                      |
| Math            | `clamp`, `round`, `randomInt`, `sum`, `avg`                                                                                                 |
| Data            | `parseJson`, `toJson`, `parseCsv`, `flatten`, `getPath`                                                                                     |
| Array           | `unique`, `chunk`, `shuffle`, `sample`, `groupBy`                                                                                           |
| Password        | `generatePassword(length?)`                                                                                                                 |

### Permission System

| Permission   | What it enables                                 |
| ------------ | ----------------------------------------------- |
| `network`    | Access to `fetch()` for HTTP requests           |
| `filesystem` | Read and write access to the sandbox filesystem |
| `database`   | Access through injected database APIs           |
| `shell`      | Ability to spawn child processes                |
| `email`      | Access through injected email APIs              |
| `scheduling` | Access through injected scheduling APIs         |

### Resource Limits

| Resource           | Limit      |
| ------------------ | ---------- |
| Max execution time | 30 seconds |
| Max CPU time       | 5 seconds  |
| Max memory         | 50 MB      |

### Code Safety

The following patterns are blocked and will prevent tool registration:

- `process.exit`
- `require()`
- `import()`
- `__dirname` / `__filename`
- `global.` / `globalThis.`

### Example: Creating a Custom Weather Tool

```
LLM calls create_tool with:
  name: "check_weather_api"
  description: "Get weather from WeatherAPI.com"
  parameters: '{"type":"object","properties":{"city":{"type":"string","description":"City name"}},"required":["city"]}'
  code: |
    const apiKey = utils.getApiKey('weatherapi');
    if (!apiKey) return { error: 'WeatherAPI key not configured' };
    const resp = await fetch(`https://api.weatherapi.com/v1/current.json?key=${apiKey}&q=${args.city}`);
    const data = await resp.json();
    return { temp: data.current.temp_c, condition: data.current.condition.text };
  permissions: ["network"]
  required_api_keys: [{"name":"weatherapi","displayName":"WeatherAPI","docsUrl":"https://weatherapi.com"}]
```

---

## Source File Map

All tool source files are located under `packages/core/src/agent/tools/`.

| File                       | Description                                                    | Exports                                                                                                                                                                                                             |
| -------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`                 | Tool aggregation, registration helpers, category constants     | `ALL_TOOLS`, `TOOL_CATEGORIES`, `TOOL_SETS`, `registerAllTools()`, `registerToolSet()`, `getTool()`, `getToolDefinitions()`, `getToolExecutors()`, `getToolsByCategory()`, `getCategoryForTool()`, `getToolStats()` |
| `file-system.ts`           | File system operations with path security                      | `FILE_SYSTEM_TOOLS`                                                                                                                                                                                                 |
| `code-execution.ts`        | Docker-sandboxed code execution                                | `CODE_EXECUTION_TOOLS`                                                                                                                                                                                              |
| `web-fetch.ts`             | HTTP requests with blocked domains                             | `WEB_FETCH_TOOLS`                                                                                                                                                                                                   |
| `expense-tracker.ts`       | Personal finance tracking                                      | `EXPENSE_TRACKER_TOOLS`                                                                                                                                                                                             |
| `scheduler-tools.ts`       | Cron-style task scheduling                                     | `SCHEDULER_TOOLS`                                                                                                                                                                                                   |
| `custom-data.ts`           | Dynamic table CRUD (definitions only)                          | `CUSTOM_DATA_TOOLS`, `CUSTOM_DATA_TOOL_NAMES`                                                                                                                                                                       |
| `memory-tools.ts`          | Persistent AI memory (definitions only)                        | `MEMORY_TOOLS`, `MEMORY_TOOL_NAMES`                                                                                                                                                                                 |
| `goal-tools.ts`            | Goal tracking (definitions only)                               | `GOAL_TOOLS`, `GOAL_TOOL_NAMES`                                                                                                                                                                                     |
| `personal-data.ts`         | Tasks, bookmarks, notes, calendar, contacts (definitions only) | `PERSONAL_DATA_TOOLS`, `PERSONAL_DATA_TOOL_NAMES`                                                                                                                                                                   |
| `pdf-tools.ts`             | PDF read/create/info                                           | `PDF_TOOLS`, `PDF_TOOL_NAMES`                                                                                                                                                                                       |
| `translation-tools.ts`     | Multi-language translation                                     | `TRANSLATION_TOOLS`, `TRANSLATION_TOOL_NAMES`                                                                                                                                                                       |
| `image-tools.ts`           | Image analysis and generation                                  | `IMAGE_TOOLS`, `IMAGE_TOOL_NAMES`                                                                                                                                                                                   |
| `email-tools.ts`           | Email via SMTP/IMAP                                            | `EMAIL_TOOLS`, `EMAIL_TOOL_NAMES`                                                                                                                                                                                   |
| `git-tools.ts`             | Version control operations                                     | `GIT_TOOLS`, `GIT_TOOL_NAMES`                                                                                                                                                                                       |
| `vector-search-tools.ts`   | Semantic search and embeddings                                 | `VECTOR_SEARCH_TOOLS`, `VECTOR_SEARCH_TOOL_NAMES`                                                                                                                                                                   |
| `audio-tools.ts`           | TTS and STT                                                    | `AUDIO_TOOLS`, `AUDIO_TOOL_NAMES`                                                                                                                                                                                   |
| `data-extraction-tools.ts` | Structured data extraction                                     | `DATA_EXTRACTION_TOOLS`, `DATA_EXTRACTION_TOOL_NAMES`                                                                                                                                                               |
| `weather-tools.ts`         | Weather data                                                   | `WEATHER_TOOLS`, `WEATHER_TOOL_NAMES`                                                                                                                                                                               |
| `dynamic-tools.ts`         | Dynamic tool system, meta-tools, sandbox                       | `DYNAMIC_TOOL_DEFINITIONS`, `DYNAMIC_TOOL_NAMES`, `createDynamicToolRegistry()`                                                                                                                                     |
| `utility-tools.ts`         | Date, math, text, encoding, validation                         | `UTILITY_TOOLS`, `UTILITY_TOOL_NAMES`                                                                                                                                                                               |
| `tool-tags.ts`             | Search tag registry for discovery                              | `TOOL_SEARCH_TAGS`                                                                                                                                                                                                  |
| `tool-limits.ts`           | Max limit definitions for list tools                           | `TOOL_MAX_LIMITS`, `applyToolLimits()`                                                                                                                                                                              |

**Related files outside the tools directory:**

| File                                     | Description                                                                       |
| ---------------------------------------- | --------------------------------------------------------------------------------- |
| `packages/core/src/agent/types.ts`       | All TypeScript interfaces (`ToolDefinition`, `ToolExecutor`, `ToolContext`, etc.) |
| `packages/core/src/agent/tools.ts`       | `ToolRegistry` class, `createToolRegistry()`, core tool definitions               |
| `packages/core/src/agent/tool-config.ts` | `TOOL_GROUPS`, `DEFAULT_ENABLED_GROUPS`, group configuration helpers              |
| `packages/core/src/agent/debug.ts`       | `logToolCall()`, `logToolResult()` debug logging                                  |

---

## Quick Reference: All 170+ Tools by Category

| #   | Category        | Tool Count | Tools                                                                                                                                                                                                                                                                                                                                                     |
| --- | --------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Tasks           | 6          | `add_task`, `batch_add_tasks`, `list_tasks`, `complete_task`, `update_task`, `delete_task`                                                                                                                                                                                                                                                                |
| 2   | Bookmarks       | 4          | `add_bookmark`, `batch_add_bookmarks`, `list_bookmarks`, `delete_bookmark`                                                                                                                                                                                                                                                                                |
| 3   | Notes           | 5          | `add_note`, `batch_add_notes`, `list_notes`, `update_note`, `delete_note`                                                                                                                                                                                                                                                                                 |
| 4   | Calendar        | 4          | `add_calendar_event`, `batch_add_calendar_events`, `list_calendar_events`, `delete_calendar_event`                                                                                                                                                                                                                                                        |
| 5   | Contacts        | 5          | `add_contact`, `batch_add_contacts`, `list_contacts`, `update_contact`, `delete_contact`                                                                                                                                                                                                                                                                  |
| 6   | Custom Data     | 11         | `list_custom_tables`, `describe_custom_table`, `create_custom_table`, `delete_custom_table`, `add_custom_record`, `batch_add_custom_records`, `list_custom_records`, `search_custom_records`, `get_custom_record`, `update_custom_record`, `delete_custom_record`                                                                                         |
| 7   | File System     | 8          | `read_file`, `write_file`, `list_directory`, `search_files`, `download_file`, `file_info`, `delete_file`, `copy_file`                                                                                                                                                                                                                                     |
| 8   | PDF             | 3          | `read_pdf`, `create_pdf`, `pdf_info`                                                                                                                                                                                                                                                                                                                      |
| 9   | Code Execution  | 5          | `execute_javascript`, `execute_python`, `execute_shell`, `compile_code`, `package_manager`                                                                                                                                                                                                                                                                |
| 10  | Git             | 7          | `git_status`, `git_diff`, `git_log`, `git_commit`, `git_add`, `git_branch`, `git_checkout`                                                                                                                                                                                                                                                                |
| 11  | Web & API       | 4          | `http_request`, `fetch_web_page`, `search_web`, `json_api`                                                                                                                                                                                                                                                                                                |
| 12  | Email           | 6          | `send_email`, `list_emails`, `read_email`, `delete_email`, `search_emails`, `reply_email`                                                                                                                                                                                                                                                                 |
| 13  | Image           | 5          | `analyze_image`, `generate_image`, `edit_image`, `image_variation`, `resize_image`                                                                                                                                                                                                                                                                        |
| 14  | Audio           | 5          | `text_to_speech`, `speech_to_text`, `translate_audio`, `audio_info`, `split_audio`                                                                                                                                                                                                                                                                        |
| 15  | Translation     | 4          | `translate_text`, `detect_language`, `list_languages`, `batch_translate`                                                                                                                                                                                                                                                                                  |
| 16  | Data Extraction | 4          | `extract_structured_data`, `extract_entities`, `extract_table_data`, `summarize_text`                                                                                                                                                                                                                                                                     |
| 17  | Vector Search   | 7          | `create_embedding`, `semantic_search`, `upsert_vectors`, `delete_vectors`, `list_vector_collections`, `create_vector_collection`, `similarity_score`                                                                                                                                                                                                      |
| 18  | Finance         | 7          | `add_expense`, `batch_add_expenses`, `parse_receipt`, `query_expenses`, `export_expenses`, `expense_summary`, `delete_expense`                                                                                                                                                                                                                            |
| 19  | Scheduler       | 6          | `create_scheduled_task`, `list_scheduled_tasks`, `update_scheduled_task`, `delete_scheduled_task`, `get_task_history`, `trigger_task`                                                                                                                                                                                                                     |
| 20  | Weather         | 2          | `get_weather`, `get_weather_forecast`                                                                                                                                                                                                                                                                                                                     |
| 21  | Memory          | 7          | `remember`, `batch_remember`, `recall`, `forget`, `list_memories`, `boost_memory`, `memory_stats`                                                                                                                                                                                                                                                         |
| 22  | Goals           | 8          | `create_goal`, `list_goals`, `update_goal`, `decompose_goal`, `get_next_actions`, `complete_step`, `get_goal_details`, `goal_stats`                                                                                                                                                                                                                       |
| 23  | Dynamic Tools   | 7          | `search_tools`, `get_tool_help`, `use_tool`, `create_tool`, `list_custom_tools`, `delete_custom_tool`, `toggle_custom_tool`                                                                                                                                                                                                                               |
| 24  | Utilities       | 22         | `get_current_datetime`, `date_diff`, `date_add`, `calculate`, `statistics`, `convert_units`, `generate_uuid`, `generate_password`, `random_number`, `hash_text`, `encode_decode`, `count_text`, `extract_from_text`, `transform_text`, `compare_text`, `regex`, `format_json`, `parse_csv`, `generate_csv`, `array_operations`, `validate`, `system_info` |
| 25  | CLI Tools       | 3          | `run_cli_tool`, `list_cli_tools`, `install_cli_tool`                                                                                                                                                                                                                                                                                                      |
| 26  | Coding Agents   | 4          | `run_coding_task`, `list_coding_agents`, `get_task_result`, `list_task_results`                                                                                                                                                                                                                                                                            |

### 25. CLI Tools

**Source:** `packages/gateway/src/tools/cli-tool-tools.ts`

Gateway-registered tools for executing discovered CLI tools. These tools interact with the CLI Tools Discovery and Execution system.

| Tool              | Description                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `run_cli_tool`    | Execute a CLI tool by name with arguments. Respects per-tool policies (allowed/prompt/blocked) and risk scoring. |
| `list_cli_tools`  | List all discovered CLI tools with their install status, version, category, risk level, and current policy.  |
| `install_cli_tool`| Install a CLI tool via npx (for tools with an npx package defined in the catalog).                          |

**Parameters for `run_cli_tool`:**

| Parameter | Type     | Required | Description                            |
| --------- | -------- | -------- | -------------------------------------- |
| `name`    | `string` | Yes      | CLI tool name (from catalog or custom) |
| `args`    | `string[]` | No     | Command-line arguments array           |
| `cwd`     | `string` | No       | Working directory for execution        |
| `timeout` | `number` | No       | Timeout in milliseconds (default: 30s) |

### 26. Coding Agents

**Source:** `packages/gateway/src/tools/coding-agent-tools.ts`

Gateway-registered tools for delegating coding tasks to external AI coding agents. Creates visible sessions with real-time terminal output streaming.

| Tool                 | Description                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| `run_coding_task`    | Delegate a coding task to an external AI coding agent (Claude Code, Codex, Gemini CLI, or custom).       |
| `list_coding_agents` | List available coding agents with status (installed, configured, version).                                |
| `get_task_result`    | Get the result of a previously executed coding agent task by result ID.                                   |
| `list_task_results`  | List recent coding agent task results (provider, prompt, success, duration, cost).                        |

**Parameters for `run_coding_task`:**

| Parameter         | Type     | Required | Description                                                         |
| ----------------- | -------- | -------- | ------------------------------------------------------------------- |
| `provider`        | `string` | Yes      | `claude-code`, `codex`, `gemini-cli`, or `custom:{name}`           |
| `prompt`          | `string` | Yes      | Task description — be specific about files and expected outcome     |
| `cwd`             | `string` | No       | Working directory (absolute path)                                   |
| `model`           | `string` | No       | Model override (provider-specific)                                  |
| `max_budget_usd`  | `number` | No       | Maximum cost in USD (default: 1.0, Claude Code SDK only)            |
| `max_turns`       | `number` | No       | Maximum agent turns (default: 10, Claude Code SDK only)             |
| `timeout_seconds` | `number` | No       | Timeout in seconds (default: 300, max: 1800)                        |
