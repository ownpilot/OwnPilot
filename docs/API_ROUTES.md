# OwnPilot Gateway API Reference

Complete HTTP API reference for the OwnPilot Gateway, a Hono-based server running on Node.js with `@hono/node-server`.

**Base URL:** `http://localhost:8080`
**API Prefix:** `/api/v1`
**Transport:** HTTP/1.1, Server-Sent Events (SSE), WebSocket (`ws` library)
**Database:** PostgreSQL via `pg`
**Authentication:** JWT tokens via `jose` library (planned; currently single-user mode with `userId = "default"`)

All JSON responses follow a standard envelope:

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "requestId": "uuid",
    "timestamp": "2025-01-30T12:00:00.000Z",
    "processingTime": 42
  }
}
```

Error responses:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description"
  }
}
```

---

## Table of Contents

1. [Health](#1-health)
2. [Chat](#2-chat)
3. [Agents](#3-agents)
4. [Tools](#4-tools)
5. [Custom Tools](#5-custom-tools)
6. [Models](#6-models)
7. [Model Configs](#7-model-configs)
8. [Providers](#8-providers)
9. [Local Providers](#9-local-providers)
10. [Settings](#10-settings)
11. [Costs](#11-costs)
12. [Channels](#12-channels)
13. [Personal Data](#13-personal-data)
14. [Custom Data](#14-custom-data)
15. [Memories](#15-memories)
16. [Goals](#16-goals)
17. [Triggers](#17-triggers)
18. [Plans](#18-plans)
19. [Autonomy](#19-autonomy)
20. [Expenses](#20-expenses)
21. [Database](#21-database)
22. [Integrations](#22-integrations)
23. [Media Settings](#23-media-settings)
24. [Productivity](#24-productivity)
25. [Dashboard](#25-dashboard)
26. [Profile](#26-profile)
27. [Auth](#27-auth)
28. [Workspaces](#28-workspaces)
29. [File Workspaces](#29-file-workspaces)
30. [Config Services](#30-config-services)
31. [Plugins](#31-plugins)
32. [Debug](#32-debug)
33. [Audit](#33-audit)

---

## 1. Health

**Mount:** `/health` and `/api/v1/health`
**Source:** `packages/gateway/src/routes/health.ts`

Health checks for server status, Docker sandbox availability, and database connectivity.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Full health check with subsystem statuses |
| `GET` | `/health/live` | Kubernetes liveness probe |
| `GET` | `/health/ready` | Kubernetes readiness probe |
| `GET` | `/health/sandbox` | Docker sandbox diagnostics |
| `POST` | `/health/sandbox/reset` | Reset sandbox detection cache |
| `POST` | `/health/sandbox/pull-images` | Pull Docker images for code execution |

### GET /health

Returns overall system health including core module, database connection, and Docker sandbox availability.

**Response:**

```json
{
  "success": true,
  "data": {
    "status": "healthy | degraded | unhealthy",
    "version": "1.0.0",
    "uptime": 3600.5,
    "checks": [
      { "name": "core", "status": "pass", "message": "Core module loaded" },
      { "name": "database", "status": "pass", "message": "POSTGRES connected (localhost)" },
      { "name": "docker", "status": "pass", "message": "Docker available (v24.0.0)" }
    ],
    "database": {
      "type": "postgres",
      "connected": true,
      "host": "localhost"
    },
    "sandbox": {
      "dockerAvailable": true,
      "dockerVersion": "24.0.0",
      "codeExecutionEnabled": true,
      "securityMode": "strict"
    }
  }
}
```

### GET /health/sandbox

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `refresh` | boolean | `false` | Force re-detect Docker capabilities |

### POST /health/sandbox/pull-images

Pulls the three default sandbox Docker images: `python:3.11-slim`, `node:20-slim`, `alpine:latest`.

**Response:** Per-image success/failure results.

---

## 2. Chat

**Mount:** `/api/v1/chat`
**Source:** `packages/gateway/src/routes/chat.ts`

Core chat endpoint for sending messages to the AI, managing conversations, and retrieving chat history. Supports both synchronous and SSE streaming modes.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/chat` | Send a chat message |
| `GET` | `/chat/conversations/:id` | Get in-memory conversation |
| `DELETE` | `/chat/conversations/:id` | Delete in-memory conversation |
| `GET` | `/chat/history` | List all DB-persisted conversations |
| `GET` | `/chat/history/:id` | Get conversation with all messages |
| `DELETE` | `/chat/history/:id` | Delete conversation from DB |
| `PATCH` | `/chat/history/:id/archive` | Archive/unarchive conversation |
| `GET` | `/chat/logs` | Get request/response logs |
| `GET` | `/chat/logs/stats` | Get log statistics |
| `GET` | `/chat/logs/:id` | Get single log detail |
| `DELETE` | `/chat/logs` | Clear logs |
| `POST` | `/chat/reset-context` | Reset chat agent context |

### POST /chat

Send a message and receive an AI response. Supports streaming via SSE.

**Request Body:**

```json
{
  "message": "Hello, what can you do?",
  "conversationId": "uuid (optional, resume existing)",
  "agentId": "agent_123 (optional, use specific agent)",
  "provider": "openai (optional, default: openai)",
  "model": "gpt-4o (optional)",
  "stream": true,
  "includeToolList": true,
  "workspaceId": "ws_abc (optional)",
  "directTools": ["tool_name1"],
  "history": []
}
```

**Non-streaming Response:**

```json
{
  "success": true,
  "data": {
    "id": "msg_uuid",
    "conversationId": "conv_uuid",
    "message": "AI response text...",
    "response": "AI response text...",
    "model": "gpt-4o",
    "toolCalls": [
      { "id": "tc_1", "name": "get_current_time", "arguments": {} }
    ],
    "usage": {
      "promptTokens": 150,
      "completionTokens": 80,
      "totalTokens": 230
    },
    "finishReason": "stop",
    "trace": {
      "duration": 1234,
      "toolCalls": [],
      "modelCalls": [],
      "autonomyChecks": [],
      "dbOperations": { "reads": 0, "writes": 0 },
      "memoryOps": { "adds": 0, "recalls": 0 },
      "triggersFired": [],
      "errors": [],
      "events": []
    }
  }
}
```

**Streaming (SSE) Events:**

When `stream: true`, the response uses `text/event-stream` content type.

| Event | Description |
|-------|-------------|
| `chunk` | Text delta from the model |
| `done` | Final chunk with usage, trace, and finish reason |
| `progress` | Tool start/end and status updates |
| `autonomy` | Tool call blocked by autonomy system |
| `error` | Error during streaming |

Each `chunk` event data:

```json
{
  "id": "chunk_id",
  "conversationId": "conv_uuid",
  "delta": "partial text",
  "toolCalls": null,
  "done": false,
  "finishReason": null,
  "usage": null
}
```

### GET /chat/history

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | `50` | Max conversations to return |
| `offset` | number | `0` | Pagination offset |
| `search` | string | -- | Search in conversation titles |
| `agentId` | string | -- | Filter by agent |
| `archived` | boolean | `false` | Show archived conversations |

### GET /chat/logs

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | `100` | Max logs to return |
| `offset` | number | `0` | Pagination offset |
| `type` | string | -- | Filter: `chat`, `completion`, `embedding`, `tool`, `agent`, `other` |
| `errors` | boolean | -- | `true` for errors only, `false` for non-errors |
| `conversationId` | string | -- | Filter by conversation |

### DELETE /chat/logs

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `all` | boolean | `false` | Clear ALL logs |
| `olderThanDays` | number | `30` | Clear logs older than N days |

### POST /chat/reset-context

**Request Body:**

```json
{
  "provider": "openai",
  "model": "gpt-4o",
  "clearAll": false
}
```

If `clearAll: true`, clears all cached chat agent contexts. Otherwise resets only the specific provider/model pair.

---

## 3. Agents

**Mount:** `/api/v1/agents`
**Source:** `packages/gateway/src/routes/agents.ts`

Full CRUD for AI agent configurations. Agents are persisted in PostgreSQL and cached in memory at runtime. Each agent has a system prompt, provider/model configuration, and tool group assignments.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/agents` | List all agents |
| `POST` | `/agents` | Create a new agent |
| `GET` | `/agents/:id` | Get agent details |
| `PATCH` | `/agents/:id` | Update agent |
| `DELETE` | `/agents/:id` | Delete agent |
| `POST` | `/agents/:id/reset` | Reset agent conversation |
| `POST` | `/agents/resync` | Resync agents from default templates |

### POST /agents

**Request Body:**

```json
{
  "name": "Code Assistant",
  "systemPrompt": "You are a coding assistant...",
  "provider": "openai (or 'default')",
  "model": "gpt-4o (or 'default')",
  "tools": ["get_current_time", "calculate"],
  "toolGroups": ["core", "filesystem"],
  "maxTokens": 8192,
  "temperature": 0.7,
  "maxTurns": 25,
  "maxToolCalls": 200
}
```

- `provider` / `model` default to `"default"`, resolved at runtime from user settings.
- Tools can be specified explicitly via `tools` array or by referencing `toolGroups`.

**Response:** `201 Created`

```json
{
  "success": true,
  "data": {
    "id": "agent_1706000000000_abc1234",
    "name": "Code Assistant",
    "provider": "openai",
    "model": "gpt-4o",
    "tools": ["get_current_time", "calculate", "read_file", "write_file"],
    "createdAt": "2025-01-30T12:00:00.000Z"
  }
}
```

### GET /agents/:id

Returns full agent detail including system prompt and config.

```json
{
  "success": true,
  "data": {
    "id": "agent_123",
    "name": "Code Assistant",
    "provider": "openai",
    "model": "gpt-4o",
    "systemPrompt": "You are a coding assistant...",
    "tools": ["get_current_time", "calculate"],
    "config": {
      "maxTokens": 8192,
      "temperature": 0.7,
      "maxTurns": 25,
      "maxToolCalls": 200,
      "tools": ["get_current_time"],
      "toolGroups": ["core"]
    },
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

### POST /agents/resync

Resyncs agent definitions from the default agents template. Updates existing agents and creates missing ones.

**Response:**

```json
{
  "success": true,
  "data": {
    "updated": 3,
    "created": 1,
    "total": 4,
    "errors": []
  }
}
```

---

## 4. Tools

**Mount:** `/api/v1/tools`
**Source:** `packages/gateway/src/routes/tools.ts`

List, inspect, and execute tools. Tools are grouped by category (core, filesystem, memory, goals, tasks, etc.). Supports direct execution, streaming execution, and batch execution.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/tools` | List available tools |
| `GET` | `/tools/meta/categories` | Get tool categories with counts |
| `GET` | `/tools/meta/grouped` | Get all tools grouped by category |
| `GET` | `/tools/:name` | Get tool details |
| `GET` | `/tools/:name/source` | Get tool executor source code |
| `POST` | `/tools/:name/execute` | Execute a tool directly |
| `POST` | `/tools/:name/stream` | Execute tool with SSE streaming output |
| `POST` | `/tools/batch` | Batch execute multiple tools |

### GET /tools

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `agentId` | string | -- | Filter to tools available for this agent |
| `grouped` | boolean | `false` | Return grouped by category |

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "name": "get_current_time",
      "description": "Get the current date and time",
      "parameters": { "type": "object", "properties": {} },
      "category": "core",
      "source": "core"
    }
  ]
}
```

### POST /tools/:name/execute

**Request Body:**

```json
{
  "arguments": {
    "expression": "2 + 2"
  }
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "tool": "calculate",
    "result": "4",
    "isError": false,
    "duration": 5
  }
}
```

### POST /tools/batch

**Request Body:**

```json
{
  "executions": [
    { "tool": "get_current_time", "arguments": {} },
    { "tool": "calculate", "arguments": { "expression": "10 * 5" } }
  ],
  "parallel": true
}
```

**Response:** Array of individual tool results with `successCount` and `failureCount`.

---

## 5. Custom Tools

**Mount:** `/api/v1/custom-tools`
**Source:** `packages/gateway/src/routes/custom-tools.ts`

CRUD for user-defined and LLM-created dynamic tools. Supports an approval workflow, enable/disable toggling, code sandbox execution, and dry-run testing.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/custom-tools` | List custom tools |
| `GET` | `/custom-tools/stats` | Get statistics |
| `GET` | `/custom-tools/pending` | Get tools pending approval |
| `GET` | `/custom-tools/active/definitions` | Get active tool definitions for LLM |
| `GET` | `/custom-tools/:id` | Get a specific custom tool |
| `POST` | `/custom-tools` | Create a new custom tool |
| `PATCH` | `/custom-tools/:id` | Update a custom tool |
| `DELETE` | `/custom-tools/:id` | Delete a custom tool |
| `POST` | `/custom-tools/:id/enable` | Enable a tool |
| `POST` | `/custom-tools/:id/disable` | Disable a tool |
| `POST` | `/custom-tools/:id/approve` | Approve a pending tool |
| `POST` | `/custom-tools/:id/reject` | Reject a pending tool |
| `POST` | `/custom-tools/:id/execute` | Execute a custom tool |
| `POST` | `/custom-tools/test` | Test a tool without saving (dry run) |

### POST /custom-tools

**Request Body:**

```json
{
  "name": "format_phone",
  "description": "Format a phone number to international format",
  "parameters": {
    "type": "object",
    "properties": {
      "phone": { "type": "string", "description": "Phone number" },
      "countryCode": { "type": "string", "default": "+1" }
    },
    "required": ["phone"]
  },
  "code": "return `${args.countryCode}${args.phone.replace(/\\D/g, '')}`;",
  "category": "utility",
  "permissions": [],
  "requiresApproval": false,
  "createdBy": "user",
  "requiredApiKeys": []
}
```

**Validation rules:**
- Tool name must match `^[a-z][a-z0-9_]*$`
- Code is scanned for dangerous patterns (`process.exit`, `require()`, `import()`, `__dirname`, `global.`, `globalThis.`)
- LLM-created tools default to `requiresApproval: true`
- Duplicate names are rejected with `409 Conflict`

**Response:** `201 Created` with the full tool record.

### GET /custom-tools

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | `active`, `disabled`, `pending_approval` |
| `category` | string | Filter by category |
| `createdBy` | string | `user` or `llm` |
| `limit` | number | Pagination limit |
| `offset` | number | Pagination offset |

---

## 6. Models

**Mount:** `/api/v1/models`
**Source:** `packages/gateway/src/routes/models.ts`

List AI models from configured providers. Model data is loaded from JSON config files synced from models.dev.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/models` | List all available models |
| `GET` | `/models/catalog/all` | Full catalog without API key check |
| `GET` | `/models/sync/providers` | List providers from models.dev |
| `POST` | `/models/sync` | Sync provider configs from models.dev |
| `GET` | `/models/:provider` | Get models for a specific provider |

### GET /models

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `enabledOnly` | boolean | `true` | Filter to enabled models only |

**Response:**

```json
{
  "success": true,
  "data": {
    "models": [
      {
        "id": "gpt-4o",
        "name": "GPT-4o",
        "provider": "openai",
        "contextWindow": 128000,
        "maxOutputTokens": 16384,
        "inputPrice": 2.5,
        "outputPrice": 10,
        "capabilities": ["chat", "vision", "function_calling", "streaming"],
        "recommended": true
      }
    ],
    "configuredProviders": ["openai", "anthropic"],
    "availableProviders": ["openai", "anthropic", "google", "deepseek", "groq"]
  }
}
```

### POST /models/sync

**Request Body (optional):**

```json
{
  "providers": ["openai", "anthropic"]
}
```

If `providers` is omitted, syncs all providers from models.dev.

---

## 7. Model Configs

**Mount:** `/api/v1/model-configs`
**Source:** `packages/gateway/src/routes/model-configs.ts`

Manages user model configuration overrides, custom providers, and model enable/disable state. Provides a merged view combining builtin providers, aggregator providers, custom providers, and local providers.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/model-configs` | List all models (merged view) |
| `POST` | `/model-configs` | Create custom model |
| `GET` | `/model-configs/providers/list` | List all providers (merged) |
| `GET` | `/model-configs/providers/available` | List available providers to add |
| `GET` | `/model-configs/providers/:id` | Get single provider with models |
| `POST` | `/model-configs/providers` | Create/enable custom provider |
| `PUT` | `/model-configs/providers/:id` | Update provider |
| `DELETE` | `/model-configs/providers/:id` | Delete custom provider |
| `PATCH` | `/model-configs/providers/:id/toggle` | Toggle provider enabled |
| `POST` | `/model-configs/providers/:id/discover-models` | Discover models from provider API |
| `GET` | `/model-configs/capabilities/list` | List capability types |
| `GET` | `/model-configs/:provider` | List models for a provider |
| `GET` | `/model-configs/:provider/:model` | Get single model |
| `PUT` | `/model-configs/:provider/:model` | Update model config |
| `DELETE` | `/model-configs/:provider/:model` | Delete custom model or override |
| `PATCH` | `/model-configs/:provider/:model/toggle` | Toggle model enabled |
| `POST` | `/model-configs/sync` | Check sync status with models.dev |
| `POST` | `/model-configs/sync/apply` | Apply sync from models.dev |
| `POST` | `/model-configs/sync/reset` | Full reset and resync |
| `DELETE` | `/model-configs/sync/provider/:id` | Delete specific provider config |

### GET /model-configs

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `provider` | string | Filter by provider ID |
| `capability` | string | Filter by capability (`chat`, `vision`, `code`, etc.) |
| `enabled` | boolean | Filter to enabled models only |
| `userId` | string | User ID (default: `"default"`) |

**Response:** Array of `MergedModel` objects with `source` field (`builtin`, `aggregator`, `custom`, `local`).

### POST /model-configs/providers/:id/discover-models

Fetches models from the provider's OpenAI-compatible `/v1/models` endpoint and saves them as custom models. Tries multiple URL patterns (`/v1/models`, `/api/v1/models`, `/models`).

---

## 8. Providers

**Mount:** `/api/v1/providers`
**Source:** `packages/gateway/src/routes/providers.ts`

AI provider listing and configuration. Provider configs are loaded from JSON files. Includes UI metadata (colors, API key placeholders), category groupings, and per-user config overrides.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/providers` | List all providers |
| `GET` | `/providers/categories` | Get provider categories |
| `GET` | `/providers/overrides/all` | Get all user config overrides |
| `GET` | `/providers/:id` | Get full provider config |
| `GET` | `/providers/:id/models` | Get models for a provider |
| `GET` | `/providers/:id/config` | Get user config overrides |
| `PUT` | `/providers/:id/config` | Update user config override |
| `DELETE` | `/providers/:id/config` | Delete user config override |
| `PATCH` | `/providers/:id/toggle` | Toggle provider enabled/disabled |

### GET /providers

**Response:**

```json
{
  "success": true,
  "data": {
    "providers": [
      {
        "id": "openai",
        "name": "OpenAI",
        "type": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "apiKeyEnv": "OPENAI_API_KEY",
        "docsUrl": "https://platform.openai.com/docs",
        "features": {
          "streaming": true,
          "toolUse": true,
          "vision": true,
          "jsonMode": true,
          "systemMessage": true
        },
        "modelCount": 12,
        "isConfigured": true,
        "isEnabled": true,
        "hasOverride": false,
        "configSource": "database",
        "color": "#10a37f",
        "apiKeyPlaceholder": "sk-..."
      }
    ],
    "categories": {
      "Popular": ["openai", "anthropic", "google", "deepseek"],
      "Cloud Platforms": ["azure", "amazon-bedrock"],
      "Inference Providers": ["togetherai", "fireworks-ai"]
    },
    "total": 50
  }
}
```

### PUT /providers/:id/config

**Request Body:**

```json
{
  "baseUrl": "https://my-proxy.example.com/v1",
  "providerType": "openai",
  "isEnabled": true,
  "apiKeyEnv": "MY_CUSTOM_KEY",
  "notes": "Using proxy"
}
```

---

## 9. Local Providers

**Mount:** `/api/v1/local-providers`
**Source:** `packages/gateway/src/routes/local-providers.ts`

Management for local AI providers (LM Studio, Ollama, LocalAI, vLLM, custom OpenAI-compatible servers). Supports auto-discovery of models from running servers.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/local-providers/templates` | Get provider templates |
| `GET` | `/local-providers` | List all local providers |
| `POST` | `/local-providers` | Add a local provider |
| `GET` | `/local-providers/:id` | Get provider details |
| `PUT` | `/local-providers/:id` | Update provider |
| `DELETE` | `/local-providers/:id` | Delete provider |
| `PATCH` | `/local-providers/:id/toggle` | Toggle provider enabled |
| `POST` | `/local-providers/:id/discover` | Discover models from provider |
| `GET` | `/local-providers/:id/models` | List models for provider |
| `POST` | `/local-providers/:id/models` | Add model manually |
| `PATCH` | `/local-providers/:id/models/:modelId/toggle` | Toggle model enabled |
| `DELETE` | `/local-providers/:id/models/:modelId` | Delete model |

### GET /local-providers/templates

Returns predefined templates:

```json
{
  "success": true,
  "data": [
    { "id": "lmstudio", "name": "LM Studio", "providerType": "lmstudio", "baseUrl": "http://localhost:1234" },
    { "id": "ollama", "name": "Ollama", "providerType": "ollama", "baseUrl": "http://localhost:11434" },
    { "id": "localai", "name": "LocalAI", "providerType": "localai", "baseUrl": "http://localhost:8080" },
    { "id": "vllm", "name": "vLLM", "providerType": "vllm", "baseUrl": "http://localhost:8000" },
    { "id": "custom", "name": "Custom Local Server", "providerType": "custom", "baseUrl": "http://localhost:8080" }
  ]
}
```

---

## 10. Settings

**Mount:** `/api/v1/settings`
**Source:** `packages/gateway/src/routes/settings.ts`

Application settings key-value store. Manages API keys, default provider/model selection, sandbox settings, and general configuration. All settings are persisted in the database.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/settings` | Get current settings overview |
| `GET` | `/settings/data-info` | Get data directory information |
| `GET` | `/settings/api-key/:provider` | Check if API key is configured |
| `POST` | `/settings/api-key/:provider` | Set API key for a provider |
| `DELETE` | `/settings/api-key/:provider` | Remove API key for a provider |
| `GET` | `/settings/defaults` | Get default provider/model |
| `POST` | `/settings/defaults` | Set default provider/model |
| `GET` | `/settings/sandbox` | Get sandbox settings |
| `POST` | `/settings/sandbox` | Update sandbox settings |
| `GET` | `/settings/:key` | Get a setting value |
| `POST` | `/settings/:key` | Set a setting value |
| `DELETE` | `/settings/:key` | Delete a setting |

### GET /settings

**Response:**

```json
{
  "success": true,
  "data": {
    "configuredProviders": ["openai", "anthropic", "lmstudio"],
    "localProviders": [
      { "id": "lmstudio", "name": "LM Studio", "type": "local" }
    ],
    "demoMode": false,
    "defaultProvider": "openai",
    "defaultModel": "gpt-4o",
    "availableProviders": ["openai", "anthropic", "google", "deepseek"]
  }
}
```

### POST /settings/api-key/:provider

**Request Body:**

```json
{
  "apiKey": "sk-..."
}
```

API keys are stored encrypted in the database settings table.

---

## 11. Costs

**Mount:** `/api/v1/costs`
**Source:** `packages/gateway/src/routes/costs.ts`

LLM usage cost tracking and budget management. Tracks tokens, costs, latency, and error rates across all providers.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/costs` | Get cost summary |
| `GET` | `/costs/usage` | Get usage records |
| `GET` | `/costs/by-provider` | Breakdown by provider |
| `GET` | `/costs/by-model` | Breakdown by model |
| `GET` | `/costs/timeline` | Cost timeline |
| `POST` | `/costs/estimate` | Estimate cost for a request |
| `GET` | `/costs/budget` | Get budget status |
| `POST` | `/costs/budget` | Set budget config |
| `GET` | `/costs/pricing` | Get model pricing table |

### GET /costs

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `period` | string | `month` | `day`, `week`, `month`, `year` |
| `userId` | string | -- | Filter by user |

**Response:**

```json
{
  "success": true,
  "data": {
    "period": "month",
    "summary": {
      "totalRequests": 150,
      "successfulRequests": 148,
      "failedRequests": 2,
      "totalInputTokens": 50000,
      "totalOutputTokens": 25000,
      "totalCost": 1.25,
      "totalCostFormatted": "$1.25",
      "averageLatencyMs": 850
    },
    "budget": {
      "daily": { "limit": 5.0, "used": 0.50, "remaining": 4.50 },
      "monthly": { "limit": 100.0, "used": 1.25, "remaining": 98.75 },
      "alerts": []
    }
  }
}
```

---

## 12. Channels

**Mount:** `/api/v1/channels`
**Source:** `packages/gateway/src/routes/channels.ts`

Communication channel management for Telegram, Discord, Slack, and other messaging platforms. Manages channel configurations, message inbox, and webhook endpoints.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/channels` | List configured channels |
| `POST` | `/channels` | Add a new channel |
| `GET` | `/channels/messages/inbox` | Get all messages from all channels |
| `POST` | `/channels/messages/:messageId/read` | Mark message as read |
| `POST` | `/channels/messages/:messageId/reply` | Reply to a message |
| `GET` | `/channels/:id` | Get channel details |
| `PATCH` | `/channels/:id` | Update channel config |
| `DELETE` | `/channels/:id` | Delete channel |
| `POST` | `/channels/:id/test` | Test channel connection |
| `POST` | `/channels/:id/webhook` | Webhook endpoint for incoming messages |

### GET /channels/messages/inbox

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `filter` | string | `all` | `all`, `unread`, `unanswered` |
| `channelType` | string | -- | Filter by channel type |
| `limit` | number | `50` | Max messages to return |

---

## 13. Personal Data

**Mount:** `/api/v1` (sub-routes: `/tasks`, `/bookmarks`, `/notes`, `/calendar`, `/contacts`)
**Source:** `packages/gateway/src/routes/personal-data.ts`

CRUD APIs for personal data management: tasks, bookmarks, notes, calendar events, and contacts.

### Tasks `/api/v1/tasks`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/tasks` | List tasks (with query filters) |
| `GET` | `/tasks/today` | Get tasks due today |
| `GET` | `/tasks/overdue` | Get overdue tasks |
| `GET` | `/tasks/upcoming` | Get upcoming tasks |
| `POST` | `/tasks` | Create task |
| `GET` | `/tasks/:id` | Get task |
| `PATCH` | `/tasks/:id` | Update task |
| `DELETE` | `/tasks/:id` | Delete task |

**Query Parameters for GET /tasks:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | `pending`, `in_progress`, `completed`, `cancelled` |
| `priority` | string | `low`, `medium`, `high`, `urgent` |
| `category` | string | Category filter |
| `projectId` | string | Project filter |
| `search` | string | Full-text search |
| `limit` | number | Pagination limit |
| `offset` | number | Pagination offset |

### Bookmarks `/api/v1/bookmarks`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/bookmarks` | List bookmarks |
| `POST` | `/bookmarks` | Create bookmark |
| `GET` | `/bookmarks/:id` | Get bookmark |
| `PATCH` | `/bookmarks/:id` | Update bookmark |
| `DELETE` | `/bookmarks/:id` | Delete bookmark |

### Notes `/api/v1/notes`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/notes` | List notes |
| `POST` | `/notes` | Create note |
| `GET` | `/notes/:id` | Get note |
| `PATCH` | `/notes/:id` | Update note |
| `DELETE` | `/notes/:id` | Delete note |

### Calendar `/api/v1/calendar`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/calendar` | List events |
| `POST` | `/calendar` | Create event |
| `GET` | `/calendar/:id` | Get event |
| `PATCH` | `/calendar/:id` | Update event |
| `DELETE` | `/calendar/:id` | Delete event |

### Contacts `/api/v1/contacts`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/contacts` | List contacts |
| `POST` | `/contacts` | Create contact |
| `GET` | `/contacts/:id` | Get contact |
| `PATCH` | `/contacts/:id` | Update contact |
| `DELETE` | `/contacts/:id` | Delete contact |

---

## 14. Custom Data

**Mount:** `/api/v1/custom-data`
**Source:** `packages/gateway/src/routes/custom-data.ts`

Dynamic custom table schemas and record management. Users and the AI can create arbitrary data tables with typed columns and manage records within them.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/custom-data/tables` | List all custom tables |
| `POST` | `/custom-data/tables` | Create a new table |
| `GET` | `/custom-data/tables/:table` | Get table details |
| `DELETE` | `/custom-data/tables/:table` | Delete table |
| `GET` | `/custom-data/tables/:table/records` | List records |
| `POST` | `/custom-data/tables/:table/records` | Add record |
| `GET` | `/custom-data/tables/:table/records/:id` | Get record |
| `PATCH` | `/custom-data/tables/:table/records/:id` | Update record |
| `DELETE` | `/custom-data/tables/:table/records/:id` | Delete record |
| `POST` | `/custom-data/tables/:table/search` | Search records |

### POST /custom-data/tables

**Request Body:**

```json
{
  "name": "recipes",
  "displayName": "Recipes",
  "description": "My recipe collection",
  "columns": [
    { "name": "title", "type": "text", "required": true },
    { "name": "servings", "type": "number" },
    { "name": "ingredients", "type": "text" },
    { "name": "isFavorite", "type": "boolean" }
  ]
}
```

---

## 15. Memories

**Mount:** `/api/v1/memories`
**Source:** `packages/gateway/src/routes/memories.ts`

Persistent AI memory system. Memories have types (fact, preference, event, skill), importance scores, and support search and deduplication.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/memories` | List memories |
| `POST` | `/memories` | Create a memory |
| `GET` | `/memories/:id` | Get a memory |
| `PATCH` | `/memories/:id` | Update a memory |
| `DELETE` | `/memories/:id` | Delete a memory |
| `POST` | `/memories/search` | Search memories |
| `POST` | `/memories/:id/boost` | Boost memory importance |

### GET /memories

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `userId` | string | `default` | User ID |
| `type` | string | -- | `fact`, `preference`, `event`, `skill` |
| `limit` | number | `20` | Max memories to return |
| `minImportance` | number | -- | Minimum importance score (0-1) |

### POST /memories

Creates a new memory. If a similar memory already exists, the existing one is boosted instead of creating a duplicate.

**Request Body:**

```json
{
  "content": "User prefers dark mode",
  "type": "preference",
  "importance": 0.7,
  "tags": ["ui", "preference"]
}
```

---

## 16. Goals

**Mount:** `/api/v1/goals`
**Source:** `packages/gateway/src/routes/goals.ts`

Goal and goal-step management. Goals have progress tracking, priority, due dates, and support hierarchical decomposition into steps.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/goals` | List goals |
| `POST` | `/goals` | Create a goal |
| `GET` | `/goals/:id` | Get goal details |
| `PATCH` | `/goals/:id` | Update goal |
| `DELETE` | `/goals/:id` | Delete goal |
| `GET` | `/goals/:id/steps` | List goal steps |
| `POST` | `/goals/:id/steps` | Add goal step |
| `PATCH` | `/goals/:id/steps/:stepId` | Update step |
| `DELETE` | `/goals/:id/steps/:stepId` | Delete step |
| `GET` | `/goals/active` | Get active goals |
| `GET` | `/goals/next-actions` | Get suggested next actions |

### GET /goals

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `userId` | string | `default` | User ID |
| `status` | string | -- | `active`, `completed`, `paused`, `abandoned` |
| `limit` | number | `20` | Max goals to return |
| `parentId` | string | -- | Filter by parent goal |

---

## 17. Triggers

**Mount:** `/api/v1/triggers`
**Source:** `packages/gateway/src/routes/triggers.ts`

Proactive trigger management. Triggers fire based on schedules (cron), events, or conditions and execute actions automatically.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/triggers` | List triggers |
| `POST` | `/triggers` | Create a trigger |
| `GET` | `/triggers/:id` | Get trigger details |
| `PATCH` | `/triggers/:id` | Update trigger |
| `DELETE` | `/triggers/:id` | Delete trigger |
| `POST` | `/triggers/:id/fire` | Manually fire a trigger |
| `GET` | `/triggers/:id/history` | Get trigger fire history |
| `PATCH` | `/triggers/:id/toggle` | Enable/disable trigger |

### POST /triggers

**Request Body:**

```json
{
  "name": "Daily Standup Reminder",
  "type": "schedule",
  "config": {
    "cron": "0 9 * * 1-5"
  },
  "action": {
    "type": "chat",
    "message": "Time for your daily standup! What are your goals today?"
  },
  "enabled": true
}
```

**Query Parameters for GET /triggers:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `type` | string | Trigger type filter |
| `enabled` | boolean | Filter by enabled status |
| `limit` | number | Pagination limit |

---

## 18. Plans

**Mount:** `/api/v1/plans`
**Source:** `packages/gateway/src/routes/plans.ts`

Autonomous plan management. Plans consist of ordered steps that can be executed, paused, and resumed. Plans can be linked to goals and triggers.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/plans` | List plans |
| `POST` | `/plans` | Create a plan |
| `GET` | `/plans/:id` | Get plan details |
| `PATCH` | `/plans/:id` | Update plan |
| `DELETE` | `/plans/:id` | Delete plan |
| `POST` | `/plans/:id/execute` | Execute plan |
| `POST` | `/plans/:id/pause` | Pause plan execution |
| `POST` | `/plans/:id/resume` | Resume plan execution |
| `GET` | `/plans/:id/history` | Get execution history |
| `GET` | `/plans/:id/steps` | List plan steps |
| `POST` | `/plans/:id/steps` | Add plan step |
| `PATCH` | `/plans/:id/steps/:stepId` | Update step |
| `DELETE` | `/plans/:id/steps/:stepId` | Delete step |

### GET /plans

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `status` | string | -- | `draft`, `active`, `paused`, `completed`, `failed` |
| `goalId` | string | -- | Filter by linked goal |
| `triggerId` | string | -- | Filter by linked trigger |
| `limit` | number | `20` | Pagination limit |
| `offset` | number | `0` | Pagination offset |

---

## 19. Autonomy

**Mount:** `/api/v1/autonomy`
**Source:** `packages/gateway/src/routes/autonomy.ts`

Autonomy level management, risk assessment, and approval workflows. Controls how much freedom agents have to execute tools without user confirmation.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/autonomy/config` | Get autonomy configuration |
| `PATCH` | `/autonomy/config` | Update autonomy configuration |
| `POST` | `/autonomy/config/reset` | Reset to default configuration |
| `POST` | `/autonomy/assess` | Assess risk of an action |
| `GET` | `/autonomy/pending` | Get pending approvals |
| `POST` | `/autonomy/approve/:id` | Approve a pending action |
| `POST` | `/autonomy/reject/:id` | Reject a pending action |

### GET /autonomy/config

**Response:**

```json
{
  "success": true,
  "data": {
    "config": { ... },
    "levels": [
      { "level": 0, "name": "Manual", "description": "All actions require approval" },
      { "level": 1, "name": "Supervised", "description": "Safe actions auto-approved" },
      { "level": 2, "name": "Guided", "description": "Most actions auto-approved" },
      { "level": 3, "name": "Autonomous", "description": "Full autonomy" }
    ]
  }
}
```

---

## 20. Expenses

**Mount:** `/api/v1/expenses`
**Source:** `packages/gateway/src/routes/expenses.ts`

Expense tracking and management. Stores expenses with categories, payment methods, tags, and supports analytics.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/expenses` | List expenses |
| `POST` | `/expenses` | Add expense |
| `GET` | `/expenses/:id` | Get expense |
| `PATCH` | `/expenses/:id` | Update expense |
| `DELETE` | `/expenses/:id` | Delete expense |
| `GET` | `/expenses/summary` | Get expense summary |
| `GET` | `/expenses/categories` | Get category configs |
| `POST` | `/expenses/categories` | Update category budget |

**Expense Categories:** `food`, `transport`, `utilities`, `entertainment`, `shopping`, `health`, `education`, `travel`, `subscription`, `housing`, `other`

---

## 21. Database

**Mount:** `/api/v1/database`
**Source:** `packages/gateway/src/routes/database.ts`

PostgreSQL database management endpoints for backup, restore, and maintenance operations.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/database/status` | Database status and stats |
| `POST` | `/database/backup` | Create database backup |
| `GET` | `/database/backups` | List available backups |
| `POST` | `/database/restore` | Restore from backup |
| `DELETE` | `/database/backups/:name` | Delete a backup file |
| `GET` | `/database/operations` | Get current operation status |
| `POST` | `/database/maintenance` | Run maintenance (VACUUM, ANALYZE) |

### GET /database/status

**Response:**

```json
{
  "success": true,
  "data": {
    "type": "postgres",
    "connected": true,
    "host": "localhost",
    "databaseSize": "45 MB",
    "tableCount": 28,
    "hasLegacyData": false,
    "backups": [
      { "name": "backup_2025-01-30.sql", "size": 12345678, "created": "..." }
    ],
    "operationStatus": { "isRunning": false }
  }
}
```

---

## 22. Integrations

**Mount:** `/api/v1/integrations`
**Source:** `packages/gateway/src/routes/integrations.ts`

Manages OAuth integrations for external services (Gmail, Google Calendar, Google Drive).

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/integrations/available` | List available integrations |
| `GET` | `/integrations/connected` | List connected integrations |
| `GET` | `/integrations/:id` | Get integration details |
| `DELETE` | `/integrations/:id` | Disconnect an integration |

### GET /integrations/available

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "provider": "google",
      "service": "gmail",
      "name": "Gmail",
      "description": "Read, send, and manage emails via Gmail API",
      "icon": "mail",
      "requiredConfig": ["google_oauth_client_id", "google_oauth_client_secret"],
      "isConfigured": true
    }
  ]
}
```

---

## 23. Media Settings

**Mount:** `/api/v1/media-settings`
**Source:** `packages/gateway/src/routes/media-settings.ts`

Configure media providers for image generation, vision/OCR, text-to-speech, speech-to-text, and weather.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/media-settings` | Get all media settings |
| `GET` | `/media-settings/:capability` | Get settings for a capability |
| `POST` | `/media-settings/:capability` | Update settings for a capability |
| `DELETE` | `/media-settings/:capability` | Reset settings for a capability |

**Capabilities:** `image_generation`, `vision`, `tts`, `stt`, `weather`

### POST /media-settings/:capability

**Request Body:**

```json
{
  "provider": "openai",
  "model": "dall-e-3"
}
```

---

## 24. Productivity

**Mount:** `/api/v1` (sub-routes: `/pomodoro`, `/habits`, `/captures`)
**Source:** `packages/gateway/src/routes/productivity.ts`

Productivity tools: Pomodoro timer, habit tracking, and quick capture inbox.

### Pomodoro `/api/v1/pomodoro`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/pomodoro/session` | Get active session |
| `POST` | `/pomodoro/session/start` | Start a new session |
| `POST` | `/pomodoro/session/stop` | Stop active session |
| `POST` | `/pomodoro/session/complete` | Mark session as completed |
| `GET` | `/pomodoro/history` | Get session history |
| `GET` | `/pomodoro/stats` | Get productivity stats |
| `GET` | `/pomodoro/settings` | Get Pomodoro settings |
| `PATCH` | `/pomodoro/settings` | Update Pomodoro settings |

### Habits `/api/v1/habits`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/habits` | List habits |
| `POST` | `/habits` | Create habit |
| `GET` | `/habits/:id` | Get habit |
| `PATCH` | `/habits/:id` | Update habit |
| `DELETE` | `/habits/:id` | Delete habit |
| `POST` | `/habits/:id/complete` | Mark habit as completed today |
| `GET` | `/habits/:id/history` | Get completion history |
| `GET` | `/habits/stats` | Get habit statistics |

### Captures `/api/v1/captures`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/captures` | List captures |
| `POST` | `/captures` | Create a quick capture |
| `GET` | `/captures/:id` | Get capture |
| `PATCH` | `/captures/:id` | Update capture |
| `DELETE` | `/captures/:id` | Delete capture |
| `POST` | `/captures/:id/process` | Process capture (convert to task/note/etc.) |

---

## 25. Dashboard

**Mount:** `/api/v1/dashboard`
**Source:** `packages/gateway/src/routes/dashboard.ts`

AI-powered daily briefing dashboard. Aggregates data from tasks, calendar, goals, habits, and generates an AI summary.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/dashboard/briefing` | Get daily briefing with AI summary |
| `GET` | `/dashboard/stats` | Get overview stats |
| `DELETE` | `/dashboard/briefing/cache` | Clear briefing cache |

### GET /dashboard/briefing

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `refresh` | boolean | `false` | Force regenerate AI briefing |
| `aiOnly` | boolean | `false` | Only return AI briefing, not raw data |
| `provider` | string | -- | Override AI provider |
| `model` | string | -- | Override AI model |

**Response:**

```json
{
  "success": true,
  "data": {
    "data": {
      "tasks": { "due": 3, "overdue": 1, "completed": 5 },
      "calendar": { "today": 2, "upcoming": 4 },
      "goals": { "active": 3, "progress": 45 },
      "habits": { "streaks": [...] }
    },
    "aiBriefing": {
      "summary": "Good morning! You have 3 tasks due today...",
      "priorities": ["Complete project proposal", "Review PR #42"],
      "suggestions": ["Consider scheduling a break between meetings"],
      "cached": false
    }
  }
}
```

---

## 26. Profile

**Mount:** `/api/v1/profile`
**Source:** `packages/gateway/src/routes/profile.ts`

User profile management for AI personalization. Stores personal facts, preferences, and communication style.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/profile` | Get full user profile |
| `GET` | `/profile/summary` | Get profile summary for prompts |
| `PUT` | `/profile` | Update profile |
| `PATCH` | `/profile` | Partial update profile |
| `GET` | `/profile/:category` | Get profile category data |
| `PUT` | `/profile/:category` | Update profile category |

**Profile Categories:** `basicInfo`, `preferences`, `communication`, `work`, `interests`, `health`, `goals`

---

## 27. Auth

**Mount:** `/api/v1/auth`
**Source:** `packages/gateway/src/routes/auth.ts`

OAuth authentication flows for external service integrations. Currently supports Google OAuth for Gmail, Calendar, and Drive.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/auth/status` | Check OAuth configuration status |
| `POST` | `/auth/config/google` | Save Google OAuth credentials |
| `DELETE` | `/auth/config/google` | Remove Google OAuth credentials |
| `GET` | `/auth/google/start` | Start Google OAuth flow (redirects to Google) |
| `GET` | `/auth/google/callback` | Google OAuth callback handler |
| `POST` | `/auth/google/revoke` | Revoke/disconnect a Google integration |
| `POST` | `/auth/google/refresh` | Refresh an expired token |

### GET /auth/google/start

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `service` | string | `gmail` | `gmail`, `calendar`, `drive` |
| `returnUrl` | string | `/settings` | URL to redirect back to after auth |
| `userId` | string | `default` | User ID |

Redirects the browser to Google's OAuth consent screen. On success, Google redirects back to `/auth/google/callback` which exchanges the code for tokens and stores them in the database.

### POST /auth/config/google

**Request Body:**

```json
{
  "clientId": "xxx.apps.googleusercontent.com",
  "clientSecret": "GOCSPX-xxx",
  "redirectUri": "http://localhost:8080/api/v1/auth/google/callback"
}
```

### POST /auth/google/revoke

**Request Body:**

```json
{
  "integrationId": "uuid"
}
```

Revokes the token with Google and deletes the integration from the database.

---

## 28. Workspaces

**Mount:** `/api/v1/workspaces`
**Source:** `packages/gateway/src/routes/workspaces.ts`

Isolated user workspaces with Docker container execution. Provides workspace CRUD, file operations, and sandboxed code execution.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/workspaces` | List user's workspaces |
| `POST` | `/workspaces` | Create workspace |
| `GET` | `/workspaces/:id` | Get workspace details |
| `PATCH` | `/workspaces/:id` | Update workspace |
| `DELETE` | `/workspaces/:id` | Delete workspace |
| `GET` | `/workspaces/:id/files` | List files in workspace |
| `GET` | `/workspaces/:id/files/*` | Read a file |
| `PUT` | `/workspaces/:id/files/*` | Write a file |
| `DELETE` | `/workspaces/:id/files/*` | Delete a file |
| `POST` | `/workspaces/:id/execute` | Execute code in workspace sandbox |
| `GET` | `/workspaces/docker-status` | Check Docker availability |

### POST /workspaces/:id/execute

**Request Body:**

```json
{
  "language": "python",
  "code": "print('Hello, World!')",
  "timeout": 30000,
  "containerConfig": {
    "memoryLimit": "256m",
    "cpuLimit": "1"
  }
}
```

**Supported Languages:** `python`, `javascript`, `typescript`, `shell`

---

## 29. File Workspaces

**Mount:** `/api/v1/file-workspaces`
**Source:** `packages/gateway/src/routes/file-workspaces.ts`

Lightweight session-based file workspaces. Isolated directories for agent file operations without full Docker containers.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/file-workspaces` | List all session workspaces |
| `POST` | `/file-workspaces` | Create a session workspace |
| `GET` | `/file-workspaces/:id` | Get workspace details |
| `DELETE` | `/file-workspaces/:id` | Delete workspace |
| `GET` | `/file-workspaces/:id/files` | List files |
| `GET` | `/file-workspaces/:id/files/*` | Read file content |
| `PUT` | `/file-workspaces/:id/files/*` | Write file |
| `DELETE` | `/file-workspaces/:id/files/*` | Delete file |
| `GET` | `/file-workspaces/:id/download` | Download workspace as ZIP |
| `POST` | `/file-workspaces/cleanup` | Clean up old workspaces |

### POST /file-workspaces

**Request Body:**

```json
{
  "name": "My Workspace",
  "agentId": "agent_123",
  "sessionId": "session_abc",
  "description": "Working on data analysis",
  "tags": ["python", "analysis"]
}
```

---

## 30. Config Services

**Mount:** `/api/v1/config-services`
**Source:** `packages/gateway/src/routes/config-services.ts`

Centralized, schema-driven configuration management. Services define configuration schemas and entries. Secrets are automatically masked in all API responses.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/config-services` | List all config services |
| `POST` | `/config-services` | Create a config service |
| `GET` | `/config-services/:name` | Get service with entries |
| `PUT` | `/config-services/:name` | Update service definition |
| `DELETE` | `/config-services/:name` | Delete service |
| `GET` | `/config-services/:name/entries` | List entries for a service |
| `POST` | `/config-services/:name/entries` | Create entry |
| `GET` | `/config-services/:name/entries/:id` | Get entry |
| `PUT` | `/config-services/:name/entries/:id` | Update entry |
| `DELETE` | `/config-services/:name/entries/:id` | Delete entry |

**Security:** Fields with `type: "secret"` in the schema are automatically masked in responses (e.g., `sk-a...b1c2`).

---

## 31. Plugins

**Mount:** `/api/v1/plugins`
**Source:** `packages/gateway/src/routes/plugins.ts`

Plugin management system. Plugins provide additional tools, event handlers, and capabilities. Supports enable/disable, permission granting, and configuration.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/plugins` | List all plugins |
| `GET` | `/plugins/:id` | Get plugin details |
| `POST` | `/plugins/:id/enable` | Enable plugin |
| `POST` | `/plugins/:id/disable` | Disable plugin |
| `POST` | `/plugins/:id/permissions` | Grant permissions |
| `GET` | `/plugins/:id/settings` | Get plugin settings |
| `PUT` | `/plugins/:id/settings` | Update plugin settings |
| `POST` | `/plugins/reload` | Reload all plugins |

### GET /plugins

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "plugin-gmail",
      "name": "Gmail Plugin",
      "version": "1.0.0",
      "description": "Gmail integration for reading, sending, and managing emails",
      "status": "active",
      "capabilities": ["tools"],
      "permissions": ["network"],
      "grantedPermissions": ["network"],
      "toolCount": 5,
      "tools": ["email_send", "email_read", "email_search", "email_delete", "list_emails"],
      "category": "email",
      "hasSettings": true,
      "requiredServices": [
        { "name": "google-oauth", "displayName": "Google OAuth", "isConfigured": true }
      ],
      "hasUnconfiguredServices": false
    }
  ]
}
```

---

## 32. Debug

**Mount:** `/api/v1/debug`
**Source:** `packages/gateway/src/routes/debug.ts`

Debug endpoints for viewing AI request/response logs and internal state.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/debug` | Get debug log entries |
| `GET` | `/debug/recent` | Get recent entries only |
| `DELETE` | `/debug` | Clear debug log |
| `POST` | `/debug/toggle` | Enable/disable debug logging |

### GET /debug

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `count` | number | `50` | Number of entries to return |

**Response:**

```json
{
  "success": true,
  "data": {
    "enabled": true,
    "summary": { "totalEntries": 150, "requestCount": 45, "errorCount": 2 },
    "entries": [
      {
        "type": "request",
        "timestamp": "...",
        "data": { "provider": "openai", "model": "gpt-4o", "endpoint": "chat/completions" }
      }
    ]
  }
}
```

### POST /debug/toggle

**Request Body:**

```json
{
  "enabled": true
}
```

---

## 33. Audit

**Mount:** `/api/v1/audit`
**Source:** `packages/gateway/src/routes/audit.ts`

Audit log system for all agent activities, tool executions, and system events.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/audit` | Query audit events with filters |
| `GET` | `/audit/stats` | Get audit statistics |
| `DELETE` | `/audit` | Clear audit logs |

### GET /audit

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `types` | string | Comma-separated event types (e.g., `tool.success,tool.error`) |
| `actorId` | string | Filter by actor ID |
| `actorType` | string | `agent`, `user`, `system` |
| `resourceId` | string | Filter by resource ID |
| `resourceType` | string | `tool`, `session`, `agent` |
| `minSeverity` | string | `debug`, `info`, `warn`, `error`, `critical` |
| `outcome` | string | `success`, `failure` |
| `from` | string | Start date (ISO 8601) |
| `to` | string | End date (ISO 8601) |
| `correlationId` | string | Filter by request/correlation ID |
| `limit` | number | Max events (default: 100) |
| `offset` | number | Pagination offset |
| `order` | string | `asc` or `desc` (default: `desc`) |

**Response:**

```json
{
  "success": true,
  "data": {
    "events": [
      {
        "id": "evt_uuid",
        "type": "tool.success",
        "actor": { "id": "agent_123", "type": "agent" },
        "resource": { "id": "get_current_time", "type": "tool" },
        "outcome": "success",
        "severity": "info",
        "timestamp": "2025-01-30T12:00:00.000Z",
        "metadata": { "duration": 5 }
      }
    ],
    "count": 50,
    "total": 1500
  }
}
```

---

## Architecture Notes

### Route Registration

All routes are registered in `packages/gateway/src/app.ts` using Hono's `app.route()` method:

```typescript
app.route('/health', healthRoutes);
app.route('/api/v1/health', healthRoutes);
app.route('/api/v1/agents', agentRoutes);
app.route('/api/v1/chat', chatRoutes);
// ... 30+ more route groups
```

### Middleware

- **CORS:** Enabled for UI access from different origins
- **Request Logging:** Each request is assigned a `requestId` (UUID) available via `c.get('requestId')`
- **Error Handling:** Hono `HTTPException` for structured error responses

### Database Access Pattern

Routes use the **Repository Pattern** for database access:

```
Route Handler -> Repository -> PostgreSQL (via pg)
```

Repositories are instantiated per-request with a `userId` parameter. Examples: `ChatRepository`, `MemoriesRepository`, `GoalsRepository`, `TasksRepository`.

### Tool Execution Architecture

Tools are registered at startup into a `ToolRegistry`. The AI accesses tools via three meta-tools:

1. **`search_tools`** - Keyword search across all registered tools
2. **`get_tool_help`** - Get parameter documentation for a specific tool
3. **`use_tool`** - Execute any tool by name with arguments

This meta-tool pattern prevents sending 100+ tool schemas per request (saving approximately 20K+ tokens).

### Streaming

Two streaming mechanisms are used:

1. **SSE (Server-Sent Events):** Used by chat streaming and tool streaming via Hono's `streamSSE` helper
2. **WebSocket:** Used for real-time bidirectional communication via the `ws` library

### Authentication

Currently operates in single-user mode with `userId = "default"`. JWT authentication via the `jose` library is prepared but not enforced on routes. OAuth integration (Google) is fully implemented for external service access.
