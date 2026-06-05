# OwnPilot Architecture

**Version:** 0.7.2

---

## Table of Contents

1. [High-Level Overview](#1-high-level-overview)
2. [Package Structure & Dependencies](#2-package-structure--dependencies)
3. [Request Flow](#3-request-flow)
4. [Database Schema](#4-database-schema)
5. [Core Package Architecture](#5-core-package-architecture)
   - [5.A Two-Layer Capability Architecture](#5a-two-layer-capability-architecture-2026-05-23)
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
17. [Removed: Fleet, Subagent, Orchestra](#17-removed-fleet-subagent-orchestra)
18. [Habit Tracking](#18-habit-tracking)
19. [Event System](#19-event-system)
20. [WebSocket Server](#20-websocket-server)
21. [API Routes](#21-api-routes)
22. [Security Architecture](#22-security-architecture)
23. [Key Patterns & Conventions](#23-key-patterns--conventions)
24. [Additional Subsystems](#23a-additional-subsystems) — MCP, Coding Agents, Browser, Voice, Composio, Pulse, Tunnel, Pairing, Notifications, Security Scanner, Job Queue, Retention, Metrics, Provider Health
25. [Security Gaps Analysis (Audit)](#24-security-gaps-analysis-external-audit--2026-05-07)

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
│   │   cli    │  Commands: start, server, bot, config, channel,         │
│   │          │  tunnel, skill, soul                                    │
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

| Package               | Path               | Responsibility                                                        | Dependencies       |
| --------------------- | ------------------ | --------------------------------------------------------------------- | ------------------ |
| **@ownpilot/core**    | `packages/core`    | Agent engine, tools, plugins, events, sandbox, crypto, channels, edge | Zero (base)        |
| **@ownpilot/gateway** | `packages/gateway` | HTTP API, WebSocket, PostgreSQL, all business logic                   | core               |
| **@ownpilot/ui**      | `packages/ui`      | React 19 SPA (64 pages)                                               | gateway (HTTP API) |
| **@ownpilot/cli**     | `packages/cli`     | CLI commands                                                          | gateway, core      |

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
│   ├── assistant/      # Assistant/skills infrastructure
│   ├── audit/          # Tamper-evident audit logging
│   ├── channels/       # Builder pattern, UCP, channel adapters
│   ├── costs/          # Cost calculation
│   ├── credentials/    # Credential management
│   ├── crypto/         # Keychain, signing, vault
│   ├── data-gateway/   # Data gateway
│   ├── edge/           # IoT/edge device delegation
│   ├── events/         # EventSystem, EventBus, HookBus, ScopedBus
│   ├── memory/         # Secure memory
│   ├── plugins/        # PluginRegistry, runtime, isolation, marketplace
│   ├── privacy/        # PII detection/redaction
│   ├── sandbox/        # Secure code execution
│   ├── scheduler/      # Task scheduling
│   ├── security/       # Critical pattern blocking, code risk analysis
│   ├── services/       # ServiceRegistry, interfaces
│   ├── types/          # Branded types, Result<T,E>, errors, guards
│   └── workspace/      # User workspace isolation
│
├── gateway/src/
│   ├── routes/         # 70+ Hono route files
│   ├── services/      # Service implementations (90+ files)
│   ├── middleware/    # Auth, rate-limit, validation, audit
│   ├── db/
│   │   ├── repositories/  # Data access objects (60+ repos)
│   │   └── schema/        # PostgreSQL DDL (15 domain files)
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

PostgreSQL via `pg` adapter. **14 domain schema files** in `packages/gateway/src/db/schema/`.

### Schema Files & Tables

```
packages/gateway/src/db/schema/
│
├── index.ts              # Assembles all schemas (order matters for FK)
├── core.ts               # conversations, messages, request_logs, channels,
│                         # channel_messages, costs, agents, settings,
│                         # system_settings, channel_bridges, idempotency_keys,
│                         # jobs, job_history, provider_metrics
├── personal-data.ts      # bookmarks, notes, tasks, calendar_events,
│                         # contacts, projects, reminders, captures
├── productivity.ts       # pomodoro_sessions, pomodoro_settings,
│                         # pomodoro_daily_stats, habits, habit_logs
├── autonomous.ts         # memories (pgvector + embedding_model_id), goals,
│                         # goal_steps, triggers, trigger_history, plans,
│                         # plan_steps, plan_history, heartbeats,
│                         # embedding_cache
├── workspaces.ts         # user_workspaces, user_containers, code_executions,
│                         # workspace_audit, execution_permissions
├── models.ts             # user_model_configs, custom_providers,
│                         # user_provider_configs, custom_data, custom_tools,
│                         # custom_table_schemas, custom_data_records,
│                         # oauth_integrations, config_services, config_entries,
│                         # plugins, local_providers, local_models
├── workflows.ts          # workflows, workflow_versions, workflow_logs,
│                         # workflow_approvals, autonomy_log, mcp_servers
├── coding-agents.ts      # coding_agent_results, cli_providers,
│                         # cli_tool_policies, coding_agent_permissions,
│                         # coding_agent_skill_attachments,
│                         # coding_agent_subscriptions, orchestration_runs,
│                         # artifacts, artifact_versions
├── souls.ts              # agent_souls, agent_soul_versions, skill_usage,
│                         # agent_messages, agent_crews, agent_crew_members,
│                         # heartbeat_log
├── channels.ts           # channel_users, channel_sessions,
│                         # channel_verification_tokens, channel_assets,
│                         # user_extensions, user_extension_removals
├── claw.ts               # claws, claw_sessions, claw_history,
│                         # claw_audit_log
└── ui-sessions.ts        # ui_sessions
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
│   │   ├── openai-provider.ts     # OpenAI native adapter
│   │   ├── openai-compatible.ts   # OpenAI-compatible API (DeepSeek, etc.)
│   │   ├── anthropic-provider.ts  # Anthropic native (Claude models)
│   │   ├── google.ts              # Google AI (Gemini)
│   │   ├── zhipu.ts               # Zhipu AI (GLM)
│   │   ├── router.ts              # Smart model selection (cheapest/fastest/
│   │   │                          # smartest/balanced/fallback)
│   │   ├── aggregators.ts         # fal.ai, together.ai, groq, fireworks
│   │   ├── fallback.ts            # Automatic failover wrapper
│   │   └── configs/               # JSON-based provider/model configs
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

## 5.A Two-Layer Capability Architecture (2026-05-23)

OwnPilot uses a two-layer model to keep module boundaries clean. Every
runtime (Chat, Claw, Soul Heartbeat, AgentRunner, Workflow…) consumes a
fixed set of horizontal capabilities. Capability contracts live in
`@ownpilot/core`; implementations live in `@ownpilot/gateway`; runtimes
import the contracts and never reach into implementations directly.

```
                     ┌─────────────────────────────────────────────────┐
   Layer 2           │  RUNTIMES (vertical)                            │
   (vertical)        │                                                 │
                     │  Chat • Claw • Soul Heartbeat • AgentRunner     │
                     │  Workflow • Coding Agents • Pulse • Triggers    │
                     └────────────────────┬────────────────────────────┘
                                          │ ctx.* (typed bundle)
                                          ▼
                     ┌─────────────────────────────────────────────────┐
   Layer 1           │  CAPABILITIES (horizontal)                      │
   (horizontal)      │                                                 │
                     │  ┌─────────────┐  ┌──────────────┐              │
                     │  │ LLMRouter   │  │ ChannelSvc   │  ConfigCenter│
                     │  │ pick()      │  │ send()       │  getApiKey() │
                     │  │ ctx-window  │  │ broadcast()  │  getField()  │
                     │  └─────────────┘  └──────────────┘              │
                     │  ┌─────────────┐  ┌──────────────┐  ┌─────────┐ │
                     │  │ EventSystem │  │ PermGate     │  │ Memory  │ │
                     │  │ emit/on     │  │ check()      │  │ create  │ │
                     │  └─────────────┘  └──────────────┘  └─────────┘ │
                     │  ┌─────────────┐                                │
                     │  │ AuditSvc    │                                │
                     │  │ logRequest  │                                │
                     │  └─────────────┘                                │
                     └─────────────────────────────────────────────────┘
```

### Capability accessor pattern

Every capability follows the same shape:

- Contract in core: `IXxx` interface
- Singleton accessors: `getXxx()`, `setXxx()`, `hasXxx()`
- ServiceToken (mirrored in `Services.Xxx` for the registry path)
- Gateway impl wires up at startup: `setXxx(new XxxImpl(...))`

Both paths resolve to the same instance — the accessor checks the
registry first, falls back to a module-level singleton. Either entry
point works after `setXxx` has run.

### RuntimeContext bundle

`packages/core/src/services/runtime-context.ts` defines the bundle:

```typescript
export interface RuntimeContext {
  readonly llm: ILLMRouter;
  readonly channels: IChannelService;
  readonly config: ConfigCenter;
  readonly events: IEventSystem;
  readonly permissions: IPermissionGate;
  readonly memory: IMemoryService;
  readonly audit: IAuditService;
}
```

A runtime takes the bundle once at construction:

```typescript
class MyRunner {
  constructor(
    private config: MyConfig,
    private runtime: RuntimeContext = getRuntimeContext()
  ) {}

  async run() {
    const model = await this.runtime.llm.pick({ process: 'pulse' });
    // ... use this.runtime.channels, .events, .permissions, etc.
  }
}
```

Production constructs the runner without the second arg and inherits the
process-wide singletons; tests pass a mock bundle (one stub instead of
seven separate global overrides). `hasRuntimeContext()` returns true
once the six explicit capabilities have been installed (the EventSystem
lazy-creates itself, so it's always available).

### Where each capability lives

Thirty capabilities now follow the accessor pattern. The seven in the
`RuntimeContext` bundle are infrastructure every runtime needs; the
others are domain/data services with accessor-only access (no bundle
slot because they're consumed by routes/orchestrators, not by every
runtime).

**In `RuntimeContext` bundle (infrastructure):**

| Capability     | Contract                                        | Impl                                           |
| -------------- | ----------------------------------------------- | ---------------------------------------------- |
| LLMRouter      | `core/src/services/llm-router.ts`               | `gateway/src/services/llm-router.ts`           |
| ChannelService | `core/src/channels/service.ts`                  | `gateway/src/channels/service-impl.ts`         |
| ConfigCenter   | `core/src/services/config-center.ts`            | `gateway/src/services/config-center-impl.ts`   |
| EventSystem    | `core/src/events/event-system.ts`               | (lazy-created in core)                         |
| PermissionGate | `core/src/services/permission-gate.ts`          | `gateway/src/services/permission-gate-impl.ts` |
| MemoryService  | `core/src/services/memory-service-interface.ts` | `gateway/src/services/memory-service.ts`       |
| AuditService   | `core/src/services/audit-service.ts`            | `gateway/src/services/audit-service-impl.ts`   |

**Accessor-only (domain/data services):**

| Capability         | Contract                                    | Impl                                                |
| ------------------ | ------------------------------------------- | --------------------------------------------------- |
| GoalService        | `core/src/services/goal-service.ts`         | `gateway/src/services/goal-service.ts`              |
| TriggerService     | `core/src/services/trigger-service.ts`      | `gateway/src/services/trigger-service.ts`           |
| PlanService        | `core/src/services/plan-service.ts`         | `gateway/src/services/plan-service.ts`              |
| DatabaseService    | `core/src/services/database-service.ts`     | `gateway/src/services/custom-data-service.ts`       |
| ExtensionService   | `core/src/services/extension-service.ts`    | `gateway/src/services/extension-service.ts`         |
| McpClientService   | `core/src/services/mcp-client-service.ts`   | `gateway/src/services/mcp-client-service.ts`        |
| PluginService      | `core/src/services/plugin-service.ts`       | `gateway/src/services/plugin-service-impl.ts`       |
| WorkflowService    | `core/src/services/workflow-service.ts`     | `gateway/src/services/workflow/workflow-service.ts` |
| EmbeddingService   | `core/src/services/embedding-service.ts`    | `gateway/src/services/embedding-service.ts`         |
| HeartbeatService   | `core/src/services/heartbeat-service.ts`    | `gateway/src/services/heartbeat-service.ts`         |
| ToolService        | `core/src/services/tool-service.ts`         | `gateway/src/services/tool-service-impl.ts`         |
| ProviderService    | `core/src/services/provider-service.ts`     | `gateway/src/services/provider-service-impl.ts`     |
| SessionService     | `core/src/services/session-service.ts`      | `gateway/src/services/session-service-impl.ts`      |
| ResourceService    | `core/src/services/resource-service.ts`     | `gateway/src/services/resource-service-impl.ts`     |
| WorkspaceService   | `core/src/services/workspace-service.ts`    | `gateway/src/services/workspace-service-impl.ts`    |
| ArtifactService    | `core/src/services/artifact-service.ts`     | `gateway/src/services/artifact-service.ts`          |
| CodingAgentService | `core/src/services/coding-agent-service.ts` | `gateway/src/services/coding-agent-service.ts`      |
| PulseService       | `core/src/services/pulse-service.ts`        | `gateway/src/autonomy/engine.ts`                    |
| EdgeService        | `core/src/services/edge-service.ts`         | `gateway/src/services/edge-service.ts`              |
| CliToolService     | `core/src/services/cli-tool-service.ts`     | `gateway/src/services/cli-tool-service.ts`          |
| MessageBus         | `core/src/services/message-bus.ts`          | `gateway/src/services/message-bus-impl.ts`          |
| ClawService        | `core/src/services/claw-types.ts`           | `gateway/src/services/claw-service.ts`              |

**Migration completion (2026-05-23):** The gateway has **zero production
callsites** using `getServiceRegistry().get(Services.X)` outside the
generic `crud-factory.ts` (which is parameterised over an arbitrary
`ServiceToken<T>` and legitimately needs the registry API). Every other
consumer resolves through its capability accessor:

- `hasServiceRegistry()` / `getServiceRegistry()` direct calls — gone
  from all runtime files. The few `tryGet(Services.X)` fallbacks (audit
  middleware, tool-executor) were collapsed into the canonical
  `hasXService()` / `getXService()` pair on the same day.
- `configServicesRepo.getFieldValue()` / `.getApiKey()` /
  `.getDefaultEntry()` / `.isAvailable()` / `.getEntries()` / `.getByName()`
  direct reads — migrated to `getConfigCenter()`. The repo retains CRUD
  ownership (its `upsert` / `createEntry` / `updateEntry` calls still
  belong to the gateway-internal route module, the seed file, the
  api-service-registrar, and the `*-overrides.ts` schema registrants).
- `resolveForProcess()` direct calls in runtime code — migrated to
  `getLLMRouter().pick({ process })`. The function still exists as the
  bottom-of-stack implementation that the router delegates to.
- Module-level singletons in autonomous runtimes — Claw was already a
  class taking `RuntimeContext`; Soul Heartbeat was the last holdout
  (collection of module-level functions with shared mutable state) and
  was extracted into a `SoulHeartbeatService` class matching the
  ClawRunner shape. Module-level wrappers remain only as
  backward-compat entry points for legacy callers.

The service registry is kept as a secondary mounting point so
third-party plugins that prefer iteration (e.g. listing what's
available) can still resolve through it.

### Adding a new capability

1. Define the contract `IXxx` and accessors (`getXxx` / `setXxx` /
   `hasXxx` + `XxxToken`) in `packages/core/src/services/xxx.ts`,
   following the existing pattern (registry-first, singleton fallback).
2. If it's infrastructure used by every runtime, add the field to
   `RuntimeContext` and include it in `getRuntimeContext()` +
   `hasRuntimeContext()`. Otherwise skip this step — the accessor is
   the canonical access path for domain services.
3. Re-export from `packages/core/src/services/index.ts`.
4. Implement in `packages/gateway/src/services/xxx-impl.ts` and call
   `setXxx(impl)` in `server.ts` at startup.
5. Migrate any direct callers as their files are touched. NEW code
   consumes the capability through `ctx.xxx.*` (if in the bundle) or
   `getXxx()` — never the impl directly, never the service registry.

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
│   ├── index.ts            # All route exports (60 route files)
│   ├── register/           # Route registration helpers (6 files)
│   │   ├── platform.ts     → health, auth, profile
│   │   ├── agent.ts       → agents, tools, chat
│   │   ├── data.ts        → personal data, memories
│   │   ├── automation.ts   → goals, triggers, plans, autonomy, workflows, heartbeats
│   │   ├── integration.ts  → channels, plugins, extensions, skills, MCP, browser, edge
│   │   └── v2.ts          → side-by-side v2 routes
│   ├── agents/             # Agent routes
│   ├── artifacts/          # Artifact routes
│   ├── audit/              # Audit routes
│   ├── autonomy/           # Autonomy routes
│   ├── bridges/           # Bridge routes
│   ├── browser/            # Browser routes
│   ├── channels/           # Channel routes
│   ├── chat/               # Chat routes
│   ├── claws/              # Claw routes (16 endpoints)
│   ├── cli/                # CLI routes
│   ├── coding-agents/       # Coding agents routes
│   ├── composio/           # Composio routes
│   ├── config-services/    # Config services routes
│   ├── costs/              # Cost routes
│   ├── crews/              # Crew routes
│   ├── custom-data/        # Custom data routes
│   ├── custom-tools/       # Custom tools routes
│   ├── dashboard/          # Dashboard routes
│   ├── database/           # Database routes
│   ├── debug/              # Debug routes
│   ├── edge/               # Edge routes
│   ├── error-codes/        # Error codes routes
│   ├── execution-permissions/  # Execution permissions routes
│   ├── expenses/           # Expense routes
│   ├── extensions/         # Extension routes + eval + packaging
│   ├── file-workspaces/    # File workspace routes
│   ├── goals/              # Goal routes
│   ├── health.ts           # GET /health
│   ├── heartbeats/         # Heartbeat routes
│   ├── helpers.ts          # apiResponse(), apiError(), ERROR_CODES
│   ├── local-providers/    # Local provider routes
│   ├── memories/           # Memory routes
│   ├── mcp/                # MCP routes
│   ├── model-configs/      # Model configs routes
│   ├── model-routing/      # Model routing routes
│   ├── models/             # Models routes
│   ├── notifications/      # Notification routes
│   ├── openapi.ts          # OpenAPI spec
│   ├── personal-data/      # Personal data routes
│   ├── plans/              # Plan routes
│   ├── plugins/           # Plugin routes
│   ├── productivity/       # Productivity routes
│   ├── profile/            # Profile routes
│   ├── providers/          # Provider routes
│   ├── pulse.ts            # Pulse routes
│   ├── security/           # Security routes
│   ├── settings/           # Settings routes
│   ├── skills/             # Skills routes
│   ├── souls/              # Soul routes
│   ├── tools/              # Tool routes
│   ├── triggers/           # Trigger routes
│   ├── tunnel/             # Tunnel routes
│   ├── ui-auth/            # UI auth routes
│   ├── voice/              # Voice routes
│   ├── webhooks/           # Webhook routes
│   ├── workflow/           # Workflow routes
│   └── workspaces/         # Workspace routes

├── services/
│   ├── agent/              # Agent service (cache, prompt, registry, runner-utils, service)
│   ├── artifact/          # Artifact service
│   ├── audit-service.ts    # Audit logging implementation
│   ├── chat/              # Chat service + streaming
│   ├── claw/              # Claw lifecycle (manager, runner, service)
│   ├── cli/                # CLI service
│   ├── coding-agent/       # Coding agent service
│   ├── config/             # Config center + validation
│   ├── conversation-service.ts  # Chat conversation management
│   ├── custom/             # Custom data service
│   ├── dashboard/          # Dashboard service
│   ├── edge/               # Edge service
│   ├── embedding/          # Embedding service
│   ├── extension/          # Extension service (install, enable, scanner, trigger-manager)
│   ├── heartbeat/          # Heartbeat service
│   ├── job-queue-service.ts  # Durable job queue (pg-boss)
│   ├── llm/                # LLM router + semaphore
│   ├── log.ts              # Structured logging (getLog)
│   ├── memory-service.ts   # Memory service
│   ├── metric/             # Metrics service
│   ├── mcp/                # MCP client + server services
│   ├── model/              # Model service
│   ├── notification-router.ts # Notification routing
│   ├── orphan-reconciliation.ts # Boot-time orphan reclamation
│   ├── permission/         # Permission gate service
│   ├── provider/           # Provider service
│   ├── resource/           # Resource service
│   ├── retention-service.ts # Nightly retention cleanup
│   ├── session-service.ts  # Session service
│   ├── skill/              # Skill service
│   ├── tool/               # Tool service
│   ├── tool-executor.ts     # Shared ToolRegistry + executeTool()
│   ├── voice-service.ts    # Voice service
│   └── workspace-service.ts # Workspace service
│
├── middleware/
│   ├── index.ts            # All middleware exports
│   ├── auth.ts             # createAuthMiddleware (api-key / JWT)
│   ├── rate-limit.ts       # createRateLimitMiddleware (token bucket)
│   ├── validation.ts      # Zod schema validation + schemas/
│   ├── audit.ts           # Audit logging middleware
│   ├── ui-session.ts      # UI session authentication
│   ├── pagination.ts      # parsePagination(), paginatedResponse()
│   ├── circuit-breaker.ts # Circuit breaker for external calls
│   ├── error-handler.ts   # Global error handler
│   ├── request-id.ts      # Request ID + timing header
│   ├── timing.ts          # Request timing logger
│   └── schemas/           # Validation Zod schemas (workflow-claws, etc.)
│
├── db/
│   ├── repositories/       # 84 files (38 flat .ts + 11 family subdirs)
│   │   ├── agents/        # Agent repository
│   │   ├── artifacts/     # Artifact repository
│   │   ├── channels/      # Channel repositories (messages, sessions, assets, verification)
│   │   ├── chat/          # Chat repositories (conversations, messages)
│   │   ├── claw/          # Claw repository
│   │   ├── cli/           # CLI repository
│   │   ├── coding-agent/   # Coding agent repositories
│   │   ├── config-services/  # Config services repository
│   │   ├── crew/          # Crew repository
│   │   ├── custom/         # Custom data repositories
│   │   ├── goals/         # Goal repository
│   │   ├── habits.ts       # Habit repository (645 lines)
│   │   ├── heartbeats/     # Heartbeat repository
│   │   ├── jobs.ts          # Job queue repository
│   │   ├── memories.ts       # Memory repository (pgvector)
│   │   ├── orchestrator/    # Orchestrator repository
│   │   ├── plans/          # Plan repository
│   │   ├── settings/        # Settings repository
│   │   ├── souls/          # Soul repository
│   │   ├── triggers/        # Trigger repository
│   │   ├── workflows/       # Workflow repository
│   │   ├── workspaces/      # Workspace repository
│   │   ├── base.ts          # BaseRepository + transaction()
│   │   ├── index.ts         # Barrel exports
│   │   ├── interfaces.ts    # Repository interfaces
│   │   └── ... (13 more: bookmarks, calendar, captures, contacts,
│   │                  costs, embedding-cache, expenses, extensions,
│   │                  idempotency-keys, logs, mcp-servers, notes,
│   │                  pomodoro, query-helpers, tasks, ui-sessions)
│   ├── schema/             # 14 PostgreSQL schema domain files
│   └── adapters/           # pg adapter abstraction
│
├── channels/
│   ├── service-impl.ts     # ChannelServiceImpl (discovers + routes)
│   └── channel-ai-routing.ts # Routes incoming → AI processing
│
├── tools/
│   ├── agent-tool-registry.ts  # Registers agent tools (crew, goal, habit, heartbeat,
│   │                            # memory, notification, pulse, soul-comm, trigger, etc.)
│   ├── artifact-tools.ts        # Artifact tool provider
│   ├── browser-tools.ts         # Browser automation tools
│   ├── channel-tools.ts         # Channel (send/broadcast/list/inbox) tools
│   ├── cli-tool-tools.ts         # CLI tool provider
│   ├── coding-agent-tools.ts     # Coding agent tools
│   ├── config-tools.ts           # Config tools
│   ├── crew-tools.ts             # Crew tools (delegate, broadcast, members)
│   ├── custom-data-tools.ts      # Custom data CRUD tools
│   ├── custom-tools.ts           # Custom tool management
│   ├── edge-tools.ts             # Edge device tools
│   ├── event-tools.ts            # Event bus tools
│   ├── expense-tools.ts          # Expense tracking tools
│   ├── extension-tools.ts        # Extension tools
│   ├── goal-tools.ts             # Goal management tools
│   ├── habit-tools.ts            # Habit tracking tools (8 tools)
│   ├── heartbeat-tools.ts         # Heartbeat tools
│   ├── interactive-tools.ts      # Interactive confirmation tools
│   ├── memory-tools.ts           # Memory tools
│   ├── notification-tools.ts      # Notification tools
│   ├── personal-data-tools.ts    # Personal data (bookmarks, notes, tasks, etc.)
│   ├── plan-tools.ts             # Plan tools
│   ├── provider-manifest.ts      # All gateway tool providers manifest
│   ├── pulse-tools.ts            # Pulse engine tools
│   ├── skill/                   # Skill tools (definitions, introspection, learning)
│   ├── soul-communication-tools.ts # Soul-to-soul communication tools
│   ├── trigger-tools.ts          # Trigger tools
│   ├── claw/                    # Claw tools (16 tools + 7 management tools)
│   │   ├── tools.ts             # Claw tool executors
│   │   ├── definitions.ts       # Claw tool definitions
│   │   ├── management-tools.ts  # claw_start/stop/pause/resume/get_status/list
│   │   ├── context-executors.ts
│   │   ├── delegation-executors.ts
│   │   ├── lifecycle-executors.ts
│   │   ├── output-executors.ts
│   │   ├── sandbox-env.ts
│   │   └── validation.ts
│   ├── overrides/               # Tool overrides (audio, email, expense, image)
│   └── registry/               # Tool registry utilities
│       ├── core-registration.ts   # Core tool registration
│       ├── external-registration.ts
│       ├── meta-executors.ts     # Meta tools (search, help, use, batch)
│       └── utils.ts
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
│   ├── start.ts            # Start gateway (default entrypoint)
│   ├── server.ts           # Server lifecycle management
│   ├── bot.ts              # Telegram bot
│   ├── config.ts           # Configuration management
│   ├── channel.ts          # Channel setup (REST client)
│   ├── tunnel.ts           # ngrok/localtunnel for webhook exposure
│   ├── tunnel-wizard.ts    # Interactive tunnel setup
│   ├── skill.ts            # Skill management
│   ├── soul.ts             # Soul agent management
│   └── gateway-client.ts   # Shared REST client for CLI subcommands
└── telegram/
    └── telegram-bot.ts     # TelegramBot implementation
```

> Note: Crew, msg, and heartbeat operations live in the gateway HTTP API, not as dedicated CLI commands.

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

#### Tool Discovery & Search Modes

The `search_tools` utility supports discoverability of the 214+ tool surface by tags, keywords, and description intent through three modes:
- `keyword`: Traditional keyword-based prefix or AND-tag filtering.
- `semantic`: Embedding-powered semantic matching via `EmbeddingService`. Embeds the query and ranks tools by cosine similarity. Content-based hash caching prevents redundant embedding generation and manages API costs.
- `hybrid`: Combines both keyword and semantic hits, ordering results by semantic ranking.
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

| Source      | Count | Example                                     | Execution                           |
| ----------- | ----- | ------------------------------------------- | ----------------------------------- |
| **core**    | 50+   | `file_read`, `code_execute`, `http_request` | Direct                              |
| **gateway** | 10+   | `memory_*`, `goal_*`, `custom_data_*`       | ProviderService                     |
| **plugin**  | 20+   | `weather_*`, `expense_*`                    | Worker thread (SecurePluginRuntime) |
| **custom**  | N     | User/LLM-created                            | DynamicToolRegistry (sandboxed)     |
| **dynamic** | N     | `ext.*`, `skill.*`                          | ExtensionSandbox (sandboxed)        |

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

| Mode          | Description                                              |
| ------------- | -------------------------------------------------------- |
| `continuous`  | Runs until stop condition met                            |
| `interval`    | Runs on a schedule (interval-based)                      |
| `event`       | Runs when triggered by an event                          |
| `single-shot` | Runs once and stops (used for one-shot autonomous tasks) |

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

### Security & Workspace Isolation

Autonomous Claws are strictly scoped to isolated directory contexts.

- Each Claw resolves its `workspaceId` to a local directory via `getSessionWorkspacePath()`.
- During agent initialization, the runner passes this directory to `tools.setWorkspaceDir(workspaceDir)`.
- This ensures all standard file-system tools (`file_read`, `file_write`, `list_files`, etc.) and dynamic tools are bound to the Claw's directory sandbox, preventing unauthorized access to other directories.

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

Channel Plugins registered in plugins/init.ts (8 active):
  ├── TelegramPlugin
  ├── DiscordPlugin
  ├── WhatsAppPlugin (Baileys)
  ├── SlackPlugin
  ├── WebChatPlugin
  ├── SmsPlugin
  ├── EmailPlugin (IMAP/SMTP)
  └── MatrixPlugin
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
utils.callTool(name, args); // Call any of 150+ built-in tools
utils.getConfig(key); // Get configuration
utils.log(message); // Structured logging
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

#### Heartbeat Audit Trail & Tool Call Tracking

To facilitate debugging, each heartbeat execution records a detailed run log persisted in `heartbeat_log`:

- **Tool-Call Audit Trail:** Logs individual tool executions (`HeartbeatToolCallRecord`) containing the tool name, execution duration, success status, and a bounded 500-character preview of the arguments and any errors (preventing unbounded database bloat).
- **Tool-Call Count Summary:** Summarizes tool counts via `toolCallsCount` on lists to quickly audit external API consumption or slow cycles.
- **Drill-down API:** A dedicated endpoint `GET /api/v1/souls/:agentId/logs/:logId` allows developers to inspect detailed cycle logs, including the full list of tool calls made during that cycle.

#### Per-Soul Workspace Scoping

Agent souls can be assigned a `workspaceId` which resolves to a dedicated folder under session workspace paths. Scoping is handled by `@ownpilot/core` using the `ExecContext` helper (built on `AsyncLocalStorage`):

- Wraps concurrent `agent.chat()` invocations inside independent execution contexts.
- Dynamically resolves workspace precedence in `ToolRegistry` (Explicit Call-Site ➔ Registry Default ➔ ExecContext ➔ process.cwd()).
- Prevents race conditions and safely isolates concurrent file tools across multiple running souls.

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

## 17. Removed: Fleet, Subagent, Orchestra

The Fleet (worker army), Subagent (ephemeral spawn), and Orchestra
(multi-task DAG) subsystems were removed on 2026-05-23. Their roles
are covered by:

- **Claw** — concurrent cycles + `claw_spawn_subclaw` for hierarchical work
- **Crew** — `delegate_task` for ad-hoc task handoff between agents
- **Workflow** — `parallelNode` for visual DAG execution

Migration 038 dropped the legacy tables (`fleets`, `fleet_sessions`,
`fleet_tasks`, `fleet_worker_history`, `subagent_history`,
`orchestra_executions`). The autonomous-agent surface is now
**Agent → Claw → Soul/Crew/Heartbeat**.

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
create_habit, list_habits, update_habit, delete_habit,
log_habit, get_today_habits, get_habit_stats, archive_habit
```

> Defined in `packages/gateway/src/tools/habit-tools.ts`. Backed by
> `HabitsRepository` (645 lines) in `db/repositories/habits.ts`.

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

All events use **colon-namespaced** identifiers (e.g. `chat:stream:chunk`),
typed via `ServerEvents` / `ClientEvents` interfaces in
`packages/gateway/src/ws/types.ts`. Selected events:

```
client → server (ClientEvents):
  ├── session:ping            — Keepalive request
  └── session:pong            — Keepalive ack (resets WS session TTL)

server → client (ServerEvents):
  ├── connection:ready        — Session established
  ├── connection:error        — Auth / protocol error
  ├── connection:ping         — Server-initiated heartbeat
  │
  ├── channel:connected       — Channel adapter online
  ├── channel:disconnected    — Channel adapter offline
  ├── channel:qr              — WhatsApp/Baileys QR code
  ├── channel:status          — Status change
  ├── channel:message         — Incoming/outgoing channel message
  ├── channel:message:sent    — Outbound delivery ack
  ├── channel:message:error   — Outbound delivery failure
  ├── channel:user:pending|approved|blocked|unblocked|verified|first_seen
  │
  ├── chat:message            — Final assistant message
  ├── chat:stream:start       — Streaming begins
  ├── chat:stream:chunk       — Streaming token chunk
  ├── chat:stream:end         — Streaming done
  ├── chat:error              — Chat-level error
  ├── chat:history:updated    — Conversation list changed
  │
  ├── agent:state             — Agent state change (idle/running/etc.)
  ├── agent:thinking          — Thought trace
  ├── agent:response          — Agent response message
  │
  ├── tool:start              — Tool invocation begin
  ├── tool:progress           — Tool execution progress
  ├── tool:end                — Tool execution complete
  │
  ├── workspace:created|updated|deleted
  ├── trigger:executed        — Trigger fired (success/failure/skipped)
  ├── data:changed            — Personal-data CRUD ({entity, action, id})
  ├── pulse:activity          — Pulse engine stage updates
  ├── debug:entry             — Per-request debug entries
  ├── system:notification     — User-facing system notification
  ├── system:status           — Online/version/uptime
  │
  └── coding-agent:session:{created,output,state,exit,error}
      coding-agent:acp:{tool-call,tool-update,...}  — ACP protocol events
```

Chat invocation itself is delivered via `POST /api/v1/chat` (REST/SSE) or via
the WebChat channel plugin, not via a client→server WS event. The WS layer is
event broadcasting only; clients subscribe and the gateway pushes updates.

---

## 21. API Routes

**50+ route files** registered in 5 groups:

### Route Groups (registered in `app.ts`)

The gateway uses **6 registration helpers**:
`registerPlatformRoutes`, `registerAgentRoutes`, `registerDataRoutes`,
`registerAutomationRoutes`, `registerIntegrationRoutes`, `registerV2Routes`.

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
  └── /webhooks/telegram/:secret

registerV2Routes()
  └── /api/v2/*               # side-by-side v2 of all v1 routes (ADR-003)
                              # GET /api/v2 returns version + endpoint map
```

### Key REST Endpoint Families

| Domain        | Base Path           | Key Endpoints                                                                             |
| ------------- | ------------------- | ----------------------------------------------------------------------------------------- |
| **Claws**     | `/api/v1/claws`     | 16 endpoints: CRUD + `/stats`, `/audit`, `/deny-escalation`                               |
| **Workflows** | `/api/v1/workflows` | CRUD + DAG validation + execution                                                         |
| **Souls**     | `/api/v1/souls`     | Soul agent CRUD + `/logs` (with `toolCallsCount`) + `/logs/:logId` (drill-down tool logs) |
| **Crews**     | `/api/v1/crews`     | Crew orchestration                                                                        |
| **Habits**    | `/api/v1/habits`    | Habit CRUD + logging + stats                                                              |

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

| Feature                    | Implementation                                                  |
| -------------------------- | --------------------------------------------------------------- |
| **SSRF Protection**        | `isBlockedUrl()` (sync) + `isPrivateUrlAsync()` (DNS rebinding) |
| **Timing-safe comparison** | API key comparison, Twilio signature                            |
| **Sandbox isolation**      | Worker threads for plugins, vm for extensions                   |
| **SVG iframe restriction** | Sandbox restriction on SVG rendering                            |
| **IDOR guard**             | Bridge route protection                                         |
| **Open-redirect guard**    | Composio callback validation                                    |
| **Rate limiting**          | Token bucket algorithm on all API endpoints                     |
| **Hard-blocked tools**     | Shell, file mutation, email, git, code-exec from extensions     |

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
  const MockFoo = vi.fn().mockImplementation(function () {
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

## 23.A Additional Subsystems

Beyond the named systems above, the gateway hosts several first-class subsystems
that share the same routing/service/repository pattern but don't have a dedicated
section. Each is listed here with file pointers.

### MCP Integration (Model Context Protocol)

```
mcp-client-service.ts    — Connects to external MCP servers (stdio / SSE / HTTP)
mcp-server-service.ts    — Exposes OwnPilot tools AS an MCP server to other clients
mcp_servers table        — Configured MCP server records (workflows.ts schema)
/api/v1/mcp routes       — CRUD + connect/disconnect + tool discovery + presets
```

Bridges OwnPilot's 250+ tools to any MCP-compatible client (Claude Desktop, Cursor,
Claude Code) and consumes tools from external MCP servers as virtual `plugin.mcp.*`
tools.

#### Curated Preset Catalog & Quick-Add

Provides a static database-independent catalog of recommended MCP servers (`MCP_SERVER_PRESETS` in `packages/gateway/src/mcp/presets.ts`), including `browser-use`, `playwright-mcp`, `filesystem`, `fetch`, `sequential-thinking`, `memory`, `git`, and `sqlite`.

- **API Endpoints:**
  - `GET /api/v1/mcp/presets` returns the catalog presets, their environment variable declarations (secret vs. plain text), warnings, and installation hints.
  - `POST /api/v1/mcp/presets/:id/install` automates installation by mapping environment variables, resolving paths, and inserting a configured row in `mcp_servers`.
- **UI Quick-Add Dialog:** `PresetInstallDialog` dynamically generates form fields for required environment variables (e.g. API keys, workspace directories) and displays preset warnings, enabling one-click installs.

### Coding Agents (Multi-Provider CLI Orchestration)

```
coding-agent-orchestrator.ts  — Top-level lifecycle for CLI coding sessions
coding-agent-providers.ts     — Per-provider adapters (claude-code, codex, etc.)
coding-agent-pty.ts           — node-pty wrapper for terminal capture
coding-agent-sessions.ts      — In-memory session registry
coding-agent-service.ts       — Public service facade
DB tables                     — coding_agent_results, cli_providers,
                                cli_tool_policies, coding_agent_permissions,
                                coding_agent_skill_attachments,
                                coding_agent_subscriptions, orchestration_runs,
                                artifacts, artifact_versions
Routes                        — /api/v1/coding-agents, /api/v1/cli-providers,
                                /api/v1/cli-tools, /api/v1/artifacts
```

#### Autonomous CLI Access & Named Wrappers

- **Autonomous Path Integration:** CLI management and execution tools (`run_cli_tool`, `list_cli_tools`, `install_cli_tool`) are registered in `core-registration.ts`, allowing autonomous agents (Claws, Heartbeats, Channels) to invoke workspace-approved CLI binaries.
- **CLI Wrappers:** Exposes 15 highly structured wrappers (`CLI_WRAPPER_TOOLS`) that delegate to the CLI tool execution pipeline with pre-configured command mappings and typed parameters (e.g. `gh_pr_list`, `docker_ps`, `npm_install`), enhancing discoverability and eliminating dangerous raw shell execution.

### Browser Automation

```
browser-service.ts            — Playwright-based browser session manager
SSRF guard                    — Reuses isBlockedUrl / isPrivateUrlAsync
Routes                        — /api/v1/browser (navigate, screenshot, extract)
```

Provides full web automation capabilities (Playwright / Puppeteer). Browser tools (`BROWSER_TOOLS` + `executeBrowserTool`) are registered globally in `core-registration.ts`, allowing both chat-path agents and autonomous agents (Claws, Heartbeats, Channels) to navigate, fill forms, click elements, capture screenshots, and extract content autonomously.

### Voice

```
voice-service.ts              — TTS/STT provider routing + audio overrides
Routes                        — /api/v1/voice (speak, transcribe)
```

### Composio (External SaaS Tooling)

```
composio-service.ts           — OAuth + tool catalog from composio.dev
Routes                        — /api/v1/composio (apps, connect, callback)
Open-redirect guard           — Composio callback validation
```

### Pulse Engine (Background Heartbeat / Metrics)

```
pulse-metrics-service.ts      — In-process pulse counters
Routes                        — /pulse (system pulse + metrics)
UI                            — AutonomyPage → PulseEngineSection
```

### Tunnel (Webhook Exposure)

```
tunnel-service.ts             — ngrok / localtunnel / cloudflared wrappers
Routes                        — /api/v1/tunnel (start, stop, status)
CLI                           — tunnel command + tunnel-wizard interactive setup
```

### Pairing (Device Linking)

```
pairing-service.ts            — Pairing-code flow for channel + edge devices
channel_verification_tokens   — Backing table
```

### Notification Router

```
notification-router.ts        — Routes notifications to user-preferred channels
                                (DB-backed preferences, replaces in-memory)
```

### Security Scanner

```
security-scanner.ts           — Static analysis of skill/extension code at install
skill-security-audit.ts       — Per-skill security audit report
Routes                        — /api/v1/security (scan, audit)
```

### Operational Infrastructure (cross-cutting)

```
job-queue-service.ts          — Postgres-backed durable job queue (FOR UPDATE
                                SKIP LOCKED). See ADR-001 + section 24.1
jobs.ts (repo)                — claimJob, complete, fail (exponential backoff),
                                cancel, cleanupOld
retention-service.ts          — Nightly cleanup across 13 tables. See ADR-002 +
                                section 24.3
orphan-reconciliation.ts      — Boot-time reclamation of crashed Claw /
                                Workflow / Plan sessions. See 24.5
provider-health-service.ts    — Boot-time /models probe for all configured
                                providers. See 24.10
metrics-service.ts            — In-process Prometheus exporter (GET /metrics).
                                See 24.6
idempotency-keys (repo+mw)    — 24h-TTL deduplication on tool exec + POST /chat.
                                See 24.1 / 24.7
llm-semaphore.ts              — Global LLM concurrency limiter
embedding-queue.ts            — Async embedding generation queue
config validation             — config/validation.ts fail-fast at boot. See 24.8
```

---

## 24. Security Gaps Analysis (External Audit — 2026-05-07)

> The following issues were identified by an external architecture audit. Each item is tracked with severity, current state, and recommended resolution.

---

### 24.1 Dayanıklılık — Persistent Task Queue Eksikliği (HIGH)

**Problem:** Triggers, Plans, Workflows, and Heartbeats — four separate systems — all implement cron-like or event-driven logic. None have a persistent queue. `EventSystem` is in-memory. `ClawManager` holds `Map<clawId, ClawSession>` in memory.

**Failure Scenario:** Workflow engine is running a 24-node DAG, node #7 is executing. Gateway process is killed (OOM, deploy, kernel panic). On restart: the in-progress node is lost. This is at-most-once execution. The user expects at-least-once or exactly-once.

**Current State:** If `workflow_logs` table is written on every node completion, manual recovery is possible. But "currently running but not yet finished" work state is lost on restart.

**Resolution:** Introduce a durable job queue layer using Postgres (Graphile Worker or pg-boss). Both use Postgres as the queue backend — no extra infrastructure (Redis/RabbitMQ) required. Jobs live in a `jobs` table, workers use `FOR UPDATE SKIP LOCKED` to avoid contention, exponential backoff retry on failure, dead letter queue after N attempts.

**Refactor Scope:**

- `WorkflowService.dispatchNode` → enqueues each node as a job
- Worker pool executes nodes, writes results to DB, triggers dependent nodes via gating
- `TriggerService` schedules cron-like jobs into the queue
- `PlanExecutor` writes each step as a job

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

**Wasmtime Research Conclusion (2026-05-07):** wasmtime cannot run JavaScript natively — it only executes WebAssembly bytecode. To sandbox JS in wasmtime, you must first transpile JS to WASM using QuickJS. This adds: QuickJS compatibility risk (subtle JS semantics differ from V8), async/WASI complexity, no Node.js built-ins in WASM context, debugging difficulty, and performance overhead. For the stated threat model (blocking fs access, network, process execution, module abuse), the existing Worker+vm sandbox with blacklist validation + capability-based isolation is the correct Node.js 22 approach. Real defense-in-depth requires Docker containers for process-level isolation, not WASM. See `packages/core/src/sandbox/sandbox-escape.test.ts` — 41 adversarial tests covering prototype pollution, constructor escape, scope chain, Symbol, async, SAB, RCE, native modules.

**Real Sandbox Options:**

| Option                    | Isolation Level               | Complexity | Notes                                                                   |
| ------------------------- | ----------------------------- | ---------- | ----------------------------------------------------------------------- |
| **wasmtime + QuickJS**    | Hardware enforced WASM        | Very High  | JS→WASM transpile required; QuickJS semantics differ; not practical     |
| **Worker threads + vm**   | V8 context + process boundary | Low        | Current approach; correct for Node.js 22; defense-in-depth              |
| **Firecracker** (microVM) | Hypervisor                    | Very High  | VM infra required                                                       |
| **Docker containers**     | OS process                    | Medium     | Recommended for production; `--read-only --network=none --cap-drop=ALL` |

**Current State:** `BLOCKED_CALLABLE_TOOLS` (shell, file mutation, email, git, code-exec) and 100+ regex patterns are **blacklist-based**. Blacklists are bypassed eventually. WASM capability-based is **whitelist**: _"if not granted, it does not exist"_.

**Immediate Action:** Build an adversarial test suite at `packages/core/test/sandbox-escape/` that attempts: prototype pollution, regex bypass, env exfiltration, `process.send` abuse, async stack manipulation. These run in CI on every release; a successful bypass blocks the release. This discipline existed in OpenClaw until March 2026 when they paid the price.

---

### 24.3 Veri Katmanı — Migration ve Type Safety Boşluğu (MEDIUM)

**Problem 1 — No Rollback:** Migrations are idempotent in the forward direction (good) but have no `down.sql`. If a migration adds a column that causes a production bug, rolling back requires manual SQL.

**Problem 2 — Schema/Type Drift:** SQL schema files and TypeScript types are maintained manually and separately. No automatic link between them. One gets updated, the other doesn't → drift.

**Problem 3 — Transaction Boundaries:** 40+ repository classes. Multi-step operations — e.g., creating a workflow + 24 nodes + edges + version snapshot — are atomic only if wrapped in a transaction. If each repository calls its own `pool.query()`, partial failure is possible (12 nodes written, 13th fails, half a workflow remains in DB). **Current state:** `BaseRepository.transaction()` delegates to `adapter.transaction()` with 30s timeout. Multi-step operations use it (e.g., channel-messages batch insert).

**Problem 4 — Log Retention:** These tables grow unbounded:
`request_logs`, `audit_log`, `claw_history`, `claw_audit_log`, `workflow_logs`, `plan_history`, `trigger_history`, `heartbeat_log`, `embedding_cache`

**Current state:** Cleanup methods exist across repositories: `memories.cleanup(maxAge, minImportance)`, `channel_sessions.cleanupOld(90 days)`, `trigger_history.cleanupHistory(30 days)`, `claws.cleanupOldHistory(30 days)`, `autonomy_log.cleanup(olderThanDays)`. Retention intervals vary by table.

**Resolution — Drizzle ORM (future):**
The long-term resolution for Problems 1-3 is Drizzle ORM, which generates migrations from schema definitions and provides type-safe query builders. The schema `/*.ts` files would become Drizzle schema definitions. This is a larger refactor (P2 priority) — not a quick fix.\*\*

```typescript
// gateway/src/db/schema/claws.ts
import { pgTable, text, timestamp, jsonb, integer } from 'drizzle-orm/pg-core';

export const claws = pgTable('claws', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
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
- `EventBus` listeners — max unbounded but attach cleanup on unsubscribe
- `DynamicToolRegistry` — max cached tools + LRU eviction
- `embedding_cache` — max size + TTL eviction
- `idempotency_keys` — max size + TTL (already has TTL, needs max size)
- `ToolRegistry` — already bounded by registered tools, but custom tool sync needs bound

`core/src/utils/bounded-map.ts` — `BoundedMap<K, V>(maxSize, evictionPolicy)` with 'lru' and 'fifo' policies addresses all of the above.

**Problem 2 — Orphan Cleanup:** Claw, Plan, Workflow — what happens when a parent process is killed while one of these is running? Orphan state remains in DB. Required: `reconcileOrphanedSessions()` at boot — queries DB for `status: running` but not actually running, sets them to `status: aborted`, cascades to dependent tasks.

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
/api/v1/metrics endpoint (Prometheus format):
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

**Current State:**

- **Unit layer:** Vitest, `vi.hoisted()` pattern, 9189 core tests + 16618 gateway tests. Unit layer is solid.
- **Integration layer (partial):** Tests verify SQL patterns (e.g., `FOR UPDATE SKIP LOCKED` in `crew-tasks.test.ts`). SQL query generation is tested against expected output. `BaseRepository.transaction()` has test coverage. However, most repository tests use mocked adapters, not real Postgres connections.
- **E2E layer:** Playwright configured (`packages/ui/playwright.config.ts`), 8 spec files in `packages/ui/e2e/`. Wired into CI on PRs via GitHub Actions step.
- **Adversarial testing (done):** `sandbox-escape.test.ts` covers 41 attack vectors. Runs in CI on release.

**Recommended Test Pyramid:**

```
Top: E2E (Playwright)
  └── 5-10 core user journeys (Login → Chat → Tool → Approval → Result)
  └── Runtime < 5 min; otherwise team disables tests
  └── WIRING NEEDED: add Playwright to CI (GitHub Actions step)

Middle: Integration
  └── Route + DB + Service stack against real Postgres (pg15, pg16 in CI matrix)
  └── Transaction boundary tests (partial failure scenarios)
  └── Partial coverage: SQL pattern tests exist; mocked adapter pattern dominates

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

| #     | Issue                                    | Severity | Effort | Priority | Status                                                                                                                                                                                                                                                                                                                 |
| ----- | ---------------------------------------- | -------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 24.1  | Persistent task queue (job queue layer)  | HIGH     | High   | P1       | **Phase 1+2 done (ADR-001 written; jobs+job_history tables; JobQueueService; JobsRepository FOR UPDATE SKIP LOCKED; workflowRunId/nodeId in payload; persistNodeOutputs/getLogForRecovery in WorkflowsRepository; orphan reconciliation; jobified workflow node execution wired; crash recovery at boot)**             |
| 24.2  | Real sandbox isolation                   | CRITICAL | High   | P0       | **Done (adversarial test suite in place; wasmtime research: not practical for JS — requires QuickJS transpile, adds massive complexity; Worker+vm is correct Node.js approach)**                                                                                                                                       |
| 24.3  | Drizzle ORM + migration/type safety      | MEDIUM   | High   | P2       | **Partially done (transaction() exists; cleanup methods across 13 tables; RetentionService with nightly job; 032_retention_policies migration; ADR-002 written; Drizzle migration deferred)**                                                                                                                          |
| 24.4  | Telemetry-based provider routing         | MEDIUM   | Medium | P2       | **Done (embedding_model_id; provider_metrics table + ProviderMetricsRepository; IProvider.recordMetric in interface + BaseProvider; recordTelemetry in executeAgentPipeline now calls ProviderMetricsRepository.record() directly (fire-and-forget); getRoutingMetrics/getCheapestRoute/getFastestRoute implemented)** |
| 24.5  | Bounded maps + orphan cleanup            | MEDIUM   | Medium | P2       | **Done (P1 portion, BoundedMap added)**                                                                                                                                                                                                                                                                                |
| 24.6  | OpenTelemetry tracing + metrics          | MEDIUM   | Medium | P2       | **Done (metrics foundation)**                                                                                                                                                                                                                                                                                          |
| 24.7  | API versioning + webhook signature       | MEDIUM   | Low    | P3       | **Done (ADR-003; side-by-side v2 at /api/v2/\*; registerV2Routes(); /api/v2 info endpoint; idempotency keys; HMAC verification; IdemKey middleware; webhook timing-safe comparison)**                                                                                                                                  |
| 24.8  | Boot-time config validation fail-fast    | HIGH     | Low    | P1       | **Done**                                                                                                                                                                                                                                                                                                               |
| 24.9  | Test pyramid + adversarial suite         | MEDIUM   | Medium | P2       | **Partially done (sandbox adversarial tests done; unit layer solid; Playwright now wired into CI on PRs; integration mock-vs-real gap exists)**                                                                                                                                                                        |
| 24.10 | Native provider adapters + health checks | MEDIUM   | Medium | P2       | **Done**                                                                                                                                                                                                                                                                                                               |

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
- Finds and marks as aborted all orphaned Claw, Workflow, and Plan sessions
- 5-minute heartbeat threshold to avoid false positives on long-running tasks
- Called at boot, BEFORE any autonomous system starts

Repository methods added:

- `ClawsRepository.getOrphanedSessions()` + `updateSessionStatus()`
- `WorkflowsRepository.getOrphanedRuns()` + `markRunFailed()`
- `PlansRepository.getOrphanedPlans()` + `markPlanFailed()`

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
- Used by: ClawManager.tracks, DynamicToolRegistry, idempotency keys, embedding cache
- Addresses: unbounded in-memory collections identified in gap 24.5

**P2 — 24.7 Idempotency Keys:**

- `packages/gateway/src/db/migrations/postgres/030_idempotency_keys.sql` — idempotency_keys table (TEXT PK, JSONB result, expires_at with index)
- `packages/gateway/src/db/repositories/idempotency-keys.ts` — IdempotencyKeysRepository: getRecord, setRecord, deleteKey, purgeExpired, countActive
- `packages/gateway/src/db/schema/core.ts` — idempotency_keys table added to CORE_TABLES_SQL (fresh installs); idx_idempotency_expires_at index added to CORE_INDEXES_SQL
- `packages/gateway/src/services/tool-executor.ts` — executeTool() now checks/updates idempotency keys: SHA-256(toolName+args) as key, 24h TTL, cached results returned on duplicate calls
- `packages/gateway/src/routes/chat.ts` — API-level Idempotency-Key header support for POST /chat: cache hit returns cached response, cache miss stores result; fire-and-forget with non-blocking try/catch
- Existing webhook signature validation: Slack (HMAC-SHA256 via createHmac), Telegram (path secret via safeKeyCompare), Trigger (HMAC-SHA256), Email (secret via safeKeyCompare)
- **v2 API implemented (ADR-003):** side-by-side `/api/v2/*` with identical handlers; `register-v2-routes.ts` mirrors all v1 routes at v2 paths; `registerV2Routes()` wired in app.ts; `GET /api/v2` info endpoint returns version + endpoint map; v1 has no EOL date set — deprecation timeline will publish 90 days before removal

**WebSocket Session Fix:**

- `packages/ui/src/hooks/useWebSocket.tsx` — respond to connection:ping with session:pong, unlimited reconnect with exponential backoff (1s→30s cap)
- `packages/gateway/src/ws/server.ts` — session:pong handler now calls `sessionManager.touch()` to reset WS session TTL (was logging only)

**P2 — 24.4 Token Counting & Embedding Model Versioning:**

- `packages/core/src/agent/providers/openai-compatible.ts` — `countTokens()` uses char/4 approximation as fallback for OpenAI-compatible endpoints that don't return token usage
- `packages/gateway/src/db/schema/autonomous.ts` — `memories.embedding_model_id` column added for multi-model embedding support; queries can scope to current model: `WHERE embedding_model_id = $currentModel`; partial index `idx_memories_embedding_model` added
- `packages/gateway/src/db/schema/autonomous.ts` — migration to add `embedding_model_id` column for existing installs
- `packages/gateway/src/services/agent-runner-utils.ts` — `createConfiguredAgent` now passes real `IProvider` instance via `options.provider` (was passing config object, making `prov.recordMetric` always undefined); `recordTelemetry` now calls `getProviderMetricsRepository().record()` directly (fire-and-forget) for every agent execution

**Remaining P0-P1:**

- (none)

**P0 — 24.2 Sandbox Isolation Research (2026-05-07):**

- wasmtime cannot run JavaScript natively — only WebAssembly bytecode
- JS→WASM transpile via QuickJS required: massive complexity, QuickJS/V8 semantics differ, no async/WASI stability, no Node.js built-ins in WASM context
- Worker threads + vm module is the correct approach for Node.js 22
- 41 adversarial tests in `sandbox-escape.test.ts` verify the sandbox holds

**P2 — 24.1 & 24.7 Tool Executor Idempotency:**

- `packages/gateway/src/services/tool-executor.ts` — executeTool() now checks/updates idempotency keys before execution
  - Key: SHA-256(userId + toolName + JSON.stringify(args))
  - On cache hit: returns cached ToolExecutionResult without re-execution
  - On cache miss: executes and stores result with 24h TTL
  - Deduplicates duplicate calls from retried triggers, plans, workflows, webhooks
  - Idempotency failures are non-blocking (fire-and-forget with try/catch)
  - Test mock added: `mockIdempotencyRepo` with getRecord/setRecord in tool-executor.test.ts

**P2 — 24.3 Transaction Safety & Retention:**

- `packages/gateway/src/db/repositories/base.ts` — `BaseRepository.transaction()` delegates to adapter.transaction()
- `packages/gateway/src/db/adapters/postgres-adapter.ts` — `transaction()` with 30s timeout, automatic rollback on error
- `docs/ADR/ADR-002-database-retention-policy.md` — full ADR for gap 24.3 retention enforcement
- `packages/gateway/src/services/retention-service.ts` — `RetentionService` with `runRetentionCleanup()`, `scheduleRetentionCleanup(hour)`, `registerRetentionCleanupWorker()`; maps 13 tables to cleanup methods via factory functions; runs on 'system' queue at 02:00 UTC daily
- `packages/gateway/src/db/migrations/postgres/032_retention_policies.sql` — idempotent migration creating `retention_policies` table
- Cleanup methods: `request_logs(30)`, `claw_history(90)`, `claw_audit_log(30)`, `workflow_logs(90)`, `plan_history(90)`, `trigger_history(30)`, `heartbeat_log(30)`, `embedding_cache(7)`, `jobs(30)`, `job_history(90)`, `provider_metrics(30)`
- **Remaining**: DB-level partition-based TTL expiry, Drizzle ORM migration

**P1 — 24.1 Persistent Job Queue:**

- `docs/ADR/ADR-001-persistent-job-queue.md` — full architecture decision record
- pg-boss over Postgres chosen (no extra infra; FOR UPDATE SKIP LOCKED)
- 4-phase plan: infrastructure → workflows → triggers/plans
- **Phase 1+2 infrastructure done:** `jobs` + `job_history` tables in schema/core.ts + migration 031_job_queue.sql; `JobsRepository` with claimJob (FOR UPDATE SKIP LOCKED), create, complete, fail (exponential backoff), cancel, cleanupOld, cleanupHistory; `JobQueueService` with enqueue, enqueueSystem, startWorker, getStats; `workflowRunId`/`nodeId` fields in `CreateJobInput` and `JobRecord`; `persistNodeOutputs()` and `getLogForRecovery()` in WorkflowsRepository; orphan reconciliation in place
- **Phase 2 done:** worker pool boot wiring in server.ts; `WorkflowNodeJobHandler` with `enqueueWorkflowLevel()` and `resumeWorkflowFromRecovery()`; `jobifiedExecuteLevel()` in WorkflowService (level-by-level polling, 500ms interval); `listRunningLogs()` + `cleanupOldWorkflowLogs()` in WorkflowsRepository; hybrid sync/jobified node execution (SYNC_ONLY_TYPES: forEach, approval, parallel, subWorkflow, errorHandler, trigger, stickyNote stay inline; all others use job queue); crash recovery wired at boot

**P2 — 24.9 Test Pyramid:**

- Unit layer: 9189 core tests + 16618 gateway tests; `vi.hoisted()` pattern, `Result<T,E>` flows
- Adversarial sandbox tests: `packages/core/src/sandbox/sandbox-escape.test.ts` — 41 attack vectors (prototype pollution, constructor escape, scope chain, Symbol, async, SAB, RCE, native modules, etc.)
- Integration: SQL pattern tests exist (`FOR UPDATE SKIP LOCKED` in `crew-tasks.test.ts`); most repo tests use mocked adapters
- E2E: Playwright configured, 8 spec files in `packages/ui/e2e/`; **wired into CI on PRs** (`.github/workflows/ci.yml`)
- **Remaining**: add integration tests against real Postgres connections, property-based testing with fast-check

**Remaining P0-P1:**

- (none)
