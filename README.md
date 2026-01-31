# OwnPilot

Privacy-first personal AI assistant platform with autonomous agents, tool orchestration, multi-provider support, and multi-channel communication.

**Self-hosted. Your data stays yours.**

---

## Table of Contents

- [Features](#features)
- [Architecture Overview](#architecture-overview)
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
- [API Reference](#api-reference)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Development](#development)
- [License](#license)

---

## Features

### AI & Agents
- **100+ AI Provider Configs** - OpenAI, Anthropic, Google, DeepSeek, Groq, xAI, Mistral, Together AI, Fireworks, Perplexity, OpenRouter, Cohere, Azure, NVIDIA, Hugging Face, and many more
- **Local AI Support** - Ollama, LM Studio, and custom OpenAI-compatible endpoints
- **29 Pre-configured Agents** - Code Assistant, Writing Assistant, Research, Data Analyst, and more across 8 categories
- **Smart Provider Routing** - Cheapest, fastest, smartest, balanced, or fallback strategies
- **Streaming Responses** - Server-Sent Events (SSE) for real-time streaming

### Tools
- **148+ Built-in Tools** across 20 categories (personal data, files, code, web, email, media, AI/NLP, finance, automation, utilities)
- **Meta-tool Proxy** - Only 3 tools sent to the LLM (`search_tools`, `get_tool_help`, `use_tool`); all 148+ tools remain available via dynamic discovery
- **Batch Operations** - `batch_use_tool` for multiple tool calls in one request, `search_tools` with `include_params` for faster workflows
- **Custom Tools** - Create new tools at runtime via LLM (sandboxed JavaScript)
- **Tool Limits** - Automatic parameter capping to prevent unbounded queries
- **Search Tags** - 150+ English keywords for natural language tool discovery

### Personal Data
- **Notes, Tasks, Bookmarks, Contacts, Calendar, Expenses** - Full CRUD with categories, tags, and search
- **Productivity** - Pomodoro timer with sessions/settings/stats, habit tracker with streaks, quick capture inbox
- **Memories** - Long-term persistent memory (facts, preferences, events, skills) with importance scoring
- **Goals** - Goal creation, decomposition, progress tracking, next-action recommendations
- **Custom Data Tables** - Create your own structured data types

### Autonomy & Automation
- **5 Autonomy Levels** - Manual, Assisted, Supervised, Autonomous, Full
- **Triggers** - Schedule-based (cron), event-driven, condition-based, webhook
- **Plans** - Multi-step autonomous execution with checkpoints and rollback
- **Risk Assessment** - Automatic risk scoring for tool executions

### Communication
- **Web UI** - React 19 + Vite + Tailwind CSS 4 with dark mode
- **Telegram Bot** - Full bot integration with user/chat filtering
- **Discord Bot** - Multi-guild support with DMs
- **Slack Bot** - Socket Mode with thread support
- **REST API** - 35 route modules, full CRUD for all entities

### Security
- **Encrypted Credential Storage** - AES-256-GCM + PBKDF2 (600K iterations)
- **PII Detection & Redaction** - Automatic pattern-based detection
- **Sandboxed Code Execution** - Isolated VM with resource limits
- **Authentication** - None, API Key, or JWT modes
- **Rate Limiting** - Configurable with burst support and soft mode

---

## Architecture Overview

```
                         ┌──────────────┐
                         │   Web UI     │  React 19 + Vite
                         │  (Port 3000) │  + Tailwind CSS 4
                         └──────┬───────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                  │
     ┌────────┴────────┐       │        ┌─────────┴──────────┐
     │  Telegram Bot   │       │        │   Discord / Slack  │
     │   (Channels)    │       │        │     (Channels)     │
     └────────┬────────┘       │        └─────────┬──────────┘
              │                │                  │
              └────────┬───────┘──────────────────┘
                       │
              ┌────────▼────────┐
              │    Gateway      │  Hono API Server
              │  (Port 8080)    │  35 Route Modules
              ├─────────────────┤
              │  Service Layer  │  Business Logic
              │  Agent Engine   │  Tool Orchestration
              │  Provider Router│  Smart Model Selection
              │  Autonomy       │  Risk Assessment
              │  EventBus       │  Typed Event System
              ├─────────────────┤
              │     Core        │  Tools, Providers, Types
              │  148+ Tools     │  100+ Provider Configs
              │  Sandbox, Crypto│  Privacy, Audit
              └────────┬────────┘
                       │
              ┌────────▼────────┐
              │   PostgreSQL    │  47 Tables
              │  (Port 25432)   │  Conversations, Personal Data,
              │                 │  Memories, Goals, Triggers, Plans
              └─────────────────┘
```

---

## Quick Start

### Prerequisites
- **Node.js** >= 22.0.0
- **pnpm** >= 9.0.0
- **Docker** (for PostgreSQL)

### Setup

```bash
# Clone and install
git clone https://github.com/ownpilot/ownpilot.git
cd ownpilot
pnpm install

# Start PostgreSQL
docker compose -f docker-compose.db.yml up -d

# Configure
cp .env.example .env
# Edit .env - add at least one API key (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.)

# Seed database with default agents
pnpm --filter @ownpilot/gateway seed

# Start development (gateway + ui)
pnpm dev

# UI: http://localhost:3000
# API: http://localhost:8080
```

### Secure Credential Storage (Recommended)

Instead of storing API keys in `.env`, use the encrypted credential store:

```bash
# Create encrypted store
ownpilot setup

# Add API keys (encrypted with AES-256-GCM)
ownpilot config set openai-api-key
ownpilot config set anthropic-api-key

# Start with auto-unlock
OWNPILOT_PASSWORD=your-master-password ownpilot start
```

Credentials are stored in `~/.ownpilot/credentials.enc` with AES-256-GCM encryption and PBKDF2 key derivation (600K iterations).

---

## Project Structure

```
ownpilot/
├── packages/
│   ├── core/                    # AI runtime, providers, tools, types
│   │   ├── src/
│   │   │   ├── agent/           # Agent engine, orchestrator, types
│   │   │   │   ├── providers/   # 100+ provider configs (JSON), synced from models.dev
│   │   │   │   ├── tools/       # 23 tool modules (148+ tools)
│   │   │   │   └── types.ts     # Agent, provider, ToolProvider, ToolMiddleware types
│   │   │   ├── events/          # EventBus - typed event system
│   │   │   ├── memory/          # Conversation & personal memory
│   │   │   ├── sandbox/         # Isolated code execution (VM)
│   │   │   ├── privacy/         # PII detection & redaction
│   │   │   ├── crypto/          # AES-256-GCM encryption, keychain
│   │   │   ├── audit/           # Audit logging & compliance
│   │   │   ├── costs/           # API cost tracking
│   │   │   ├── plugins/         # Plugin system (worker threads)
│   │   │   ├── services/        # Config center, service registry
│   │   │   └── types/           # Branded types, Result<T,E>
│   │   └── package.json
│   │
│   ├── gateway/                 # Hono API server
│   │   ├── src/
│   │   │   ├── routes/          # 35 route modules
│   │   │   ├── services/        # 16 business logic services, tool providers
│   │   │   ├── db/
│   │   │   │   ├── repositories/  # 30 data access repositories
│   │   │   │   ├── migrations/    # PostgreSQL schema (47 tables)
│   │   │   │   └── seeds/         # Default agents, config services
│   │   │   ├── channels/        # Discord, Slack adapters
│   │   │   ├── triggers/        # Trigger engine
│   │   │   ├── plans/           # Plan executor
│   │   │   ├── ws/              # WebSocket handler
│   │   │   └── middleware/      # Auth, rate limiting, CORS
│   │   ├── data/seeds/          # default-agents.json
│   │   └── package.json
│   │
│   ├── ui/                      # React 19 web interface
│   │   ├── src/
│   │   │   ├── pages/           # 28+ page components
│   │   │   ├── components/      # 22+ reusable components
│   │   │   ├── hooks/           # Custom React hooks
│   │   │   ├── types/           # UI type definitions
│   │   │   ├── App.tsx          # Route definitions
│   │   │   └── main.tsx         # Entry point
│   │   └── package.json
│   │
│   ├── channels/                # Messaging channel adapters
│   │   ├── src/
│   │   │   ├── telegram/        # Telegram Bot API
│   │   │   ├── manager.ts       # Channel orchestration
│   │   │   └── types/           # Channel type definitions
│   │   └── package.json
│   │
│   └── cli/                     # Command-line tools
│       ├── src/
│       │   ├── commands/        # server, bot, start, config, workspace, channel
│       │   └── index.ts         # CLI entry (Commander.js)
│       └── package.json
│
├── docker-compose.db.yml        # PostgreSQL only
├── docker-compose.yml           # Full stack (gateway + ui + db)
├── Dockerfile                   # Multi-stage production build
├── turbo.json                   # Turborepo task config
├── tsconfig.base.json           # Shared TypeScript config
└── package.json                 # Monorepo root
```

---

## Packages

### Core (`@ownpilot/core`)

The core runtime library. Contains all AI provider integrations, tool definitions, agent types, and security primitives.

**Key Modules:**

| Module | Description |
|--------|-------------|
| `agent/providers/` | 100+ provider config JSONs synced from models.dev |
| `agent/tools/` | 23 tool modules with 148+ tool definitions and executors |
| `agent/types.ts` | Agent config, provider types, ToolProvider, ToolMiddleware |
| `events/` | EventBus - typed event system with wildcard subscriptions |
| `memory/` | Conversation memory and personal memory stores |
| `sandbox/` | Isolated VM code execution with resource limits |
| `privacy/` | PII detection patterns (email, phone, SSN, credit card, etc.) |
| `crypto/` | AES-256-GCM encryption, PBKDF2 key derivation, vault |
| `audit/` | Event logging, verification, compliance |
| `costs/` | Per-provider/model cost calculation |
| `plugins/` | Worker-thread isolated plugin runtime |
| `services/` | Config center, API service registry |

### Gateway (`@ownpilot/gateway`)

The API server built on [Hono](https://hono.dev/). Handles all HTTP/WebSocket communication, database operations, agent execution, and channel management.

**Route Modules (35):**

| Category | Routes |
|----------|--------|
| **Chat & Agents** | `chat.ts`, `agents.ts` |
| **AI Configuration** | `models.ts`, `providers.ts`, `model-configs.ts`, `local-providers.ts` |
| **Personal Data** | `personal-data.ts`, `personal-data-tools.ts`, `memories.ts`, `goals.ts`, `expenses.ts`, `custom-data.ts` |
| **Productivity** | `productivity.ts` (Pomodoro, Habits, Captures) |
| **Automation** | `triggers.ts`, `plans.ts`, `autonomy.ts` |
| **Tools & Plugins** | `tools.ts`, `custom-tools.ts`, `plugins.ts` |
| **Channels** | `channels.ts` |
| **Configuration** | `settings.ts`, `config-services.ts`, `media-settings.ts` |
| **Integration** | `integrations.ts`, `auth.ts` |
| **System** | `health.ts`, `dashboard.ts`, `costs.ts`, `audit.ts`, `debug.ts`, `database.ts`, `profile.ts`, `workspaces.ts`, `file-workspaces.ts` |

**Services (16):** GoalService, MemoryService, CustomDataService, TriggerService, PlanService, DashboardService, ToolExecutor, ToolOverrides, ToolProviders, GmailExecutors, MediaExecutors, ConfigCenter, ConfigTools, ApiServiceRegistrar, LocalDiscovery, ToolSource.

**Database Repositories (30):**

agents, conversations, messages, chat, tasks, notes, bookmarks, calendar, contacts, memories, goals, triggers, plans, expenses, custom-data, custom-tools, plugins, channels, channel-messages, costs, logs, settings, workspaces, model-configs, media-settings, oauth-integrations, local-providers, config-services, pomodoro, habits, captures.

### UI (`@ownpilot/ui`)

Modern web interface built with React 19, Vite 6, and Tailwind CSS 4.

**Tech Stack:**
- React 19.0.0 with hooks and Context API
- React Router DOM 7.1.3
- Vite 6.0.11
- Tailwind CSS 4.0.6
- Prism React Renderer (syntax highlighting)
- Lucide React (icons)

**Pages (28+):**

| Page | Description |
|------|-------------|
| **Chat** | Main AI conversation interface with streaming, progress events, tool execution display |
| **Dashboard** | Overview with stats cards, AI briefing, timeline, quick actions |
| **Tasks** | Task management with priorities, due dates, categories |
| **Notes** | Note-taking with markdown support |
| **Calendar** | Event scheduling and viewing |
| **Contacts** | Contact directory with relationships |
| **Bookmarks** | URL bookmarking with tags and categories |
| **Expenses** | Financial tracking with categories |
| **Memories** | Browse and manage AI long-term memories |
| **Goals** | Goal tracking with progress and decomposition |
| **Data Browser** | Universal data browser for all personal data types |
| **Custom Data** | User-defined data tables and records |
| **Agents** | Agent selection and configuration |
| **Tools** | Tool browser with categories |
| **Custom Tools** | Create/manage LLM-created tools |
| **Models** | AI model browser across providers |
| **Costs** | API usage and spending dashboard |
| **Triggers** | Automation trigger management |
| **Plans** | Multi-step plan management |
| **Autonomy** | Autonomy level controls, budget limits, tool permissions |
| **Plugins** | Plugin management |
| **Workspaces** | Multi-workspace support |
| **Config Center** | Dynamic service configuration |
| **API Keys** | Provider API key management |
| **Logs** | Request logs and debug logs |
| **System** | System info, database backup/restore, sandbox status |
| **Profile** | User profile settings |
| **Settings** | Settings hub (Providers, AI Models, Integrations, Media) |

**Key Components:**
- `Layout` - 3-column layout (sidebar, content, stats panel)
- `MessageList` - Chat messages with code blocks, tool calls, traces
- `ChatInput` - Message input with send/stop controls
- `ToolExecutionDisplay` - Real-time tool execution results
- `TraceDisplay` - Detailed execution trace viewer
- `CodeBlock` - Syntax-highlighted code with copy button
- `ConfirmDialog` - Styled modal dialogs (replaces native `confirm`/`alert`)
- `DynamicConfigForm` - Schema-driven configuration forms
- `AIBriefingCard` - AI-generated daily briefing
- `TimelineView` - Timeline visualization

**Custom Hooks:**
- `useChatStore` - Global chat state (provider, model, messages, streaming)
- `useTheme` - Dark/light/system theme with localStorage
- `useWebSocket` - WebSocket connection management
- `useDialog` - Async confirm/alert dialogs (`Promise<boolean>`)

### Channels (`@ownpilot/channels`)

Communication channel adapters for messaging platforms.

| Channel | Features |
|---------|----------|
| **Telegram** | Bot API, message/photo/document/audio handling, user/chat filtering, parse modes (HTML, Markdown) |
| **Discord** | Discord.js, multi-guild, DM support, message content intents, partial message reconstruction |
| **Slack** | @slack/bolt, Socket Mode, thread support, file attachments, emoji reactions |

All channels implement a common `ChannelHandler` interface with `start()`, `stop()`, `sendMessage()`, and `onMessage()` methods.

### CLI (`@ownpilot/cli`)

Command-line interface built with Commander.js.

```bash
ownpilot setup                    # Create encrypted credential store
ownpilot start                    # Start all services (server + bot)
ownpilot server                   # Start HTTP API server only
ownpilot bot                      # Start Telegram bot only

# Credential management
ownpilot config set <key>         # Add encrypted credential
ownpilot config get <key>         # Retrieve credential
ownpilot config delete <key>      # Delete credential
ownpilot config list              # List all credentials
ownpilot config change-password   # Change master password

# Workspace management
ownpilot workspace list           # List workspaces
ownpilot workspace create <name>  # Create workspace
ownpilot workspace delete <name>  # Delete workspace
ownpilot workspace switch <name>  # Switch active workspace

# Channel management
ownpilot channel list             # List channels
ownpilot channel add <type>       # Add channel (telegram/discord/slack)
ownpilot channel connect <id>     # Connect channel
ownpilot channel disconnect <id>  # Disconnect channel
```

---

## AI Providers

OwnPilot supports **100+ AI provider configurations** via OpenAI-compatible API format, Anthropic native API, and Google Gemini API.

### Supported Providers

| Provider | Type | Notable Models | Env Variable |
|----------|------|---------------|--------------|
| **OpenAI** | Native | GPT-5, GPT-5.1, o3, o4-mini, GPT-4o | `OPENAI_API_KEY` |
| **Anthropic** | Native | Claude Opus 4.5, Claude Sonnet 4.5, Claude Haiku 4.5 | `ANTHROPIC_API_KEY` |
| **Google** | Native | Gemini 2.0 Pro, Gemini 2.0 Flash | `GOOGLE_API_KEY` |
| **DeepSeek** | OpenAI-compat | DeepSeek V3.2, DeepSeek Reasoner | `DEEPSEEK_API_KEY` |
| **Groq** | OpenAI-compat | Llama 4 Maverick, Mixtral 8x7B | `GROQ_API_KEY` |
| **xAI** | OpenAI-compat | Grok 3, Grok 3 Mini | `XAI_API_KEY` |
| **Mistral** | OpenAI-compat | Mistral Large 3, Devstral 2, Codestral | `MISTRAL_API_KEY` |
| **Together AI** | OpenAI-compat | Llama 4, Qwen3-72B | `TOGETHER_API_KEY` |
| **Fireworks AI** | OpenAI-compat | Llama 4, Mistral Large 3 | `FIREWORKS_API_KEY` |
| **Perplexity** | OpenAI-compat | Sonar Pro, Sonar Reasoning | `PERPLEXITY_API_KEY` |
| **OpenRouter** | OpenAI-compat | 200+ models via single API | `OPENROUTER_API_KEY` |
| **Ollama** | Local | Llama 4, Qwen3, Mistral, CodeLlama | None (local) |
| **LM Studio** | Local | Any GGUF model | None (local) |

Plus 85+ more providers including Azure, AWS Bedrock, Google Vertex, NVIDIA, Hugging Face, Cerebras, Scaleway, OVHcloud, and more.

### Provider Routing Strategies

The provider router can automatically select the best model based on:

| Strategy | Description |
|----------|-------------|
| `cheapest` | Minimize API costs |
| `fastest` | Minimize latency |
| `smartest` | Best quality/reasoning |
| `balanced` | Cost + quality balance (default) |
| `fallback` | Try providers sequentially until one succeeds |

---

## Agent System

### Pre-configured Agents (29)

Agents are AI assistants with specific system prompts, tool assignments, and model preferences.

| Category | Agents |
|----------|--------|
| **Core (2)** | Orchestrator, General Assistant |
| **Technical (6)** | Code Assistant, DevOps Engineer, Database Expert, Security Analyst, Mobile Developer, API Designer |
| **Content (5)** | Writing Assistant, Creative Writer, Technical Writer, Summarizer, Translator |
| **Professional (5)** | Task Manager, Career Coach, Personal Coach, Legal Assistant, Finance Advisor |
| **Analysis (3)** | Data Analyst, Research Assistant, Business Analyst |
| **Creative (3)** | UX Designer, Image Prompt Creator, Video Scriptwriter |
| **Education (3)** | Math Tutor, Language Tutor, Study Coach |
| **Specialized (2)** | Email Composer, Meeting Assistant |

### Agent Configuration

Each agent has:

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

- **Tool Orchestration** - Automatic tool calling with multi-step planning
- **Memory Injection** - Relevant memories automatically included in context
- **Dynamic Prompts** - Context-aware system prompt enhancement
- **Error Handling** - Automatic retries with graceful degradation

---

## Tool System

### Overview

OwnPilot has **148+ tools** organized into **20 categories**. Rather than sending all tool definitions to the LLM (which would consume too many tokens), OwnPilot uses a **meta-tool proxy pattern**:

1. **`search_tools`** - Find tools by keyword (supports `include_params` for inline parameter schemas)
2. **`get_tool_help`** - Get detailed help for a specific tool (supports batch lookup)
3. **`use_tool`** - Execute a tool with automatic parameter validation and limit enforcement
4. **`batch_use_tool`** - Execute multiple tools in a single call for faster workflows

### Tool Categories

| Category | Tools | Examples |
|----------|-------|---------|
| **Tasks** | 6 | add_task, list_tasks, complete_task, update_task, delete_task, batch_add_tasks |
| **Notes** | 5 | add_note, list_notes, update_note, delete_note, batch_add_notes |
| **Calendar** | 4 | add_calendar_event, list_calendar_events, delete_calendar_event, batch_add |
| **Contacts** | 5 | add_contact, list_contacts, update_contact, delete_contact, batch_add |
| **Bookmarks** | 4 | add_bookmark, list_bookmarks, delete_bookmark, batch_add_bookmarks |
| **Custom Data** | 11 | create_custom_table, add_custom_record, search_custom_records, ... |
| **File System** | 8 | read_file, write_file, list_directory, search_files, copy_file, ... |
| **PDF** | 3 | read_pdf, create_pdf, pdf_info |
| **Code Execution** | 5 | execute_javascript, execute_python, execute_shell, compile_code, package_manager |
| **Git** | 7 | git_status, git_diff, git_log, git_commit, git_add, git_branch, git_checkout |
| **Web & API** | 4 | http_request, fetch_web_page, search_web, json_api |
| **Email** | 6 | send_email, list_emails, read_email, search_emails, reply_email, delete_email |
| **Image** | 5 | analyze_image, generate_image, edit_image, image_variation, resize_image |
| **Audio** | 5 | text_to_speech, speech_to_text, translate_audio, audio_info, split_audio |
| **Translation** | 4 | translate_text, detect_language, list_languages, batch_translate |
| **Data Extraction** | 4 | extract_structured_data, extract_entities, extract_table_data, summarize_text |
| **Vector Search** | 7 | create_embedding, semantic_search, upsert_vectors, similarity_score, ... |
| **Finance** | 7 | add_expense, parse_receipt, query_expenses, expense_summary, export_expenses, ... |
| **Scheduler** | 6 | create_scheduled_task, list_scheduled_tasks, trigger_task, ... |
| **Weather** | 2 | get_weather, get_weather_forecast |
| **Memory** | 7 | remember, recall, forget, list_memories, boost_memory, memory_stats, batch_remember |
| **Goals** | 8 | create_goal, list_goals, decompose_goal, get_next_actions, complete_step, ... |
| **Dynamic Tools** | 4 | create_tool, list_custom_tools, delete_custom_tool, toggle_custom_tool |
| **Utilities** | 21 | calculate, statistics, convert_units, generate_uuid, hash_text, regex, parse_csv, ... |

### Tool Limits

Automatic parameter capping prevents unbounded queries from the LLM:

| Tool | Parameter | Max | Default |
|------|-----------|-----|---------|
| `list_emails` | limit | 50 | 20 |
| `search_emails` | limit | 100 | 50 |
| `list_tasks` | limit | 50 | 20 |
| `list_notes` | limit | 50 | 20 |
| `list_calendar_events` | limit | 50 | 20 |
| `list_contacts` | limit | 50 | 20 |
| `list_goals` | limit | 30 | 10 |
| `get_next_actions` | limit | 20 | 5 |
| `query_expenses` | limit | 100 | 50 |
| `semantic_search` | topK | 50 | 10 |
| `search_web` | maxResults | 20 | 10 |
| `search_files` | maxResults | 100 | 50 |

### Custom Tools (LLM-Created)

The AI can create new tools at runtime:

1. LLM calls `create_tool` with name, description, parameters, and JavaScript code
2. Tool is sandboxed and stored in the database
3. Tool is available to all agents via `use_tool`
4. Tools can be enabled/disabled, require approval, and have permission controls

---

## Personal Data

### Entity Types

| Entity | Features |
|--------|----------|
| **Tasks** | Title, description, status (pending/in_progress/completed/cancelled), priority (low/normal/high/urgent), due date, category, tags, subtasks, recurrence |
| **Notes** | Title, content (markdown), category, tags, pinned, archived, color |
| **Bookmarks** | URL, title, description, category, tags, favorite, visit count |
| **Calendar Events** | Title, description, location, start/end time, all-day, timezone, recurrence, attendees, reminders |
| **Contacts** | Name, email, phone, company, job title, birthday, address, relationship, tags, social links, custom fields |
| **Expenses** | Amount, category, description, date, tags, receipt parsing |
| **Custom Data** | User-defined tables with dynamic schemas |

### Memory System

Persistent long-term memory for the AI assistant:

| Memory Type | Description |
|-------------|-------------|
| `fact` | Factual information about the user |
| `preference` | User preferences and settings |
| `conversation` | Key conversation takeaways |
| `event` | Important events and milestones |
| `skill` | Learned capabilities |

Memories have **importance scoring** (0-1), are **automatically injected** into agent context, and support **semantic recall** with relevance matching.

### Goals System

Hierarchical goal tracking with decomposition:

- **Create goals** with title, description, priority (1-10), due date
- **Decompose** goals into sub-goals and actionable steps
- **Track progress** (0-100%) with status (active/paused/completed/abandoned)
- **Get next actions** - AI recommends what to do next
- **Complete steps** and auto-update parent goal progress

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

- **Step types**: tool_call, llm_decision, user_input, condition, parallel, loop, sub_plan
- **Status tracking**: pending, running, paused, completed, failed, cancelled
- **Checkpoints**: Save state for rollback on failure
- **Linked** to goals and triggers

---

## Database

### Supported Databases

| Database | Status | Notes |
|----------|--------|-------|
| **PostgreSQL 16+** | Primary | Recommended for production |
| **SQLite** | Legacy | Development/single-user |

### Schema (47 Tables)

**Core Tables:**
- `conversations`, `messages` - Chat history
- `agents` - Agent configurations
- `settings` - Key-value settings store
- `request_logs` - API request/response logging
- `costs` - Token usage and cost tracking

**Personal Data Tables:**
- `tasks`, `notes`, `bookmarks`, `calendar_events`, `contacts`
- `projects`, `reminders`, `captures` (quick capture inbox)
- `expenses`

**Productivity Tables:**
- `pomodoro_sessions`, `pomodoro_settings` - Pomodoro timer
- `habits`, `habit_logs` - Habit tracking

**Autonomous AI Tables:**
- `memories` - Long-term memory with embeddings
- `goals`, `goal_steps` - Goal hierarchy
- `triggers`, `trigger_history` - Automation triggers
- `plans`, `plan_steps`, `plan_history` - Multi-step plans

**System Tables:**
- `channels`, `channel_messages` - Messaging channels
- `custom_tools` - LLM-created tools
- `custom_data_tables`, `custom_data_records` - User-defined data
- `plugins` - Plugin state persistence
- `oauth_integrations` - OAuth token storage
- `media_provider_settings` - Media provider configuration
- `user_model_configs` - Per-user model enable/disable
- `local_providers`, `local_models` - Local AI provider management

### Migration

```bash
# Run PostgreSQL migration
pnpm --filter @ownpilot/gateway migrate:postgres

# Dry run (preview only)
pnpm --filter @ownpilot/gateway migrate:postgres:dry
```

---

## Security & Privacy

### Credential Management

Two approaches for storing API keys:

1. **Encrypted Vault (CLI)** — `ownpilot config set <key>` stores credentials in `~/.ownpilot/credentials.enc` with AES-256-GCM encryption and PBKDF2 key derivation (600K iterations). Recommended for CLI usage.
2. **Database Settings (Gateway API)** — `POST /api/v1/settings/api-keys` stores keys in PostgreSQL via the config services system. Keys are loaded into `process.env` at startup for provider SDK compatibility. Used by the Web UI.

### PII Detection
- Automatic detection of emails, phone numbers, SSNs, credit cards, and more
- Configurable redaction before logging/storage
- Enable via `ENABLE_PII_REDACTION=true`

### Sandboxed Code Execution
- Node.js VM module + Worker threads for isolation
- Configurable resource limits (memory, CPU, timeout)
- Permission-based access control (filesystem, network, process)
- All executions are audit-logged

### Authentication
- **None** - No authentication (development only — **not for production**)
- **API Key** - Static API keys in `API_KEYS` env var
- **JWT** - JSON Web Token with configurable secret
- **Database Admin** - Mutating database operations (`/api/v1/database/*`) require `ADMIN_API_KEY` env var and `X-Admin-Key` header, regardless of global auth config

### Rate Limiting
- Window-based rate limiting (default: 500 requests/minute)
- Burst support (default: 750)
- Soft mode: warn but don't block (recommended for personal use)
- Fully configurable or disableable

---

## API Reference

### Core Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/chat` | Send message to AI agent |
| `GET` | `/api/v1/chat/conversations` | List conversations |
| `GET` | `/api/v1/chat/conversations/:id` | Get conversation with messages |

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
| `GET` | `/api/v1/chat/logs` | Request logs |

---

## Configuration

### Environment Variables

```bash
# ─── Master Password ───────────────────────────────
OWNPILOT_PASSWORD=              # Auto-unlock encrypted credentials

# ─── AI Provider API Keys ─────────────────────────
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...
DEEPSEEK_API_KEY=...
GROQ_API_KEY=...
XAI_API_KEY=...
MISTRAL_API_KEY=...

# ─── Server ────────────────────────────────────────
PORT=8080
HOST=0.0.0.0
NODE_ENV=development
CORS_ORIGINS=http://localhost:3000,http://localhost:5173

# ─── Authentication ────────────────────────────────
AUTH_TYPE=none                   # none | api-key | jwt
API_KEYS=key1,key2              # For api-key auth
JWT_SECRET=your-secret          # For jwt auth (min 32 chars)
ADMIN_API_KEY=your-admin-key    # Required for database admin operations

# ─── Rate Limiting ─────────────────────────────────
RATE_LIMIT_DISABLED=false
RATE_LIMIT_WINDOW_MS=60000      # 1 minute window
RATE_LIMIT_MAX=500              # Max requests per window
RATE_LIMIT_BURST=750            # Allow temporary spikes
RATE_LIMIT_SOFT=true            # Warn but don't block

# ─── Database ──────────────────────────────────────
DB_TYPE=postgres                # postgres | sqlite
POSTGRES_HOST=localhost
POSTGRES_PORT=25432
POSTGRES_USER=ownpilot
POSTGRES_PASSWORD=ownpilot_secret
POSTGRES_DB=ownpilot
POSTGRES_POOL_SIZE=10
# Or use connection URL:
# DATABASE_URL=postgresql://ownpilot:secret@localhost:25432/ownpilot

# ─── Telegram Bot ──────────────────────────────────
TELEGRAM_BOT_TOKEN=123456789:ABC...
TELEGRAM_ALLOWED_USERS=         # Comma-separated user IDs
TELEGRAM_ALLOWED_CHATS=         # Comma-separated chat IDs

# ─── Autonomy ─────────────────────────────────────
DEFAULT_AUTONOMY_LEVEL=1        # 0=Manual, 1=Assisted, 2=Supervised, 3=Autonomous, 4=Full
ENABLE_PROACTIVE_TRIGGERS=false
TRIGGER_CHECK_INTERVAL=60000    # ms

# ─── Privacy & Security ───────────────────────────
ENABLE_PII_REDACTION=true
ENCRYPTION_KEY=                 # 32 bytes hex

# ─── Logging ───────────────────────────────────────
LOG_LEVEL=info
LOG_FORMAT=json

# ─── AI Agent ──────────────────────────────────────
SYSTEM_PROMPT=You are a helpful AI assistant.
DATA_DIR=./data
```

---

## Deployment

### Docker (Recommended)

```bash
# Full stack: PostgreSQL + Gateway + UI
docker compose up -d

# PostgreSQL only
docker compose -f docker-compose.db.yml up -d

# Build and run production image
docker build -t ownpilot .
docker run -p 8080:8080 --env-file .env ownpilot
```

The Dockerfile uses multi-stage builds:
1. **Builder** - `node:22-alpine`, installs pnpm, builds all packages
2. **Production** - `node:22-alpine`, copies only dist/ and prod dependencies

### Docker Compose Services

| Service | Image | Port | Description |
|---------|-------|------|-------------|
| `postgres` | postgres:16-alpine | 25432 | PostgreSQL database |
| `gateway` | ownpilot (built) | 8080 | API server |
| `ui` | ownpilot-ui (built) | 3000 | Web interface |

### Manual Deployment

```bash
# Build
pnpm build

# Start production server
pnpm start

# Or start individually
pnpm --filter @ownpilot/gateway start
pnpm --filter @ownpilot/ui preview
```

---

## Development

### Scripts

```bash
# ─── Root (Turborepo) ──────────────────────────────
pnpm dev              # Watch mode for all packages
pnpm build            # Build all packages
pnpm test             # Run all tests
pnpm test:watch       # Watch test mode
pnpm test:coverage    # Coverage reports
pnpm lint             # ESLint all packages
pnpm lint:fix         # Auto-fix lint issues
pnpm typecheck        # TypeScript type checking
pnpm clean            # Clear all build artifacts
pnpm format           # Prettier formatting
pnpm format:check     # Check formatting

# ─── Package-specific ──────────────────────────────
pnpm --filter @ownpilot/gateway seed                # Seed default agents
pnpm --filter @ownpilot/gateway seed:triggers-plans # Seed triggers & plans
pnpm --filter @ownpilot/gateway migrate:postgres    # Run DB migration
pnpm --filter @ownpilot/ui dev                      # UI dev server
pnpm --filter @ownpilot/ui build                    # Build UI
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Monorepo** | pnpm workspaces + Turborepo |
| **Language** | TypeScript 5.9 (strict, ES2023, NodeNext) |
| **API Server** | Hono |
| **Web UI** | React 19 + Vite 6 + Tailwind CSS 4 |
| **Database** | PostgreSQL 16 / SQLite |
| **Testing** | Vitest |
| **Linting** | ESLint |
| **Formatting** | Prettier |
| **Git Hooks** | Husky |
| **Build** | Turborepo with incremental caching |
| **Container** | Docker multi-stage |

### Testing

- **65 test files** across all packages
- **1,075+ tests** in the gateway package alone
- Integration tests for all route modules
- Unit tests for services, middleware, and core modules
- Framework: **Vitest** with `vi.mock` for module-level mocking

### Architecture Patterns

| Pattern | Usage |
|---------|-------|
| **Result<T, E>** | Error handling throughout core |
| **Repository** | Data access abstraction (`IRepository<T>`, `StandardQuery`, `PaginatedResult`) |
| **Strategy** | Provider routing (cheapest/fastest/smartest) |
| **Registry** | Tool registration and discovery |
| **EventBus** | Typed event system with wildcard subscriptions (tool, resource, agent, system events) |
| **Service Layer** | Business logic services (GoalService, MemoryService, PlanService, TriggerService, etc.) |
| **Tool Provider** | Modular tool registration via `ToolProvider` interface and `ToolMiddleware` |
| **Middleware** | Hono request pipeline (auth, rate limiting, timing, circuit breaker) |
| **Context + Hook** | React state management (Chat, Theme, Dialog) |

---

## License

MIT
