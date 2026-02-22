# OwnPilot Architecture

> Comprehensive architecture documentation for OwnPilot -- a privacy-first personal AI assistant platform.

**Version:** 0.1.0
**Last updated:** January 2026

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Monorepo Structure](#3-monorepo-structure)
4. [Package Dependency Graph](#4-package-dependency-graph)
5. [Core Package (`@ownpilot/core`)](#5-core-package-ownpilotcore)
   - 5.1 [Agent System](#51-agent-system)
   - 5.2 [Tool System](#52-tool-system)
   - 5.3 [Provider System](#53-provider-system)
   - 5.4 [Type System](#54-type-system)
   - 5.5 [Privacy and Security](#55-privacy-and-security)
   - 5.6 [Plugin System](#56-plugin-system)
   - 5.7 [Memory System](#57-memory-system)
   - 5.8 [Event System (EventBus)](#58-event-system-eventbus)
6. [Gateway Package (`@ownpilot/gateway`)](#6-gateway-package-ownpilotgateway)
   - 6.1 [HTTP Server](#61-http-server)
   - 6.2 [Route Modules](#62-route-modules)
   - 6.3 [Middleware Pipeline](#63-middleware-pipeline)
   - 6.4 [Database Layer](#64-database-layer)
   - 6.5 [WebSocket Server](#65-websocket-server)
   - 6.6 [Channel Manager](#66-channel-manager)
   - 6.7 [Autonomy System](#67-autonomy-system)
   - 6.8 [Service Layer](#68-service-layer)
7. [UI Package (`@ownpilot/ui`)](#7-ui-package-ownpilotui)
   - 7.1 [Frontend Stack](#71-frontend-stack)
   - 7.2 [Pages and Routing](#72-pages-and-routing)
   - 7.3 [Components](#73-components)
   - 7.4 [Hooks and State](#74-hooks-and-state)
8. [Channels Package (`@ownpilot/channels`)](#8-channels-package-ownpilotchannels)
9. [CLI Package (`@ownpilot/cli`)](#9-cli-package-ownpilotcli)
10. [Data Flow](#10-data-flow)
11. [Key Design Patterns](#11-key-design-patterns)
12. [Deployment Architecture](#12-deployment-architecture)
13. [Security Architecture](#13-security-architecture)
14. [Environment and Configuration](#14-environment-and-configuration)
15. [Build System](#15-build-system)
16. [Testing Strategy](#16-testing-strategy)

---

## 1. System Overview

OwnPilot is a self-hosted, privacy-first personal AI assistant platform. It connects to multiple LLM providers (OpenAI, Anthropic, Google, DeepSeek, and 100+ others) while keeping all data under the user's control. The system is built as a TypeScript monorepo with zero production dependencies in its core package, using only Node.js built-in modules.

### Design Principles

- **Privacy First** -- All data stays on infrastructure the user controls. PII detection and redaction are built in.
- **Zero-Dependency Core** -- The `@ownpilot/core` package uses only Node.js built-in modules. No npm runtime dependencies.
- **Multi-Provider** -- Config-driven provider system supports 100+ AI providers via JSON configuration files.
- **Extensible** -- Plugin system with worker-thread isolation, marketplace verification, and capability-based access control.
- **Type-Safe** -- Branded types, Result pattern for error handling, and strict TypeScript throughout.

---

## 2. High-Level Architecture

```
                                     OwnPilot System Architecture
 +---------------------------------------------------------------------------+
 |                                                                           |
 |   CLIENTS                                                                 |
 |   +----------+  +----------+  +----------+  +----------+  +----------+   |
 |   |  Web UI  |  |   CLI    |  | Telegram |  | Discord  |  |  Slack   |   |
 |   | (React)  |  |(commander|  |  (grammy)|  |(discord.js|  |(@slack/  |   |
 |   |          |  |inquirer) |  |          |  |          |  | bolt)    |   |
 |   +----+-----+  +----+-----+  +----+-----+  +----+-----+  +----+-----+   |
 |        |             |             |             |             |           |
 |        |   HTTP/WS   |    HTTP     |    Events   |   Events   |  Events   |
 |        +------+------+------+------+------+------+------+-----+           |
 |               |                    |                    |                  |
 +---------------|--------------------|--------------------|------------------+
                 v                    v                    v
 +---------------------------------------------------------------------------+
 |                                                                           |
 |   GATEWAY (@ownpilot/gateway)                  Port 8080                  |
 |   +---------------------------------------------------------------+      |
 |   |  Hono HTTP Framework                                          |      |
 |   |  +------------------+  +-----------------+  +---------------+ |      |
 |   |  | Middleware Stack  |  | Route Modules   |  | WebSocket    | |      |
 |   |  | - Request ID     |  | - /health       |  | Server (ws)  | |      |
 |   |  | - Timing         |  | - /api/chat     |  | - Sessions   | |      |
 |   |  | - Auth (JWT/Key) |  | - /api/agents   |  | - Events     | |      |
 |   |  | - Rate Limiting  |  | - /api/tools    |  | - Streaming  | |      |
 |   |  | - Error Handler  |  | - /api/settings |  +---------------+ |      |
 |   |  +------------------+  | - /api/models   |                    |      |
 |   |                        | - 35 modules    |                    |      |
 |   |                        +-----------------+                    |      |
 |   +---------------------------------------------------------------+      |
 |                               |                                           |
 |                               v                                           |
 |   +---------------------------------------------------------------+      |
 |   |  CORE (@ownpilot/core)           Zero Dependencies            |      |
 |   |  +-----------------+  +-----------------+  +---------------+  |      |
 |   |  | Agent System    |  | Tool System     |  | Provider      |  |      |
 |   |  | - Orchestrator  |  | - ToolRegistry  |  | System        |  |      |
 |   |  | - Agent         |  | - 148+ tools    |  | - OpenAI      |  |      |
 |   |  | - PromptComposer|  | - 20 categories |  | - Anthropic   |  |      |
 |   |  | - MemoryInjector|  | - Dynamic tools |  | - Google      |  |      |
 |   |  | - AgentBuilder  |  | - Tool limits   |  | - 100+ configs|  |      |
 |   |  +-----------------+  +-----------------+  +---------------+  |      |
 |   |  +-----------------+  +-----------------+  +---------------+  |      |
 |   |  | Type System     |  | Privacy         |  | Plugin System |  |      |
 |   |  | - Branded types |  | - PII detection |  | - Isolation   |  |      |
 |   |  | - Result<T,E>   |  | - Redaction     |  | - Marketplace |  |      |
 |   |  | - Type guards   |  | - Audit logging |  | - Worker      |  |      |
 |   |  +-----------------+  +-----------------+  |   threads     |  |      |
 |   |                                            +---------------+  |      |
 |   +---------------------------------------------------------------+      |
 |                               |                                           |
 |                               v                                           |
 |   +---------------------------------------------------------------+      |
 |   |  DATABASE LAYER                                                |      |
 |   |  +-------------------------+  +-----------------------------+  |      |
 |   |  | PostgreSQL 16           |  | Repository Pattern          |  |      |
 |   |  | (docker-compose)        |  | - 30 repositories           |  |      |
 |   |  | - Schema migrations     |  | - BaseRepository class      |  |      |
 |   |  | - Seed scripts          |  | - DatabaseAdapter interface  |  |      |
 |   |  +-------------------------+  +-----------------------------+  |      |
 |   +---------------------------------------------------------------+      |
 |                                                                           |
 +---------------------------------------------------------------------------+
```

---

## 3. Monorepo Structure

The project uses **pnpm workspaces** with **Turborepo** for build orchestration.

### Requirements

| Requirement | Minimum Version |
| ----------- | --------------- |
| Node.js     | >= 22.0.0       |
| pnpm        | >= 9.0.0        |

### Directory Layout

```
ownpilot/
|-- package.json                  # Root workspace config
|-- pnpm-workspace.yaml           # Workspace definitions
|-- pnpm-lock.yaml                # Lockfile
|-- turbo.json                    # Turborepo pipeline config
|-- tsconfig.base.json            # Shared TypeScript config
|-- Dockerfile                    # Multi-stage production build
|-- docker-compose.yml            # Full stack (gateway + postgres + ui)
|-- docker-compose.db.yml         # PostgreSQL only
|-- start.sh / start.ps1          # Launch scripts
|
|-- packages/
|   |-- core/                     # @ownpilot/core - Zero-dependency foundation
|   |   |-- src/
|   |   |   |-- agent/            # Agent system (orchestrator, provider, tools)
|   |   |   |-- agent-builder/    # LLM-guided agent creation
|   |   |   |-- agent-executor/   # Agent execution engine
|   |   |   |-- agent-router/     # Multi-agent routing
|   |   |   |-- assistant/        # High-level assistant API
|   |   |   |-- audit/            # Audit logging and verification
|   |   |   |-- costs/            # Cost tracking tools
|   |   |   |-- credentials/      # Credential management
|   |   |   |-- crypto/           # Encryption, key derivation, vault
|   |   |   |-- data-gateway/     # Data access abstraction
|   |   |   |-- integrations/     # Gmail and external service clients
|   |   |   |-- memory/           # Conversation and personal memory
|   |   |   |-- notifications/    # Notification system
|   |   |   |-- plugins/          # Plugin runtime, isolation, marketplace
|   |   |   |-- privacy/          # PII detection and redaction
|   |   |   |-- sandbox/          # Code execution sandbox (Docker)
|   |   |   |-- scheduler/        # Task scheduling
|   |   |   |-- security/         # Security validation
|   |   |   |-- services/         # Media, weather, config center
|   |   |   |-- types/            # Branded types, Result, errors, guards
|   |   |   |-- workspace/        # User workspace isolation
|   |   |   +-- index.ts          # Package entry point
|   |   +-- package.json
|   |
|   |-- gateway/                  # @ownpilot/gateway - HTTP API server
|   |   |-- src/
|   |   |   |-- assistant/        # Gateway-level assistant orchestrator
|   |   |   |-- audit/            # Audit trail persistence
|   |   |   |-- autonomy/         # Autonomy levels and risk assessment
|   |   |   |-- channels/         # Channel adapters (Discord, Slack, Telegram)
|   |   |   |-- db/               # Database layer
|   |   |   |   |-- adapters/     # PostgreSQL adapter (DatabaseAdapter interface)
|   |   |   |   |-- migrations/   # SQL schema migrations (47 tables)
|   |   |   |   |-- repositories/ # 30 repository classes (IRepository<T> interface)
|   |   |   |   +-- seeds/        # Default data seeds
|   |   |   |-- middleware/       # HTTP middleware stack
|   |   |   |-- paths/            # Data directory management and migration
|   |   |   |-- plans/            # Plan execution engine
|   |   |   |-- plugins/          # Plugin initialization
|   |   |   |-- routes/           # 35 route modules
|   |   |   |-- scheduler/        # Scheduled task runner
|   |   |   |-- services/         # 16 business logic services (GoalService, MemoryService, etc.)
|   |   |   |-- tools/            # Gateway-specific tools (channel tools)
|   |   |   |-- tracing/          # Request tracing
|   |   |   |-- triggers/         # Proactive trigger engine
|   |   |   |-- utils/            # Query param helpers
|   |   |   |-- workspace/        # File workspace management
|   |   |   |-- ws/               # WebSocket server, sessions, events
|   |   |   +-- index.ts          # Package entry point
|   |   |-- scripts/              # Seed and migration scripts
|   |   +-- package.json
|   |
|   |-- ui/                       # @ownpilot/ui - Web frontend SPA
|   |   |-- src/
|   |   |   |-- components/       # 24+ reusable components
|   |   |   |-- hooks/            # Custom React hooks
|   |   |   |-- pages/            # 35+ page components
|   |   |   |   +-- tools/        # Tool browser sub-pages
|   |   |   |-- types/            # Frontend type definitions
|   |   |   |-- App.tsx           # Root route configuration
|   |   |   +-- main.tsx          # Application entry point
|   |   +-- package.json
|   |
|   |-- channels/                 # @ownpilot/channels - Communication channels
|   |   |-- src/
|   |   |   |-- telegram/         # Telegram bot via grammy
|   |   |   |-- types/            # Channel type definitions
|   |   |   |-- manager.ts        # Channel lifecycle manager
|   |   |   +-- index.ts
|   |   +-- package.json
|   |
|   +-- cli/                      # @ownpilot/cli - Command-line interface
|       |-- src/
|       |   |-- commands/          # CLI commands
|       |   |   |-- start.ts      # Start server
|       |   |   |-- server.ts     # Server management
|       |   |   |-- config.ts     # Configuration
|       |   |   |-- channel.ts    # Channel management
|       |   |   |-- bot.ts        # Bot management
|       |   |   +-- workspace.ts  # Workspace management
|       |   +-- index.ts          # CLI entry point (commander)
|       +-- package.json
|
+-- docs/                         # Documentation
```

---

## 4. Package Dependency Graph

Internal workspace dependencies flow strictly downward. No circular dependencies exist.

```
                     @ownpilot/cli
                    /      |      \
                   /       |       \
                  v        v        v
      @ownpilot/core  @ownpilot/gateway  @ownpilot/channels
                  \        |              /
                   \       |             /
                    v      v            v
                     @ownpilot/core
```

Detailed dependency table:

| Package              | Depends On                                                                       |
| -------------------- | -------------------------------------------------------------------------------- |
| `@ownpilot/core`     | (none -- zero external dependencies)                                             |
| `@ownpilot/gateway`  | `@ownpilot/core`, hono, pg, ws, jose, dotenv, ...                                |
| `@ownpilot/ui`       | `@ownpilot/gateway` (types only), react, vite                                    |
| `@ownpilot/channels` | `@ownpilot/core`, grammy                                                         |
| `@ownpilot/cli`      | `@ownpilot/core`, `@ownpilot/gateway`, `@ownpilot/channels`, commander, inquirer |

### Key External Dependencies

| Package           | Version | Used In  | Purpose                             |
| ----------------- | ------- | -------- | ----------------------------------- |
| hono              | ^4.11   | gateway  | HTTP framework                      |
| @hono/node-server | ^1.14   | gateway  | Node.js adapter for Hono            |
| pg                | ^8.13   | gateway  | PostgreSQL client                   |
| ws                | ^8.19   | gateway  | WebSocket server                    |
| jose              | ^6.0    | gateway  | JWT authentication                  |
| dotenv            | ^16.4   | gateway  | Environment variable loading        |
| discord.js        | ^14.16  | gateway  | Discord channel adapter             |
| @slack/bolt       | ^4.1    | gateway  | Slack channel adapter               |
| nodemailer        | ^7.0    | gateway  | Email sending                       |
| imapflow          | ^1.2    | gateway  | Email receiving (IMAP)              |
| archiver          | ^7.0    | gateway  | File archival                       |
| grammy            | ^1.36   | channels | Telegram bot framework              |
| react             | ^19.0   | ui       | UI framework                        |
| react-router-dom  | ^7.1    | ui       | Client-side routing                 |
| tailwindcss       | ^4.0    | ui       | Utility-first CSS                   |
| vite              | ^6.0    | ui       | Build tool and dev server           |
| commander         | ^13.1   | cli      | CLI framework                       |
| @inquirer/prompts | ^7.0    | cli      | Interactive CLI prompts             |
| vitest            | ^2.1    | all      | Test framework (dev)                |
| typescript        | ^5.7    | all      | Type checking and compilation (dev) |
| turbo             | ^2.7    | root     | Monorepo build orchestration (dev)  |

---

## 5. Core Package (`@ownpilot/core`)

The core package is the foundation of the entire system. It is designed with **zero external dependencies** -- every module uses only Node.js built-in APIs (`node:crypto`, `node:events`, `node:fs`, `node:worker_threads`, etc.).

### Module Exports

The core package provides multiple entry points:

| Export Path              | Purpose                       |
| ------------------------ | ----------------------------- |
| `@ownpilot/core`         | Main entry -- all public APIs |
| `@ownpilot/core/types`   | Type definitions only         |
| `@ownpilot/core/crypto`  | Cryptographic utilities       |
| `@ownpilot/core/audit`   | Audit logging                 |
| `@ownpilot/core/privacy` | PII detection and redaction   |
| `@ownpilot/core/plugin`  | Plugin runtime                |
| `@ownpilot/core/gateway` | Gateway foundation            |

---

### 5.1 Agent System

The agent system orchestrates all AI interactions, from single-turn completions to multi-step reasoning with tool calls.

```
                         Agent System Architecture
 +-----------------------------------------------------------------------+
 |                                                                       |
 |  AgentBuilder                       AgentOrchestrator                 |
 |  (LLM-guided creation)            (Multi-step execution)             |
 |  +-----------------------+         +--------------------------+       |
 |  | BuilderSession        |         | AgentConfig              |       |
 |  | - phase: gathering/   |         | - name, systemPrompt     |       |
 |  |   refining/generating |         | - provider (LLMProvider) |       |
 |  | - Q&A flow            |  uses   | - model, tools           |       |
 |  | - GeneratedAgentConfig|-------->| - maxIterations          |       |
 |  +-----------------------+         | - temperature            |       |
 |                                    +-----------+--------------+       |
 |                                                |                      |
 |                                    Agent       v                      |
 |                          +---------------------+--+                   |
 |                          | Agent                   |                  |
 |                          | - config: AgentConfig   |                  |
 |                          | - provider: IProvider   |                  |
 |                          | - tools: ToolRegistry   |                  |
 |                          | - memory: Conversation  |                  |
 |                          |   Memory                |                  |
 |                          | - state: AgentState     |                  |
 |                          +---+--------+--------+---+                  |
 |                              |        |        |                      |
 |                    +---------+   +----+----+   +----------+           |
 |                    v             v          v              v           |
 |             PromptComposer  MemoryInjector  IProvider  ToolRegistry   |
 |                                                                       |
 +-----------------------------------------------------------------------+
```

#### Key Classes

**`Agent`** (`packages/core/src/agent/agent.ts`)

- The primary AI interaction orchestrator.
- Manages conversation state, tool calls, and provider communication.
- Defaults: `maxTurns: 50`, `maxToolCalls: 200`.
- Registers core tools automatically unless a custom `ToolRegistry` is injected.

**`AgentOrchestrator`** (`packages/core/src/agent/orchestrator.ts`)

- Handles complex multi-step execution with planning and reasoning.
- Emits events via `EventEmitter` for observability: `step:start`, `step:complete`, `tool:call`, `tool:result`, `error`.
- Maintains `OrchestratorContext` tracking execution ID, iteration count, message history, and status (`running`, `completed`, `failed`, `cancelled`).

**`PromptComposer`** (`packages/core/src/agent/prompt-composer.ts`)

- Generates context-aware system prompts that include user profile, available tools, custom instructions, time context, and workspace context.
- Input: `PromptContext` (base prompt, user profile, tools, time, capabilities).
- Output: A fully composed system prompt string.

**`MemoryInjector`** (`packages/core/src/agent/memory-injector.ts`)

- Integrates personal memory and conversation context into agent prompts.
- Retrieves user profile, preferences, and custom instructions from the personal memory store.
- Options: `includeProfile`, `includeInstructions`, `includeTimeContext`, `includeToolDescriptions`, `maxPromptLength`.

**`AgentBuilder`** (`packages/core/src/agent-builder/index.ts`)

- LLM-guided agent creation through interactive question-and-answer sessions.
- Manages a `BuilderSession` with phases: `gathering` -> `refining` -> `generating` -> `complete`.
- Produces a `GeneratedAgentConfig` with name, emoji, category, system prompt, tools, triggers, and model parameters.

**`MultiAgentOrchestrator`** (`packages/core/src/agent/orchestrator.ts`)

- Coordinates multiple agents as a team (`AgentTeam`).
- Supports planning with `createPlanningPrompt` and `parsePlan` for multi-step plan decomposition into `Plan` and `PlanStep` structures.

---

### 5.2 Tool System

The tool system provides 148+ built-in tools organized into 20 categories, plus support for user-created dynamic tools and modular tool providers.

```
                            Tool System Architecture
 +-----------------------------------------------------------------------+
 |                                                                       |
 |  ToolRegistry                                                         |
 |  +-----------------------------+                                      |
 |  | tools: Map<string,          |                                      |
 |  |   RegisteredTool>           |                                      |
 |  | pluginTools: Map<string,    |                                      |
 |  |   Set<string>>              |                                      |
 |  |                             |                                      |
 |  | register(def, exec, plugin) |                                      |
 |  | execute(name, args, ctx)    |                                      |
 |  | getDefinitions()            |                                      |
 |  +-----------------------------+                                      |
 |         |                                                             |
 |         | registers                                                   |
 |         v                                                             |
 |  +------+----------------------------------------------------------+  |
 |  |  TOOL CATEGORIES (20)                                            | |
 |  |                                                                  | |
 |  |  Personal Data          File & Documents      Code & Dev         | |
 |  |  - Tasks (6 tools)      - File System (8)     - Code Exec (5)   | |
 |  |  - Bookmarks (4)        - PDF (3)             - Git (7)         | |
 |  |  - Notes (5)                                                     | |
 |  |  - Calendar (4)         Web & API              Communication     | |
 |  |  - Contacts (5)         - Web/API (4)          - Email (6)      | |
 |  |  - Custom Data (11)                                              | |
 |  |                         Media                  AI & NLP           | |
 |  |  Finance                - Image (5)            - Translation (4) | |
 |  |  - Expenses (7)         - Audio (5)            - Data Extract(4) | |
 |  |                                                - Vector Search(7)| |
 |  |  Automation             Memory & Goals         Meta              | |
 |  |  - Scheduler (6)        - Memory (7)           - Dynamic Tools(4)| |
 |  |  - Weather (2)          - Goals (8)            - Utilities (21)  | |
 |  +------------------------------------------------------------------+ |
 |                                                                       |
 +-----------------------------------------------------------------------+
```

#### Tool Categories and Counts

| Category                 | Tool Count | Description                                                                    |
| ------------------------ | :--------: | ------------------------------------------------------------------------------ |
| Tasks                    |     6      | add, batch_add, list, complete, update, delete                                 |
| Bookmarks                |     4      | add, batch_add, list, delete                                                   |
| Notes                    |     5      | add, batch_add, list, update, delete                                           |
| Calendar                 |     4      | add, batch_add, list, delete                                                   |
| Contacts                 |     5      | add, batch_add, list, update, delete                                           |
| Custom Data              |     11     | Table and record CRUD, search, describe                                        |
| File System              |     8      | read, write, list, search, download, info, delete, copy                        |
| PDF                      |     3      | read, create, info                                                             |
| Code Execution (Sandbox) |     5      | JavaScript, Python, Shell, compile, package mgr                                |
| Git                      |     7      | status, diff, log, commit, add, branch, checkout                               |
| Web & API                |     4      | HTTP request, fetch page, search web, JSON API                                 |
| Email                    |     6      | send, list, read, delete, search, reply                                        |
| Image                    |     5      | analyze, generate, edit, variation, resize                                     |
| Audio                    |     5      | TTS, STT, translate, info, split                                               |
| Translation              |     4      | translate, detect language, list languages, batch                              |
| Data Extraction          |     4      | structured data, entities, tables, summarize                                   |
| Vector Search            |     7      | embeddings, semantic search, upsert, delete, collections                       |
| Finance                  |     7      | add, batch_add, parse receipt, query, export, summary, delete                  |
| Scheduler                |     6      | create, list, update, delete, history, trigger                                 |
| Weather                  |     2      | current, forecast                                                              |
| Memory                   |     7      | remember, batch, recall, forget, list, boost, stats                            |
| Goals                    |     8      | create, list, update, decompose, next actions, complete step, details, stats   |
| Dynamic Tools            |     4      | create, list, delete, toggle custom tools                                      |
| Utilities                |     21     | datetime, math, units, UUID, password, hash, encode, text ops, CSV, validation |

#### Tool Definition Structure

Every tool follows the OpenAI function-calling schema:

```typescript
interface ToolDefinition {
  name: string; // e.g., "read_file"
  description: string; // Human-readable description
  parameters: {
    type: 'object';
    properties: Record<string, JSONSchemaProperty>;
    required?: string[];
  };
}

interface ToolExecutor {
  (args: Record<string, unknown>, context?: ToolContext): Promise<ToolExecutionResult>;
}
```

#### Tool Provider Pattern

Tool providers allow modular registration of related tools:

```typescript
interface ToolProvider {
  readonly name: string;
  getTools(): Array<{ definition: ToolDefinition; executor: ToolExecutor }>;
}

// Registration:
tools.registerProvider(new MemoryToolProvider(userId));
tools.registerProvider(new GoalToolProvider(userId));
```

#### Tool Middleware

Middleware intercepts tool execution for cross-cutting concerns:

```typescript
interface ToolMiddleware {
  name: string;
  before?(context: ToolContext): Promise<void>;
  after?(context: ToolContext, result: ToolExecutionResult): Promise<ToolExecutionResult>;
}

// Registration:
tools.useFor('*', new AuditMiddleware());
tools.useFor('file_*', new WorkspaceMiddleware());
```

#### Tool Registration Flow

1. Each tool category exports a `TOOLS` array of `{ definition, executor }` pairs.
2. `registerAllTools(registry)` registers all built-in tools into a `ToolRegistry`.
3. `ToolProvider` implementations register domain-specific tools (memory, goals, custom data, etc.).
4. Gateway-specific tool executors (e.g., personal data, memory, goals) have definitions in core but executors in the gateway package, since they need database access.
5. Dynamic tools are created at runtime by the LLM and managed via `createDynamicToolRegistry()`.

#### Tool Limits

The `TOOL_MAX_LIMITS` system caps parameters on list-returning tools to prevent unbounded queries. The `applyToolLimits` function is called transparently in the tool execution proxy.

#### Tool Discovery

The `TOOL_SEARCH_TAGS` index enables the `search_tools` meta-tool, allowing the agent to discover relevant tools by keyword search at runtime rather than loading all 148+ tool definitions into every prompt.

---

### 5.3 Provider System

The provider system is config-driven and supports 100+ AI providers through a combination of JSON configuration files, protocol adapters, and intelligent routing.

```
                       Provider System Architecture
 +-----------------------------------------------------------------------+
 |                                                                       |
 |  ProviderRouter                                                       |
 |  +------------------------------+                                     |
 |  | defaultStrategy: RoutingStrategy                                   |
 |  |   - cheapest    (minimize cost)                                    |
 |  |   - fastest     (minimize latency)                                 |
 |  |   - smartest    (best quality)                                     |
 |  |   - balanced    (cost/quality)                                     |
 |  |   - fallback    (try in order)                                     |
 |  +---------------+--------------+                                     |
 |                  |                                                     |
 |       +----------+----------+                                         |
 |       v                     v                                         |
 |  FallbackProvider     OpenAICompatibleProvider                        |
 |  +----------------+   +----------------------+                        |
 |  | primary        |   | Supports:            |                        |
 |  | fallbacks[]    |   | - OpenAI             |                        |
 |  | onFallback()   |   | - Anthropic          |                        |
 |  +----------------+   | - DeepSeek           |                        |
 |       |                | - Groq               |                        |
 |       |                | - Mistral            |                        |
 |       |                | - Together           |     GoogleProvider     |
 |       |                | - Fireworks          |     +--------------+   |
 |       +--------------->| - xAI (Grok)        |     | Gemini API   |   |
 |                        | - Perplexity         |     | (native)     |   |
 |                        | - Cohere             |     +--------------+   |
 |                        | - OpenRouter         |                        |
 |                        | - 70+ more via JSON  |                        |
 |                        +----------------------+                        |
 |                                 |                                      |
 |                    +------------+----------+                           |
 |                    v                       v                           |
 |             JSON Config Files         IProvider Interface              |
 |          (80+ .json files in          +--------------------+           |
 |           providers/configs/)         | type: AIProvider   |           |
 |          - openai.json                | isReady(): bool    |           |
 |          - anthropic.json             | complete(req)      |           |
 |          - deepseek.json              | stream(req)        |           |
 |          - groq.json                  +--------------------+           |
 |          - ...                                                         |
 |                                                                       |
 +-----------------------------------------------------------------------+
```

#### Supported Provider Types (Enumerated)

```typescript
type AIProvider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'deepseek'
  | 'groq'
  | 'mistral'
  | 'zhipu'
  | 'cohere'
  | 'together'
  | 'fireworks'
  | 'perplexity'
  | 'openrouter'
  | 'xai'
  | 'local'
  | 'custom';
```

#### JSON Config Files

Each provider has a JSON configuration file in `data/providers/` (synced from models.dev via `syncAllProviders()`). The file specifies the API base URL, authentication scheme, available models, capabilities, pricing, and feature flags. Over 100 configuration files are included.

Examples of configured providers:
`openai`, `anthropic`, `google`, `deepseek`, `groq`, `mistral`, `xai`, `cohere`, `together`, `fireworks`, `perplexity`, `openrouter`, `nvidia`, `azure`, `amazon-bedrock`, `google-vertex`, `huggingface`, `ollama-cloud`, `cerebras`, `alibaba`, and many more.

#### Model Selection

The router provides several selection strategies:

| Function             | Behavior                             |
| -------------------- | ------------------------------------ |
| `selectBestModel()`  | Overall best match for criteria      |
| `getCheapestModel()` | Lowest cost per token                |
| `getFastestModel()`  | Lowest latency                       |
| `getSmartestModel()` | Highest quality/reasoning capability |
| `findModels()`       | Filter by capability requirements    |

#### Retry and Fallback

- **Retry:** `withRetry()` implements exponential backoff with jitter. Default: 3 retries, 1s initial delay, 10s max delay, 2x multiplier.
- **Fallback:** `FallbackProvider` wraps a primary provider with ordered fallback alternatives. On failure, it automatically tries the next provider and fires the `onFallback` callback.

---

### 5.4 Type System

The type system enforces correctness at compile time through two core patterns: branded types and the Result pattern.

#### Branded Types (`packages/core/src/types/branded.ts`)

Branded types prevent accidental mixing of structurally identical types. You cannot pass a `SessionId` where a `UserId` is expected, even though both are strings underneath.

```typescript
type Brand<T, B extends string> = T & { readonly [brand]: B };

type UserId = Brand<string, 'UserId'>;
type SessionId = Brand<string, 'SessionId'>;
type PluginId = Brand<string, 'PluginId'>;
type ChannelId = Brand<string, 'ChannelId'>;
type MessageId = Brand<string, 'MessageId'>;
type AuditEventId = Brand<string, 'AuditEventId'>;
type ToolId = Brand<string, 'ToolId'>;
type ConversationId = Brand<string, 'ConversationId'>;
```

Each branded type has:

- A **validated constructor** (`createUserId(id)`) that checks format (UUID, patterns, etc.) and throws on invalid input.
- An **unsafe constructor** (`unsafeUserId(id)`) for internal use when the value is known to be valid.

#### Result Pattern (`packages/core/src/types/result.ts`)

The `Result<T, E>` type replaces exceptions with explicit success/failure values. Functions that can fail return `Result` instead of throwing.

```typescript
type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
```

Available combinators:

| Function          | Signature                                      | Description                         |
| ----------------- | ---------------------------------------------- | ----------------------------------- |
| `ok(value)`       | `(T) => Result<T, never>`                      | Create a success result             |
| `err(error)`      | `(E) => Result<never, E>`                      | Create a failure result             |
| `unwrap(r)`       | `(Result<T,E>) => T`                           | Extract value or throw              |
| `unwrapOr(r,d)`   | `(Result<T,E>, T) => T`                        | Extract value or return default     |
| `mapResult()`     | `(Result<T,E>, T=>U) => Result<U,E>`           | Transform success value             |
| `mapError()`      | `(Result<T,E>, E=>F) => Result<T,F>`           | Transform error value               |
| `andThen()`       | `(Result<T,E>, T=>Result<U,E>) => Result<U,E>` | Chain (flatMap) results             |
| `combine()`       | `(Result<T,E>[]) => Result<T[], E>`            | Combine multiple results            |
| `fromPromise()`   | `(Promise<T>) => Promise<Result<T,E>>`         | Convert throwing promise to Result  |
| `fromThrowable()` | `(() => T) => Result<T,E>`                     | Convert throwing function to Result |
| `isOk(r)`         | Type guard for success                         |                                     |
| `isErr(r)`        | Type guard for error                           |                                     |

#### Error Types (`packages/core/src/types/errors.ts`)

Custom error classes extend `Error` for structured error handling:

- `ValidationError` -- Invalid input
- `NotFoundError` -- Resource not found
- `InternalError` -- Internal system error
- `TimeoutError` -- Operation timed out
- `PluginError` -- Plugin-related failure

---

### 5.5 Privacy and Security

#### PII Detection and Redaction

The privacy module (`packages/core/src/privacy/`) detects and redacts personally identifiable information from text before it is sent to external LLM providers.

```
Text Input --> PIIDetector --> PIIMatch[] --> PIIRedactor --> Redacted Text
                  |                              |
                  v                              v
            Pattern Matching              Redaction Modes:
            - Email addresses             - mask (replace with *)
            - Phone numbers               - remove (delete)
            - SSNs                         - hash (one-way hash)
            - Credit card numbers          - category placeholder
            - Addresses
```

Severity levels: `low`, `medium`, `high`, `critical`.

Categories: `email`, `phone`, `ssn`, `credit_card`, `address`, and more.

#### Sandbox Execution

Code execution tools (`execute_javascript`, `execute_python`, `execute_shell`) require Docker sandbox isolation. The security module enforces:

- Docker is **required** for all code execution in production. No bypass is possible (the `ALLOW_UNSAFE_CODE_EXECUTION` environment variable has been permanently removed from the codebase).
- Worker thread sandboxes provide additional isolation.
- Resource limits (CPU, memory, timeout) are enforced.
- Dangerous shell commands are blocked.
- File access is restricted to the workspace directory.

#### Audit Logging

The audit system (`packages/core/src/audit/`) records all significant actions with tamper-evident logging:

- Structured audit events with UUIDv7 IDs.
- Event verification for integrity checking.
- Persistent audit trail in the gateway database.

#### Cryptographic Utilities

The crypto module (`packages/core/src/crypto/`) provides:

- **Key derivation** -- PBKDF2 and HKDF via `node:crypto`.
- **Vault** -- Encrypted credential storage.
- **Keychain** -- Key management.
- **Credential encryption** -- AES-256-GCM encryption for stored secrets.

---

### 5.6 Plugin System

Plugins extend OwnPilot with custom functionality while running in complete isolation.

```
                        Plugin Lifecycle
 +--------------------------------------------------------------+
 |                                                              |
 |  MarketplaceManifest --> PluginVerifier --> TrustLevel       |
 |       |                                       |              |
 |       v                                       v              |
 |  PluginRuntime.load() --> PluginIsolationManager             |
 |       |                   - Worker thread isolation           |
 |       v                   - Capability-based access control   |
 |  PluginInstance            - Memory/credential isolation      |
 |  - state: unloaded -->     - Resource limits enforcement      |
 |    loading --> loaded -->   - Storage quotas                  |
 |    starting --> running                                       |
 |    --> stopping --> stopped                                   |
 |    --> error / blocked                                        |
 |                                                              |
 +--------------------------------------------------------------+
```

**Plugin States:** `unloaded` -> `loading` -> `loaded` -> `starting` -> `running` -> `stopping` -> `stopped` (or `error`/`blocked`)

**Capabilities:** Plugins declare required capabilities. The `IsolationEnforcer` grants or denies access based on `PluginCapability` declarations.

**Example Plugins** (in `packages/core/src/plugins/examples/`):

- Calculator, Clipboard, Code Assistant, Expense Tracker
- Habit Tracker, News, Pomodoro, Quick Capture
- Reminder, Weather

---

### 5.7 Memory System

The memory system has two layers:

1. **Conversation Memory** (`packages/core/src/memory/conversation.ts`) -- Short-term memory within a single conversation session. Manages message history, user profile, and system prompt context.

2. **Personal Memory** (`packages/core/src/memory/personal.ts`) -- Long-term persistent memory across sessions. Stores `ComprehensiveProfile` with user preferences, custom instructions, and learned facts. Memory tools (`remember`, `recall`, `forget`, `list_memories`, `boost_memory`) are exposed to the agent for runtime memory operations.

---

### 5.8 Event System (EventBus)

The EventBus (`packages/core/src/events/`) provides a typed event system that replaces ad-hoc `EventEmitter` usage with a unified, structured approach.

```typescript
interface IEventBus {
  emit(event: string, data: unknown): void;
  on(event: string, handler: EventHandler): void;
  off(event: string, handler: EventHandler): void;
  once(event: string, handler: EventHandler): void;
}
```

#### Event Categories

| Category   | Events                                                     | Description              |
| ---------- | ---------------------------------------------------------- | ------------------------ |
| `tool`     | `tool:call`, `tool:result`, `tool:error`                   | Tool execution lifecycle |
| `resource` | `resource:created`, `resource:updated`, `resource:deleted` | Data mutation events     |
| `agent`    | `agent:start`, `agent:complete`, `agent:error`             | Agent execution events   |
| `plugin`   | `plugin:loaded`, `plugin:error`                            | Plugin lifecycle events  |
| `system`   | `system:startup`, `system:shutdown`                        | System lifecycle events  |

#### Key Features

- **Wildcard subscriptions** -- Subscribe to `tool:*` to receive all tool events.
- **Async handler execution** -- Handlers can be async; errors are caught and logged without breaking the emitter.
- **Singleton access** -- `getEventBus()` returns the global instance.
- **Replaces** -- Orchestrator `EventEmitter` and plugin custom pub/sub patterns.

---

## 6. Gateway Package (`@ownpilot/gateway`)

The gateway is the HTTP API server that connects all pieces together. It provides REST endpoints, WebSocket real-time communication, database persistence, and channel integrations.

---

### 6.1 HTTP Server

Built on **Hono** -- a fast, lightweight web framework -- running on `@hono/node-server`.

```typescript
// Simplified startup flow
import { createApp } from './app.js';

const app = createApp();
// Registers: middleware -> routes -> error handlers
// Starts listening on PORT (default 8080)
```

---

### 6.2 Route Modules

The gateway has **35 route modules**, each responsible for a specific domain. All routes are exported from `packages/gateway/src/routes/index.ts`.

| Route Module          | Base Path              | Purpose                            |
| --------------------- | ---------------------- | ---------------------------------- |
| `health`              | `/health`              | Health checks and readiness probes |
| `auth`                | `/api/auth`            | Authentication (JWT, API key)      |
| `chat`                | `/api/chat`            | Chat completions and streaming     |
| `agents`              | `/api/agents`          | Agent CRUD and management          |
| `tools`               | `/api/tools`           | Tool listing and execution         |
| `custom-tools`        | `/api/custom-tools`    | User-created dynamic tools         |
| `settings`            | `/api/settings`        | System settings and API keys       |
| `models`              | `/api/models`          | AI model listing                   |
| `model-configs`       | `/api/model-configs`   | User model configurations          |
| `providers`           | `/api/providers`       | AI provider management             |
| `local-providers`     | `/api/local-providers` | Local AI provider management       |
| `config-services`     | `/api/config-services` | Configuration center               |
| `profile`             | `/api/profile`         | User profile management            |
| `personal-data`       | `/api/personal-data`   | Tasks, notes, calendar, etc.       |
| `personal-data-tools` | (internal)             | Tool executors for personal data   |
| `custom-data`         | `/api/custom-data`     | Custom user-defined tables         |
| `memories`            | `/api/memories`        | Persistent AI memory CRUD          |
| `goals`               | `/api/goals`           | Goal and step management           |
| `triggers`            | `/api/triggers`        | Proactive trigger configuration    |
| `plans`               | `/api/plans`           | Multi-step plan management         |
| `autonomy`            | `/api/autonomy`        | Autonomy level control             |
| `costs`               | `/api/costs`           | Usage and cost tracking            |
| `expenses`            | `/api/expenses`        | Personal expense management        |
| `channels`            | `/api/channels`        | Communication channel management   |
| `plugins`             | `/api/plugins`         | Plugin management                  |
| `workspaces`          | `/api/workspaces`      | User workspace management          |
| `file-workspaces`     | `/api/file-workspaces` | File workspace operations          |
| `integrations`        | `/api/integrations`    | OAuth and external integrations    |
| `media-settings`      | `/api/media-settings`  | Image/audio provider settings      |
| `productivity`        | `/api/productivity`    | Pomodoro, habits, captures         |
| `audit`               | `/api/audit`           | Audit log access                   |
| `dashboard`           | `/api/dashboard`       | Dashboard aggregated data          |
| `database`            | `/api/database`        | Database info and management       |
| `debug`               | `/api/debug`           | Debug endpoints (dev only)         |
| `logs`                | (via `debug`)          | Request log access                 |

---

### 6.3 Middleware Pipeline

Requests flow through the middleware pipeline in this order:

```
Request
   |
   v
+------------------+
| 1. Request ID    |  Generates unique X-Request-Id header
+------------------+
   |
   v
+------------------+
| 2. Timing        |  Records X-Response-Time header
+------------------+
   |
   v
+------------------+
| 3. Auth          |  JWT / API key / none (configurable)
| (optional)       |  createAuthMiddleware() or createOptionalAuthMiddleware()
+------------------+
   |
   v
+------------------+
| 4. Rate Limiting |  Sliding window algorithm
|                  |  Configurable: window, max requests, per-IP
+------------------+
   |
   v
+------------------+
| 5. Route Handler |  Business logic
+------------------+
   |
   v
+------------------+
| 6. Error Handler |  Structured error responses with ErrorCodes
+------------------+
   |
   v
Response
```

**Authentication Modes** (configured via `AUTH_TYPE`):

- `none` -- No authentication required.
- `api-key` -- Requires `Authorization: Bearer <key>` header. Keys set via `API_KEYS` env var.
- `jwt` -- JWT-based authentication using `jose`. Secret set via `JWT_SECRET`.

**Rate Limiting:**

- Sliding window algorithm.
- Configurable: `RATE_LIMIT_WINDOW_MS` (default 60000ms), `RATE_LIMIT_MAX` (default 100).
- Can be disabled: `RATE_LIMIT_DISABLED=true`.

---

### 6.4 Database Layer

The database layer uses a **repository pattern** with a `DatabaseAdapter` interface abstracting the underlying database engine.

```
                        Database Architecture
 +-----------------------------------------------------------------------+
 |                                                                       |
 |  Route Handler                                                        |
 |       |                                                               |
 |       v                                                               |
 |  Repository (e.g., TasksRepository)                                   |
 |  +----------------------------------+                                 |
 |  | extends BaseRepository           |                                 |
 |  |                                  |                                 |
 |  | query<T>(sql, params)            |                                 |
 |  | queryOne<T>(sql, params)         |                                 |
 |  | execute(sql, params)             |                                 |
 |  | transaction(fn)                  |                                 |
 |  +----------------------------------+                                 |
 |       |                                                               |
 |       v                                                               |
 |  DatabaseAdapter Interface                                            |
 |  +----------------------------------+                                 |
 |  | type: DatabaseType               |                                 |
 |  | isConnected(): boolean           |                                 |
 |  | query<T>(sql, params): T[]       |                                 |
 |  | queryOne<T>(sql, params): T|null |                                 |
 |  | execute(sql, params): changes    |                                 |
 |  | transaction<T>(fn): T            |                                 |
 |  | exec(sql): void                  |                                 |
 |  | close(): void                    |                                 |
 |  +----------------------------------+                                 |
 |       |                                                               |
 |       v                                                               |
 |  PostgresAdapter (pg)                                                 |
 |  - PostgreSQL 16-alpine                                               |
 |  - Connection via pg.Pool                                             |
 |  - Schema via SQL migrations                                          |
 |                                                                       |
 +-----------------------------------------------------------------------+
```

#### Repositories (30 total)

The repositories are organized by domain:

| Domain             | Repository                    | Data Managed                       |
| ------------------ | ----------------------------- | ---------------------------------- |
| **Core**           | `ConversationsRepository`     | Chat conversations                 |
|                    | `MessagesRepository`          | Chat messages                      |
|                    | `ChatRepository`              | Enhanced chat history              |
|                    | `AgentsRepository`            | Agent configurations               |
|                    | `SettingsRepository`          | System settings, API keys          |
|                    | `LogsRepository`              | Request logs for debugging         |
| **Personal Data**  | `TasksRepository`             | To-do tasks                        |
|                    | `BookmarksRepository`         | Web bookmarks                      |
|                    | `NotesRepository`             | Notes and documents                |
|                    | `CalendarRepository`          | Calendar events                    |
|                    | `ContactsRepository`          | Contact list                       |
|                    | `CustomDataRepository`        | User-defined tables and records    |
| **Autonomous AI**  | `MemoriesRepository`          | Persistent AI memories             |
|                    | `GoalsRepository`             | Long-term goals and steps          |
|                    | `TriggersRepository`          | Proactive automation triggers      |
|                    | `PlansRepository`             | Multi-step execution plans         |
| **Channels**       | `ChannelsRepository`          | Channel configurations             |
|                    | `ChannelMessagesRepository`   | Messages from external channels    |
| **Finance**        | `CostsRepository`             | AI usage costs                     |
| **Productivity**   | `PomodoroRepository`          | Pomodoro timer sessions            |
|                    | `HabitsRepository`            | Habit tracking                     |
|                    | `CapturesRepository`          | Quick captures                     |
| **Integrations**   | `OAuthIntegrationsRepository` | OAuth tokens and connections       |
|                    | `MediaSettingsRepository`     | Image/audio provider settings      |
|                    | `ModelConfigsRepository`      | User AI model configurations       |
| **Infrastructure** | `WorkspacesRepository`        | User workspaces and code execution |
|                    | `CustomToolsRepository`       | User-created dynamic tools         |
|                    | `PluginsRepository`           | Plugin state and configuration     |
|                    | `LocalProvidersRepository`    | Local AI providers (Ollama, etc.)  |
|                    | `ConfigServicesRepository`    | Service configuration center       |

#### Schema Migrations

SQL migration files are in `packages/gateway/src/db/migrations/postgres/`. The initial schema (`001_initial_schema.sql`) is automatically applied when PostgreSQL starts via Docker's `docker-entrypoint-initdb.d` mount.

#### Seed Data

Seed scripts in `packages/gateway/scripts/`:

- `seed-database.ts` -- Populates initial data.
- `seed-triggers-plans.ts` -- Creates default automation triggers and plans.
- `packages/gateway/src/db/seeds/default-agents.ts` -- Default agent configurations.

---

### 6.5 WebSocket Server

The WebSocket server (`packages/gateway/src/ws/server.ts`) provides real-time communication for streaming AI responses and channel message relay.

```typescript
interface WSGatewayConfig {
  port?: number; // Default: 18789 (standalone) or /ws path
  path?: string; // Default: '/ws'
  heartbeatInterval?: number; // Default: 30000ms
  sessionTimeout?: number; // Default: 300000ms (5 minutes)
  maxPayloadSize?: number; // Default: 1MB
}
```

**Session Management:**

- Each WebSocket connection creates a `Session` with unique ID, user ID, connection time, and subscribed channels.
- `SessionManager` tracks all active sessions.

**Event System:**

- `gatewayEvents` (`EventEmitter`) bridges between HTTP routes, WebSocket, and channel adapters.
- `ClientEventHandler` processes incoming client messages.

**Message Flow:**

```
Client WS Connect --> Session Created --> Subscribe to Channels
Client WS Message --> ClientEventHandler --> gatewayEvents.emit()
Server Event      --> gatewayEvents      --> Broadcast to Sessions
```

---

### 6.6 Channel Manager

The `ChannelManager` (`packages/gateway/src/channels/manager.ts`) provides a unified interface for all communication channels.

**Supported Channel Types:**

| Channel  | Library     | Adapter Location                                    |
| -------- | ----------- | --------------------------------------------------- |
| Telegram | grammy      | `packages/channels/src/telegram/bot.ts`             |
| Discord  | discord.js  | `packages/gateway/src/channels/adapters/discord.ts` |
| Slack    | @slack/bolt | `packages/gateway/src/channels/adapters/slack.ts`   |
| WhatsApp | (planned)   | --                                                  |
| Matrix   | (planned)   | --                                                  |
| Signal   | (planned)   | --                                                  |
| Webchat  | (built-in)  | Via WebSocket                                       |

**Architecture:**

```
              ChannelManager
              +------------------------------+
              | adapters: Map<id, Adapter>    |
              | factories: Map<type, Factory> |
              |                              |
              | registerFactory(type, fn)     |
              | connect(config): Adapter      |
              | disconnect(id)               |
              | send(message)                |
              +------------------------------+
                       |
          +------------+------------+
          |            |            |
     TelegramAdapter  DiscordAdapter  SlackAdapter
          |            |            |
     grammy Bot     discord.js   @slack/bolt
```

Each adapter converts platform-specific messages into the unified `IncomingMessage` / `OutgoingMessage` types defined in `packages/gateway/src/ws/types.ts`.

---

### 6.7 Autonomy System

The autonomy system (`packages/gateway/src/autonomy/`) controls how independently the AI agent operates.

**Autonomy Levels:**

| Level | Name       | Value | Behavior                                    |
| ----- | ---------- | :---: | ------------------------------------------- |
| 0     | Manual     |   0   | Always ask before any action                |
| 1     | Assisted   |   1   | Suggest actions, ask for approval           |
| 2     | Supervised |   2   | Execute low-risk actions, ask for high-risk |
| 3     | Autonomous |   3   | Execute all actions, send notifications     |
| 4     | Full       |   4   | Fully autonomous, minimal notifications     |

**Risk Assessment:**

Every tool action is assigned a `RiskLevel` (`low`, `medium`, `high`, `critical`) with a numeric score (0-100). The autonomy system compares the risk level against the current autonomy setting to decide whether to execute automatically or request approval.

**Approval Flow:**

```
Tool Call --> Risk Assessment --> Compare to Autonomy Level
                                      |
                          +-----------+-----------+
                          |                       |
                     Risk <= Level           Risk > Level
                          |                       |
                     Auto-execute            Queue for approval
                          |                       |
                     Return result           Notify user
                                                  |
                                            User approves/denies
                                                  |
                                            Execute or cancel
```

---

### 6.8 Service Layer

The service layer (`packages/gateway/src/services/`) encapsulates business logic, keeping route handlers thin and tool executors focused on parameter mapping.

#### Services (16 total)

| Service              | Responsibility                               |
| -------------------- | -------------------------------------------- |
| `GoalService`        | Goal CRUD, decomposition, progress tracking  |
| `MemoryService`      | Memory CRUD, recall, boost, stats            |
| `CustomDataService`  | Dynamic table/record operations              |
| `TriggerService`     | Trigger CRUD, evaluation, history            |
| `PlanService`        | Plan CRUD, step execution, state transitions |
| `DashboardService`   | Aggregated dashboard data                    |
| `GmailService`       | Gmail integration (send, list, read)         |
| `MediaService`       | Image/audio provider management              |
| `PomodoroService`    | Pomodoro timer sessions and settings         |
| `HabitsService`      | Habit tracking and logging                   |
| `CaptureService`     | Quick capture inbox                          |
| `PluginService`      | Plugin state persistence                     |
| `IntegrationService` | OAuth token management                       |
| `WorkspaceService`   | File workspace operations                    |
| `ConfigService`      | Configuration center                         |
| `AuditService`       | Audit trail queries                          |

#### Pattern

```
Route Handler --> Service --> Repository --> Database
     |                |
     v                v
  HTTP concerns   Business logic + EventBus emission
  (validation,    (rules, calculations, side effects)
   serialization)
```

Services emit events via `EventBus` for cross-cutting concerns (audit logging, real-time notifications, cache invalidation).

---

## 7. UI Package (`@ownpilot/ui`)

The frontend is a single-page application built with modern React.

---

### 7.1 Frontend Stack

| Technology           | Version | Purpose                             |
| -------------------- | ------- | ----------------------------------- |
| React                | 19.x    | UI framework                        |
| React Router         | 7.x     | Client-side routing                 |
| Vite                 | 6.x     | Build tool and dev server           |
| Tailwind CSS         | 4.x     | Utility-first CSS framework         |
| @tailwindcss/vite    | 4.x     | Vite integration for Tailwind       |
| prism-react-renderer | 2.x     | Syntax highlighting for code blocks |
| TypeScript           | 5.7+    | Type safety                         |

---

### 7.2 Pages and Routing

The application has 35+ pages organized within a shared `Layout` component. Routing is configured in `App.tsx`:

```
/                    --> ChatPage (default)
/dashboard           --> DashboardPage
/memories            --> MemoriesPage
/goals               --> GoalsPage
/triggers            --> TriggersPage
/plans               --> PlansPage
/autonomy            --> AutonomyPage
/tasks               --> TasksPage
/notes               --> NotesPage
/calendar            --> CalendarPage
/contacts            --> ContactsPage
/bookmarks           --> BookmarksPage
/expenses            --> ExpensesPage
/custom-data         --> CustomDataPage
/data-browser        --> DataBrowserPage
/inbox               --> InboxPage
/agents              --> AgentsPage
/tools               --> ToolsPage
/custom-tools        --> CustomToolsPage
/plugins             --> PluginsPage
/workspaces          --> WorkspacesPage
/models              --> ModelsPage
/costs               --> CostsPage
/logs                --> LogsPage
/settings            --> SettingsPage
/settings/config-center  --> ConfigCenterPage
/settings/api-keys       --> ApiKeysPage
/settings/providers      --> ProvidersPage
/settings/ai-models      --> AIModelsPage
/settings/integrations   --> IntegrationsPage
/settings/media          --> MediaSettingsPage
/settings/system         --> SystemPage
/profile                 --> ProfilePage
*                        --> Redirect to /
```

---

### 7.3 Components

Key reusable components in `packages/ui/src/components/`:

| Component              | Purpose                                             |
| ---------------------- | --------------------------------------------------- |
| `Layout`               | Main page layout with sidebar navigation            |
| `ChatInput`            | Chat message input with tool picker                 |
| `MessageList`          | Renders conversation messages                       |
| `ToolPicker`           | Tool selection overlay for chat                     |
| `ToolExecutionDisplay` | Shows tool call results inline                      |
| `CodeBlock`            | Syntax-highlighted code rendering                   |
| `FileBrowser`          | File system browser component                       |
| `WorkspaceSelector`    | Workspace switching dropdown                        |
| `StatsPanel`           | Statistics and metrics display                      |
| `TimelineView`         | Timeline visualization                              |
| `AIBriefingCard`       | AI-generated briefing cards                         |
| `TraceDisplay`         | Request trace visualization                         |
| `DebugInfoModal`       | Debug information overlay                           |
| `ConfirmDialog`        | Async confirmation dialog (replaces native confirm) |
| `DynamicConfigForm`    | Dynamic form generation from schemas                |
| `ErrorBoundary`        | React error boundary                                |
| `AIModelsTab`          | AI models configuration tab                         |
| `ProvidersTab`         | Provider configuration tab                          |
| `IntegrationsTab`      | Integration configuration tab                       |
| `MediaSettingsTab`     | Media provider settings tab                         |

---

### 7.4 Hooks and State

| Hook           | File                     | Purpose                                           |
| -------------- | ------------------------ | ------------------------------------------------- |
| `useChat`      | `hooks/useChat.ts`       | Chat state management, message sending, streaming |
| `useChatStore` | `hooks/useChatStore.tsx` | Global chat store (conversations, active chat)    |
| `useWebSocket` | `hooks/useWebSocket.tsx` | WebSocket connection and message handling         |
| `useTheme`     | `hooks/useTheme.tsx`     | Dark/light theme management                       |

---

## 8. Channels Package (`@ownpilot/channels`)

The channels package provides standalone bot implementations for messaging platforms.

### Telegram Bot

The primary channel implementation uses **grammy** (Telegram Bot Framework):

```
packages/channels/src/
|-- index.ts              # Package entry
|-- manager.ts            # Channel lifecycle manager
|-- types/index.ts        # Channel type definitions
+-- telegram/
    |-- bot.ts            # Telegram bot implementation
    +-- bot.test.ts       # Tests
```

The Telegram bot:

- Receives messages via long polling or webhook.
- Forwards them to the gateway's agent system.
- Streams back AI responses to the Telegram chat.
- Access control via `TELEGRAM_ALLOWED_USERS` and `TELEGRAM_ALLOWED_CHATS`.

---

## 9. CLI Package (`@ownpilot/cli`)

The CLI provides a terminal interface for managing OwnPilot. It uses **commander** for command parsing and **@inquirer/prompts** for interactive input.

### Binary Names

The package exposes two binary names:

- `ownpilot` -- Full name
- `oag` -- Short alias

### Commands

| Command     | File                    | Purpose                                 |
| ----------- | ----------------------- | --------------------------------------- |
| `start`     | `commands/start.ts`     | Start the gateway server                |
| `server`    | `commands/server.ts`    | Server management (start, stop, status) |
| `config`    | `commands/config.ts`    | View and modify configuration           |
| `channel`   | `commands/channel.ts`   | Manage communication channels           |
| `bot`       | `commands/bot.ts`       | Bot management (Telegram, etc.)         |
| `workspace` | `commands/workspace.ts` | Workspace management                    |

The Docker container starts via `node packages/cli/dist/index.js start`.

---

## 10. Data Flow

### Chat Request Flow (Primary Path)

```
 User types message
        |
        v
 1. UI: ChatInput component
        |
        | HTTP POST /api/chat (or WebSocket)
        v
 2. Gateway: chatRoutes handler
        |
        | Middleware: requestId -> timing -> auth -> rateLimit
        v
 3. Gateway: getOrCreateChatAgent()
        |
        | Agent with ToolRegistry, Provider, Memory
        v
 4. Core: Agent.process(message)
        |
        +---> PromptComposer.compose(context)
        |       |
        |       v
        |     MemoryInjector.inject(basePrompt, options)
        |       |
        |       v
        |     Composed system prompt with:
        |       - User profile
        |       - Available tools
        |       - Time context
        |       - Custom instructions
        |
        +---> Provider.complete(request) or Provider.stream(request)
        |       |
        |       v
        |     LLM API call (OpenAI / Anthropic / Google / ...)
        |       |
        |       v
        |     Response with optional tool_calls
        |
        +---> If tool_calls present:
        |       |
        |       v
        |     ToolRegistry.execute(name, args, context)
        |       |
        |       +---> Autonomy check (risk assessment)
        |       |       |
        |       |       v
        |       |     Auto-execute or queue for approval
        |       |
        |       +---> Tool executor runs
        |       |       |
        |       |       v
        |       |     Result stored in messages
        |       |
        |       +---> Loop back to Provider.complete() with tool results
        |             (up to maxTurns / maxToolCalls)
        |
        v
 5. Final text response
        |
        | Stream chunks or full response
        v
 6. Gateway: persist conversation + messages to DB
        |
        | Cost tracking (token usage)
        v
 7. UI: MessageList renders response
        |
        | WebSocket: real-time updates
        v
 User sees response
```

### Tool Execution Flow (Detail)

```
 Agent receives tool_calls from LLM
        |
        v
 For each tool_call:
        |
        +---> Parse arguments (JSON)
        |
        +---> Apply tool limits (TOOL_MAX_LIMITS)
        |
        +---> Check permissions (PermissionChecker)
        |
        +---> Assess risk (RiskAssessment)
        |       |
        |       v
        |     Risk level vs Autonomy level
        |       |
        |       +---> Approved: execute
        |       +---> Denied: queue for user approval
        |
        +---> Execute tool
        |       |
        |       +---> Built-in executor (core package)
        |       |       or
        |       +---> Gateway executor (DB access needed)
        |       |       or
        |       +---> Custom tool executor (dynamic tools)
        |       |       or
        |       +---> Plugin tool executor (isolated worker)
        |
        +---> Return ToolResult
        |       - content: string
        |       - isError: boolean
        |
        v
 All tool results collected
        |
        v
 Append tool results as messages
        |
        v
 Call LLM again with updated conversation
```

---

## 11. Key Design Patterns

### 11.1 Event-Driven Architecture (EventBus)

The system uses the **EventBus** (see [Section 5.8](#58-event-system-eventbus)) as the primary event system, replacing ad-hoc `EventEmitter` instances with a typed, centralized event bus that supports wildcard subscriptions:

```typescript
// EventBus - typed events with wildcard support
const bus = getEventBus();
bus.on('tool:*', (data) => { ... });         // All tool events
bus.on('resource:created', (data) => { ... }); // Specific events

// AgentOrchestrator events (via EventBus)
bus.on('agent:start', (data) => { ... });
bus.on('agent:complete', (data) => { ... });
bus.on('tool:call', (call) => { ... });
bus.on('tool:result', (result) => { ... });

// Gateway events
gatewayEvents.on('message:incoming', (msg: IncomingMessage) => { ... });
gatewayEvents.on('message:outgoing', (msg: OutgoingMessage) => { ... });
gatewayEvents.on('channel:connected', (channel: Channel) => { ... });
```

### 11.2 Repository Pattern

Every database entity is accessed through a dedicated repository class that extends `BaseRepository` and implements `IRepository<T>`:

```typescript
// Standard query interface for all repositories
interface StandardQuery {
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
}

interface PaginatedResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

interface IRepository<T> {
  findById(id: string): Promise<T | null>;
  create(input: Partial<T>): Promise<T>;
  update(id: string, input: Partial<T>): Promise<T | null>;
  delete(id: string): Promise<boolean>;
}

abstract class BaseRepository {
  protected async query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  protected async queryOne<T>(sql: string, params?: unknown[]): Promise<T | null>;
  protected async execute(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  protected async paginatedQuery<T>(sql: string, query: StandardQuery): Promise<PaginatedResult<T>>;
}
```

### 11.3 Builder Pattern

The `AgentBuilder` uses a multi-phase builder pattern for interactive agent creation:

```
BuilderSession
  phase: gathering --> refining --> generating --> complete
  answers: BuilderAnswer[]
  generatedConfig?: GeneratedAgentConfig
```

### 11.4 Factory Pattern

Channel adapters use factories for registration:

```typescript
channelManager.registerFactory('telegram', (config) => new TelegramAdapter(config));
channelManager.registerFactory('discord', (config) => new DiscordAdapter(config));
channelManager.registerFactory('slack', (config) => new SlackAdapter(config));

// Later:
const adapter = await channelManager.connect({ type: 'telegram', id: '...', ... });
```

### 11.5 Adapter Pattern

The `DatabaseAdapter` interface abstracts PostgreSQL specifics, making it possible to swap database engines:

```typescript
interface DatabaseAdapter {
  readonly type: DatabaseType; // 'postgres'
  query<T>(sql, params): Promise<T[]>;
  queryOne<T>(sql, params): Promise<T | null>;
  execute(sql, params): Promise<{ changes: number }>;
  transaction<T>(fn): Promise<T>;
  exec(sql): Promise<void>;
  close(): Promise<void>;
}
```

### 11.6 Result Pattern for Error Handling

Functions that can fail return `Result<T, E>` instead of throwing:

```typescript
// Registration returns Result, not throwing
register(def, exec): Result<ToolId, ValidationError> {
  if (!def.name) {
    return err(new ValidationError('Tool name required'));
  }
  // ...
  return ok(toolId);
}

// Caller handles both paths
const result = registry.register(def, exec);
if (result.ok) {
  console.log('Registered:', result.value);
} else {
  console.error('Failed:', result.error.message);
}
```

### 11.7 Plugin Isolation

Plugins run in worker threads with capability-based security:

```
Main Thread                    Worker Thread
+-----------------+            +------------------+
| PluginRuntime   |  message   | Plugin Code      |
| - load()        |----------->| - initialize()   |
| - start()       |<-----------| - execute()      |
| - stop()        |  channel   | - cleanup()      |
+-----------------+            +------------------+
       |                              |
       v                              v
IsolationEnforcer              Sandboxed Context
- capability check             - no fs access
- resource limits              - no network (default)
- storage quotas               - limited memory
- audit logging                - timeout enforcement
```

### 11.8 Service Layer Pattern

Services encapsulate business logic between route handlers and repositories:

```typescript
class GoalService {
  constructor(
    private repo: GoalsRepository,
    private bus: IEventBus
  ) {}

  async createGoal(input: CreateGoalInput): Promise<Goal> {
    const goal = await this.repo.create(input);
    this.bus.emit('resource:created', { type: 'goal', id: goal.id });
    return goal;
  }
}
```

See [Section 6.8](#68-service-layer) for the full service listing.

### 11.9 Tool Provider Pattern

Tool providers enable modular tool registration by domain:

```typescript
interface ToolProvider {
  readonly name: string;
  getTools(): Array<{ definition: ToolDefinition; executor: ToolExecutor }>;
}

// Registration in agent setup
tools.registerProvider(new MemoryToolProvider(userId));
tools.registerProvider(new GoalToolProvider(userId));
tools.registerProvider(new CustomDataToolProvider(userId));
```

---

## 12. Deployment Architecture

### Docker Multi-Stage Build

The `Dockerfile` uses a two-stage build for minimal image size:

```
Stage 1: Builder (node:22-alpine)
  - Install pnpm
  - Install all dependencies
  - Copy source code
  - Build all packages (pnpm build)

Stage 2: Production (node:22-alpine)
  - Install pnpm
  - Install production dependencies only
  - Copy built dist/ directories from builder
  - Set NODE_ENV=production
  - Expose port 8080
  - Health check via /health endpoint
  - Start: node packages/cli/dist/index.js start
```

### Docker Compose Configurations

**Full Stack** (`docker-compose.yml`):

```
+------------------+     +-------------------+     +------------------+
|  ownpilot-ui     |     |  ownpilot         |     | ownpilot-postgres|
|  (ui profile)    |---->|  (gateway)        |---->| (postgres profile|
|  Port: 3000      |     |  Port: 8080       |     |  Port: 25432     |
+------------------+     +-------------------+     +------------------+
                               |                          |
                               v                          v
                          gateway-data             postgres-data
                          (volume)                 (volume)
```

**Database Only** (`docker-compose.db.yml`):

- Runs PostgreSQL 16-alpine on port 25432.
- Auto-applies schema migrations on first start.
- Useful for local development with `pnpm dev`.

### Startup Commands

```bash
# Development (all packages in parallel)
pnpm dev

# Production via Docker
docker compose up -d

# Production with PostgreSQL
docker compose --profile postgres up -d

# Database only
docker compose -f docker-compose.db.yml up -d

# Via CLI
pnpm --filter @ownpilot/cli start

# Via scripts
./start.sh    # Linux/macOS
./start.ps1   # Windows
```

---

## 13. Security Architecture

```
                     Security Layers
 +-----------------------------------------------------------------------+
 |                                                                       |
 |  Layer 1: Network                                                     |
 |  +-------------------+  +-----------------+  +--------------------+   |
 |  | CORS              |  | Rate Limiting   |  | HTTPS (external)   |   |
 |  | (configurable     |  | (sliding window)|  |                    |   |
 |  |  origins)          |  |                 |  |                    |   |
 |  +-------------------+  +-----------------+  +--------------------+   |
 |                                                                       |
 |  Layer 2: Authentication                                              |
 |  +-------------------+  +-----------------+  +--------------------+   |
 |  | API Key auth      |  | JWT auth (jose) |  | Optional auth mode |   |
 |  +-------------------+  +-----------------+  +--------------------+   |
 |                                                                       |
 |  Layer 3: Data Protection                                             |
 |  +-------------------+  +-----------------+  +--------------------+   |
 |  | PII Detection     |  | PII Redaction   |  | Encrypted Vault    |   |
 |  | (regex patterns)  |  | (mask/remove/   |  | (AES-256-GCM)     |   |
 |  |                   |  |  hash)          |  |                    |   |
 |  +-------------------+  +-----------------+  +--------------------+   |
 |                                                                       |
 |  Layer 4: Execution Safety                                            |
 |  +-------------------+  +-----------------+  +--------------------+   |
 |  | Docker Sandbox    |  | Worker Thread   |  | Permission System  |   |
 |  | (REQUIRED for     |  | Isolation       |  | (capability-based) |   |
 |  |  code execution)  |  | (plugins)       |  |                    |   |
 |  +-------------------+  +-----------------+  +--------------------+   |
 |                                                                       |
 |  Layer 5: Audit                                                       |
 |  +-------------------+  +-----------------+  +--------------------+   |
 |  | Event Logging     |  | Tamper-Evident  |  | Request Tracing    |   |
 |  | (all actions)     |  | Verification    |  | (X-Request-Id)     |   |
 |  +-------------------+  +-----------------+  +--------------------+   |
 |                                                                       |
 +-----------------------------------------------------------------------+
```

**Critical Security Decisions:**

1. Code execution **requires Docker**. There is no environment variable bypass. The `ALLOW_UNSAFE_CODE_EXECUTION` flag has been permanently removed from the codebase.

2. Plugin code runs in **worker threads** with enforced capability restrictions, memory limits, and storage quotas.

3. Credential storage uses **AES-256-GCM** encryption via the crypto vault.

4. All operations are recorded in the **audit trail** with UUIDv7-timestamped event IDs.

---

## 14. Environment and Configuration

### Environment Variables

| Variable                    | Required | Default                | Description                         |
| --------------------------- | -------- | ---------------------- | ----------------------------------- |
| `NODE_ENV`                  | No       | `development`          | Environment mode                    |
| `PORT`                      | No       | `8080`                 | HTTP server port                    |
| `HOST`                      | No       | `0.0.0.0`              | HTTP server bind address            |
| `DATA_DIR`                  | No       | `./data`               | Persistent data directory           |
| **Database**                |          |                        |                                     |
| `DB_TYPE`                   | No       | `postgres`             | Database type (PostgreSQL only)     |
| `DATABASE_URL`              | No       | --                     | PostgreSQL connection string        |
| `POSTGRES_HOST`             | No       | `postgres`             | PostgreSQL host                     |
| `POSTGRES_PORT`             | No       | `5432`                 | PostgreSQL port                     |
| `POSTGRES_USER`             | No       | `ownpilot`             | PostgreSQL username                 |
| `POSTGRES_PASSWORD`         | No       | `ownpilot_secret`      | PostgreSQL password                 |
| `POSTGRES_DB`               | No       | `ownpilot`             | PostgreSQL database name            |
| **Authentication**          |          |                        |                                     |
| `AUTH_TYPE`                 | No       | `none`                 | Auth mode: `none`, `api-key`, `jwt` |
| `API_KEYS`                  | No       | --                     | Comma-separated API keys            |
| `JWT_SECRET`                | No       | --                     | JWT signing secret                  |
| **AI Providers**            |          |                        |                                     |
| `OPENAI_API_KEY`            | No       | --                     | OpenAI API key                      |
| `ANTHROPIC_API_KEY`         | No       | --                     | Anthropic API key                   |
| `GOOGLE_API_KEY`            | No       | --                     | Google AI API key                   |
| `DEEPSEEK_API_KEY`          | No       | --                     | DeepSeek API key                    |
| **Channels**                |          |                        |                                     |
| `TELEGRAM_BOT_TOKEN`        | No       | --                     | Telegram bot token                  |
| `TELEGRAM_ALLOWED_USERS`    | No       | --                     | Allowed Telegram user IDs           |
| `TELEGRAM_ALLOWED_CHATS`    | No       | --                     | Allowed Telegram chat IDs           |
| **Rate Limiting**           |          |                        |                                     |
| `RATE_LIMIT_DISABLED`       | No       | `false`                | Disable rate limiting               |
| `RATE_LIMIT_WINDOW_MS`      | No       | `60000`                | Rate limit window (ms)              |
| `RATE_LIMIT_MAX`            | No       | `100`                  | Max requests per window             |
| **System**                  |          |                        |                                     |
| `SYSTEM_PROMPT`             | No       | `You are a helpful...` | Default system prompt               |
| `CORS_ORIGINS`              | No       | `*`                    | Allowed CORS origins                |
| `DEFAULT_AUTONOMY_LEVEL`    | No       | `1`                    | Default autonomy level (0-4)        |
| `ENABLE_PROACTIVE_TRIGGERS` | No       | `false`                | Enable proactive automation         |

---

## 15. Build System

### Turborepo Pipeline

Defined in `turbo.json`:

```
build:          dependsOn: [^build]     outputs: [dist/**]
dev:            cache: false            persistent: true, dependsOn: [^build]
test:           dependsOn: [build]      outputs: [coverage/**]
test:watch:     cache: false            persistent: true
test:coverage:  dependsOn: [build]      outputs: [coverage/**]
lint:           dependsOn: [^build]
lint:fix:       dependsOn: [^build]
typecheck:      dependsOn: [^build]
clean:          cache: false
```

The `^build` dependency notation means "build all upstream workspace dependencies first." This ensures `@ownpilot/core` is always built before `@ownpilot/gateway`.

### Build Commands

| Command              | Scope | Purpose                            |
| -------------------- | ----- | ---------------------------------- |
| `pnpm build`         | All   | Build all packages (via Turborepo) |
| `pnpm dev`           | All   | Start all packages in dev mode     |
| `pnpm test`          | All   | Run all tests                      |
| `pnpm test:watch`    | All   | Run tests in watch mode            |
| `pnpm test:coverage` | All   | Run tests with coverage            |
| `pnpm lint`          | All   | Lint all packages                  |
| `pnpm lint:fix`      | All   | Auto-fix lint issues               |
| `pnpm typecheck`     | All   | Type-check all packages            |
| `pnpm clean`         | All   | Clean all build outputs            |
| `pnpm format`        | Root  | Format with Prettier               |
| `pnpm format:check`  | Root  | Check formatting                   |

### TypeScript Configuration

- `tsconfig.base.json` at root provides shared compiler options.
- Each package has its own `tsconfig.json` extending the base.
- All packages target ESM (`"type": "module"` in package.json).
- Output to `dist/` directories.

---

## 16. Testing Strategy

All packages use **Vitest** as the test framework. The project has **65 test files** with **1,075+ tests** across all packages.

### Test Organization

Tests are co-located with source files using the `.test.ts` naming convention:

```
packages/core/src/types/result.test.ts       # Core type tests
packages/core/src/types/branded.test.ts
packages/core/src/audit/logger.test.ts
packages/core/src/crypto/derive.test.ts
packages/core/src/privacy/redactor.test.ts
packages/core/src/privacy/detector.test.ts
packages/core/src/sandbox/executor.test.ts
packages/core/src/agent/tools.test.ts
packages/core/src/agent/memory.test.ts
packages/core/src/agent/provider.test.ts
packages/core/src/agent/agent.test.ts
packages/gateway/src/routes/*.test.ts        # 27 route integration tests
packages/gateway/src/services/*.test.ts      # Service unit tests
packages/gateway/src/middleware/*.test.ts     # Middleware tests
packages/channels/src/telegram/bot.test.ts
packages/cli/src/index.test.ts
packages/ui/src/App.test.tsx
```

### Test Coverage Summary

| Package              | Test Files | Tests  | Description                            |
| -------------------- | :--------: | :----: | -------------------------------------- |
| `@ownpilot/gateway`  |     50     | 1,075+ | Route integration, service, middleware |
| `@ownpilot/core`     |     11     |  ~100  | Types, crypto, privacy, agent          |
| `@ownpilot/channels` |     1      |  ~10   | Telegram bot                           |
| `@ownpilot/ui`       |     1      |   ~5   | App rendering                          |
| `@ownpilot/cli`      |     1      |   ~5   | CLI commands                           |

### Test Patterns

- **Route integration tests** use Hono's built-in `app.request()` test client with `vi.mock()` for module-level mocking of singletons and repositories.
- **Service tests** test business logic in isolation with mocked repositories.
- **Middleware tests** verify the HTTP pipeline (auth, rate limiting, error handling).

### Test Commands

```bash
# Run all tests
pnpm test

# Run tests for specific package
pnpm --filter @ownpilot/core test

# Watch mode
pnpm test:watch

# Coverage report
pnpm test:coverage
```

### Coverage

Coverage is collected with `@vitest/coverage-v8` and output to `coverage/` directories.

---

## Appendix: Quick Reference

### Starting Development

```bash
# 1. Clone and install
git clone https://github.com/ownpilot/ownpilot.git
cd ownpilot
pnpm install

# 2. Start PostgreSQL
docker compose -f docker-compose.db.yml up -d

# 3. Configure environment
cp .env.example .env
# Edit .env with your API keys

# 4. Seed database
pnpm --filter @ownpilot/gateway seed

# 5. Start development
pnpm dev
```

### Adding a New Tool

1. Create tool definition and executor in `packages/core/src/agent/tools/your-tools.ts`.
2. Export from `packages/core/src/agent/tools/index.ts`.
3. Add to the appropriate `TOOL_CATEGORIES` entry.
4. If the tool needs database access, put the executor in `packages/gateway/src/routes/` and keep only the definition in core.

### Adding a New Route

1. Create route module in `packages/gateway/src/routes/your-route.ts`.
2. Export from `packages/gateway/src/routes/index.ts`.
3. Register in the app's route setup in `packages/gateway/src/app.ts`.

### Adding a New Repository

1. Create repository class extending `BaseRepository` in `packages/gateway/src/db/repositories/`.
2. Add table schema to the SQL migration.
3. Export from `packages/gateway/src/db/repositories/index.ts`.

### Adding a New Provider

1. Create a JSON configuration file in `data/providers/`.
2. If the provider is OpenAI-compatible, no code changes are needed -- the JSON config is sufficient.
3. For non-standard APIs, create a custom provider class implementing `IProvider`.
