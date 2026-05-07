# OwnPilot Architecture

**Version:** 1.0 | **Date:** 2026-05-07 | **Stack:** TypeScript Monorepo · pnpm · Turborepo

---

## Table of Contents

1. [High-Level Overview](#1-high-level-overview)
2. [Package Structure & Dependencies](#2-package-structure--dependencies)
3. [Request Flow](#3-request-flow)
4. [Database Schema](#4-database-schema)
5. [Core Package Architecture](#5-core-package-architecture)
6. [Gateway Package Architecture](#6-gateway-package-architecture)
7. [UI Package](#7-ui-package)
8. [CLI Package](#8-cli-package)
9. [Agent System](#9-agent-system)
10. [Tool System](#10-tool-system)
11. [Plugin System](#11-plugin-system)
12. [Claw Runtime](#12-claw-runtime)
13. [Workflow System](#13-workflow-system)
14. [Channel System](#14-channel-system)
15. [Extension System](#15-extension-system)
16. [Soul & Crew System](#16-soul--crew-system)
17. [Fleet System](#17-fleet-system)
18. [Habit Tracking](#18-habit-tracking)
19. [Event System](#19-event-system)
20. [WebSocket Server](#20-websocket-server)
21. [API Routes](#21-api-routes)
22. [Security Architecture](#22-security-architecture)
23. [Key Patterns & Conventions](#23-key-patterns--conventions)

---

## 1. High-Level Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           OwnPilot Monorepo                              │
│                                                                      │
│  ┌─────────────┐    ┌─────────────────┐    ┌─────────────────────┐   │
│  │    CLI     │───▶│    Gateway      │───▶│       Core          │   │
│  │  (Commands)│    │  (Hono + WS)   │    │  (Agent Engine)    │   │
│  └─────────────┘    └─────────────────┘    └─────────────────────┘   │
│                            │   │                      │              │
│                     ┌──────┴───┴──────┐          ┌───────┴───────┐    │
│                     │  PostgreSQL DB │          │ Event System │    │
│                     └────────────────┘          └──────────────┘    │
│                                                                         │
│                     ┌─────────────────┐                               │
│                     │   React SPA UI  │◀──────────────────────────────│
│                     └─────────────────┘                               │
└──────────────────────────────────────────────────────────────────────────┘
```

**OwnPilot** is a privacy-first personal AI assistant platform. It runs as a single self-hosted server with:
- An HTTP API (Hono) + WebSocket server (Gateway)
- A React SPA frontend
- An autonomous Claw runtime that composes LLMs + workspace + soul + coding agents
- 250+ built-in tools, a plugin system, and a workflow/DAG execution engine

---

## 2. Package Structure & Dependencies

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         packages/                                      │
│                                                                         │
│   ┌──────────┐                                                         │
│   │   cli    │  Commands: server, bot, config, channel, tunnel,        │
│   │          │  skill, soul, crew, msg, heartbeat, fleet                │
│   └────┬─────┘                                                         │
│        │  initializes repos, loads credentials                         │
│        ▼                                                                │
│   ┌──────────────────────────────────────────────────────────────────┐ │
│   │                        gateway                                   │ │
│   │                                                                  │ │
│   │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌───────────┐ │ │
│   │  │  HTTP API  │  │    WS      │  │  Database  │  │  Services │ │ │
│   │  │  (Hono)    │  │  Server    │  │  (pg)      │  │   (30+)   │ │ │
│   │  └────────────┘  └────────────┘  └────────────┘  └───────────┘ │ │
│   │         │               │                                    │     │ │
│   │         │        ┌──────┴──────┐                              │     │ │
│   │         │        │ EventBridge │                              │     │ │
│   │         │        └──────┬──────┘                              │     │ │
│   └─────────┼───────────────┼──────────────────────────────────────────┘ │
│             │               │                                            │
│             │    ┌─────────┴─────────┐                                  │
│             │    │                   │                                   │
│             ▼    ▼                   ▼                                   │
│   ┌──────────────────────┐   ┌──────────────────────┐                   │
│   │       core           │   │       ui            │                   │
│   │  (Agent Engine)      │   │  (React SPA)        │                   │
│   └──────────────────────┘   └──────────────────────┘                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

| Package | Path | Responsibility | Dependencies |
|---------|------|---------------|-------------|
| **@ownpilot/core** | `packages/core` | Agent engine, tools, plugins, events, sandbox, crypto, channels, edge | Zero (base) |
| **@ownpilot/gateway** | `packages/gateway` | HTTP API, WebSocket, PostgreSQL, all business logic | core |
| **@ownpilot/ui** | `packages/ui` | React 19 SPA (64 pages) | gateway (HTTP API) |
| **@ownpilot/cli** | `packages/cli` | CLI commands | gateway, core |

### Dependency Rules

```
cli → gateway → core
            ↘ ui (HTTP)
```

- **CLI** depends on Gateway (server) and Core (types)
- **Gateway** depends on Core; exports services, routes, DB repositories
- **UI** depends on Gateway via REST API + WebSocket (no direct package dep)
- **Core** has **zero** external package dependencies — only Node.js built-ins

### Directory Structure

```
packages/
├── core/src/
│   ├── agent/          # Agent, orchestrator, providers, memory, tools
│   ├── plugins/        # PluginRegistry, runtime, isolation, marketplace
│   ├── channels/       # Builder pattern, UCP, channel adapters
│   ├── events/         # EventSystem, EventBus, HookBus, ScopedBus
│   ├── sandbox/        # Secure code execution
│   ├── crypto/         # Keychain, signing
│   ├── credentials/    # Credential management
│   ├── scheduler/      # Task scheduling
│   ├── memory/         # Secure memory
│   ├── privacy/        # Privacy controls
│   ├── assistant/      # Assistant/skills infrastructure
│   ├── services/       # ServiceRegistry, interfaces
│   ├── costs/          # Cost calculation
│   ├── data-gateway/   # Data gateway
│   ├── workspace/      # User workspace isolation
│   ├── security/       # Critical pattern blocking, code risk analysis
│   └── edge/           # IoT/edge device delegation
│
├── gateway/src/
│   ├── routes/         # 50+ Hono route files
│   ├── services/      # Service implementations
│   ├── middleware/    # Auth, rate-limit, validation, audit
│   ├── db/
│   │   ├── repositories/  # Data access objects
│   │   └── schema/        # PostgreSQL DDL (13 domain files)
│   ├── channels/      # Channel service implementation
│   ├── tools/         # Gateway tool providers
│   └── ws/            # WebSocket server
│
├── ui/src/
│   ├── pages/         # 64 pages (code-split)
│   ├── components/    # React components
│   └── api/           # API client wrappers
│
└── cli/src/
    └── commands/      # server, bot, config, channel, tunnel, etc.
```

---

## 3. Request Flow

### HTTP Request Lifecycle

```
HTTP Request
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Hono Middleware Stack                         │
│                                                                  │
│  1. Security Headers (secureHeaders)                            │
│  2. CORS                                                          │
│  3. Body Limit                                                   │
│  4. Request ID + Timing                                          │
│  5. Logger (non-test env)                                         │
│  6. Rate Limiting                                                │
│  7. UI Session Middleware                                        │
│  8. API Auth (api-key / JWT)                                     │
│  9. Audit Logging                                                │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                 Route Handlers                               │ │
│  │                                                               │ │
│  │  registerPlatformRoutes()  → health, auth, profile          │ │
│  │  registerAgentRoutes()     → agents, tools, chat            │ │
│  │  registerDataRoutes()       → personal data, memories       │ │
│  │  registerAutomationRoutes() → goals, triggers, plans,       │ │
│  │                               autonomy, workflows, heartbeats │ │
│  │  registerIntegrationRoutes()→ channels, plugins, extensions,│ │
│  │                               skills, MCP, browser, edge      │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Response Helpers                           │
│                                                                  │
│  apiResponse(c, data, status?)   → { data, status }            │
│  apiError(c, msg, code, status)  → { error: { code, message }} │
└─────────────────────────────────────────────────────────────────┘
```

### WebSocket Request Lifecycle

```
WebSocket Connection
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│  WebSocketServer.authenticate()                                 │
│    ├── API Key (timing-safe comparison)                         │
│    └── UI Session Token                                        │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│  SessionManager.getOrCreate()                                   │
│    └── session timeout: 5 minutes                              │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│  ClientEventHandler.onMessage()                                 │
│    ├── chat-send     → WebChatHandler → Agent                   │
│    ├── chat-stop     → stop agent iteration                     │
│    ├── tool-call     → ToolExecutor                             │
│    ├── claw-control → ClawManager                              │
│    └── ...                                                   │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│  EventBusBridge                                                 │
│    └── broadcasts events back to all connected clients          │
└─────────────────────────────────────────────────────────────────┘
```

### Tool Execution Flow

```
Tool Call Request
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│  ToolExecutor.getSharedToolRegistry()                           │
│                                                                  │
│  Registry contains:                                              │
│    1. Core tools (source: 'core')         — file, code, web     │
│    2. Gateway providers (source: 'gateway') — memory, goals, etc │
│    3. Plugin tools (source: 'plugin')      — weather, expense    │
│    4. Custom tools (source: 'custom')       — user/LLM-created   │
│    5. Extension tools (source: 'dynamic')  — ext.*, skill.*     │
└─────────────────────────────────────────────────────────────────┘
    │
    ├───▶ Permission Check ──────────────────────────────────────▶│
│    │        ToolPermissionService                               │
│    │        checkToolPermission(userId, toolName, context)      │
│    └─────────────────────────────────────────────────────────────│
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│  Middleware Pipeline                                             │
│    1. createPluginSecurityMiddleware()                         │
│       ├── Rate limiting                                         │
│       ├── Argument validation                                   │
│       └── Output sanitization                                   │
│    2. Tool-specific middleware (from tool definition)          │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│  Tool Executor                                                   │
│    ├── Core tool    → Direct implementation                     │
│    ├── Gateway tool → ProviderService                          │
│    ├── Plugin tool → SecurePluginRuntime (worker thread)        │
│    ├── Custom tool → DynamicToolRegistry (sandboxed)            │
│    └── Extension  → ExtensionSandbox (sandboxed)                │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│  Audit Log (fire-and-forget)                                   │
│    AuditService.logAudit({ userId, action: 'tool_execute', ... })│
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Database Schema

PostgreSQL via `pg` adapter. **13 domain schema files** in `packages/gateway/src/db/schema/`.

### Schema Files & Tables

```
packages/gateway/src/db/schema/
│
├── index.ts              # Assembles all schemas (order matters for FK)
├── core.ts               # conversations, messages, request_logs, channels,
│                         # channel_messages, costs, agents, settings,
│                         # system_settings, channel_bridges
├── personal-data.ts      # bookmarks, notes, tasks, calendar_events,
│                         # contacts, captures
├── productivity.ts       # pomodoro_sessions, pomodoro_settings,
│                         # pomodoro_daily_stats, habits, habit_logs
├── autonomous.ts        # memories (pgvector), goals, goal_steps,
│                         # triggers, trigger_history, plans, plan_steps,
│                         # plan_history, heartbeats, embedding_cache
├── workspaces.ts         # File workspace tables
├── models.ts            # model_configurations
├── workflows.ts         # workflows, workflow_versions, workflow_logs,
│                         # workflow_approvals, autonomy_log, mcp_servers
├── coding-agents.ts     # coding_agent_* tables
├── souls.ts             # agent_souls, agent_soul_versions, skill_usage,
│                         # agent_messages, agent_crews, agent_crew_members,
│                         # heartbeat_log, subagent_history
├── channels.ts          # channel_users, channel_sessions,
│                         # channel_verification_tokens, channel_assets,
│                         # user_extensions
├── fleet.ts             # fleets, fleet_sessions, fleet_tasks,
│                         # fleet_worker_history
├── claw.ts              # claws, claw_sessions, claw_history,
│                         # claw_audit_log
└── ui-sessions.ts       # ui_sessions, ui_session_tokens
```

### Migration Pattern

All migrations are **idempotent** — safe to run multiple times:

```sql
-- Table creation (idempotent)
CREATE TABLE IF NOT EXISTS my_table (...);

-- Column addition (idempotent)
ALTER TABLE my_table ADD COLUMN IF NOT EXISTS new_col TEXT;

-- Index creation (idempotent)
CREATE INDEX IF NOT EXISTS idx_my_table_col ON my_table(col);
```

### Key DB Relationships

```
agents
  └── conversations ── messages
                    └── request_logs

channels ── channel_users ── channel_sessions
       └── channel_messages

claws ── claw_sessions ── claw_history
              └── claw_audit_log

fleets ── fleet_sessions ── fleet_tasks

agent_souls ── agent_soul_versions
           └── agent_crews ── agent_crew_members
                            └── heartbeat_log

workflows ── workflow_versions ── workflow_logs
                                   └── workflow_approvals

triggers ── trigger_history
plans ── plan_history
goals ── goal_steps
heartbeats
memories (pgvector embeddings)
```

---

## 5. Core Package Architecture

`@ownpilot/core` — Zero external dependencies, Node.js built-ins only.

```
packages/core/src/
│
├── agent/
│   ├── index.ts              # Exports agent, orchestrator, providers
│   ├── agent.ts              # Core Agent class (LLM interaction)
│   ├── orchestrator.ts       # Multi-step planning/reasoning
│   ├── provider.ts           # Base provider interface
│   ├── memory.ts             # Conversation memory management
│   ├── memory-injector.ts    # Context-aware prompt injection
│   ├── prompt-composer.ts    # Dynamic system prompt composition
│   ├── permissions.ts       # Permission levels & tool categories
│   ├── code-generator.ts     # Sandbox code execution
│   ├── tool-config.ts        # Tool groups and enabled tools
│   ├── tool-validation.ts    # Anti-hallucination validation
│   ├── tool-namespace.ts     # Tool name qualification (core., custom., etc.)
│   ├── dynamic-tools.ts      # LLM-created dynamic tools
│   ├── providers/
│   │   ├── openai-compatible.ts   # OpenAI-compatible API
│   │   ├── zhipu.ts               # Zhipu AI
│   │   ├── google.ts              # Google AI
│   │   ├── router.ts              # Smart model selection
│   │   ├── aggregators.ts        # fal.ai, together.ai, groq, fireworks
│   │   ├── fallback.ts           # Automatic failover
│   │   └── configs/              # JSON-based provider/model configs
│   ├── tools/
│   │   ├── index.ts              # ToolRegistry with 10 tool sets
│   │   ├── file-system.ts        # file_read, file_write, etc.
│   │   ├── code-execution.ts     # code_execute
│   │   ├── web-fetch.ts          # http_request, browse_url
│   │   ├── expense-tracker.ts    # expense tools
│   │   ├── pdf.ts                # PDF tools
│   │   ├── image.ts              # image tools
│   │   ├── email.ts              # email tools
│   │   ├── git.ts               # git tools
│   │   ├── audio.ts             # audio tools
│   │   └── data-extraction.ts   # data extraction tools
│   └── fleet/
│       ├── fleet-manager.ts
│       ├── fleet-worker.ts
│       └── fleet-types.ts
│
├── plugins/
│   ├── index.ts              # PluginRegistry, createPlugin, PluginBuilder
│   ├── registry.ts          # PluginRegistry singleton
│   ├── runtime.ts           # SecurePluginRuntime (worker thread isolation)
│   ├── isolation.ts         # PluginIsolationManager, capability-based access
│   ├── marketplace.ts       # MarketplaceRegistry, PluginVerifier
│   ├── api-boundary.ts      # CAPABILITY_API_MAP
│   └── core-plugin.ts       # Built-in CorePlugin
│
├── channels/
│   ├── index.ts
│   ├── builder.ts           # ChannelPluginBuilder, createChannelPlugin
│   ├── service.ts          # IChannelService interface
│   ├── sdk.ts              # createChannelAdapter
│   └── ucp/
│       ├── index.ts         # Universal Channel Protocol
│       ├── adapter.ts       # UCPChannelAdapter
│       ├── pipeline.ts      # UCPPipeline
│       ├── bridge.ts        # UCPBridgeManager
│       ├── rate-limit.ts
│       └── thread-tracking.ts
│
├── events/
│   ├── index.ts             # EventSystem, getEventSystem, HookBus, EventBus
│   ├── event-system.ts      # IEventSystem facade (EventBus + HookBus + ScopedBus)
│   ├── event-bus.ts        # IEventBus (fire-and-forget events)
│   ├── hook-bus.ts         # IHookBus (sequential interceptable hooks)
│   ├── scoped-bus.ts        # IScopedBus (auto-prefixed namespaces)
│   ├── event-map.ts        # Typed event definitions
│   ├── hook-map.ts         # Typed hook definitions
│   └── types.ts            # TypedEvent, EventHandler, Unsubscribe
│
├── sandbox/
│   ├── index.ts
│   ├── sandbox.ts           # SecureSandbox (vm2 → worker_threads)
│   └── worker.ts            # Worker thread execution
│
├── crypto/
│   ├── index.ts
│   ├── keychain.ts          # OS keychain integration
│   └── signing.ts           # Cryptographic signing
│
├── services/
│   ├── index.ts             # ServiceRegistry, Services enum, hasServiceRegistry
│   ├── registry.ts         # ServiceRegistry singleton
│   └── tokens.ts            # Service tokens (interface markers)
│
├── scheduler/
│   └── index.ts             # TaskScheduler
│
├── memory/
│   └── index.ts             # SecureMemory
│
└── security/
    ├── index.ts
    ├── code-analyzer.ts     # Code risk analysis
    └── pattern-blocker.ts   # Critical pattern blocking
```

---

## 6. Gateway Package Architecture

`@ownpilot/gateway` — HTTP API server using Hono, all business logic, PostgreSQL integration.

```
packages/gateway/src/
│
├── app.ts                  # createApp() — Hono application factory
│                           # Registers all middleware + 50+ route groups
│
├── routes/
│   ├── index.ts            # All route exports (66 route files)
│   ├── register-*.ts       # Route registration helpers
│   │   ├── register-platform-routes.ts  → health, auth, profile
│   │   ├── register-agent-routes.ts     → agents, tools, chat
│   │   ├── register-data-routes.ts      → personal data, memories
│   │   ├── register-automation-routes.ts → goals, triggers, plans,
│   │   │                                   autonomy, workflows, heartbeats
│   │   └── register-integration-routes.ts→ channels, plugins, extensions,
│   │                                       skills, MCP, browser, edge
│   ├── helpers.ts          # apiResponse(), apiError(), ERROR_CODES
│   ├── health.ts          # GET /health
│   ├── agents.ts          # Agent CRUD + tool registration
│   ├── chat.ts            # Chat completions (REST)
│   ├── tools.ts           # Tool registry API
│   ├── claws.ts           # Claw CRUD + runtime control (16 endpoints)
│   ├── workflows.ts       # Workflow CRUD + execution + DAG validation
│   ├── heartbeats.ts      # NL-to-cron heartbeat tasks
│   ├── extensions/        # Extension CRUD + eval + packaging
│   ├── fleet.ts           # Fleet CRUD + task coordination
│   ├── souls.ts           # Soul agent management
│   ├── crews.ts           # Crew orchestration
│   ├── subagents.ts       # Ephemeral task agents
│   ├── triggers.ts        # Trigger CRUD + event-driven execution
│   ├── plans.ts           # Autonomous plan execution
│   ├── goals.ts           # Long-term goal tracking
│   └── ... (50+ more route files)
│
├── services/
│   ├── tool-executor.ts    # Shared ToolRegistry + executeTool()
│   ├── claw-manager.ts     # Singleton Claw lifecycle manager
│   ├── claw-runner.ts      # Single claw cycle executor
│   ├── claw-service.ts     # ClawService interface implementation
│   ├── fleet-manager.ts    # Fleet lifecycle + task coordination
│   ├── fleet-worker.ts     # 5 worker types (ai-chat, coding-cli, api-call,
│   │                       # mcp-bridge, claw)
│   ├── orchestra-engine.ts# Multi-agent collaboration engine
│   ├── subagent-manager.ts # Ephemeral subagent lifecycle
│   ├── extension-service.ts# Extension install/enable/disable/scanning
│   ├── heartbeat-service.ts# NL-to-cron heartbeat tasks
│   ├── soul-heartbeat-service.ts # Soul heartbeat execution
│   ├── conversation-service.ts  # Chat conversation management
│   ├── audit-service-impl.ts     # Audit logging implementation
│   ├── log-service-impl.ts       # Structured logging (getLog)
│   ├── config-center-impl.ts     # GatewayConfigCenter
│   └── ... (20+ more services)
│
├── middleware/
│   ├── index.ts            # All middleware exports
│   ├── auth.ts             # createAuthMiddleware (api-key / JWT)
│   ├── rate-limit.ts       # createRateLimitMiddleware (token bucket)
│   ├── validation.ts      # Zod schema validation
│   ├── audit.ts           # Audit logging middleware
│   ├── ui-session.ts      # UI session authentication
│   ├── pagination.ts      # parsePagination(), paginatedResponse()
│   └── circuit-breaker.ts # Circuit breaker for external calls
│
├── db/
│   ├── repositories/       # 20+ repository classes
│   │   ├── conversations.ts
│   │   ├── messages.ts
│   │   ├── claws.ts
│   │   ├── habits.ts
│   │   ├── extensions.ts
│   │   ├── workflows.ts
│   │   └── ... (15+ more)
│   ├── schema/             # 13 PostgreSQL schema domain files
│   └── adapters/           # pg adapter abstraction
│
├── channels/
│   ├── service-impl.ts     # ChannelServiceImpl (discovers + routes)
│   └── channel-ai-routing.ts # Routes incoming → AI processing
│
├── tools/
│   ├── provider-manifest.ts  # Declarative gateway tool providers
│   ├── custom-tool-registry.ts # DynamicToolRegistry for custom tools
│   ├── provider-manifest.ts   # All gateway tool providers
│   └── claw-tools.ts          # 16 claw tools + 7 management tools
│
└── ws/
    ├── server.ts           # WebSocketServer (auth, heartbeat, reconnect)
    ├── session.ts         # SessionManager (5-min timeout)
    ├── events.ts          # ClientEventHandler (incoming messages)
    ├── event-bridge.ts    # EventBusBridge (WS ↔ EventSystem)
    ├── types.ts           # WS message types
    └── webchat-handler.ts # WebChat message handling
```

---

## 7. UI Package

React 19 + Vite + Tailwind CSS 4. **64 pages**, code-split.

```
packages/ui/src/
├── main.tsx
├── App.tsx
├── pages/
│   ├── DashboardPage.tsx      # Daily briefing with KPI cards
│   ├── AnalyticsPage.tsx     # recharts dashboard (7d/30d toggle)
│   ├── ClawsPage.tsx          # 8-tab Claw management panel
│   ├── HabitsPage.tsx         # Habit tracking + streak heatmap
│   ├── WorkflowPage.tsx       # Visual DAG editor (ReactFlow)
│   ├── SkillsHubPage.tsx     # 14-file skills discovery UI
│   └── ... (58 more pages)
├── components/
│   ├── dashboard/
│   │   ├── ClawsWidget.tsx    # Live WS updates claw widget
│   │   └── ...
│   └── ...
├── api/
│   └── endpoints/             # API client wrappers
│       ├── claws.ts
│       ├── costs.ts
│       ├── habits.ts
│       └── ...
└── hooks/                     # Custom React hooks
```

**Preview Setup:** See `~/.claude/projects/<slug>/memory/project_dev_setup.md` for machine-specific context.

---

## 8. CLI Package

Commander.js CLI with workspace support.

```
packages/cli/src/
├── index.ts
├── commands/
│   ├── server.ts         # pnpm run dev (starts gateway)
│   ├── bot.ts           # Telegram bot
│   ├── config.ts        # Configuration management
│   ├── channel.ts       # Channel setup
│   ├── tunnel.ts        # ngrok/localtunnel for webhook exposure
│   ├── skill.ts         # Skill management
│   ├── soul.ts          # Soul agent management
│   ├── crew.ts          # Crew orchestration
│   ├── msg.ts           # Send messages
│   ├── heartbeat.ts     # Heartbeat control
│   └── fleet.ts         # Fleet command
└── telegram/
    └── telegram-bot.ts  # TelegramBot implementation
```

---

## 9. Agent System

```
Agent (packages/core/src/agent/agent.ts)
  │
  ├── Orchestrator (multi-step planning/reasoning)
  │   └── provider.ts + providers/* (OpenAI, Zhipu, Google, Router, Fallback)
  │
  ├── Memory System
  │   ├── memory.ts (conversation memory)
  │   ├── memory-injector.ts (prompt injection)
  │   └── prompt-composer.ts (dynamic prompts)
  │
  ├── Permission System
  │   └── permissions.ts (none/basic/standard/elevated/full)
  │
  └── Tool System (see Section 10)
```

### Provider Waterfall

```
resolveProviderAndModel(settings)
  │
  ├── 1. Explicit config (model_configs table)
  │
  ├── 2. User preference (settings table)
  │
  ├── 3. Platform default (provider configs JSON)
  │
  └── 4. Fallback provider (automatic failover)
```

---

## 10. Tool System

### Tool Namespace System

```
core.*           — Built-in core tools (file_system, code_execution, etc.)
custom.*         — User/LLM-created custom tools
plugin.{id}.*    — Plugin-provided tools
ext.{id}.*       — Extension tools (ownpilot format)
skill.{id}.*     — Extension tools (agentskills format)

Meta tools (unprefixed):
  search_tools, get_tool_help, use_tool, batch_use_tool
```

### ToolRegistry Architecture

```
ToolRegistry
  ├── coreTools: Map<name, ToolDefinition>
  ├── gatewayTools: Map<name, ToolDefinition>
  ├── pluginTools: Map<pluginId, Map<name, Tool>>
  ├── customTools: Map<name, CustomTool>
  │
  ├── register(toolDef, executor, opts)
  ├── registerPluginTools(pluginId, tools)
  ├── registerCustomTool(def, executor, id)
  ├── has(toolName) → boolean
  ├── execute(toolName, args, context) → Result
  └── getAllTools() → ToolDefinition[]
```

### Tool Sources

| Source | Count | Example | Execution |
|--------|-------|---------|-----------|
| **core** | 50+ | `file_read`, `code_execute`, `http_request` | Direct |
| **gateway** | 10+ | `memory_*`, `goal_*`, `custom_data_*` | ProviderService |
| **plugin** | 20+ | `weather_*`, `expense_*` | Worker thread (SecurePluginRuntime) |
| **custom** | N | User/LLM-created | DynamicToolRegistry (sandboxed) |
| **dynamic** | N | `ext.*`, `skill.*` | ExtensionSandbox (sandboxed) |

### Tool Permission Levels

```
NONE      → no tools
BASIC     → non-sensitive read operations
STANDARD  → standard tool access
ELEVATED  → elevated tools (file mutation, network)
FULL      → all tools including dangerous ones
```

---

## 11. Plugin System

```
PluginRegistry
  │
  ├── enabled: Plugin[]
  ├── manifest: PluginManifest[]
  │
  └── getEnabled() → Plugin[]

Plugin
  ├── manifest: { id, name, version, category, capabilities }
  ├── tools: Map<name, Tool>
  ├── status: 'unloaded' | 'loaded' | 'enabled' | 'disabled'
  └── runtime: SecurePluginRuntime (worker thread)
```

### Plugin Categories

- **core** — Built-in tools (file system, code exec, web fetch, etc.)
- **integration** — Third-party integrations (weather, expense, etc.)
- **ai** — AI model providers
- **channel** — Messaging channels (Telegram, WhatsApp)

### Plugin Security

```
┌─────────────────────────────────────────────────────┐
│              SecurePluginRuntime                     │
│                                                       │
│  Worker Thread Isolation                              │
│    ├── Memory barrier (cannot access process memory)  │
│    ├── Credential barrier (cannot access keychain)   │
│    ├── Resource limits (CPU, memory, time)            │
│    └── Capability-based API access                   │
│                                                       │
│  PluginIsolationManager                              │
│    ├── allowedPaths: string[]                        │
│    ├── blockedPatterns: string[]                     │
│    └── CAPABILITY_API_MAP                            │
└─────────────────────────────────────────────────────┘
```

### Plugin Trust Levels

```
unverified → community → verified → official
```

---

## 12. Claw Runtime

Unified autonomous agent composing LLM + workspace + soul + coding agents + 250+ tools.

```
ClawManager (singleton)
  │
  ├── MAX_CONCURRENT_CLAWS = 50
  ├── MAX_CLAW_DEPTH = 3
  ├── mission max: 10,000 chars
  │
  └── tracks: Map<clawId, ClawSession>

ClawSession
  ├── mode: continuous | interval | event | single-shot
  ├── status: idle | running | paused | stopped
  ├── cycles: number
  └── context: ClawContext
```

### Claw Modes

| Mode | Description |
|------|-------------|
| `continuous` | Runs until stop condition met |
| `interval` | Runs on a schedule (interval-based) |
| `event` | Runs when triggered by an event |
| `single-shot` | Runs once and stops (used by Fleet claw worker) |

### Stop Conditions

```
max_cycles:N     — Stop after N cycles
on_report        — Stop when agent reports completion
on_error         — Stop on error
idle:N           — Stop after N idle cycles
```

### .claw/ Directive System

```
.claw/
├── INSTRUCTIONS.md   — Mission prompt (injected into LLM context)
├── TASKS.md          — Task list for the agent
├── MEMORY.md         — Persistent cross-cycle memory
└── LOG.md           — Auto-scaffolded execution log
```

### Working Memory

```
claw_set_context(key, value)  — Store cross-cycle state
claw_get_context(key)        — Retrieve cross-cycle state
```

### Claw Tools (16 + 7 management)

```
claw_* tools: claw_analyze, claw_execute_task, claw_write_file,
             claw_read_file, claw_list_directory, claw_search_files,
             claw_run_command, claw_snapshot_state, claw_get_context,
             claw_set_context, claw_checkin, claw_report, claw_await_event,
             claw_browse_url, claw_think, claw_rethink

claw-management: claw_start, claw_pause, claw_resume, claw_stop,
                 claw_get_status, claw_list_active, claw_get_logs,
                 claw_update_config
```

---

## 13. Workflow System

DAG-based visual workflow execution with 24 node types.

```
WorkflowService.dispatchNode()
  │
  ├── llmNode          — LLM call (supports responseFormat: 'json')
  ├── codeNode         — Code execution
  ├── conditionNode    — If/else branching
  ├── switchNode       — Multi-way branching
  ├── forEachNode     — Loop over array
  ├── transformerNode  — Data transformation
  ├── httpRequestNode  — HTTP calls
  ├── delayNode       — Wait/sleep
  ├── toolNode        — Tool calls
  ├── triggerNode     — Event-driven triggers
  ├── errorHandlerNode— Try/catch error handling
  ├── notificationNode— Send notifications
  ├── parallelNode    — Parallel execution
  ├── mergeNode       — Merge parallel branches
  ├── dataStoreNode   — Read/write persistent state
  ├── schemaValidatorNode — JSON schema validation
  ├── filterNode      — Array filtering
  ├── mapNode         — Array mapping
  ├── aggregateNode   — Array aggregation
  ├── subWorkflowNode — Nested workflow call
  ├── approvalNode    — Human-in-the-loop approval
  ├── stickyNoteNode  — Documentation
  ├── webhookResponseNode — Webhook response
  └── clawNode        — Claw integration
```

### Workflow Execution Model

```
Topological Sort (DAG)
  │
  ├── Parallel execution within same depth level
  ├── Sequential execution across depth levels
  ├── Template resolution for node-to-node data passing
  │
  └── Template syntax: {{nodeId.output.field}}
```

### Workflow Copilot

```
Copilot Prompt (routes/workflow-copilot-prompt.ts)
  │
  └── Uses short type names: "llm", "claw", "http"
      └── UI converts to "*Node" suffix via convertDefinitionToReactFlow()
```

---

## 14. Channel System

Multi-platform messaging with the **Universal Channel Protocol (UCP)**.

```
ChannelPluginBuilder
  │
  ├── .meta()           — Set plugin metadata
  ├── .platform()      — Set platform (telegram, whatsapp, etc.)
  ├── .channelApi()    — Set IChannelService factory
  └── .build()          — Build the plugin

Channel Plugins registered in plugins/init.ts:
  ├── TelegramPlugin
  └── WhatsAppPlugin (Baileys)
```

### Message Flow (Incoming Channel Message)

```
Channel Webhook → ChannelServiceImpl
  │
  ├── EventBus.emit('channel.message', ...) → UCPBridgeManager
  │
  └── channel-ai-routing.ts
        │
        ├── Routes to Agent (AI processing)
        ├── Routes to Claw (autonomous processing)
        └── Routes to Workflow (trigger-based)
```

### UCP Components

```
UCPChannelAdapter   — Platform-specific message normalization
UCPPipeline         — Message processing pipeline
UCPBridgeManager     — Manages bridge connections between channels
RateLimit            — Per-channel rate limiting
ThreadTracking       — Conversation thread management
```

---

## 15. Extension System

User-extensible tool bundles with sandboxed execution.

```
ExtensionService
  │
  ├── install(extensionId, manifest, code)
  ├── enable(extensionId)
  ├── disable(extensionId)
  └── getToolDefinitions() → ToolDefinition[]
```

### Extension SDK (available in extension code)

```typescript
// Available to extension code via SDK
utils.callTool(name, args)     // Call any of 150+ built-in tools
utils.getConfig(key)           // Get configuration
utils.log(message)             // Structured logging
```

### Permission System

```
BLOCKED_CALLABLE_TOOLS (hard blocked regardless of permission):
  — Shell execution, file mutation, email, git, code-exec

grantedPermissions: SkillPermission[]
  — 'network'   → http_request, browse_url, etc.
  — 'memory'    → memory_* tools
  — 'goals'     → goal_* tools
  — 'custom'    → custom_data_* tools
  — etc.
```

### Extension Formats

```
'ownpilot'    → ext.{id}.{toolName} namespacing
'agentskills' → skill.{id}.{toolName} namespacing
```

### Skills Hub Features

- **Eval**: `POST /:id/eval/run`, `/grade`, `/optimize-description`
- **Packaging**: `GET /:id/package` (downloads `.skill` ZIP)
- **UI**: 14-file React UI (SkillsHubPage, wizard steps)

---

## 16. Soul & Crew System

### Soul Agent System

```
AgentSoul
  ├── id, name, modelId
  ├── systemPrompt
  ├── relationships (crewId, etc.)
  └── heartbeatConfig

SoulHeartbeatService
  │
  ├── Runs soul agent on schedule
  ├── Uses AsyncLocalStorage (heartbeat-context.ts)
  │   └── getHeartbeatContext() → { agentId, ... }
  │
  └── Prepends crew context section when crewId present
```

### Crew Orchestration

```
CrewManager
  │
  ├── createCrew(soulIds)
  ├── addMember(crewId, soulId)
  └── getCrew(crewId) → AgentCrew

Crew Tools (CREW_TOOLS):
  ├── get_crew_members      — List crew members
  ├── delegate_task         — Assign task to member
  └── broadcast_to_crew     — Broadcast to all members
```

### Communication Bus

```
AgentCommunicationBus
  │
  ├── broadcast(message) → { delivered, failed }
  ├── send(toAgentId, message)
  └── getMessages(agentId, since?)
```

---

## 17. Fleet System

Multi-agent fleet coordination with 5 worker types.

```
FleetManager
  │
  ├── fleets: Map<fleetId, FleetSession>
  │
  ├── MAX_CONCURRENT_TASKS per worker type
  │
  ├── createFleet(definition) → fleetId
  ├── addTask(fleetId, task)
  └── failDependentTasks(taskId) — Cascades failures

FleetSession
  ├── status, context (structuredClone isolation)
  └── tasks: FleetTask[]
```

### Fleet Worker Types

```
ai-chat      — Conversational AI chat
coding-cli  — CLI coding agent (uses codex CLI)
api-call    — API call worker
mcp-bridge  — MCP server bridge
claw        — Claw single-shot (ephemeral create → execute → cleanup)
```

### Fleet Task Dependency

```
failDependentTasks(failedTaskId)
  │
  └── Cascades failure to all tasks that depend on failedTaskId
```

---

## 18. Habit Tracking

### Database

```
habits
  ├── id, userId, name, description
  ├── frequency: daily | weekly | weekdays | custom
  ├── targetDays: string[] (JSON array, may be string from DB)
  ├── targetCount, unit
  ├── category, color, icon
  ├── reminderTime, createdAt, updatedAt

habit_logs
  ├── id, habitId, date, count, completed, note
```

### 8 Habit Tools

```
habit_create, habit_update, habit_delete, habit_list,
habit_log, habit_stats, habit_reminder, habit_search
```

### REST API

```
GET/POST        /api/v1/habits
GET/PUT/DELETE  /api/v1/habits/:id
POST            /api/v1/habits/:id/log
GET             /api/v1/habits/:id/stats
```

---

## 19. Event System

Unified facade combining EventBus + HookBus + ScopedBus.

```
EventSystem (singleton)
  │
  ├── eventBus: EventBus     — Fire-and-forget notifications
  ├── hooks: HookBus        — Sequential interceptable hooks
  │
  └── scoped(prefix, source): ScopedEventBus  — Auto-prefixed namespaces
```

### Event Categories

```
agent.*      — Agent lifecycle
tool.*       — Tool registration/execution
resource.*   — Resource CRUD
plugin.*     — Plugin status
system.*     — Startup/shutdown
gateway.*    — Gateway-specific (connection, chat stream)
memory.*     — Memory events
extension.*  — Extension lifecycle
mcp.*        — MCP server events
subagent.*   — Subagent spawn/complete/progress
channel.*    — Channel message/events
client.*    — Client-initiated actions
```

### Hook Types

```
tool:before-execute, tool:after-execute
plugin:before-load, plugin:after-load, plugin:before-enable,
  plugin:before-disable, plugin:before-unload
message:before-process, message:after-process
agent:before-execute, agent:after-execute
client:chat-send, client:chat-stop, client:chat-retry
client:channel-connect, client:channel-disconnect, client:channel-send
client:workspace-create, client:workspace-delete
client:agent-configure
```

### Usage Pattern

```typescript
// Events
system.emit('agent.complete', 'orchestrator', { agentId: '...' });
system.on('tool.executed', (event) => console.log(event.data.name));

// Hooks (interceptable)
system.hooks.tap('tool:before-execute', async (ctx) => {
  if (isBadArgs(ctx.data.args)) ctx.cancelled = true;
});
const result = await system.hooks.call('tool:before-execute', { ... });

// Scoped
const channelBus = system.scoped('channel', 'channel-manager');
channelBus.emit('connected', data); // → 'channel.connected'
```

---

## 20. WebSocket Server

```
WebSocketServer
  │
  ├── authenticate()    — API key (timing-safe) or UI session token
  ├── SessionManager   — 5-minute session timeout
  │
  ├── heartbeat: 30s interval (ping/pong)
  │
  └── EventBusBridge   — Broadcasts events to all connected clients
```

### WebSocket Message Types

```
client → server:
  ├── chat-send         — Send chat message
  ├── chat-stop         — Stop agent iteration
  ├── chat-retry        — Retry last message
  ├── tool-call         — Execute tool directly
  ├── claw-control      — Start/stop/pause claw
  └── ping              — Keepalive

server → client:
  ├── chat-progress    — Streaming response chunks
  ├── chat-complete    — Final response
  ├── tool-progress    — Tool execution progress
  ├── claw-event       — Claw runtime events
  └── error            — Error notifications
```

---

## 21. API Routes

**50+ route files** registered in 5 groups:

### Route Groups

```
registerPlatformRoutes()
  ├── /health
  ├── /api/v1/auth
  └── /api/v1/profile

registerAgentRoutes()
  ├── /api/v1/agents
  ├── /api/v1/chat
  └── /api/v1/tools

registerDataRoutes()
  ├── /api/v1/tasks, /bookmarks, /notes, /calendar, /contacts
  ├── /api/v1/custom-data
  ├── /api/v1/memories
  ├── /api/v1/settings
  └── /api/v1/summary

registerAutomationRoutes()
  ├── /api/v1/goals
  ├── /api/v1/triggers
  ├── /api/v1/plans
  ├── /api/v1/autonomy
  ├── /api/v1/workflows
  ├── /api/v1/heartbeats
  ├── /api/v1/habits
  └── /api/v1/pomodoro

registerIntegrationRoutes()
  ├── /api/v1/channels, /channel-auth
  ├── /api/v1/plugins
  ├── /api/v1/extensions
  ├── /api/v1/skills
  ├── /api/v1/composio
  ├── /api/v1/mcp
  ├── /api/v1/browser
  ├── /api/v1/edge
  ├── /api/v1/cli-chat
  ├── /api/v1/coding-agents
  ├── /api/v1/subagents
  ├── /api/v1/orchestra
  └── /webhooks/telegram/:secret
```

### Key REST Endpoint Families

| Domain | Base Path | Key Endpoints |
|--------|----------|--------------|
| **Claws** | `/api/v1/claws` | 16 endpoints: CRUD + `/stats`, `/audit`, `/deny-escalation` |
| **Workflows** | `/api/v1/workflows` | CRUD + DAG validation + execution |
| **Subagents** | `/api/v1/subagents` | Ephemeral task agents |
| **Fleets** | `/api/v1/fleet` | Fleet CRUD + task coordination |
| **Souls** | `/api/v1/souls` | Soul agent CRUD |
| **Crews** | `/api/v1/crews` | Crew orchestration |
| **Habits** | `/api/v1/habits` | Habit CRUD + logging + stats |

---

## 22. Security Architecture

### Middleware Security Stack

```
1. secureHeaders (HSTS, X-Content-Type-Options, X-Frame-Options, CSP)
2. CORS (explicit origin whitelist, not wildcard)
3. bodyLimit (configurable, applies to /api/* and /webhooks/*)
4. Rate Limiting (token bucket, webhooks included)
5. UI Session Auth (bypasses API auth for logged-in web users)
6. API Auth (api-key or JWT)
7. Audit Logging (fire-and-forget)
```

### Security Features

| Feature | Implementation |
|---------|----------------|
| **SSRF Protection** | `isBlockedUrl()` (sync) + `isPrivateUrlAsync()` (DNS rebinding) |
| **Timing-safe comparison** | API key comparison, Twilio signature |
| **Sandbox isolation** | Worker threads for plugins, vm for extensions |
| **SVG iframe restriction** | Sandbox restriction on SVG rendering |
| **IDOR guard** | Bridge route protection |
| **Open-redirect guard** | Composio callback validation |
| **Rate limiting** | Token bucket algorithm on all API endpoints |
| **Hard-blocked tools** | Shell, file mutation, email, git, code-exec from extensions |

---

## 23. Key Patterns & Conventions

### Response Helpers

```typescript
// Standard success response
apiResponse(c, data, status?)  → { data, status }

// Standard error response
apiError(c, message, code, status) → { error: { code, message } }

// Pagination
parsePagination(c)           → { page, limit, offset }
paginatedResponse(c, items, total, page, limit)
```

### Error Codes

```typescript
ERROR_CODES = {
  NOT_FOUND, UNAUTHORIZED, FORBIDDEN, VALIDATION_ERROR,
  RATE_LIMITED, INTERNAL_ERROR, etc.
}
```

### Idempotent Migrations

```sql
CREATE TABLE IF NOT EXISTS ...;
ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...;
CREATE INDEX IF NOT EXISTS ...;
```

### vi.hoisted() for Class Mocks

```typescript
const { MockFoo } = vi.hoisted(() => {
  const MockFoo = vi.fn().mockImplementation(function() {
    return { method: vi.fn() };
  });
  return { MockFoo };
});
```

### Tool Namespace Sanitization

```typescript
sanitizeToolName('core.file_read')  → 'core_file_read'  (dots to underscores)
desanitizeToolName('core_file_read') → 'core.file_read'  (underscores to dots)
```

### AsyncLocalStorage for Context

```typescript
// heartbeat-context.ts
runInHeartbeatContext(ctx, fn)
getHeartbeatContext() → { agentId, crewId, ... }
```

### Structured Logging

```typescript
// All production code uses:
const log = getLog('ModuleName');
log.info('message', { key: value });
log.warn('message', { error: err });
```

### Dead Code Cleanup (v0.2.2+)

```
✓ Zero require() in ESM production code
✓ Zero silent .catch(() => {})
✓ Zero TODO/FIXME/HACK in production
✓ Zero lint warnings in production
✓ 3 intentional as any (WS/event type workarounds with eslint-disable)
```

---

## 24. Security Gaps Analysis (External Audit — 2026-05-07)

> The following issues were identified by an external architecture audit. Each item is tracked with severity, current state, and recommended resolution.

---

### 24.1 Dayanıklılık — Persistent Task Queue Eksikliği (HIGH)

**Problem:** Triggers, Plans, Workflows, Subagents, and Heartbeats — five separate systems — all implement cron-like or event-driven logic. None have a persistent queue. `EventSystem` is in-memory. `ClawManager` holds `Map<clawId, ClawSession>` in memory. Fleet sessions are also in-memory.

**Failure Scenario:** Workflow engine is running a 24-node DAG, node #7 is executing. Gateway process is killed (OOM, deploy, kernel panic). On restart: the in-progress node is lost. This is at-most-once execution. The user expects at-least-once or exactly-once.

**Current State:** If `workflow_logs` table is written on every node completion, manual recovery is possible. But "currently running but not yet finished" work state is lost on restart.

**Resolution:** Introduce a durable job queue layer using Postgres (Graphile Worker or pg-boss). Both use Postgres as the queue backend — no extra infrastructure (Redis/RabbitMQ) required. Jobs live in a `jobs` table, workers use `FOR UPDATE SKIP LOCKED` to avoid contention, exponential backoff retry on failure, dead letter queue after N attempts.

**Refactor Scope:**
- `WorkflowService.dispatchNode` → enqueues each node as a job
- Worker pool executes nodes, writes results to DB, triggers dependent nodes via gating
- `TriggerService` schedules cron-like jobs into the queue
- `PlanExecutor` writes each step as a job
- Fleet and Subagent systems become naturally restartable (workers wake up, see `in-progress` jobs, continue)

**Idempotency Key:** Every tool execution, HTTP call, and webhook receive should be tagged with an idempotency key. Duplicate requests (retry, network duplication) return the first result without re-execution. Tool executor needs an `idempotency_keys` table (`key`, `result`, `expires_at`) with 24h TTL. Retry policy then naturally becomes duplication-safe.

---

### 24.2 Sandbox Gerçekten İzolasyon Değil (CRITICAL)

**Problem:** `SecurePluginRuntime` uses worker thread isolation; the `vm` module is used for extensions. Both run inside the JavaScript runtime — not real isolation.

**Attack Vectors (within current sandbox):**
- `process.binding('fs')` — direct Node.js internal API access
- `eval` — arbitrary code execution
- Prototype pollution — object property injection
- V8 internals exploits — historically recurring in Node.js
- `this.constructor.constructor("return process")()` — classic vm module escape

**Node.js docs explicitly state:** _"the vm module is not a security mechanism"_. The `vm.runInNewContext` is scope separation, not sandboxing.

**Real Sandbox Options:**

| Option | Isolation Level | Complexity | Notes |
|--------|----------------|------------|-------|
| **wasmtime** (Rust binary, WASI) | OS-level | Medium | Unix socket IPC; capability-based; your best fit |
| **Firecracker** (microVM, KVM) | Hypervisor | High | Requires VM infrastructure |
| **gVisor** (kernel emulation) | Container | Medium | syscall-level filtering |

**Recommended:** `wasmtime` via a `sandbox-ctl` Rust crate that listens on a Unix socket. Gateway sends `"run this code with these args"` over IPC, gets result back. Capabilities are explicit: no filesystem (default), no network (default), no env vars (default). If a tool declares `"internet access required"` in its manifest, the capability is opened but with an allowlist (only these domains).

**Current State:** `BLOCKED_CALLABLE_TOOLS` (shell, file mutation, email, git, code-exec) and 100+ regex patterns are **blacklist-based**. Blacklists are bypassed eventually. WASM capability-based is **whitelist**: _"if not granted, it does not exist"_.

**Immediate Action:** Build an adversarial test suite at `packages/core/test/sandbox-escape/` that attempts: prototype pollution, regex bypass, env exfiltration, `process.send` abuse, async stack manipulation. These run in CI on every release; a successful bypass blocks the release. This discipline existed in OpenClaw until March 2026 when they paid the price.

---

### 24.3 Veri Katmanı — Migration ve Type Safety Boşluğu (MEDIUM)

**Problem 1 — No Rollback:** Migrations are idempotent in the forward direction (good) but have no `down.sql`. If a migration adds a column that causes a production bug, rolling back requires manual SQL.

**Problem 2 — Schema/Type Drift:** SQL schema files and TypeScript types are maintained manually and separately. No automatic link between them. One gets updated, the other doesn't → drift.

**Problem 3 — Transaction Boundaries:** 40+ repository classes. Multi-step operations — e.g., creating a workflow + 24 nodes + edges + version snapshot — are atomic only if wrapped in a transaction. If each repository calls its own `pool.query()`, partial failure is possible (12 nodes written, 13th fails, half a workflow remains in DB).

**Problem 4 — Log Retention:** These tables grow unbounded:
`request_logs`, `audit_log`, `claw_history`, `claw_audit_log`, `workflow_logs`, `plan_history`, `trigger_history`, `heartbeat_log`, `subagent_history`, `embedding_cache`

No retention policy is defined in the architecture. After 6 months, Postgres hits 100GB.

**Resolution — Drizzle ORM:**

```typescript
// gateway/src/db/schema/claws.ts
import { pgTable, text, timestamp, jsonb, integer } from 'drizzle-orm/pg-core';

export const claws = pgTable('claws', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  mission: text('mission').notNull(),
  mode: text('mode', { enum: ['continuous', 'interval', 'event', 'single-shot'] }).notNull(),
  status: text('status').default('idle').notNull(),
  cycleCount: integer('cycle_count').default(0),
  config: jsonb('config').$type<ClawConfig>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type Claw = typeof claws.$inferSelect;
export type NewClaw = typeof claws.$inferInsert;
```

Then `drizzle-kit generate` produces both `up.sql` and `down.sql`. `drizzle-kit check` in CI catches schema drift. Repository classes become typed query builders — compile-time errors on wrong column names.

**Migration Path:** Port 13 schema files to Drizzle incrementally. New tables first (forward-compatible), then existing tables (Drizzle definitions that match current schema), then refactor repository classes to Drizzle queries. Last step: wrap multi-step operations in `db.transaction()`.

**Retention Policy (Immediate Action):** Define per-table retention now, not later:
- `audit_log`: 90 days
- `request_logs`: 30 days
- `embedding_cache`: TTL field-based expiry
- Nightly job (via the job queue above) purges cold records or moves to a `cold_storage` table.

---

### 24.4 Provider Katmanı — Veri-Güdümlü Olmayan Routing (MEDIUM)

**Problem 1 — Static Config:** Provider router strategies ("cheapest, fastest, smartest, balanced, fallback") use static JSON config. `"OpenAI fast=true, cost=0.005/1K"` — this never changes. Real-world latency and error rates change hourly. Static config cannot optimize in real time.

**Resolution:** Telemetry-based routing. Every provider call writes a row to `provider_metrics(provider_id, model_id, ts, latency_ms, error, prompt_tokens, completion_tokens, cost_usd)`. Router queries 1-hour moving averages: cheapest = lowest $/token, fastest = lowest p50 latency, smartest = model_configs user-defined score, balanced = composite metric.

**Problem 2 — Token Counting:** Some OpenAI-compatible endpoints don't return token usage (older proxies, some open-source backends). Fallback: local token counting with tiktoken or gpt-tokenizer.

**Problem 3 — Streaming Cancellation Propagation:** User clicks "Stop" in UI (`chat-stop` event). Gateway stops its iteration, but does it close the provider's HTTP stream connection? If not, the provider keeps generating tokens and adding to the bill. `AbortController` must be chained all the way to the provider adapter. Each provider adapter accepts `signal: AbortSignal` and passes it to the HTTP request.

**Problem 4 — Embedding Model Versioning:** `memories` table stores pgvector embeddings. When switching embedding models (BGE-small → Snowflake Arctic Embed), old vectors and new vectors have different dimensions — cosine similarity breaks. `memories` table needs an `embedding_model_id` column. Retrieval queries `WHERE embedding_model_id = current_model`. Migration runs a background re-embedding job (via the queue), after which the `current_model` flag switches. Starting this architecture now prevents a painful migration later.

---

### 24.5 Eşzamanlılık ve Yaşam Döngüsü — Bounded Queues, Cleanup (MEDIUM)

**Problem 1 — Unbounded In-Memory Collections:** `ClawManager.tracks: Map<clawId, ClawSession>`, `MAX_CONCURRENT_CLAWS=50`. What happens when 50 are full and a new claw request arrives? Reject? Queue? Evict oldest? If queued, is the queue bounded? Unbounded queue = memory exhaustion.

**Required Policy for Every In-Memory Collection:**
- `ClawManager.tracks` — max 50 + LRU eviction or bounded queue
- `FleetManager.fleets` — max N fleets + eviction policy
- `EventBus` listeners — max unbounded but attach cleanup on unsubscribe
- `DynamicToolRegistry` — max cached tools + LRU eviction
- `embedding_cache` — max size + TTL eviction
- `idempotency_keys` — max size + TTL (already has TTL, needs max size)
- `ToolRegistry` — already bounded by registered tools, but custom tool sync needs bound

**Create `core/src/utils/bounded-map.ts`:** A generic `BoundedMap<K, V>(maxSize, evictionPolicy)` wrapper used everywhere in-memory collections are needed.

**Problem 2 — Orphan Cleanup:** Subagent, Claw, Fleet, Plan, Workflow — what happens when a parent process is killed while one of these is running? Orphan state remains in DB. Required: `reconcileOrphanedSubagents()` at boot — queries DB for `status: running` but not actually running, sets them to `status: aborted`, cascades to dependent tasks. Same reconciliation needed for Claw, Fleet, Plan, and Workflow.

**Problem 3 — Browser Process Cleanup:** `/api/v1/browser` automation (Playwright/Puppeteer). Browser processes become zombies if Node.js parent exits without `browser.close()`. Required: `browser.close()` in `try/finally` on every path. Orphan cleanup at boot (`pkill chromium` or similar). Not visible in current architecture.

**Problem 4 — Subprocess Management:** `coding-cli` worker type spawns `codex` CLI subprocess. `child_process.spawn` with `detached: false` and piped stdio. Parent shutdown handler must call `child.kill('SIGTERM')` with timeout then `SIGKILL`. On Linux, `prctl(PR_SET_PDEATHSIG, SIGKILL)` for kernel-level orphan protection (requires native binding).

**Problem 5 — Memory Pressure Detection:** `v8.getHeapStatistics()` measured every 30s. When heap approaches limit: set backpressure flag, slow down Claw spawning, purge old conversation contexts. `ClawManager` checks this flag before accepting new work.

---

### 24.6 Gözlemlenebilirlik — Audit Var Ama Tracing Yok (MEDIUM)

**Current State:** `AuditService`, hash-chain audit log, structured logging via `getLog`, `request_logs` table — good for "what happened." Not sufficient for "why was it slow."

**Missing — Distributed Tracing:**
- Audit answers: _"user X called tool Y at time Z"_
- Tracing answers: _"request arrived → middleware 12ms → orchestrator 8ms → provider call 2400ms (!) → tool execution 145ms → memory write 22ms → SSE send 4ms"_

Without tracing, performance problems are black boxes. The question "customers complained it was slow — why?" cannot be answered systematically.

**Resolution — OpenTelemetry:**
- `@hono/otel` middleware for automatic HTTP instrumentation
- Manual spans around provider calls (biggest unknown: which provider, which model, token count, duration)
- `X-Trace-ID` response header on every response
- Trace ID written into audit log entries
- OTLP exporter → Tempo/Jaeger/Datadog

**Metrics — Prometheus Endpoint:**
```
/metrics endpoint (Prometheus format):
ownpilot_chat_requests_total{provider, model, status}
ownpilot_tool_execution_duration_seconds{tool, source}
ownpilot_claw_sessions_active
ownpilot_provider_token_cost_usd_total
```

**Alerts (Grafana):**
- p99 latency > 5s
- error rate > 5%
- claw memory > 80% limit

**PII Redaction:** User message content, tool arguments, provider responses leak through logs. Add `redactPII(logRecord)` middleware in the log writer path — runs before any write. Default: ON in production, OFF in dev. PII redaction service exists (15+ categories) but is not automatically wired into all log writers.

---

### 24.7 API Tasarımı — Versioning ve Idempotency (MEDIUM)

**Problem 1 — No v2 Strategy:** `/api/v1/` prefix exists but no v2 evolution plan. When a breaking change is needed: extensions and channel adapters calling v1 endpoints will break. Strategy needed:
- **Side-by-side (recommended):** v1 and v2 served in parallel. v1 has a documented deprecation period, then removed. Simple but route duplication.
- **Header-based:** `Accept: application/vnd.ownpilot.v2+json` header switching. More complex but single codebase.

**Problem 2 — Webhook Signature Validation Inconsistency:** Twilio uses timing-safe comparison (good). Other channels:
- Telegram: `X-Telegram-Bot-Api-Secret-Token`
- Discord: `X-Signature-Ed25519` + `X-Signature-Timestamp`
- Stripe-style: HMAC-SHA256
- GitHub: `X-Hub-Signature-256`

Each channel needs validation middleware. Mis-signed requests must be rejected, logged, and rate-limited.

**Problem 3 — API-Level Idempotency:** `POST /api/v1/chat` — on mobile network duplication, two requests arrive. Without idempotency-key handling at the API layer, two separate responses are generated. Add `Idempotency-Key` header support: if key exists in cache, return cached response; otherwise execute and store. Standard pattern used by Stripe, Square; should be standard in agent platforms.

---

### 24.8 Konfigürasyon Doğrulama ve Boot-Time Fail-Fast (HIGH)

**Problem:** `.env.example` has `MEMORY_SALT=change-this-in-production`, `JWT_SECRET=` (blank). If production deploys with these defaults, the system boots but is insecure: memory encryption uses a known default key, JWT validation is skipped or broken.

**Current State:** No validation. Process boots with insecure defaults → user believes system is secure when it is not.

**Resolution — Boot-Time Validation:**
```typescript
// Zod schema validates all env vars at startup
// MEMORY_SALT: must not equal "change-this-in-production"
// JWT_SECRET: required when AUTH_TYPE=jwt, min 32 chars
// ENCRYPTION_KEY: 32-byte hex
// DATABASE_URL or individual POSTGRES_*: all required

if (invalid) {
  console.error(`[FATAL] Configuration validation failed:
  - MEMORY_SALT: must not be the default value "change-this-in-production"
  - JWT_SECRET: required when AUTH_TYPE=jwt, must be at least 32 characters
  Refer to https://ownpilot.dev/docs/configuration for guidance.`);
  process.exit(1);
}
```

**Discipline:** Fail-fast — running with wrong config is worse than not running at all.

**NODE_ENV-aware:** In dev, `MEMORY_SALT=dev-default-not-secure` works. In production (`NODE_ENV=production`), same value causes a fail-fast. Boot checks `NODE_ENV` and branches accordingly.

---

### 24.9 Test Disiplini — Pyramid ve Adversarial (MEDIUM)

**Current State:** Vitest, `vi.hoisted()` pattern, 1,507 tests — unit layer is solid. Unknown: integration and E2E layer quality.

**Questions:**
- CI runs against real Postgres or mock `pg`? Mock `pg` misses query bugs.
- Integration tests: real schema migrate + real queries + real transactions?
- E2E: Playwright tests for core user flows?

**Recommended Test Pyramid:**

```
Top: E2E (Playwright)
  └── 5-10 core user journeys (Login → Chat → Tool → Approval → Result)
  └── Runtime < 5 min; otherwise team disables tests

Middle: Integration
  └── Route + DB + Service stack against real Postgres (pg15, pg16 in CI matrix)
  └── Transaction boundary tests (partial failure scenarios)

Base: Unit (fast, many)
  └── Result<T,E> flows, type guards, parsers, tool argument validation
  └── Property-based testing (fast-check): random input → no crash, no invariant violation
```

**Adversarial Testing (Immediate):**
- `test/sandbox-escape/` — prototype pollution, regex bypass, env exfiltration, `process.send` abuse, async stack manipulation
- `test/security/` — SSRF bypass URLs, regex pattern bypass, prompt injection templates
- These run in CI on every release; successful bypass = P0 issue = release blocked

**Property-Based Testing:**
```typescript
import { fc } from 'fast-check';
// From Zod schema, generate random inputs:
// no crash, no invariant violation across all tool argument validation
```

---

### 24.10 Provider Bağımlılığı ve Lock-In Riski (MEDIUM)

**Problem 1 — OpenAI-Compatible Abstraction Leak:** If Anthropic is accessed via OpenAI-compatible adapter, there are meaningful differences: streaming delta format, tool calling format, Vision API. These differences are real and can cause subtle bugs.

**Resolution:** Each provider has its own native adapter. OpenAI-compatible is used only for the common subset. Provider-specific adapters handle streaming, tool calling, and vision independently.

**Problem 2 — No Provider Health Checks:** If a provider goes down or a model is sunset, the gateway boots but every chat request returns 404. No early detection.

**Resolution — Provider Health Check at Boot:**
- `provider.healthCheck()` called at startup
- If unreachable → warn (do not fail boot), emit `provider_status` event
- UI shows "OpenAI unavailable" indicator
- Automatic fallback activates

**Provider Config Metadata:**
- `deprecated_at` — date when provider/model deprecated
- `replacement_model_id` — migration target
- Boot checks these and warns/fails accordingly

---

### Gap Summary Table

| # | Issue | Severity | Effort | Priority | Status |
|---|-------|----------|--------|----------|--------|
| 24.1 | Persistent task queue (job queue layer) | HIGH | High | P1 | **Partially done (idempotency keys for tools; orphan reconciliation; job queue ADR pending)** |
| 24.2 | Real sandbox isolation (wasmtime) | CRITICAL | High | P0 | Pending (P0 tests done) |
| 24.3 | Drizzle ORM + migration/type safety | MEDIUM | High | P2 | **Partially done (transaction() in BaseRepository; cleanup methods exist; schema drift unverified)** |
| 24.4 | Telemetry-based provider routing | MEDIUM | Medium | P2 | **Partially done (embedding_model_id col added; token counting fallback; WS session pong fix)** |
| 24.5 | Bounded maps + orphan cleanup | MEDIUM | Medium | P2 | **Done (P1 portion, BoundedMap added)** |
| 24.6 | OpenTelemetry tracing + metrics | MEDIUM | Medium | P2 | **Done (metrics foundation)** |
| 24.7 | API versioning + webhook signature | MEDIUM | Low | P3 | **Done (idempotency keys table in core schema; HMAC verification; tool executor layer; v2 strategy pending)** |
| 24.8 | Boot-time config validation fail-fast | HIGH | Low | P1 | **Done** |
| 24.9 | Test pyramid + adversarial suite | MEDIUM | Medium | P2 | **Done (sandbox part)** |
| 24.10 | Native provider adapters + health checks | MEDIUM | Medium | P2 | **Done** |

**Implemented in this session (2026-05-07):**

**P0 — 24.8 Boot-Time Config Validation:**
- `packages/gateway/src/config/validation.ts` — `validateBootConfig()` + `assertBootConfig()`
- Checks `MEMORY_SALT` is not the insecure default placeholder
- Requires `JWT_SECRET` when `AUTH_TYPE=jwt` (min 32 chars)
- Validates database configuration
- Production: exits with clear error on failure
- Development: logs warnings but continues
- Wired into `server.ts` main() before any heavy initialization

**P1 — 24.5 Orphan Reconciliation:**
- `packages/gateway/src/services/orphan-reconciliation.ts` — `reconcileOrphanedSessions()`
- Finds and marks as aborted all orphaned Claw, Fleet, Subagent, Workflow, and Plan sessions
- 5-minute heartbeat threshold to avoid false positives on long-running tasks
- Called at boot, BEFORE any autonomous system starts

Repository methods added:
- `ClawsRepository.getOrphanedSessions()` + `updateSessionStatus()`
- `SubagentsRepository.getOrphanedSessions()` + `markAborted()`
- `WorkflowsRepository.getOrphanedRuns()` + `markRunFailed()`
- `PlansRepository.getOrphanedPlans()` + `markPlanFailed()`
- `FleetRepository.getOrphanedSessions()` + `markSessionStopped()`, `requeueOrphanedTasks('__all__')`

**P0 — 24.2 Sandbox Adversarial Test Suite:**
- `packages/core/src/sandbox/sandbox-escape.test.ts` — 41 tests across 13 groups
- **Attack vectors covered:**
  - `constructor.constructor` escape (8 variants) — blocked by `/\bprocess\b/` + constructor regex
  - Prototype pollution (`Object.prototype`, `Array.prototype`, `__proto__`, `defineProperty`)
  - Proxy-based scope chain escape — Proxy is undefined in sandbox globals
  - Symbol-based escape (`Symbol.unscopables`, `Symbol.toStringTag`) — blocked by new patterns
  - Error stack introspection — path exposure tested
  - Async stack manipulation (Promise rejection, async generators)
  - Timing attacks (`SharedArrayBuffer`, `Atomics`) — blocked (undefined globals)
  - RCE via built-ins (`Function.toString`, escape sequences, `RegExp.$1`)
  - Native module access (`process.binding`, `process.dlopen`, `NativeModule`) — blocked
  - Resource exhaustion (memory limit + execution timeout)
  - Worker thread isolation (`parentPort`, `workerData`)
- **Legitimate code verified still works:** arithmetic, arrays, JSON, RegExp, Date, URL, Math, crypto, fetch
- **Security fixes applied:**
  - `worker-sandbox.ts`: Hardcoded globals replaced with `buildSandboxContext()` for proper isolation
  - `code-validator.ts`: Constructor regex fixed (negative lookbehind), `getOwnPropertyDescriptor(Symbol)` pattern added
  - `context.ts`: `fetch` + `Response/Request/Headers` now injected when `network: true`
- **Critical finding:** `codeGeneration: { strings: false }` does NOT block `this.constructor.constructor("return process")()` — VM allows direct Function constructor access. Protection is purely via regex validation (defense-in-depth).
- CI gate: tests run on every release; any escape that succeeds blocks the release

**P2 — 24.10 Provider Health Checks:**
- `IProvider.healthCheck()` added to interface + `BaseProvider` as abstract method
- Implementations: `OpenAICompatibleProvider`, `OpenAIProvider`, `AnthropicProvider`, `GoogleProvider`, `FallbackProvider`, `CliChatProvider`
- `ProviderHealthResult` exported via `@ownpilot/core` agent barrel
- `ProviderHealthService.runProviderHealthChecks()` probes all configured providers via `/models` endpoint (5s timeout) at boot
- Logged at WARN level for unavailable providers; does NOT fail boot
- `ProviderStatusEvent` emitted via EventBus for UI "provider unavailable" indicators

**P2 — 24.6 Prometheus Metrics Endpoint:**
- `packages/gateway/src/services/metrics-service.ts` — in-process MetricsService with Prometheus text format
- `GET /metrics` endpoint with counters, histograms, gauges (no external dependencies)
- Metrics: `ownpilot_http_requests_total{method,path,status}`, `ownpilot_http_request_duration_ms` histogram (11 latency buckets), `ownpilot_active_agents{type}`, `ownpilot_provider_cost_usd_total{provider}`, `ownpilot_chat_requests_total{provider,model,status}`
- `recordHttpRequest()` wired into auditMiddleware for every API request
- `startMetricsService()` called at boot; agent metrics refresh every 30s via setInterval
- For multi-node: aggregate via Prometheus Pushgateway (documented in comments)

**P2 — 24.5 BoundedMap Utility:**
- `packages/core/src/utils/bounded-map.ts` — `BoundedMap<K, V>(maxSize, evictionPolicy)` with 'lru' and 'fifo' policies
- `packages/core/src/utils/bounded-map.test.ts` — 20 tests covering basic ops, LRU/FIFO eviction, iteration
- Monotonic counter approach: lowest counter = oldest mutation (LRU) or oldest insertion (FIFO)
- Used by: ClawManager.tracks, FleetManager.fleets, DynamicToolRegistry, idempotency keys, embedding cache
- Addresses: unbounded in-memory collections identified in gap 24.5

**P2 — 24.7 Idempotency Keys:**
- `packages/gateway/src/db/migrations/postgres/030_idempotency_keys.sql` — idempotency_keys table (TEXT PK, JSONB result, expires_at with index)
- `packages/gateway/src/db/repositories/idempotency-keys.ts` — IdempotencyKeysRepository: getRecord, setRecord, deleteKey, purgeExpired, countActive
- `packages/gateway/src/db/schema/core.ts` — idempotency_keys table added to CORE_TABLES_SQL (fresh installs); idx_idempotency_expires_at index added to CORE_INDEXES_SQL
- `packages/gateway/src/services/tool-executor.ts` — executeTool() now checks/updates idempotency keys: SHA-256(toolName+args) as key, 24h TTL, cached results returned on duplicate calls
- Existing webhook signature validation: Slack (HMAC-SHA256 via createHmac), Telegram (path secret via safeKeyCompare), Trigger (HMAC-SHA256), Email (secret via safeKeyCompare)
- Missing: API-level Idempotency-Key header middleware for chat endpoints (key per-request, not per-tool-call), v2 versioning strategy

**WebSocket Session Fix:**
- `packages/ui/src/hooks/useWebSocket.tsx` — respond to connection:ping with session:pong, unlimited reconnect with exponential backoff (1s→30s cap)
- `packages/gateway/src/ws/server.ts` — session:pong handler now calls `sessionManager.touch()` to reset WS session TTL (was logging only)

**P2 — 24.4 Token Counting & Embedding Model Versioning:**
- `packages/core/src/agent/providers/openai-compatible.ts` — `countTokens()` uses char/4 approximation as fallback for OpenAI-compatible endpoints that don't return token usage
- `packages/gateway/src/db/schema/autonomous.ts` — `memories.embedding_model_id` column added for multi-model embedding support; queries can scope to current model: `WHERE embedding_model_id = $currentModel`; partial index `idx_memories_embedding_model` added
- `packages/gateway/src/db/schema/autonomous.ts` — migration to add `embedding_model_id` column for existing installs

**Remaining P0-P1:**
- Persistent job queue research (24.1) — ADR to be written
- wasmtime sandbox (24.2 real isolation) — research phase

**P2 — 24.1 & 24.7 Tool Executor Idempotency:**
- `packages/gateway/src/services/tool-executor.ts` — executeTool() now checks/updates idempotency keys before execution
  - Key: SHA-256(userId + toolName + JSON.stringify(args))
  - On cache hit: returns cached ToolExecutionResult without re-execution
  - On cache miss: executes and stores result with 24h TTL
  - Deduplicates duplicate calls from retried triggers, plans, workflows, webhooks
  - Idempotency failures are non-blocking (fire-and-forget with try/catch)
  - Test mock added: `mockIdempotencyRepo` with getRecord/setRecord in tool-executor.test.ts

**P2 — 24.3 Transaction Safety:**
- `packages/gateway/src/db/repositories/base.ts` — `BaseRepository.transaction()` delegates to adapter.transaction()
- `packages/gateway/src/db/adapters/postgres-adapter.ts` — `transaction()` with 30s timeout, automatic rollback on error, re-throws original error after rollback
- Cleanup methods exist across repositories: `memories.cleanup(maxAge, minImportance)`, `channel_sessions.cleanupOld(90 days)`, `trigger_history.cleanupHistory(30 days)`, `request_logs` cleanup
- Multi-step operations use transaction (e.g., channel-messages batch insert)

