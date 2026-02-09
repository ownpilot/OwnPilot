# OwnPilot

Privacy-first personal AI assistant platform with autonomous agents, tool orchestration, multi-provider support, and Telegram integration.

**Self-hosted. Your data stays yours.**

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Packages](#packages)
  - [Core](#core-ownpilotcore)
  - [Gateway](#gateway-ownpilotgateway)
  - [UI](#ui-ownpilotui)
  - [Channels](#channels-ownpilotchannels)
  - [CLI](#cli-ownpilotcli)
- [AI Providers](#ai-providers)
- [Agent System](#agent-system)
- [Tool System](#tool-system)
- [Personal Data](#personal-data)
- [Autonomy & Automation](#autonomy--automation)
- [Database](#database)
- [Security & Privacy](#security--privacy)
  - [Code Execution](#code-execution)
- [API Reference](#api-reference)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Development](#development)
- [License](#license)

---

## Features

### AI & Agents
- **Multi-Provider Support** - 4 native providers (OpenAI, Anthropic, Google, Zhipu) + 7 OpenAI-compatible providers + any custom endpoint
- **Local AI Support** - Ollama and LM Studio auto-discovery on the local network
- **Smart Provider Routing** - Cheapest, fastest, smartest, balanced, or fallback strategies
- **Streaming Responses** - Server-Sent Events (SSE) for real-time streaming with tool execution progress
- **Configurable Agents** - Custom system prompts, model preferences, tool assignments, and execution limits

### Tools
- **100+ Built-in Tools** across 20+ categories (personal data, files, code execution, web, email, media, finance, automation, utilities)
- **Meta-tool Proxy** - Only 4 meta-tools sent to the LLM (`search_tools`, `get_tool_help`, `use_tool`, `batch_use_tool`); all tools remain available via dynamic discovery
- **Custom Tools** - Create new tools at runtime via LLM (sandboxed JavaScript)
- **Tool Limits** - Automatic parameter capping to prevent unbounded queries
- **Search Tags** - Natural language tool discovery with keyword matching

### Personal Data
- **Notes, Tasks, Bookmarks, Contacts, Calendar, Expenses** - Full CRUD with categories, tags, and search
- **Productivity** - Pomodoro timer with sessions/stats, habit tracker with streaks, quick capture inbox
- **Memories** - Long-term persistent memory (facts, preferences, events) with importance scoring and auto-injection
- **Goals** - Goal creation, decomposition into steps, progress tracking, next-action recommendations
- **Custom Data Tables** - Create your own structured data types with AI-determined schemas

### Autonomy & Automation
- **5 Autonomy Levels** - Manual, Assisted, Supervised, Autonomous, Full
- **Triggers** - Schedule-based (cron), event-driven, condition-based, webhook
- **Plans** - Multi-step autonomous execution with checkpoints, retry logic, and timeout handling
- **Risk Assessment** - Automatic risk scoring for tool executions with approval workflows

### Communication
- **Web UI** - React 19 + Vite 6 + Tailwind CSS 4 with dark mode, ~40 routes, code-split
- **Telegram Bot** - Full bot integration with user/chat filtering, message splitting, HTML/Markdown formatting
- **WebSocket** - Real-time updates, event subscriptions, session management
- **REST API** - 38 route modules with standardized responses, pagination, and error codes

### Security
- **Zero-Dependency Crypto** - AES-256-GCM encryption + PBKDF2 key derivation using only Node.js built-ins
- **PII Detection & Redaction** - 15+ categories (SSN, credit cards, emails, phone, etc.)
- **Sandboxed Code Execution** - Docker container isolation, local execution with approval, critical pattern blocking
- **4-Layer Security** - Critical patterns -> permission matrix -> approval callback -> sandbox isolation
- **Code Execution Approval** - Real-time SSE approval dialog for sensitive operations with 120s timeout
- **Authentication** - None, API Key, or JWT modes
- **Rate Limiting** - Sliding window with burst support
- **Tamper-Evident Audit** - Hash chain verification for audit logs

---

## Architecture

```
                         ┌──────────────┐
                         │   Web UI     │  React 19 + Vite 6
                         │  (Port 5173) │  Tailwind CSS 4
                         └──────┬───────┘
                                │ HTTP + SSE
              ┌─────────────────┼─────────────────┐
              │                 │                  │
     ┌────────┴────────┐       │        ┌─────────┴──────────┐
     │  Telegram Bot   │       │        │     WebSocket      │
     │   (Channels)    │       │        │    (Port 18789)    │
     └────────┬────────┘       │        └─────────┬──────────┘
              │                │                   │
              └────────┬───────┘───────────────────┘
                       │
              ┌────────▼────────┐
              │    Gateway      │  Hono HTTP API Server
              │  (Port 8080)    │  38 Route Modules
              ├─────────────────┤
              │  MessageBus     │  Middleware Pipeline
              │  Agent Engine   │  Tool Orchestration
              │  Provider Router│  Smart Model Selection
              │  Plugin System  │  Extensible Architecture
              │  EventBus       │  Typed Event System
              ├─────────────────┤
              │     Core        │  Zero External Dependencies
              │  50+ Tools      │  Multi-Provider Support
              │  Sandbox, Crypto│  Privacy, Audit
              └────────┬────────┘
                       │
              ┌────────▼────────┐
              │   PostgreSQL    │  40+ Repositories
              │                 │  Conversations, Personal Data,
              │                 │  Memories, Goals, Triggers, Plans
              └─────────────────┘
```

### Message Pipeline

```
Request → Audit → Persistence → Post-Processing → Context-Injection → Agent-Execution → Response
```

All messages (web UI chat, Telegram) flow through the same MessageBus middleware pipeline.

---

## Quick Start

### Prerequisites
- **Node.js** >= 22.0.0
- **pnpm** >= 10.0.0
- **PostgreSQL** (via Docker or native)

### Setup

```bash
# Clone and install
git clone https://github.com/ownpilot/ownpilot.git
cd ownpilot
pnpm install

# Configure
cp .env.example .env
# Edit .env with database connection details
# AI provider API keys are configured via the Config Center UI after setup

# Start development (gateway + ui)
pnpm dev

# UI: http://localhost:5173
# API: http://localhost:8080
```

### Configuration via CLI

```bash
# Initialize database
ownpilot setup

# Start server + channels
ownpilot start

# Configure API keys (stored in database, not .env)
ownpilot config set openai-api-key sk-...
```

API keys and settings are stored in the PostgreSQL database. The web UI **Config Center** (Settings page) provides a graphical alternative to CLI configuration.

---

## Project Structure

```
ownpilot/
├── packages/
│   ├── core/                    # AI runtime (zero external deps)
│   │   ├── src/
│   │   │   ├── agent/           # Agent engine, orchestrator, providers
│   │   │   │   ├── providers/   # Multi-provider implementations
│   │   │   │   └── tools/       # 50+ built-in tool definitions
│   │   │   ├── plugins/         # Plugin system with isolation, marketplace
│   │   │   ├── events/          # EventBus, HookBus, ScopedBus
│   │   │   ├── services/        # Service registry (DI container)
│   │   │   ├── memory/          # Encrypted personal memory (AES-256-GCM)
│   │   │   ├── sandbox/         # Code execution isolation (VM, Docker, Worker)
│   │   │   ├── crypto/          # Zero-dep encryption, vault, keychain
│   │   │   ├── audit/           # Tamper-evident hash chain logging
│   │   │   ├── privacy/         # PII detection & redaction
│   │   │   ├── security/        # Critical pattern blocking, permissions
│   │   │   ├── channels/        # Channel plugin architecture
│   │   │   ├── assistant/       # Intent classifier, orchestrator
│   │   │   ├── workspace/       # Per-user isolated environments
│   │   │   └── types/           # Branded types, Result<T,E>, guards
│   │   └── package.json
│   │
│   ├── gateway/                 # Hono API server (~60K LOC)
│   │   ├── src/
│   │   │   ├── routes/          # 38 route modules
│   │   │   ├── services/        # 32 business logic services
│   │   │   ├── db/
│   │   │   │   ├── repositories/  # 40+ data access repositories
│   │   │   │   ├── adapters/      # PostgreSQL adapter
│   │   │   │   ├── migrations/    # Schema migrations
│   │   │   │   └── seeds/         # Default data
│   │   │   ├── channels/        # Telegram channel plugin
│   │   │   ├── plugins/         # Plugin initialization & registration
│   │   │   ├── triggers/        # Proactive automation engine
│   │   │   ├── plans/           # Plan executor with step handlers
│   │   │   ├── autonomy/        # Risk assessment, approval manager
│   │   │   ├── ws/              # WebSocket server & session management
│   │   │   ├── middleware/      # Auth, rate limiting, CORS, audit
│   │   │   ├── assistant/       # AI orchestration (memories, goals)
│   │   │   ├── tracing/         # Request tracing (AsyncLocalStorage)
│   │   │   └── audit/           # Gateway audit logging
│   │   └── package.json
│   │
│   ├── ui/                      # React 19 web interface
│   │   ├── src/
│   │   │   ├── pages/           # ~40 page components
│   │   │   ├── components/      # 30+ reusable components
│   │   │   ├── hooks/           # Custom hooks (chat store, theme, WebSocket)
│   │   │   ├── api/             # Typed fetch wrapper + 18 endpoint modules
│   │   │   ├── types/           # UI type definitions
│   │   │   └── App.tsx          # Route definitions with lazy loading
│   │   └── package.json
│   │
│   ├── channels/                # Telegram bot (Grammy)
│   │   ├── src/
│   │   │   ├── telegram/        # Telegram Bot API wrapper
│   │   │   ├── manager.ts       # Channel orchestration
│   │   │   └── types/           # Channel type definitions
│   │   └── package.json
│   │
│   └── cli/                     # Commander.js CLI
│       ├── src/
│       │   ├── commands/        # server, bot, start, config, workspace, channel
│       │   └── index.ts         # CLI entry point
│       └── package.json
│
├── turbo.json                   # Turborepo pipeline config
├── tsconfig.base.json           # Shared TypeScript strict config
├── eslint.config.js             # ESLint 9 flat config
├── .env.example                 # Environment variable template
└── package.json                 # Monorepo root
```

---

## Packages

### Core (`@ownpilot/core`)

The foundational runtime library with **zero external dependencies** (Node.js built-ins only). Contains the AI engine, tool system, plugin architecture, security primitives, and cryptography.

**~25,000 LOC** across 158 TypeScript files.

| Module | Description |
|--------|-------------|
| `agent/` | Agent engine with multi-provider support, orchestrator, tool-calling loop |
| `agent/providers/` | Provider implementations (OpenAI, Anthropic, Google, Zhipu, OpenAI-compatible) |
| `agent/tools/` | 50+ built-in tool definitions and executors |
| `plugins/` | Plugin system with isolation, marketplace, signing, runtime |
| `events/` | 3-in-1 event system: EventBus (fire-and-forget), HookBus (interceptable), ScopedBus (namespaced) |
| `services/` | Service registry (DI container) with typed tokens |
| `memory/` | AES-256-GCM encrypted personal memory with deduplication and TTL |
| `sandbox/` | 5 sandbox implementations: VM, Docker, Worker threads, Local, Scoped APIs |
| `crypto/` | PBKDF2, AES-256-GCM, RSA, SHA256 — zero dependency |
| `audit/` | Tamper-evident logging with hash chain verification |
| `privacy/` | PII detection (15+ categories) and redaction |
| `security/` | Critical pattern blocking (100+ patterns), permission matrix |
| `types/` | Result<T,E> pattern, branded types, error classes, type guards |

### Gateway (`@ownpilot/gateway`)

The API server built on [Hono](https://hono.dev/). Handles HTTP/WebSocket communication, database operations, agent execution, plugin management, and channel integration.

**~60,000 LOC** across 293 TypeScript files. **66 test files** with **1,507 tests**.

**Route Modules (38):**

| Category | Routes |
|----------|--------|
| **Chat & Agents** | `chat.ts`, `agents.ts` |
| **AI Configuration** | `models.ts`, `providers.ts`, `model-configs.ts`, `local-providers.ts` |
| **Personal Data** | `personal-data.ts`, `memories.ts`, `goals.ts`, `expenses.ts`, `custom-data.ts` |
| **Productivity** | `productivity.ts` (Pomodoro, Habits, Captures) |
| **Automation** | `triggers.ts`, `plans.ts`, `autonomy.ts` |
| **Tools & Plugins** | `tools.ts`, `custom-tools.ts`, `plugins.ts` |
| **Channels** | `channels.ts`, `channel-auth.ts` |
| **Configuration** | `settings.ts`, `config-services.ts` |
| **Integration** | `integrations.ts`, `auth.ts` |
| **System** | `health.ts`, `dashboard.ts`, `costs.ts`, `audit.ts`, `debug.ts`, `database.ts`, `profile.ts`, `workspaces.ts`, `file-workspaces.ts`, `execution-permissions.ts` |

**Services (32):** MessageBus, ConfigCenter, ToolExecutor, ProviderService, AuditService, PluginService, MemoryService, GoalService, TriggerService, PlanService, WorkspaceService, DatabaseService, SessionService, LogService, ResourceService, LocalDiscovery, and more.

**Repositories (40+):** agents, conversations, messages, tasks, notes, bookmarks, calendar, contacts, memories, goals, triggers, plans, expenses, custom-data, custom-tools, plugins, channels, channel-messages, channel-users, channel-sessions, costs, settings, config-services, pomodoro, habits, captures, workspaces, model-configs, execution-permissions, logs, and more.

### UI (`@ownpilot/ui`)

Modern web interface built with React 19, Vite 6.4, and Tailwind CSS 4. Minimal dependencies — no Redux/Zustand, no axios, no component library.

| Technology | Version |
|-----------|---------|
| React | 19.0.0 |
| React Router DOM | 7.1.3 |
| Vite | 6.4.1 |
| Tailwind CSS | 4.0.6 |
| prism-react-renderer | 2.4.1 |

**Pages (~40):**

| Page | Description |
|------|-------------|
| **Chat** | Main AI conversation with streaming, tool execution display, approval dialogs |
| **Dashboard** | Overview with stats, AI briefing, quick actions |
| **Inbox** | Read-only channel messages from Telegram |
| **History** | Conversation history with search, archive, bulk operations |
| **Tasks / Notes / Calendar / Contacts / Bookmarks** | Personal data management |
| **Expenses** | Financial tracking with categories |
| **Memories** | AI long-term memory browser |
| **Goals** | Goal tracking with progress and step management |
| **Triggers / Plans / Autonomy** | Automation configuration |
| **Agents** | Agent selection and configuration |
| **Tools / Custom Tools** | Tool browser and custom tool management |
| **Models / Costs** | AI model browser and usage tracking |
| **Plugins / Workspaces** | Extension and workspace management |
| **Data Browser / Custom Data** | Universal data exploration |
| **Settings** | Config Center, API Keys, Providers, AI Models, Integrations, System |
| **Profile / Logs / About** | User profile, request logs, system info |

**Key Components:** Layout (sidebar nav), ChatInput, MessageList, ToolExecutionDisplay, TraceDisplay, CodeBlock, MarkdownContent, ExecutionApprovalDialog, SuggestionChips, ToastProvider, DynamicConfigForm, ErrorBoundary, SetupWizard, and more.

**State Management (Context + Hooks):**
- `useChatStore` - Global chat state with SSE streaming, tool progress, approval flow
- `useTheme` - Dark/light/system theme with localStorage persistence
- `useWebSocket` - WebSocket connection with auto-reconnect and event subscriptions

### Channels (`@ownpilot/channels`)

Telegram bot built on [Grammy](https://grammy.dev/). Implements the `ChannelHandler` interface with `start()`, `stop()`, `sendMessage()`, and `onMessage()`.

| Feature | Details |
|---------|---------|
| **Bot API** | Grammy with long polling or webhook mode |
| **Access Control** | User ID and chat ID whitelisting |
| **Message Splitting** | Intelligent splitting at newlines/spaces for messages > 4096 chars |
| **Parse Modes** | HTML, Markdown, MarkdownV2 |
| **Commands** | `/start`, `/help`, `/reset` |
| **Channel Manager** | Orchestrates multiple channels, routes messages through the Agent |

### CLI (`@ownpilot/cli`)

Command-line interface built with Commander.js and @inquirer/prompts.

```bash
ownpilot setup                    # Initialize database
ownpilot start                    # Start server + channels
ownpilot server                   # Start HTTP API server only
ownpilot bot                      # Start Telegram bot only

# Configuration (stored in PostgreSQL)
ownpilot config set <key> [value] # Set credential or setting
ownpilot config get <key>         # Retrieve (masked for secrets)
ownpilot config delete <key>      # Remove
ownpilot config list              # List all with status

# Workspace management
ownpilot workspace list
ownpilot workspace create
ownpilot workspace delete [id]
ownpilot workspace switch [id]

# Channel management
ownpilot channel list
ownpilot channel add
ownpilot channel remove [id]
ownpilot channel connect [id]
ownpilot channel disconnect [id]
```

**Configuration keys:** `<provider>-api-key` (e.g., `openai-api-key`, `anthropic-api-key`), `default_ai_provider`, `default_ai_model`, `telegram_bot_token`, `gateway_api_keys`, `gateway_jwt_secret`, `gateway_auth_type`, `gateway_rate_limit_max`, `gateway_rate_limit_window_ms`.

---

## AI Providers

All API keys are managed via the **Config Center UI** (Settings page) or the `ownpilot config set` CLI command. They are stored in the PostgreSQL database, not in environment variables.

### Supported Providers

| Provider | Integration Type |
|----------|-----------------|
| OpenAI | Native |
| Anthropic | Native |
| Google (Gemini) | Native (with OAuth) |
| Zhipu AI | Native |
| DeepSeek, Groq, xAI, Mistral, Together AI, Fireworks, Perplexity | OpenAI-compatible |
| Ollama, LM Studio | Local (auto-discovered, no API key needed) |

Any OpenAI-compatible endpoint can be added as a custom provider.

### Provider Routing Strategies

| Strategy | Description |
|----------|-------------|
| `cheapest` | Minimize API costs |
| `fastest` | Minimize latency |
| `smartest` | Best quality/reasoning |
| `balanced` | Cost + quality balance (default) |
| `fallback` | Try providers sequentially until one succeeds |

---

## Agent System

Agents are AI assistants with specific system prompts, tool assignments, model preferences, and execution limits.

### Agent Configuration

```typescript
{
  name: string               // Display name
  systemPrompt: string       // Custom instructions
  provider: string           // AI provider (or 'default')
  model: string              // Model ID (or 'default')
  config: {
    maxTokens: number        // Max response tokens
    temperature: number      // Creativity (0-2)
    maxTurns: number         // Max conversation turns
    maxToolCalls: number     // Max tool calls per turn
    tools?: string[]         // Specific tool names
    toolGroups?: string[]    // Tool group names
  }
}
```

### Agent Capabilities

- **Tool Orchestration** - Automatic tool calling with multi-step planning via meta-tool proxy
- **Memory Injection** - Relevant memories automatically included in system prompt
- **Goal Awareness** - Active goals and progress injected into context
- **Dynamic System Prompts** - Context-aware enhancement with memories, goals, available resources
- **Execution Context** - Code execution instructions injected into system prompt (not user message)
- **Streaming** - Real-time SSE responses with tool execution progress events

---

## Tool System

### Overview

OwnPilot has **100+ tools** organized into **20+ categories**. Rather than sending all tool definitions to the LLM (which would consume too many tokens), OwnPilot uses a **meta-tool proxy pattern**:

1. **`search_tools`** - Find tools by keyword with optional `include_params` for inline parameter schemas
2. **`get_tool_help`** - Get detailed help for a specific tool (supports batch lookup)
3. **`use_tool`** - Execute a tool with parameter validation and limit enforcement
4. **`batch_use_tool`** - Execute multiple tools in a single call

### Tool Categories

| Category | Examples |
|----------|---------|
| **Tasks** | add_task, list_tasks, complete_task, update_task, delete_task |
| **Notes** | add_note, list_notes, update_note, delete_note |
| **Calendar** | add_calendar_event, list_calendar_events, delete_calendar_event |
| **Contacts** | add_contact, list_contacts, update_contact, delete_contact |
| **Bookmarks** | add_bookmark, list_bookmarks, delete_bookmark |
| **Custom Data** | create_custom_table, add_custom_record, search_custom_records |
| **File System** | read_file, write_file, list_directory, search_files, copy_file |
| **PDF** | read_pdf, create_pdf, pdf_info |
| **Code Execution** | execute_javascript, execute_python, execute_shell, compile_code |
| **Web & API** | http_request, fetch_web_page, search_web |
| **Email** | send_email, list_emails, read_email, search_emails |
| **Image** | analyze_image, resize_image |
| **Audio** | audio_info |
| **Finance** | add_expense, query_expenses, expense_summary |
| **Memory** | remember, recall, forget, list_memories, memory_stats |
| **Goals** | create_goal, list_goals, decompose_goal, get_next_actions, complete_step |
| **Dynamic Tools** | create_tool, list_custom_tools, delete_custom_tool |
| **Utilities** | calculate, statistics, convert_units, generate_uuid, hash_text, regex |

### Tool Trust Levels

| Level | Source | Behavior |
|-------|--------|----------|
| `trusted` | Core tools | Full access |
| `semi-trusted` | Plugin tools | Require explicit permission |
| `sandboxed` | Custom/dynamic tools | Strict validation + sandbox execution |

### Custom Tools (LLM-Created)

The AI can create new tools at runtime:

1. LLM calls `create_tool` with name, description, parameters, and JavaScript code
2. Tool is validated, sandboxed, and stored in the database
3. Tool is available to all agents via `use_tool`
4. Tools can be enabled/disabled and have permission controls

---

## Personal Data

### Entity Types

| Entity | Key Features |
|--------|-------------|
| **Tasks** | Priority (1-5), due date, category, status (pending/in_progress/completed/cancelled) |
| **Notes** | Title, content (markdown), tags, category |
| **Bookmarks** | URL, title, description, category, tags, favicon |
| **Calendar Events** | Title, start/end time, location, attendees, RSVP status |
| **Contacts** | Name, email, phone, address, organization, notes |
| **Expenses** | Amount, category, description, date, tags |
| **Custom Data** | User-defined tables with AI-determined schemas |

### Memory System

Persistent long-term memory for the AI assistant with AES-256-GCM encryption:

| Memory Type | Description |
|-------------|-------------|
| `fact` | Factual information about the user |
| `preference` | User preferences and settings |
| `conversation` | Key conversation takeaways |
| `context` | Contextual information |
| `task` | Task-related memory |
| `relationship` | People and contacts |
| `temporal` | Time-based reminders |

Memories have **importance scoring**, are **automatically injected** into agent system prompts, support **deduplication** via content hash, and have optional **TTL expiration**.

### Goals System

Hierarchical goal tracking with decomposition:

- **Create goals** with title, description, due date
- **Decompose** into actionable steps (pending, in_progress, completed, skipped)
- **Track progress** (0-100%) with status (active/completed/abandoned)
- **Get next actions** - AI recommends what to do next
- **Complete steps** - Auto-update parent goal progress

---

## Autonomy & Automation

### Autonomy Levels

| Level | Name | Description |
|-------|------|-------------|
| 0 | **Manual** | Always ask before any action |
| 1 | **Assisted** | Suggest actions, wait for approval (default) |
| 2 | **Supervised** | Auto-execute low-risk, ask for high-risk |
| 3 | **Autonomous** | Execute all actions, notify user |
| 4 | **Full** | Fully autonomous, minimal notifications |

### Triggers

Proactive automation with 4 trigger types:

| Type | Description | Example |
|------|-------------|---------|
| `schedule` | Cron-based timing | "Every Monday at 9am, summarize my week" |
| `event` | Fired on data changes | "When a new task is added, notify me" |
| `condition` | IF-THEN rules | "If expenses > $500/day, alert me" |
| `webhook` | External HTTP triggers | "When GitHub webhook fires, create a task" |

### Plans

Multi-step autonomous execution:

- **Step types**: tool, parallel, loop, conditional, wait, pause
- **Status tracking**: draft, running, paused, completed, failed, cancelled
- **Timeout and retry** logic with configurable backoff
- **Step dependencies** for execution ordering

---

## Database

PostgreSQL via `better-sqlite3` adapter pattern with 40+ repositories.

### Key Tables

**Core:** `conversations`, `messages`, `agents`, `settings`, `costs`, `request_logs`

**Personal Data:** `tasks`, `notes`, `bookmarks`, `calendar_events`, `contacts`, `expenses`

**Productivity:** `pomodoro_sessions`, `habits`, `captures`

**Autonomous AI:** `memories`, `goals`, `triggers`, `plans`

**Channels:** `channel_messages`, `channel_users`, `channel_sessions`

**System:** `plugins`, `custom_tools`, `custom_data_tables`, `config_services`, `execution_permissions`, `workspaces`, `model_configs`

### Migration

Schema migrations are auto-applied on startup via `autoMigrateIfNeeded()`. Migration files are in `packages/gateway/src/db/migrations/`.

---

## Security & Privacy

### 4-Layer Security Model

| Layer | Purpose |
|-------|---------|
| **Critical Patterns** | 100+ regex patterns unconditionally blocked (rm -rf /, fork bombs, registry deletion, etc.) |
| **Permission Matrix** | Per-category modes: blocked, prompt, allowed (execute_javascript, execute_python, execute_shell, compile_code, package_manager) |
| **Approval Callback** | Real-time user approval for sensitive operations via SSE (2-minute timeout) |
| **Sandbox Isolation** | VM, Docker, Worker threads, or Local execution with resource limits |

### Credential Management

API keys and settings are stored in the PostgreSQL database via the Config Center system. The web UI settings page and `ownpilot config` CLI both write to the same database.

Keys are loaded into `process.env` at server startup for provider SDK compatibility.

### PII Detection

- 15+ detection categories: SSN, credit cards, emails, phone numbers, IP addresses, passport, etc.
- Configurable redaction modes: mask, label, remove
- Severity-based filtering

### Code Execution

OwnPilot can execute code on behalf of the AI through 5 execution tools:

| Tool | Description |
|------|-------------|
| `execute_javascript` | Run JavaScript/TypeScript via Node.js |
| `execute_python` | Run Python scripts |
| `execute_shell` | Run shell commands (bash/PowerShell) |
| `compile_code` | Compile and run C, C++, Rust, Go, Java |
| `package_manager` | Install packages via npm/pip |

#### Execution Modes

| Mode | Behavior |
|------|----------|
| **docker** | All code runs inside isolated Docker containers (most secure) |
| **local** | Code runs directly on the host machine (requires approval for non-allowed categories) |
| **auto** | Tries Docker first, falls back to local if Docker is unavailable |

#### Docker Sandbox Security

When using Docker mode, each execution runs in a container with strict isolation:

- `--read-only` filesystem (writable `/tmp` only)
- `--network=none` (no network access)
- `--user=65534:65534` (nobody user)
- `--no-new-privileges`
- `--cap-drop=ALL` (no Linux capabilities)
- `--memory=256m` limit
- `--cpus=1` limit
- `--pids-limit=100`
- Configurable timeout with automatic cleanup

#### Local Executor Security

When running locally (without Docker), the local executor applies:

- **Environment sanitization** — strips API keys and sensitive variables from the child process
- **Timeout enforcement** — SIGKILL after configured timeout
- **Output truncation** — 1MB output limit to prevent memory exhaustion

#### Permission System

Code execution is governed by a per-category permission matrix:

| Permission | Behavior |
|------------|----------|
| `blocked` | Execution is denied |
| `prompt` | User must approve via real-time dialog before execution proceeds |
| `allowed` | Execution proceeds without approval |

Categories: `execute_javascript`, `execute_python`, `execute_shell`, `compile_code`, `package_manager`

A **master switch** (`enabled` boolean) can disable all code execution globally.

#### Approval Flow

When a tool's permission is set to `prompt`:

1. Gateway sends an SSE `approval_required` event to the web UI
2. UI shows an approval dialog with the code to be executed
3. User approves or rejects via `POST /api/v1/execution-permissions/approvals/{id}/resolve`
4. Execution proceeds or is cancelled (120-second timeout, auto-reject on expiry)

#### Critical Pattern Blocking

Regardless of permission settings, 100+ regex patterns are **unconditionally blocked**:

- Filesystem destruction (`rm -rf /`, `format C:`, `del /f /s`)
- Fork bombs and system control
- Registry/credential access (Windows registry, `/etc/shadow`)
- Remote code execution (`curl | bash`, `eval(fetch(...))`)
- Package manager abuse (`npm publish`, `pip install` to system)

### Authentication

| Mode | Description |
|------|-------------|
| **None** | No authentication (default, development only) |
| **API Key** | Bearer token or `X-API-Key` header, timing-safe comparison |
| **JWT** | HS256/HS384/HS512 via `jose`, requires `sub` claim |

### Rate Limiting

Sliding window algorithm with configurable window (default 60s), max requests (default 500), and burst limit (default 750). Per-IP tracking with `X-RateLimit-*` response headers.

---

## API Reference

### Chat

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/chat` | Send message (supports SSE streaming) |
| `GET` | `/api/v1/chat/history` | List conversations |
| `GET` | `/api/v1/chat/history/:id` | Get conversation with messages |
| `DELETE` | `/api/v1/chat/history/:id` | Delete conversation |

### Agents

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/agents` | List all agents |
| `POST` | `/api/v1/agents` | Create new agent |
| `PUT` | `/api/v1/agents/:id` | Update agent |
| `DELETE` | `/api/v1/agents/:id` | Delete agent |

### AI Configuration

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/models` | List available models |
| `GET` | `/api/v1/providers` | List providers with status |
| `GET` | `/api/v1/tools` | List all tools |

### Personal Data

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET/POST` | `/api/v1/tasks` | Tasks CRUD |
| `GET/POST` | `/api/v1/notes` | Notes CRUD |
| `GET/POST` | `/api/v1/bookmarks` | Bookmarks CRUD |
| `GET/POST` | `/api/v1/calendar` | Calendar events CRUD |
| `GET/POST` | `/api/v1/contacts` | Contacts CRUD |
| `GET/POST` | `/api/v1/expenses` | Expenses CRUD |
| `GET/POST` | `/api/v1/memories` | Memories CRUD |
| `GET/POST` | `/api/v1/goals` | Goals CRUD |

### Automation

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET/POST` | `/api/v1/triggers` | Trigger management |
| `GET/POST` | `/api/v1/plans` | Plan management |
| `GET/PUT` | `/api/v1/autonomy` | Autonomy settings |

### System

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/api/v1/dashboard` | Dashboard data |
| `GET` | `/api/v1/costs` | Cost tracking |
| `GET` | `/api/v1/audit/logs` | Audit trail |

### Response Format

All API responses use a standardized envelope:

```json
{
  "success": true,
  "data": { },
  "meta": {
    "requestId": "uuid",
    "timestamp": "ISO-8601"
  }
}
```

Error responses include error codes from a standardized `ERROR_CODES` enum.

---

## Configuration

### Environment Variables

> **Note:** AI provider API keys (OpenAI, Anthropic, etc.) and channel tokens (Telegram) are **not** configured via environment variables. Use the Config Center UI or `ownpilot config set` CLI after setup.

```bash
# ─── Server ────────────────────────────────────────
PORT=8080                       # Gateway port
UI_PORT=5173                    # UI dev server port
HOST=0.0.0.0
NODE_ENV=development
# CORS_ORIGINS=                 # Additional origins (localhost:UI_PORT auto-included)
# BODY_SIZE_LIMIT=1048576       # Max request body size in bytes (default: 1MB)

# ─── Database (PostgreSQL) ─────────────────────────
# Option 1: Full connection URL
# DATABASE_URL=postgresql://user:pass@host:port/db
# Option 2: Individual settings
POSTGRES_HOST=localhost
POSTGRES_PORT=25432
POSTGRES_USER=ownpilot
POSTGRES_PASSWORD=ownpilot_secret
POSTGRES_DB=ownpilot
# POSTGRES_POOL_SIZE=10
# DB_VERBOSE=false

# ─── Authentication (DB primary, ENV fallback) ─────
# AUTH_TYPE=none                 # none | api-key | jwt
# API_KEYS=                     # Comma-separated keys for api-key auth
# JWT_SECRET=                   # For jwt auth (min 32 chars)

# ─── Rate Limiting (DB primary, ENV fallback) ──────
# RATE_LIMIT_DISABLED=false
# RATE_LIMIT_WINDOW_MS=60000
# RATE_LIMIT_MAX=500

# ─── Security & Encryption ────────────────────────
# ENCRYPTION_KEY=               # 32 bytes hex (for OAuth token encryption)
# ADMIN_API_KEY=                # Admin key for debug endpoints (production)

# ─── Data Storage ─────────────────────────────────
# OWNPILOT_DATA_DIR=            # Override platform-specific data directory

# ─── Logging ──────────────────────────────────────
LOG_LEVEL=info

# ─── Debug (development only) ─────────────────────
# DEBUG_AI_REQUESTS=false
# DEBUG_AGENT=false
# DEBUG_LLM=false
# DEBUG_RAW_RESPONSE=false
# DEBUG_EXEC_SECURITY=false

# ─── Sandbox (advanced) ──────────────────────────
# ALLOW_HOME_DIR_ACCESS=false
# DOCKER_SANDBOX_RELAXED_SECURITY=false
# MEMORY_SALT=change-this-in-production
```

### Configuration Priority

1. **CLI options** (highest) - `-p`, `-h`, `--no-auth`
2. **PostgreSQL database** - settings table
3. **Environment variables** - `.env` file
4. **Hardcoded defaults** (lowest) - `config/defaults.ts`

---

## Deployment

### Docker

```bash
# Build and run production image
docker build -t ownpilot .
docker run -p 8080:8080 --env-file .env ownpilot
```

### Manual

```bash
# Build all packages
pnpm build

# Start production server
ownpilot start

# Or start individually
pnpm --filter @ownpilot/gateway start
pnpm --filter @ownpilot/ui preview
```

---

## Development

### Scripts

```bash
pnpm dev              # Watch mode for all packages
pnpm build            # Build all packages
pnpm test             # Run all tests
pnpm test:watch       # Watch test mode
pnpm test:coverage    # Coverage reports
pnpm lint             # ESLint check
pnpm lint:fix         # Auto-fix lint issues
pnpm typecheck        # TypeScript type checking
pnpm format           # Prettier formatting
pnpm format:check     # Check formatting
pnpm clean            # Clear all build artifacts
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Monorepo** | pnpm 10+ workspaces + Turborepo 2.x |
| **Language** | TypeScript 5.9 (strict, ES2023, NodeNext) |
| **Runtime** | Node.js 22+ |
| **API Server** | Hono 4.x |
| **Web UI** | React 19 + Vite 6 + Tailwind CSS 4 |
| **Database** | PostgreSQL |
| **Telegram** | Grammy |
| **Testing** | Vitest 2.x (66 test files, 1,507 tests) |
| **Linting** | ESLint 9 (flat config) |
| **Formatting** | Prettier 3.x |
| **Git Hooks** | Husky (pre-commit: lint + typecheck) |
| **CI** | GitHub Actions (Node 22, Ubuntu) |

### Architecture Patterns

| Pattern | Usage |
|---------|-------|
| **Result<T, E>** | Functional error handling throughout core |
| **Branded Types** | Compile-time distinct types (UserId, SessionId, PluginId) |
| **Service Registry** | Typed DI container for runtime service composition |
| **Middleware Pipeline** | Tools, MessageBus, providers all use middleware chains |
| **Builder Pattern** | Plugin and Channel construction |
| **EventBus + HookBus** | Event-driven state + interceptable hooks |
| **Repository** | Data access abstraction with BaseRepository |
| **Meta-tool Proxy** | Token-efficient tool discovery and execution |
| **Context + Hooks** | React state management (no Redux/Zustand) |

---

## License

MIT
