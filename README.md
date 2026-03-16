# OwnPilot

<p align="center">
  <img src="ownpilot_.png" alt="OwnPilot — Privacy-First Personal AI Assistant Platform" width="100%" />
</p>

<p align="center">
  <a href="https://github.com/ownpilot/ownpilot/actions/workflows/ci.yml"><img src="https://github.com/ownpilot/ownpilot/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://ghcr.io/ownpilot/ownpilot"><img src="https://img.shields.io/badge/ghcr.io-ownpilot-blue?logo=docker" alt="Docker" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-≥22-green?logo=node.js" alt="Node.js" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript" alt="TypeScript" /></a>
</p>

Privacy-first personal AI assistant platform with soul agents, autonomous background agents, multi-agent orchestration, AI agent creator, tool orchestration, multi-provider support, MCP integration, voice pipeline, browser automation, IoT edge device control, and Telegram + WhatsApp connectivity.

**Self-hosted. Your data stays yours.**

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Setup Guide](SETUP.md) — Detailed installation instructions
- [Project Structure](#project-structure)
- [Packages](#packages)
  - [Core](#core-ownpilotcore)
  - [Gateway](#gateway-ownpilotgateway)
  - [UI](#ui-ownpilotui)
  - [CLI](#cli-ownpilotcli)
- [AI Providers](#ai-providers)
- [Agent System](#agent-system)
- [Soul Agents](#soul-agents)
- [Autonomous Hub](#autonomous-hub)
- [Agent Orchestra](#agent-orchestra)
- [Background Agents](#background-agents-1)
- [Subagents](#subagents)
- [Tool System](#tool-system)
- [MCP Integration](#mcp-integration)
- [Artifacts](#artifacts)
- [Voice Pipeline](#voice-pipeline)
- [Browser Agent](#browser-agent)
- [Edge Devices](#edge-devices)
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

- **Multi-Provider Support** — 4 native providers (OpenAI, Anthropic, Google, Zhipu) + 8 aggregator providers (Together AI, Groq, Fireworks, DeepInfra, OpenRouter, Perplexity, Cerebras, fal.ai) + any OpenAI-compatible endpoint
- **Local AI Support** — Ollama, LM Studio, LocalAI, and vLLM auto-discovery on the local network
- **Smart Provider Routing** — Cheapest, fastest, smartest, balanced, or fallback strategies
- **Anthropic Prompt Caching** — Static system prompt blocks cached via `cache_control` to reduce input tokens on repeated requests
- **Context Management** — Real-time context usage tracking, detail modal with per-section token breakdown, context compaction (AI-powered message summarization), session clear
- **Streaming Responses** — Server-Sent Events (SSE) for real-time streaming with tool execution progress
- **Configurable Agents** — Custom system prompts, model preferences, tool assignments, and execution limits

### Tools & Extensions

- **190+ Built-in Tools** across 32 categories (personal data, files, code execution, web, email, media, git, translation, weather, finance, automation, vector search, data extraction, utilities, orchestra, artifacts, browser, edge devices)
- **Meta-tool Proxy** — Only 4 meta-tools sent to the LLM (`search_tools`, `get_tool_help`, `use_tool`, `batch_use_tool`); all tools remain available via dynamic discovery
- **Tool Namespaces** — Qualified tool names with prefixes (`core.`, `custom.`, `plugin.`, `skill.`, `mcp.`) for clear origin tracking
- **MCP Client** — Connect to external MCP servers (Filesystem, GitHub, Brave Search, etc.) and use their tools natively
- **MCP Server** — Expose OwnPilot's tools as an MCP endpoint for Claude Desktop and other MCP clients
- **User Extensions** — Installable tool bundles with custom tools, triggers, services, and configurations; Extension SDK provides `utils.callTool()` to invoke any of 190+ built-in tools
- **6 Default Extensions** — Daily Briefing, Knowledge Base, Project Tracker, Smart Search, Automation Builder, Contact Enricher bundled out-of-the-box
- **Extension Security Audit** — LLM-powered security analysis for skills and extensions before installation
- **Skills** — Open standard SKILL.md format (AgentSkills.io) for instruction-based AI knowledge packages
- **Custom Tools** — Create new tools at runtime via LLM (sandboxed JavaScript)
- **Connected Apps** — 1000+ OAuth app integrations via Composio (Google, GitHub, Slack, Notion, Stripe, etc.)
- **Tool Limits** — Automatic parameter capping to prevent unbounded queries
- **Search Tags** — Natural language tool discovery with keyword matching

### Personal Data

- **Notes, Tasks, Bookmarks, Contacts, Calendar, Expenses** — Full CRUD with categories, tags, and search
- **Productivity** — Pomodoro timer with sessions/stats, habit tracker with streaks, quick capture inbox
- **Memories** — Long-term persistent memory (facts, preferences, events) with importance scoring, vector search, and auto-injection
- **Goals** — Goal creation, decomposition into steps, progress tracking, next-action recommendations
- **Custom Data Tables** — Create your own structured data types with AI-determined schemas

### Coding Agents

- **External AI Coding CLIs** — Orchestrate Claude Code, Codex, and Gemini CLI from the web UI or via AI tool calling
- **Session Management** — Long-running coding sessions with real-time terminal output streaming
- **Dual Execution Modes** — Auto mode (headless `child_process.spawn`) and interactive mode (PTY terminal)
- **Custom Providers** — Register any CLI binary as a coding agent provider
- **Result Persistence** — Task output, exit codes, and duration stored in the database

### Soul Agents

- **Rich Agent Identity** — Agents with personality, role, mission, voice, boundaries, and emoji; full identity framework for autonomous operation
- **Heartbeat Lifecycle** — Cron-scheduled execution cycles with configurable checklist, self-healing, max duration, and cost tracking
- **Crew System** — Multi-agent crews with role assignments, delegation protocols, and ready-made crew templates
- **Inter-Agent Communication** — Agents can send messages to each other with subject, content, and type classification
- **Evolution Tracking** — Version-controlled agent evolution with core/mutable traits, learnings, and feedback log
- **Autonomy Controls** — Per-agent autonomy levels with allowed/blocked actions, approval requirements, and budget limits (per-cycle, per-day, per-month)
- **Boot Sequences** — Configurable `onStart`, `onHeartbeat`, and `onMessage` action sequences
- **16+ Agent Templates** — Pre-built configurations for common use cases (Morning Briefer, News Monitor, Code Reviewer, Budget Tracker, etc.)

### Autonomous Hub

- **Unified Command Center** — Single tabbed dashboard consolidating all autonomous agents (soul + background), crews, messaging, and activity
- **AI Agent Creator** — Conversational agent creation: describe what you need in plain language, refine through chat, preview JSON config, create in one click
- **Agent Cards** — At-a-glance agent status with real-time indicators, mission preview, cost tracking, and quick actions (pause/resume/delete)
- **Activity Feed** — Unified timeline of heartbeat logs and agent messages with aggregate stats (total runs, success rate, avg duration, total cost)
- **Global Status Bar** — Live agent count, running/paused/error breakdown, daily cost, and WebSocket connection state
- **Search & Filters** — Filter agents by status, type (soul/background), and text search across name, role, and mission

### Background Agents

- **Persistent Autonomous Agents** — Long-running agents that operate independently with configurable missions, schedules, and tool access
- **3 Scheduling Modes** — Interval (fixed timer), continuous (adaptive delays), event-driven (reactive to triggers)
- **Full Tool Access** — Same capabilities as chat agents: 190+ tools, extensions, plugins, MCP tools, memory injection
- **Configurable Provider/Model** — Each agent can use a different AI provider and model, with fallback to system defaults
- **Workspace Isolation** — Each agent gets an isolated file workspace for safe file operations
- **Rate Limiting & Budget** — Cycles-per-hour enforcement, budget tracking with auto-stop, auto-pause on consecutive errors
- **Session Persistence** — Agent state persisted to DB every 30 seconds, auto-recovery on server restart
- **Inbox Messaging** — Send messages to running agents; agents process inbox at the start of each cycle

### Subagents

- **Parallel Task Delegation** — Chat agents and background agents can spawn lightweight child agents for concurrent task execution
- **Fire-and-Forget Model** — Spawn returns immediately with a session ID; parent polls for results via `check_subagent`/`get_subagent_result`
- **Budget Enforcement** — Configurable concurrent limit (default 5), total spawn limit (default 20), and nesting depth cap (max 2 levels)
- **Full Tool Access** — Subagents inherit the parent's full tool pipeline; optional `allowedTools` restriction
- **Independent Model Selection** — Each subagent can use a different provider/model (e.g., expensive model for parent, cheap model for subagents)
- **5 LLM-Callable Tools** — `spawn_subagent`, `check_subagent`, `get_subagent_result`, `cancel_subagent`, `list_subagents`

### Agent Orchestra

- **Multi-Agent Orchestration** — Fan-out/fan-in, race, pipeline, and voting strategies for concurrent multi-provider agent execution
- **Real-time Progress** — WebSocket events for orchestra session lifecycle (started, step completed, finished)
- **6 LLM Tools** — `create_orchestra`, `run_orchestra`, `list_orchestras`, `get_orchestra_result`, `cancel_orchestra`, `list_strategies`

### Artifacts

- **Versioned Documents** — Create, update, and track markdown, code, JSON, HTML, CSV, SVG, and Mermaid diagram artifacts
- **Data Binding** — Expression-based bindings (`{{source.field}}`) that auto-resolve from conversation context
- **Diff Tracking** — Version history with content diffs for every update
- **5 LLM Tools** — `create_artifact`, `update_artifact`, `list_artifacts`, `get_artifact`, `delete_artifact`

### Voice Pipeline

- **Speech-to-Text** — Whisper API integration for audio transcription with configurable models
- **Text-to-Speech** — OpenAI TTS with multiple voices (alloy, echo, fable, onyx, nova, shimmer)
- **Chat Integration** — VoiceButton for recording in ChatInput, VoicePlayButton for AI response playback
- **Channel Support** — WhatsApp voice message transcription via channel normalizer

### Browser Agent

- **Headless Automation** — Playwright-powered Chromium for AI-driven web browsing
- **7 LLM Tools** — Navigate, click, type, screenshot, evaluate JavaScript, extract content, fill forms
- **Workflow Persistence** — Browser automation workflows stored in DB for replay and audit

### Skills Platform

- **Enhanced Lifecycle** — Sandboxed skill execution with granular permissions (network, filesystem, database, shell, email, scheduling)
- **npm Dependencies** — Skills can declare and install npm packages via `ownpilot skill install`
- **CLI Management** — `ownpilot skill` commands for install, list, info, search, update, remove
- **Permission Review** — PermissionReviewModal UI for approving skill capabilities before activation

### Edge Devices (IoT)

- **MQTT Integration** — Mosquitto broker for lightweight IoT device communication
- **Device Registry** — Register edge devices (Raspberry Pi, ESP32, Arduino, custom) with sensors and actuators
- **Telemetry Ingestion** — Real-time sensor data via MQTT topics, stored with full history
- **Command Queue** — Send commands to devices with acknowledgment tracking
- **6 LLM Tools** — `list_edge_devices`, `get_device_status`, `read_sensor`, `send_device_command`, `control_actuator`, `register_edge_device`

### CLI Tools

- **40+ Discoverable Tools** — Automatic PATH-based detection of installed CLI tools (linters, formatters, build tools, package managers, security scanners, databases, containers)
- **Per-Tool Security Policies** — `allowed` (auto-execute), `prompt` (require approval), `blocked` (reject) per user per tool
- **Dynamic Risk Scoring** — Catalog-based risk levels (low/medium/high/critical) feed into the autonomy risk engine
- **Custom Tool Registration** — Register any binary as a CLI tool with category and risk metadata
- **Approval Integration** — CLI tool policies wired into the real-time approval flow, overriding generic risk scores

### Autonomy & Automation

- **5 Autonomy Levels** — Manual, Assisted, Supervised, Autonomous, Full
- **Pulse System** — Proactive AI engine that gathers context, evaluates signals, and executes actions on an adaptive 5-15 min timer with configurable directives and 4 preset templates
- **Triggers** — Schedule-based (cron), event-driven, condition-based, webhook
- **Heartbeats** — Natural language to cron conversion for periodic tasks ("every weekday at 9am")
- **Plans** — Multi-step autonomous execution with checkpoints, retry logic, and timeout handling
- **Risk Assessment** — Automatic risk scoring for tool executions with approval workflows
- **Model Routing** — Per-process model selection (chat, channel, pulse, subagent) with fallback chains
- **Extended Thinking** — Anthropic extended thinking support for deeper reasoning in complex tasks

### Communication

- **Web UI** — React 19 + Vite 7 + Tailwind CSS 4 with dark mode, 57+ pages, 120+ components, code-split
- **Telegram Bot** — Full bot integration with user/chat filtering, message splitting, HTML/Markdown formatting
- **WhatsApp (Baileys)** — QR code authentication (no Meta Business account needed), self-chat mode with loop prevention, session persistence, group message support with passive history sync
- **Channel User Approval** — Multi-step verification: approval code flow, manual admin approval, user blocking/unblocking with real-time notifications
- **Channel Pairing Keys** — Per-channel rotating pairing keys for ownership verification with revoke support
- **EventBus** — Unified event backbone with EventBusBridge translating dot-notation events to WebSocket colon-notation; Event Monitor UI for live debugging
- **WebSocket** — Real-time broadcasts for all data mutations, event subscriptions, session management
- **REST API** — 120+ route modules with standardized responses, pagination, and error codes

### Security

- **Zero-Dependency Crypto** — AES-256-GCM encryption + PBKDF2 key derivation using only Node.js built-ins
- **PII Detection & Redaction** — 15+ categories (SSN, credit cards, emails, phone, etc.)
- **Sandboxed Code Execution** — Docker container isolation, local execution with approval, critical pattern blocking
- **4-Layer Security** — Critical patterns -> permission matrix -> approval callback -> sandbox isolation
- **Code Execution Approval** — Real-time SSE approval dialog for sensitive operations with 120s timeout
- **Authentication** — None, API Key, or JWT modes
- **Rate Limiting** — Sliding window with burst support
- **Tamper-Evident Audit** — Hash chain verification for audit logs
- **SSRF Protection** — DNS rebinding detection, private IP blocking, and async URL validation with 1-min cache across browser service, fetch-url, and web-fetch executors

---

## Architecture

```
                         ┌──────────────┐
                         │   Web UI     │  React 19 + Vite 7
                         │  (bundled)   │  Tailwind CSS 4
                         └──────┬───────┘
                                │ HTTP + SSE + WebSocket (/ws)
              ┌─────────────────┼─────────────────┐
              │                 │                  │
     ┌────────┴────────┐       │        ┌─────────┴──────────┐
     │  Telegram Bot   │       │        │  External MCP      │
     │  WhatsApp       │       │        │  Clients/Servers   │
     │   (Channels)    │       │        └─────────┬──────────┘
     └────────┬────────┘       │                  │
              └────────┬───────┘──────────────────┘
                       │
              ┌────────▼────────┐
              │    Gateway      │  Hono HTTP API Server
              │  (Port 8080)    │  120+ Route Modules
              ├─────────────────┤
              │  MessageBus     │  Middleware Pipeline
              │  Agent Engine   │  Tool Orchestration
              │  Orchestra      │  Multi-Agent Coordination
              │  Provider Router│  Smart Model Selection
              │  Background Agt │  Persistent Autonomous Agents
              │  Coding Agents  │  External AI CLIs
              │  Browser Agent  │  Headless Web Automation
              │  Voice Pipeline │  STT/TTS Integration
              │  Edge Manager   │  MQTT + IoT Devices
              │  CLI Tools      │  40+ Discoverable Tools
              │  Pulse Engine   │  Proactive Autonomy
              │  MCP Client     │  External Tool Servers
              │  Plugin System  │  Extensible Architecture
              │  EventBus       │  Unified Event Backbone
              │  WebSocket      │  Real-time Broadcasts
              ├─────────────────┤
              │     Core        │  AI Engine & Tool Framework
              │  190+ Tools     │  Multi-Provider Support
              │  Sandbox, Crypto│  Privacy, Audit
              └────────┬────────┘
                       │
              ┌────────▼────────┐  ┌─────────────┐
              │   PostgreSQL    │  │  Mosquitto   │
              │  88+ Repos      │  │  MQTT Broker │
              │                 │  └──────────────┘
              └─────────────────┘
```

### Message Pipeline

```
Request → Audit → Persistence → Post-Processing → Context-Injection → Agent-Execution → Response
```

All messages (web UI chat, Telegram, trigger-initiated chats) flow through the same MessageBus middleware pipeline.

---

## Quick Start

### Docker (Recommended)

```bash
git clone https://github.com/ownpilot/ownpilot.git
cd ownpilot

# Start OwnPilot + PostgreSQL (uses defaults, no .env needed)
docker compose --profile postgres up -d

# UI + API: http://localhost:8080
```

To customize settings (auth, Telegram, etc.), copy and edit `.env` before starting:

```bash
cp .env.example .env
# Edit .env — docker-compose.yml defaults match .env.example
docker compose --profile postgres up -d
```

### From Source

#### Prerequisites

- **Node.js** >= 22.0.0
- **pnpm** >= 10.0.0
- **PostgreSQL** 16+ (via Docker Compose or native install)

#### Automated Setup (Recommended)

Use the interactive setup wizard:

```bash
# Linux/macOS
./setup.sh

# Windows PowerShell
.\setup.ps1
```

The wizard will guide you through:

- Prerequisites check (Node.js, pnpm, Docker)
- Server configuration (ports, host)
- Authentication setup
- Database configuration
- Docker PostgreSQL startup
- Dependency installation and build

**Alternative: Non-interactive scripts**

```bash
# Linux/macOS
./scripts/setup.sh --minimal          # Skip Docker
./scripts/setup.sh --docker-only      # Only database

# Windows PowerShell
.\scripts\setup.ps1 -Mode Minimal
.\scripts\setup.ps1 -Mode DockerOnly
```

#### Manual Setup

```bash
# Clone and install
git clone https://github.com/ownpilot/ownpilot.git
cd ownpilot
pnpm install

# Configure
cp .env.example .env
# Edit .env if needed (defaults work with docker compose PostgreSQL)

# Start PostgreSQL (if you don't have one already)
docker compose --profile postgres up -d

# Start development (gateway on :8080 + Vite UI on :5173)
pnpm dev

# Open http://localhost:5173 (Vite proxies API/WS to gateway)
```

AI provider API keys are configured via the **Config Center UI** (Settings page) after setup.

### Configuration via CLI

```bash
# Initialize database
ownpilot setup

# Start server
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
│   ├── core/                    # AI engine & tool framework
│   │   ├── src/
│   │   │   ├── agent/           # Agent engine, orchestrator, providers
│   │   │   │   ├── providers/   # Multi-provider implementations
│   │   │   │   ├── orchestra/   # Multi-agent orchestration engine
│   │   │   │   └── tools/       # 190+ built-in tool definitions
│   │   │   ├── plugins/         # Plugin system with isolation, marketplace
│   │   │   ├── events/          # EventBus, HookBus, ScopedBus
│   │   │   ├── services/        # Service registry (DI container)
│   │   │   ├── memory/          # Encrypted personal memory (AES-256-GCM)
│   │   │   ├── sandbox/         # Code execution isolation (VM, Docker, Worker)
│   │   │   ├── crypto/          # Zero-dep encryption, vault, keychain
│   │   │   ├── audit/           # Tamper-evident hash chain logging
│   │   │   ├── privacy/         # PII detection & redaction
│   │   │   ├── security/        # Critical pattern blocking, permissions
│   │   │   ├── channels/        # Channel plugin architecture + UCP
│   │   │   ├── edge/            # Edge device types and interfaces
│   │   │   ├── assistant/       # Intent classifier, orchestrator
│   │   │   ├── workspace/       # Per-user isolated environments
│   │   │   └── types/           # Branded types, Result<T,E>, guards
│   │   └── package.json
│   │
│   ├── gateway/                 # Hono API server (~72K LOC)
│   │   ├── src/
│   │   │   ├── routes/          # 55+ route modules
│   │   │   ├── services/        # 60+ business logic services
│   │   │   ├── tools/           # Tool providers (coding, CLI, edge, browser, etc.)
│   │   │   ├── db/
│   │   │   │   ├── repositories/  # 45+ data access repositories
│   │   │   │   ├── adapters/      # PostgreSQL adapter
│   │   │   │   ├── migrations/    # Schema migrations
│   │   │   │   └── seeds/         # Default data
│   │   │   ├── channels/        # Telegram + WhatsApp channel plugins
│   │   │   ├── plugins/         # Plugin initialization & registration
│   │   │   ├── triggers/        # Proactive automation engine
│   │   │   ├── plans/           # Plan executor with step handlers
│   │   │   ├── autonomy/        # Risk assessment, approval manager, pulse
│   │   │   ├── ws/              # WebSocket server & real-time broadcasts
│   │   │   ├── middleware/      # Auth, rate limiting, CORS, audit
│   │   │   ├── assistant/       # AI orchestration (memories, goals)
│   │   │   ├── tracing/         # Request tracing (AsyncLocalStorage)
│   │   │   └── audit/           # Gateway audit logging
│   │   └── package.json
│   │
│   ├── ui/                      # React 19 web interface (~40K LOC)
│   │   ├── src/
│   │   │   ├── pages/           # 55+ page components
│   │   │   ├── components/      # 70+ reusable components
│   │   │   ├── hooks/           # Custom hooks (chat store, theme, WebSocket)
│   │   │   ├── api/             # Typed fetch wrapper + endpoint modules
│   │   │   ├── types/           # UI type definitions
│   │   │   └── App.tsx          # Route definitions with lazy loading
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
├── eslint.config.js             # ESLint 10 flat config
├── .env.example                 # Environment variable template
└── package.json                 # Monorepo root
```

---

## Packages

### Core (`@ownpilot/core`)

The foundational runtime library. Contains the AI engine, tool system, plugin architecture, security primitives, and cryptography. Minimal dependencies (only `googleapis` for Google OAuth).

**~62,000 LOC** across 160+ source files.

| Module             | Description                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `agent/`           | Agent engine with multi-provider support, orchestrator, tool-calling loop                        |
| `agent/orchestra/` | Multi-agent orchestration (fan-out, race, pipeline, voting strategies)                           |
| `agent/providers/` | Provider implementations (OpenAI, Anthropic, Google, Zhipu, OpenAI-compatible, 8 aggregators)    |
| `agent/tools/`     | 190+ built-in tool definitions across 32 tool files                                              |
| `plugins/`         | Plugin system with isolation, marketplace, signing, runtime                                      |
| `events/`          | 3-in-1 event system: EventBus (fire-and-forget), HookBus (interceptable), ScopedBus (namespaced) |
| `services/`        | Service registry (DI container) with typed tokens                                                |
| `memory/`          | AES-256-GCM encrypted personal memory with vector search and deduplication                       |
| `sandbox/`         | 5 sandbox implementations: VM, Docker, Worker threads, Local, Scoped APIs                        |
| `crypto/`          | PBKDF2, AES-256-GCM, RSA, SHA256 — zero dependency                                               |
| `audit/`           | Tamper-evident logging with hash chain verification                                              |
| `privacy/`         | PII detection (15+ categories) and redaction                                                     |
| `security/`        | Critical pattern blocking (100+ patterns), permission matrix                                     |
| `channels/`        | Channel plugin architecture, Universal Channel Protocol (UCP)                                    |
| `edge/`            | Edge device types (sensors, actuators, telemetry, commands)                                      |
| `types/`           | Result<T,E> pattern, branded types, error classes, type guards                                   |

### Gateway (`@ownpilot/gateway`)

The API server built on [Hono](https://hono.dev/). Handles HTTP/WebSocket communication, database operations, agent execution, MCP integration, plugin management, and channel connectivity.

**~76,000 LOC** across 210+ source files. **389 test files** with **16,400+ tests**.

**Route Modules (50+ top-level + 70+ sub-modules):**

| Category               | Routes                                                                                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Chat & Agents**      | `chat.ts`, `chat-history.ts`, `agents.ts`, `chat-streaming.ts`, `chat-persistence.ts`, `chat-state.ts`, `chat-prompt.ts`                                                          |
| **AI Configuration**   | `models.ts`, `providers.ts`, `model-configs.ts`, `local-providers.ts`, `model-routing.ts`                                                                                         |
| **Personal Data**      | `personal-data.ts`, `personal-data-tools.ts`, `memories.ts`, `goals.ts`, `expenses.ts`, `custom-data.ts`                                                                          |
| **Productivity**       | `productivity.ts` (Pomodoro, Habits, Captures)                                                                                                                                    |
| **Automation**         | `triggers.ts`, `heartbeats.ts`, `plans.ts`, `autonomy.ts`, `workflows.ts`, `workflow-copilot.ts`, `background-agents.ts`, `souls.ts`                                              |
| **Tools & Extensions** | `tools.ts`, `custom-tools.ts`, `plugins.ts`, `extensions.ts`, `skills.ts`, `mcp.ts`, `composio.ts`                                                                                |
| **Coding & CLI**       | `coding-agents.ts`, `cli-tools.ts`, `cli-providers.ts`                                                                                                                            |
| **Orchestration**      | `orchestra.ts`, `artifacts.ts`, `browser.ts`, `voice.ts`, `bridges.ts`                                                                                                            |
| **Edge / IoT**         | `edge.ts` (devices, commands, telemetry, MQTT status)                                                                                                                             |
| **Channels**           | `channels.ts`, `channel-auth.ts`, `webhooks.ts`                                                                                                                                   |
| **Configuration**      | `settings.ts`, `config-services.ts`, `ui-auth.ts`                                                                                                                                 |
| **System**             | `health.ts`, `dashboard.ts`, `costs.ts`, `audit.ts`, `debug.ts`, `database.ts`, `profile.ts`, `workspaces.ts`, `file-workspaces.ts`, `execution-permissions.ts`, `error-codes.ts` |

**Services (115+):** MessageBus, ConfigCenter, ToolExecutor, ProviderService, McpClientService, McpServerService, ExtensionService, ComposioService, EmbeddingService, HeartbeatService, AuditService, PluginService, MemoryService, GoalService, TriggerService, PlanService, WorkspaceService, DatabaseService, SessionService, LogService, ResourceService, LocalDiscovery, WorkflowService, AgentSkillsParser, CodingAgentService, CodingAgentSessions, CliToolService, CliToolsDiscovery, ModelRouting, ExecutionApproval, BackgroundAgentManager, BackgroundAgentRunner, ChannelVerificationService, OrchestraEngine, ArtifactService, ArtifactDataResolver, VoiceService, BrowserService, EdgeService, EdgeMqttClient, SubagentService, SubagentManager, SoulService, CrewService, AgentMessagesService, and more.

**Repositories (90+):** agents, conversations, messages, tasks, notes, bookmarks, calendar, contacts, memories, goals, triggers, plans, expenses, custom-data, custom-tools, plugins, channels, channel-messages, channel-users, channel-sessions, channel-verification, costs, settings, config-services, pomodoro, habits, captures, workspaces, model-configs, execution-permissions, logs, mcp-servers, extensions, local-providers, heartbeats, embedding-cache, workflows, autonomy-log, coding-agent-results, cli-providers, cli-tool-policies, background-agents, orchestra, artifacts, channel-bridges, browser-workflows, edge-devices, edge-commands, edge-telemetry, subagent-history, souls, crews, agent-messages.

### UI (`@ownpilot/ui`)

Modern web interface built with React 19, Vite 7, and Tailwind CSS 4. Minimal dependencies — no Redux/Zustand, no axios, no component library.

| Technology           | Version |
| -------------------- | ------- |
| React                | 19.2.4  |
| React Router DOM     | 7.1.3   |
| Vite                 | 7.3.1   |
| Tailwind CSS         | 4.2.0   |
| prism-react-renderer | 2.4.1   |

**Pages (57+):**

| Page                                                | Description                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Chat**                                            | Main AI conversation with streaming, tool execution display, context bar, approval dialogs |
| **Dashboard**                                       | Overview with stats, AI briefing, quick actions                                            |
| **Inbox**                                           | Read-only channel messages from Telegram and WhatsApp                                      |
| **History**                                         | Conversation history with search, archive, bulk operations                                 |
| **Tasks / Notes / Calendar / Contacts / Bookmarks** | Personal data management                                                                   |
| **Expenses**                                        | Financial tracking with categories                                                         |
| **Memories**                                        | AI long-term memory browser                                                                |
| **Goals**                                           | Goal tracking with progress and step management                                            |
| **Triggers / Plans / Autonomy / Workflows**         | Automation configuration                                                                   |
| **Coding Agents**                                   | External AI coding CLI sessions (Claude Code, Codex, Gemini CLI)                           |
| **Agents**                                          | Agent selection and configuration                                                          |
| **Tools / Custom Tools**                            | Tool browser and custom tool management                                                    |
| **User Extensions**                                 | Install and manage tool bundles with custom tools and configs                              |
| **Skills**                                          | Browse and install AgentSkills.io SKILL.md instruction packages                            |
| **MCP Servers**                                     | Manage external MCP server connections with preset quick-add                               |
| **Tool Groups**                                     | Configure tool group visibility and assignments                                            |
| **Connected Apps**                                  | Composio OAuth integrations (1000+ apps)                                                   |
| **Models / AI Models / Costs**                      | AI model browser, configuration, and usage tracking                                        |
| **Providers**                                       | Provider management and status                                                             |
| **Model Routing**                                   | Per-process model selection with fallback chains                                           |
| **Autonomous Hub**                                  | Unified command center for soul agents, background agents, crews, messaging, and activity  |
| **Background Agents**                               | Create, monitor, and manage persistent autonomous agents with cycle history                |
| **Event Monitor**                                   | Live EventBus event stream viewer for real-time debugging                                  |
| **Channels**                                        | Channel management with connect/disconnect/logout, user approval, QR code display          |
| **Plugins / Workspaces / Wizards**                  | Extension management, workspace management, guided setup wizards                           |
| **Artifacts**                                       | Versioned document viewer with ArtifactCard grid and ArtifactRenderer                      |
| **Edge Devices**                                    | IoT device management with sensor readings, actuator control, MQTT status                  |
| **Data Browser / Custom Data**                      | Universal data exploration and custom tables                                               |
| **Settings / Config Center / API Keys**             | Service configuration, API key management                                                  |
| **Coding Agent Settings / CLI Tools Settings**      | Coding agent provider config, CLI tool policy management                                   |
| **Security**                                        | UI authentication and password management                                                  |
| **System**                                          | Database backup/restore, sandbox status, theme, notifications                              |
| **Profile / Logs / About**                          | User profile, request logs, system info                                                    |

**Key Components (100+):** Layout, ChatInput, MessageList, ContextBar, ContextDetailModal, ToolExecutionDisplay, TraceDisplay, CodeBlock, MarkdownContent, ExecutionApprovalDialog, ExecutionSecurityPanel, SuggestionChips, MemoryCards, WorkspaceSelector, ToastProvider, ConfirmDialog, DynamicConfigForm, ErrorBoundary, SetupWizard, and more.

**State Management (Context + Hooks):**

- `useChatStore` — Global chat state with SSE streaming, tool progress, approval flow
- `useTheme` — Dark/light/system theme with localStorage persistence
- `useWebSocket` — WebSocket connection with auto-reconnect and event subscriptions

### CLI (`@ownpilot/cli`)

Command-line interface built with Commander.js and @inquirer/prompts.

```bash
ownpilot setup                    # Initialize database
ownpilot start                    # Start server + bot
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

**96 providers** with auto-synced model catalogs from [models.dev](https://models.dev). Key providers:

| Provider           | Integration Type         | Key Models                                                              |
| ------------------ | ------------------------ | ----------------------------------------------------------------------- |
| **OpenAI**         | Native                   | GPT-5.3 Codex, GPT-5.2, GPT-5.1, o4-mini, o3                            |
| **Anthropic**      | Native (prompt caching)  | Claude Sonnet 4.6, Claude Opus 4.6, Claude Sonnet 4.5, Claude Haiku 4.5 |
| **Google**         | Native                   | Gemini 3.1 Pro, Gemini 3 Flash, Gemini 2.5 Flash/Pro                    |
| **xAI**            | Native                   | Grok 4.1 Fast, Grok 4, Grok 3                                           |
| **DeepSeek**       | Native                   | DeepSeek Chat, DeepSeek Reasoner                                        |
| **Mistral**        | Native                   | Devstral 2, Mistral Medium 3.1, Mistral Large 3, Codestral              |
| **Zhipu AI**       | Native                   | GLM-5, GLM-4.7, GLM-4.6                                                 |
| **Cohere**         | Native                   | Command A, Command A Reasoning, Command R+                              |
| **Together AI**    | Aggregator               | Qwen3.5 397B, GLM-5, Kimi K2.5, DeepSeek V3.1                           |
| **Groq**           | Aggregator (LPU)         | Kimi K2, GPT OSS 120B, Llama 4 Scout, Qwen3 32B                         |
| **Fireworks AI**   | Aggregator               | MiniMax-M2.5, GLM 5, Kimi K2.5, DeepSeek V3.2                           |
| **DeepInfra**      | Aggregator               | Kimi K2.5, GLM-4.7, DeepSeek-V3.2, Qwen3 Coder                          |
| **OpenRouter**     | Aggregator (161+ models) | Unified API for all providers                                           |
| **Perplexity**     | Aggregator               | Sonar Deep Research, Sonar Pro, Sonar Reasoning Pro                     |
| **Cerebras**       | Aggregator (fastest)     | GLM-4.7, GPT OSS 120B, Qwen 3 235B                                      |
| **NVIDIA**         | Aggregator (65+ models)  | GLM5, Kimi K2.5, DeepSeek V3.2, Nemotron                                |
| **Amazon Bedrock** | Cloud (96+ models)       | Claude 4.6, DeepSeek-V3.2, Kimi K2.5, Nova Pro                          |
| **Azure**          | Cloud (85+ models)       | GPT-5.2, Claude 4.6, DeepSeek-V3.2, Grok 4                              |
| **GitHub Models**  | Cloud                    | GPT-4.1, DeepSeek-R1, Llama 4, Mistral                                  |
| **Hugging Face**   | Aggregator               | MiniMax-M2.5, GLM-5, Qwen3.5, DeepSeek-V3.2                             |
| **SiliconFlow**    | Aggregator (66+ models)  | GLM-5, Kimi K2.5, DeepSeek V3.2, Qwen3 VL                               |
| **Novita AI**      | Aggregator (80+ models)  | Qwen3.5, GLM-5, Kimi K2.5, ERNIE-4.5                                    |
| **Nebius**         | Aggregator (45+ models)  | DeepSeek-V3.2, GLM-4.7, Qwen3, FLUX                                     |
| **Ollama**         | Local                    | qwen3.5, minimax-m2.5, glm-5, kimi-k2.5                                 |
| **LM Studio**      | Local                    | GPT OSS 20B, Qwen3 30B, Qwen3 Coder 30B                                 |

Any OpenAI-compatible endpoint can be added as a custom provider.

### Provider Routing Strategies

| Strategy   | Description                                   |
| ---------- | --------------------------------------------- |
| `cheapest` | Minimize API costs                            |
| `fastest`  | Minimize latency                              |
| `smartest` | Best quality/reasoning                        |
| `balanced` | Cost + quality balance (default)              |
| `fallback` | Try providers sequentially until one succeeds |

### Token Efficiency

- **Anthropic Prompt Caching** — Static system prompt sections (persona, tools, capabilities) marked with `cache_control: { type: 'ephemeral' }`. Dynamic sections (current context, code execution) sent without caching. Reduces input token costs on multi-turn conversations.
- **Context Compaction** — When context grows large, old messages can be AI-summarized into a compact summary, preserving recent messages. Reduces token usage while maintaining conversation continuity.
- **Meta-tool Proxy** — Only 4 small tool definitions sent to the LLM instead of 190+ full schemas.

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

- **Tool Orchestration** — Automatic tool calling with multi-step planning via meta-tool proxy
- **Memory Injection** — Relevant memories automatically included in system prompt (vector + full-text hybrid search)
- **Goal Awareness** — Active goals and progress injected into context
- **Dynamic System Prompts** — Context-aware enhancement with memories, goals, available resources
- **Execution Context** — Code execution instructions injected into system prompt (not user message)
- **Context Tracking** — Real-time context bar showing token usage, fill percentage, and per-section breakdown
- **Streaming** — Real-time SSE responses with tool execution progress events

---

## Soul Agents

Soul agents are autonomous agents with rich identity, personality, and heartbeat-driven lifecycle. They combine the scheduling power of background agents with a full identity framework.

### Soul Configuration

```typescript
{
  agentId: string              // Unique agent ID
  identity: {
    name: string               // Display name
    emoji: string              // Agent emoji
    role: string               // Professional role
    personality: string        // Personality description
    voice: { tone, language }  // Communication style
    boundaries: string[]       // Behavioral constraints
  }
  purpose: {
    mission: string            // Core mission statement
    goals: string[]            // Active goals
    expertise: string[]        // Domain expertise
    toolPreferences: string[]  // Preferred tools
  }
  autonomy: {
    level: 1-4                 // Autonomy level
    allowedActions: string[]   // Permitted actions
    blockedActions: string[]   // Blocked actions
    requiresApproval: string[] // Actions needing user approval
    maxCostPerCycle: number    // Budget per heartbeat cycle
    maxCostPerDay: number      // Daily budget limit
    maxCostPerMonth: number    // Monthly budget limit
  }
  heartbeat: {
    enabled: boolean           // Enable scheduled execution
    interval: string           // Cron expression
    checklist: string[]        // Tasks to run each cycle
    selfHealingEnabled: boolean
    maxDurationMs: number      // Cycle timeout
  }
  relationships: {
    delegates: string[]        // Agents this soul can delegate to
    peers: string[]            // Peer agents
    channels: string[]         // Communication channels
  }
}
```

### Crews

Multi-agent crews coordinate soul agents for complex tasks:

- **Role Assignment** — Each crew member has a defined role within the crew
- **Delegation Protocol** — Automatic task delegation between crew members
- **Crew Templates** — Pre-built crew configurations for common multi-agent workflows

---

## Autonomous Hub

The Autonomous Hub is a unified command center for managing all autonomous agents from a single interface.

### Tabs

| Tab          | Description                                                                                |
| ------------ | ------------------------------------------------------------------------------------------ |
| **Agents**   | Grid of all agents (soul + background) with search, status/type filters, and quick actions |
| **Crews**    | Crew management with templates and member configuration                                    |
| **Messages** | Inter-agent communication panel with compose and message history                           |
| **Activity** | Unified timeline of heartbeat logs and agent messages with stats                           |

### AI Agent Creator

Describe what you want in plain English and the AI designs the agent configuration:

1. Open the AI Creator modal from the hub header
2. Describe your agent (e.g., "Monitor my GitHub PRs daily")
3. The AI designs a configuration with name, mission, schedule, tools, and cost estimate
4. Review the preview card and refine through conversation
5. Click "Create This Agent" to deploy

The creator uses a dedicated agent with a specialized system prompt, ensuring it acts as an agent designer rather than a general chatbot.

---

## Background Agents

Persistent autonomous agents that run independently from user chat sessions.

### Configuration

```typescript
{
  name: string               // Agent name
  mission: string            // What the agent should accomplish
  mode: 'interval' | 'continuous' | 'event'  // Scheduling mode
  intervalMs: number         // Cycle interval (for interval mode)
  provider?: string          // AI provider (optional, uses system default)
  model?: string             // AI model (optional, uses system default)
  allowedTools: string[]     // Tool whitelist (empty = all tools)
  autoStart: boolean         // Start on server boot
  limits: {
    maxTurnsPerCycle: number   // Max LLM round-trips per cycle
    maxToolCallsPerCycle: number // Max tool invocations per cycle
    maxCyclesPerHour: number   // Rate limit
    cycleTimeoutMs: number     // Per-cycle timeout
  }
}
```

### Lifecycle

| State     | Description                                                         |
| --------- | ------------------------------------------------------------------- |
| `running` | Agent is actively executing cycles                                  |
| `paused`  | Agent is paused, can be resumed                                     |
| `stopped` | Agent has been terminated                                           |
| `error`   | Agent encountered an error (auto-pauses after 5 consecutive errors) |

### Features

- **Full tool access** — Same 190+ tools as chat agents, plus extensions, plugins, and MCP tools
- **Memory injection** — Agent system prompt enhanced with relevant memories and active goals
- **Workspace isolation** — Each agent gets a dedicated file workspace
- **Stop conditions** — `MISSION_COMPLETE` sentinel or `max_cycles:N` to auto-stop
- **Budget tracking** — Auto-stop when budget exceeded
- **Session persistence** — State saved to DB every 30 seconds; auto-recovery on restart

---

## Subagents

Ephemeral child agents for parallel task delegation. Unlike background agents (which are persistent and cycle-based), subagents run once to completion and are discarded.

### How It Works

```
Parent Agent (chat or background agent)
  ├─ spawn_subagent("Research pricing")  →  SubagentRunner #1
  ├─ spawn_subagent("Analyze competitors") → SubagentRunner #2
  ├─ spawn_subagent("Draft summary")     →  SubagentRunner #3
  │
  ├─ check_subagent(#1) → running...
  ├─ get_subagent_result(#1) → "Pricing analysis: ..."
  └─ Synthesize final answer from all results
```

### LLM Tools

| Tool                  | Description                                      |
| --------------------- | ------------------------------------------------ |
| `spawn_subagent`      | Spawn an autonomous subagent for a specific task |
| `check_subagent`      | Check the status of a running subagent           |
| `get_subagent_result` | Get the final result of a completed subagent     |
| `cancel_subagent`     | Cancel a running subagent                        |
| `list_subagents`      | List all subagents in the current session        |

### Session Lifecycle

| State       | Description               |
| ----------- | ------------------------- |
| `pending`   | Created, waiting to start |
| `running`   | Actively executing        |
| `completed` | Finished successfully     |
| `failed`    | Encountered an error      |
| `cancelled` | Cancelled by parent       |
| `timeout`   | Exceeded time limit       |

### Budget & Limits

| Setting          | Default | Description                                 |
| ---------------- | ------- | ------------------------------------------- |
| `maxConcurrent`  | 5       | Max active subagents per parent             |
| `maxTotalSpawns` | 20      | Total spawn limit per session               |
| `maxTurns`       | 20      | Max LLM round-trips per subagent            |
| `maxToolCalls`   | 100     | Max tool invocations per subagent           |
| `timeoutMs`      | 120,000 | Per-subagent timeout (2 min)                |
| Nesting depth    | 2       | Subagents can spawn sub-subagents (1 level) |

---

## Tool System

### Overview

OwnPilot has **190+ tools** organized into **32 categories**. Rather than sending all tool definitions to the LLM (which would consume too many tokens), OwnPilot uses a **meta-tool proxy pattern**:

1. **`search_tools`** — Find tools by keyword with optional `include_params` for inline parameter schemas
2. **`get_tool_help`** — Get detailed help for a specific tool (supports batch lookup)
3. **`use_tool`** — Execute a tool with parameter validation and limit enforcement
4. **`batch_use_tool`** — Execute multiple tools in a single call

### Tool Categories

| Category             | Examples                                                                 |
| -------------------- | ------------------------------------------------------------------------ |
| **Tasks**            | add_task, list_tasks, complete_task, update_task, delete_task            |
| **Notes**            | add_note, list_notes, update_note, delete_note                           |
| **Calendar**         | add_calendar_event, list_calendar_events, delete_calendar_event          |
| **Contacts**         | add_contact, list_contacts, update_contact, delete_contact               |
| **Bookmarks**        | add_bookmark, list_bookmarks, delete_bookmark                            |
| **Custom Data**      | create_custom_table, add_custom_record, search_custom_records            |
| **File System**      | read_file, write_file, list_directory, search_files, copy_file           |
| **PDF**              | read_pdf, create_pdf, pdf_info                                           |
| **Code Execution**   | execute_javascript, execute_python, execute_shell, compile_code          |
| **Web & API**        | http_request, fetch_web_page, search_web                                 |
| **Email**            | send_email, list_emails, read_email, search_emails                       |
| **Image**            | analyze_image, resize_image                                              |
| **Audio**            | audio_info, translate_audio                                              |
| **Finance**          | add_expense, query_expenses, expense_summary                             |
| **Memory**           | remember, recall, forget, list_memories, memory_stats                    |
| **Goals**            | create_goal, list_goals, decompose_goal, get_next_actions, complete_step |
| **Git**              | git_status, git_log, git_diff, git_commit, git_branch                    |
| **Translation**      | translate_text, detect_language                                          |
| **Weather**          | get_weather, weather_forecast                                            |
| **Data Extraction**  | extract_structured_data, parse_document                                  |
| **Vector Search**    | semantic_search, index_documents                                         |
| **Scheduler**        | schedule_task, list_scheduled                                            |
| **Utilities (Math)** | calculate, statistics, convert_units                                     |
| **Utilities (Text)** | regex, word_count, text_transform                                        |
| **Utilities (Date)** | date_math, format_date, timezone_convert                                 |
| **Utilities (Data)** | json_query, csv_parse, data_transform                                    |
| **Utilities (Gen)**  | generate_uuid, hash_text, random_number                                  |
| **CLI Tools**        | run_cli_tool, list_cli_tools, install_cli_tool                           |
| **Coding Agents**    | run_coding_task, list_coding_agents, get_task_result                     |
| **Orchestra**        | create_orchestra, run_orchestra, get_orchestra_result                    |
| **Artifacts**        | create_artifact, update_artifact, list_artifacts, get_artifact           |
| **Browser**          | browser_navigate, browser_click, browser_type, browser_screenshot        |
| **Edge Devices**     | list_edge_devices, get_device_status, read_sensor, control_actuator      |
| **Dynamic Tools**    | create_tool, list_custom_tools, delete_custom_tool                       |

### Tool Namespaces

All tools use qualified names with dot-prefixed namespaces:

| Prefix          | Source                | Example                        |
| --------------- | --------------------- | ------------------------------ |
| `core.`         | Built-in tools        | `core.add_task`                |
| `custom.`       | User-created tools    | `custom.my_helper`             |
| `plugin.{id}.`  | Plugin tools          | `plugin.telegram.send_message` |
| `skill.{id}.`   | Extension/skill tools | `skill.web-scraper.scrape`     |
| `mcp.{server}.` | MCP server tools      | `mcp.filesystem.read_file`     |

The LLM can use base names (without prefix) for backward compatibility — the registry resolves them automatically.

### Tool Trust Levels

| Level          | Source               | Behavior                              |
| -------------- | -------------------- | ------------------------------------- |
| `trusted`      | Core tools           | Full access                           |
| `semi-trusted` | Plugin tools         | Require explicit permission           |
| `sandboxed`    | Custom/dynamic tools | Strict validation + sandbox execution |

### Custom Tools (LLM-Created)

The AI can create new tools at runtime:

1. LLM calls `create_tool` with name, description, parameters, and JavaScript code
2. Tool is validated, sandboxed, and stored in the database
3. Tool is available to all agents via `use_tool`
4. Tools can be enabled/disabled and have permission controls

---

## MCP Integration

OwnPilot supports the [Model Context Protocol](https://modelcontextprotocol.io/) in both directions:

### MCP Client (connect to external servers)

Connect to any MCP server to extend OwnPilot's capabilities:

```
Settings → MCP Servers → Add (or use Quick Add presets)
```

**Pre-configured presets:**

- **Filesystem** — Read, write, and manage local files
- **GitHub** — Manage repos, issues, PRs, and branches
- **Brave Search** — Web and local search
- **Fetch** — Extract content from web pages
- **Memory** — Persistent knowledge graph
- **Sequential Thinking** — Structured problem-solving

Tools from connected MCP servers appear in the AI's catalog with `mcp.{servername}.` prefix and are available via `search_tools` / `use_tool`.

### MCP Server (expose tools to external clients)

OwnPilot exposes its full tool registry as an MCP endpoint:

```
POST /mcp/serve   — Streamable HTTP transport
```

External MCP clients (Claude Desktop, other agents) can connect and use OwnPilot's 190+ tools.

---

## Artifacts

Versioned document management for AI-created content — markdown, code, JSON, HTML, CSV, SVG, and Mermaid diagrams.

### Features

- **Version Tracking** — Every update creates a new version with content diffs
- **Data Binding** — Expressions like `{{conversation.summary}}` that auto-resolve from context
- **Rendering Pipeline** — ArtifactRenderer component renders each content type natively (syntax highlighting for code, Mermaid→SVG for diagrams)
- **Dashboard Widget** — Recent artifacts shown on the Dashboard page

### LLM Tools

| Tool              | Description                     |
| ----------------- | ------------------------------- |
| `create_artifact` | Create a new versioned document |
| `update_artifact` | Update content (creates diff)   |
| `list_artifacts`  | List all artifacts              |
| `get_artifact`    | Get artifact with version info  |
| `delete_artifact` | Delete an artifact              |

---

## Voice Pipeline

Speech-to-text and text-to-speech integration for voice-powered AI interactions.

- **STT (Whisper)** — Transcribe audio files or microphone input via OpenAI Whisper API
- **TTS (OpenAI)** — Generate speech from AI responses with 6 voice options (alloy, echo, fable, onyx, nova, shimmer)
- **VoiceButton** — Microphone recording UI in the ChatInput component
- **VoicePlayButton** — Inline playback button on AI responses
- **Channel Support** — WhatsApp voice messages auto-transcribed via channel normalizer

---

## Browser Agent

Headless Chromium automation via Playwright for AI-driven web browsing and data extraction.

### LLM Tools

| Tool                 | Description                              |
| -------------------- | ---------------------------------------- |
| `browser_navigate`   | Navigate to a URL                        |
| `browser_click`      | Click an element by selector             |
| `browser_type`       | Type text into an input                  |
| `browser_screenshot` | Capture a screenshot of the current page |
| `browser_evaluate`   | Execute JavaScript in the page context   |
| `browser_extract`    | Extract structured content from the page |
| `browser_fill_form`  | Fill out a form with multiple fields     |

### Features

- **Workflow Persistence** — Browser workflows stored in DB for replay and audit
- **Session Management** — Isolated browser contexts per session
- **REST API** — Full CRUD at `/api/v1/browser` plus workflow execution

---

## Edge Devices

MQTT-based IoT/edge device management. OwnPilot acts as the brain; cheap edge hardware (ESP32, Raspberry Pi) acts as the hands.

### Architecture

```
Edge Device (ESP32/RPi/Arduino)
  │
  │ MQTT (lightweight pub/sub)
  │
  ├── ownpilot/{userId}/devices/{deviceId}/telemetry   → Server
  ├── ownpilot/{userId}/devices/{deviceId}/commands     ← Server
  └── ownpilot/{userId}/devices/{deviceId}/status       → Server (LWT)
  │
Mosquitto Broker ←→ OwnPilot Gateway (EdgeMqttClient)
```

### Device Types

| Type           | Hardware                  |
| -------------- | ------------------------- |
| `raspberry-pi` | Raspberry Pi (any model)  |
| `esp32`        | Espressif ESP32 boards    |
| `arduino`      | Arduino-compatible boards |
| `custom`       | Any custom hardware       |

### Sensor & Actuator Types

**Sensors:** temperature, humidity, motion, light, pressure, camera, door, custom
**Actuators:** relay, servo, LED, buzzer, display, motor, custom

### LLM Tools

| Tool                   | Description                               |
| ---------------------- | ----------------------------------------- |
| `list_edge_devices`    | List all registered IoT devices           |
| `get_device_status`    | Get device status, sensors, and actuators |
| `read_sensor`          | Read latest value from a sensor           |
| `send_device_command`  | Send a command to a device via MQTT       |
| `control_actuator`     | Set state on an actuator                  |
| `register_edge_device` | Register a new edge device                |

### REST API

10 endpoints at `/api/v1/edge` — device CRUD, commands, telemetry, MQTT status.

---

## Personal Data

### Entity Types

| Entity              | Key Features                                                                         |
| ------------------- | ------------------------------------------------------------------------------------ |
| **Tasks**           | Priority (1-5), due date, category, status (pending/in_progress/completed/cancelled) |
| **Notes**           | Title, content (markdown), tags, category                                            |
| **Bookmarks**       | URL, title, description, category, tags, favicon                                     |
| **Calendar Events** | Title, start/end time, location, attendees, RSVP status                              |
| **Contacts**        | Name, email, phone, address, organization, notes                                     |
| **Expenses**        | Amount, category, description, date, tags                                            |
| **Custom Data**     | User-defined tables with AI-determined schemas                                       |

### Memory System

Persistent long-term memory for the AI assistant with AES-256-GCM encryption:

| Memory Type    | Description                        |
| -------------- | ---------------------------------- |
| `fact`         | Factual information about the user |
| `preference`   | User preferences and settings      |
| `conversation` | Key conversation takeaways         |
| `context`      | Contextual information             |
| `task`         | Task-related memory                |
| `relationship` | People and contacts                |
| `temporal`     | Time-based reminders               |

Memories have **importance scoring**, are **automatically injected** into agent system prompts via hybrid search (vector + full-text + RRF ranking), support **deduplication** via content hash, and have optional **TTL expiration**.

### Goals System

Hierarchical goal tracking with decomposition:

- **Create goals** with title, description, due date
- **Decompose** into actionable steps (pending, in_progress, completed, skipped)
- **Track progress** (0-100%) with status (active/completed/abandoned)
- **Get next actions** — AI recommends what to do next
- **Complete steps** — Auto-update parent goal progress

---

## Autonomy & Automation

### Autonomy Levels

| Level | Name           | Description                                  |
| ----- | -------------- | -------------------------------------------- |
| 0     | **Manual**     | Always ask before any action                 |
| 1     | **Assisted**   | Suggest actions, wait for approval (default) |
| 2     | **Supervised** | Auto-execute low-risk, ask for high-risk     |
| 3     | **Autonomous** | Execute all actions, notify user             |
| 4     | **Full**       | Fully autonomous, minimal notifications      |

### Triggers

Proactive automation with 4 trigger types:

| Type        | Description            | Example                                    |
| ----------- | ---------------------- | ------------------------------------------ |
| `schedule`  | Cron-based timing      | "Every Monday at 9am, summarize my week"   |
| `event`     | Fired on data changes  | "When a new task is added, notify me"      |
| `condition` | IF-THEN rules          | "If expenses > $500/day, alert me"         |
| `webhook`   | External HTTP triggers | "When GitHub webhook fires, create a task" |

### Heartbeats

Natural language periodic scheduling:

```
"every weekday at 9am" → 0 9 * * 1-5
"twice a day"          → 0 9,18 * * *
"every 30 minutes"     → */30 * * * *
```

The AI parses natural language into cron expressions for trigger scheduling.

### Plans

Multi-step autonomous execution:

- **Step types**: tool, parallel, loop, conditional, wait, pause
- **Status tracking**: draft, running, paused, completed, failed, cancelled
- **Timeout and retry** logic with configurable backoff
- **Step dependencies** for execution ordering

### Workflows

Visual multi-step automation with a workflow editor:

- **Drag-and-drop** workflow builder in the web UI
- **Step types**: prompt, tool, conditional, loop
- **Workflow Copilot** — AI-assisted workflow creation and editing
- **Execution logs** with per-step status tracking

---

## Database

PostgreSQL with 85+ repositories via the `pg` adapter.

### Key Tables

**Core:** `conversations`, `messages`, `agents`, `settings`, `costs`, `request_logs`

**Personal Data:** `tasks`, `notes`, `bookmarks`, `calendar_events`, `contacts`, `expenses`

**Productivity:** `pomodoro_sessions`, `habits`, `captures`

**Autonomous AI:** `memories`, `goals`, `triggers`, `plans`, `heartbeats`, `workflows`, `autonomy_log`, `background_agents`, `background_agent_sessions`, `background_agent_history`, `souls`, `crews`, `agent_messages`

**Channels:** `channel_messages`, `channel_users`, `channel_sessions`, `channel_verification`

**Extensions:** `plugins`, `custom_tools`, `user_extensions`, `mcp_servers`, `embedding_cache`

**Coding & CLI:** `coding_agent_results`, `cli_providers`, `cli_tool_policies`

**System:** `custom_data_tables`, `config_services`, `execution_permissions`, `workspaces`, `model_configs`, `local_providers`

### Migration

Schema migrations are auto-applied on startup via `autoMigrateIfNeeded()`. Migration files are in `packages/gateway/src/db/migrations/`.

### Backup & Restore

```
System → Database → Backup / Restore
```

Full PostgreSQL backup and restore through the web UI or API.

---

## Security & Privacy

### 4-Layer Security Model

| Layer                 | Purpose                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Critical Patterns** | 100+ regex patterns unconditionally blocked (rm -rf /, fork bombs, registry deletion, etc.)                                     |
| **Permission Matrix** | Per-category modes: blocked, prompt, allowed (execute_javascript, execute_python, execute_shell, compile_code, package_manager) |
| **Approval Callback** | Real-time user approval for sensitive operations via SSE (2-minute timeout)                                                     |
| **Sandbox Isolation** | VM, Docker, Worker threads, or Local execution with resource limits                                                             |

### Credential Management

API keys and settings are stored in the PostgreSQL database via the Config Center system. The web UI settings page and `ownpilot config` CLI both write to the same database.

Keys are loaded into `process.env` at server startup for provider SDK compatibility.

### PII Detection

- 15+ detection categories: SSN, credit cards, emails, phone numbers, IP addresses, passport, etc.
- Configurable redaction modes: mask, label, remove
- Severity-based filtering

### Code Execution

OwnPilot can execute code on behalf of the AI through 5 execution tools:

| Tool                 | Description                            |
| -------------------- | -------------------------------------- |
| `execute_javascript` | Run JavaScript/TypeScript via Node.js  |
| `execute_python`     | Run Python scripts                     |
| `execute_shell`      | Run shell commands (bash/PowerShell)   |
| `compile_code`       | Compile and run C, C++, Rust, Go, Java |
| `package_manager`    | Install packages via npm/pip           |

#### Execution Modes

| Mode       | Behavior                                                                              |
| ---------- | ------------------------------------------------------------------------------------- |
| **docker** | All code runs inside isolated Docker containers (most secure)                         |
| **local**  | Code runs directly on the host machine (requires approval for non-allowed categories) |
| **auto**   | Tries Docker first, falls back to local if Docker is unavailable                      |

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

| Permission | Behavior                                                         |
| ---------- | ---------------------------------------------------------------- |
| `blocked`  | Execution is denied                                              |
| `prompt`   | User must approve via real-time dialog before execution proceeds |
| `allowed`  | Execution proceeds without approval                              |

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

| Mode        | Description                                                |
| ----------- | ---------------------------------------------------------- |
| **None**    | No authentication (default, development only)              |
| **API Key** | Bearer token or `X-API-Key` header, timing-safe comparison |
| **JWT**     | HS256/HS384/HS512 via `jose`, requires `sub` claim         |

### Rate Limiting

Sliding window algorithm with configurable window (default 60s), max requests (default 500), and burst limit (default 750). Per-IP tracking with `X-RateLimit-*` response headers.

---

## API Reference

### Chat

| Method   | Endpoint                            | Description                                 |
| -------- | ----------------------------------- | ------------------------------------------- |
| `POST`   | `/api/v1/chat`                      | Send message (supports SSE streaming)       |
| `POST`   | `/api/v1/chat/reset-context`        | Reset conversation context                  |
| `GET`    | `/api/v1/chat/context-detail`       | Get detailed context token breakdown        |
| `POST`   | `/api/v1/chat/compact`              | Compact context by summarizing old messages |
| `GET`    | `/api/v1/chat/history`              | List conversations                          |
| `GET`    | `/api/v1/chat/history/:id`          | Get conversation with messages              |
| `DELETE` | `/api/v1/chat/history/:id`          | Delete conversation                         |
| `PATCH`  | `/api/v1/chat/history/:id/archive`  | Archive/unarchive conversation              |
| `POST`   | `/api/v1/chat/history/bulk-delete`  | Bulk delete conversations                   |
| `POST`   | `/api/v1/chat/history/bulk-archive` | Bulk archive conversations                  |

### Agents

| Method   | Endpoint                  | Description                    |
| -------- | ------------------------- | ------------------------------ |
| `GET`    | `/api/v1/agents`          | List all agents                |
| `POST`   | `/api/v1/agents`          | Create new agent               |
| `GET`    | `/api/v1/agents/:id`      | Get agent details              |
| `PUT`    | `/api/v1/agents/:id`      | Update agent                   |
| `DELETE` | `/api/v1/agents/:id`      | Delete agent                   |
| `POST`   | `/api/v1/agents/:id/chat` | Send message to specific agent |

### AI Configuration

| Method | Endpoint                  | Description                                |
| ------ | ------------------------- | ------------------------------------------ |
| `GET`  | `/api/v1/models`          | List available models across all providers |
| `GET`  | `/api/v1/providers`       | List providers with status                 |
| `GET`  | `/api/v1/model-configs`   | List model configurations                  |
| `GET`  | `/api/v1/local-providers` | List discovered local providers            |
| `GET`  | `/api/v1/tools`           | List all registered tools                  |
| `GET`  | `/api/v1/costs`           | Cost tracking and usage stats              |

### Personal Data

| Method     | Endpoint              | Description             |
| ---------- | --------------------- | ----------------------- |
| `GET/POST` | `/api/v1/tasks`       | Tasks CRUD              |
| `GET/POST` | `/api/v1/notes`       | Notes CRUD              |
| `GET/POST` | `/api/v1/bookmarks`   | Bookmarks CRUD          |
| `GET/POST` | `/api/v1/calendar`    | Calendar events CRUD    |
| `GET/POST` | `/api/v1/contacts`    | Contacts CRUD           |
| `GET/POST` | `/api/v1/expenses`    | Expenses CRUD           |
| `GET/POST` | `/api/v1/memories`    | Memories CRUD           |
| `GET/POST` | `/api/v1/goals`       | Goals CRUD              |
| `GET/POST` | `/api/v1/custom-data` | Custom data tables CRUD |

### Automation

| Method     | Endpoint             | Description          |
| ---------- | -------------------- | -------------------- |
| `GET/POST` | `/api/v1/triggers`   | Trigger management   |
| `GET/POST` | `/api/v1/heartbeats` | Heartbeat scheduling |
| `GET/POST` | `/api/v1/plans`      | Plan management      |
| `GET/POST` | `/api/v1/workflows`  | Workflow management  |
| `GET/PUT`  | `/api/v1/autonomy`   | Autonomy settings    |

### Extensions

| Method     | Endpoint               | Description                           |
| ---------- | ---------------------- | ------------------------------------- |
| `GET/POST` | `/api/v1/mcp`          | MCP server management                 |
| `POST`     | `/mcp/serve`           | MCP server endpoint (Streamable HTTP) |
| `GET/POST` | `/api/v1/extensions`   | User extension and skill management   |
| `GET/POST` | `/api/v1/plugins`      | Plugin management                     |
| `GET/POST` | `/api/v1/custom-tools` | Custom tool management                |
| `GET/POST` | `/api/v1/composio`     | Connected apps (Composio)             |

### Coding Agents

| Method   | Endpoint                             | Description                      |
| -------- | ------------------------------------ | -------------------------------- |
| `GET`    | `/api/v1/coding-agents/providers`    | List available coding agent CLIs |
| `POST`   | `/api/v1/coding-agents/execute`      | Execute a coding agent task      |
| `GET`    | `/api/v1/coding-agents/sessions`     | List active sessions             |
| `DELETE` | `/api/v1/coding-agents/sessions/:id` | Stop a running session           |
| `GET`    | `/api/v1/coding-agents/results`      | List past execution results      |

### Soul Agents

| Method   | Endpoint                             | Description                        |
| -------- | ------------------------------------ | ---------------------------------- |
| `GET`    | `/api/v1/souls`                      | List all soul agents               |
| `POST`   | `/api/v1/souls`                      | Create a new soul agent            |
| `GET`    | `/api/v1/souls/:id`                  | Get soul agent details             |
| `PUT`    | `/api/v1/souls/:id`                  | Update soul agent config           |
| `DELETE` | `/api/v1/souls/:id`                  | Delete soul agent                  |
| `GET`    | `/api/v1/souls/crews`                | List all crews                     |
| `GET`    | `/api/v1/souls/crews/templates`      | List crew templates                |
| `GET`    | `/api/v1/souls/heartbeat-logs`       | Paginated heartbeat execution logs |
| `GET`    | `/api/v1/souls/heartbeat-logs/stats` | Heartbeat statistics               |
| `GET`    | `/api/v1/souls/messages`             | List inter-agent messages          |
| `POST`   | `/api/v1/souls/messages`             | Send a message between agents      |

### Background Agents

| Method   | Endpoint                                | Description                   |
| -------- | --------------------------------------- | ----------------------------- |
| `GET`    | `/api/v1/background-agents`             | List all background agents    |
| `POST`   | `/api/v1/background-agents`             | Create a new background agent |
| `GET`    | `/api/v1/background-agents/:id`         | Get agent details + session   |
| `PATCH`  | `/api/v1/background-agents/:id`         | Update agent config           |
| `DELETE` | `/api/v1/background-agents/:id`         | Delete agent                  |
| `POST`   | `/api/v1/background-agents/:id/start`   | Start agent                   |
| `POST`   | `/api/v1/background-agents/:id/pause`   | Pause agent                   |
| `POST`   | `/api/v1/background-agents/:id/resume`  | Resume paused agent           |
| `POST`   | `/api/v1/background-agents/:id/stop`    | Stop agent                    |
| `GET`    | `/api/v1/background-agents/:id/history` | Paginated cycle history       |
| `POST`   | `/api/v1/background-agents/:id/message` | Send message to agent inbox   |

### Subagents

| Method   | Endpoint                    | Description                 |
| -------- | --------------------------- | --------------------------- |
| `GET`    | `/api/v1/subagents`         | List active subagents       |
| `POST`   | `/api/v1/subagents`         | Spawn a new subagent        |
| `GET`    | `/api/v1/subagents/:id`     | Get subagent session/result |
| `DELETE` | `/api/v1/subagents/:id`     | Cancel a running subagent   |
| `GET`    | `/api/v1/subagents/history` | Paginated execution history |

### CLI Tools

| Method   | Endpoint                         | Description                    |
| -------- | -------------------------------- | ------------------------------ |
| `GET`    | `/api/v1/cli-tools`              | Discover installed CLI tools   |
| `GET`    | `/api/v1/cli-tools/policies`     | Get per-tool security policies |
| `PUT`    | `/api/v1/cli-tools/policies`     | Update tool policies (batch)   |
| `POST`   | `/api/v1/cli-tools/execute`      | Execute a CLI tool             |
| `POST`   | `/api/v1/cli-tools/custom`       | Register a custom CLI tool     |
| `DELETE` | `/api/v1/cli-tools/custom/:name` | Remove a custom CLI tool       |

### CLI Providers

| Method   | Endpoint                    | Description                 |
| -------- | --------------------------- | --------------------------- |
| `GET`    | `/api/v1/cli-providers`     | List coding agent providers |
| `POST`   | `/api/v1/cli-providers`     | Register a custom provider  |
| `PUT`    | `/api/v1/cli-providers/:id` | Update provider config      |
| `DELETE` | `/api/v1/cli-providers/:id` | Remove a custom provider    |

### Model Routing

| Method | Endpoint                        | Description                       |
| ------ | ------------------------------- | --------------------------------- |
| `GET`  | `/api/v1/model-routing`         | Get model routing configuration   |
| `PUT`  | `/api/v1/model-routing`         | Update model routing rules        |
| `GET`  | `/api/v1/model-routing/resolve` | Resolve model for a given process |

### System

| Method     | Endpoint                        | Description                |
| ---------- | ------------------------------- | -------------------------- |
| `GET`      | `/health`                       | Health check               |
| `GET`      | `/api/v1/dashboard`             | Dashboard data             |
| `GET`      | `/api/v1/audit/logs`            | Audit trail                |
| `GET/POST` | `/api/v1/database`              | Database backup/restore    |
| `GET/PUT`  | `/api/v1/settings`              | System settings            |
| `GET/PUT`  | `/api/v1/config-services`       | Config Center entries      |
| `GET/PUT`  | `/api/v1/execution-permissions` | Code execution permissions |

### WebSocket Events

Real-time broadcasts via WebSocket at `ws://localhost:8080/ws` (attached to the HTTP server, same port):

| Event                     | Description                                      |
| ------------------------- | ------------------------------------------------ |
| `data:changed`            | CRUD mutation on any entity (tasks, notes, etc.) |
| `chat:stream:*`           | Streaming response chunks                        |
| `tool:start/progress/end` | Tool execution lifecycle                         |
| `channel:message`         | Incoming channel message (Telegram, WhatsApp)    |
| `channel:status`          | Channel connection/disconnection status change   |
| `channel:user:*`          | User events (first_seen, pending, blocked, etc.) |
| `trigger:executed`        | Trigger execution result                         |
| `coding-agent:session:*`  | Coding agent session lifecycle and output        |
| `bg-agent:*`              | Background agent lifecycle and cycle results     |
| `subagent:*`              | Subagent spawned, progress, and completion       |
| `pulse:activity`          | Pulse system proactive activity                  |

### Response Format

All API responses use a standardized envelope:

```json
{
  "success": true,
  "data": {},
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
HOST=127.0.0.1
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
POSTGRES_PASSWORD=ownpilot_secret     # Change in production
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

### Ports & Services

| Service        | Port    | Protocol | Description                                  |
| -------------- | ------- | -------- | -------------------------------------------- |
| **Gateway**    | `8080`  | HTTP     | REST API + bundled UI (Vite static assets)   |
| **WebSocket**  | `8080`  | WS       | Real-time events at `/ws` (shares HTTP port) |
| **PostgreSQL** | `25432` | TCP      | Database (mapped from container's `5432`)    |
| **MQTT**       | `1883`  | TCP      | Mosquitto broker (optional, for edge/IoT)    |
| **MQTT WS**    | `9001`  | WS       | MQTT WebSocket transport (optional)          |

> **Note:** In production (Docker), a single port `8080` serves everything — REST API, WebSocket, and the pre-built UI. No separate frontend deployment needed.

### Docker Compose

```bash
cp .env.example .env
# Edit .env with your settings

# Start OwnPilot + PostgreSQL
docker compose --profile postgres up -d

# With MQTT broker for edge/IoT devices
docker compose --profile postgres --profile mqtt up -d
```

Open **http://localhost:8080** — the gateway serves the bundled React UI, REST API, and WebSocket on the same port.

### Pre-built Image

A multi-arch image (amd64 + arm64) is published to GitHub Container Registry on every release:

```bash
docker pull ghcr.io/ownpilot/ownpilot:latest

docker run -d \
  --name ownpilot \
  -p 8080:8080 \
  -e DATABASE_URL=postgresql://user:pass@host:5432/ownpilot \
  -e NODE_ENV=production \
  ghcr.io/ownpilot/ownpilot:latest
```

Health check: `GET http://localhost:8080/health`

### Development Mode

In development, Vite runs a separate dev server with hot reload:

| Service             | Port    | Description                                             |
| ------------------- | ------- | ------------------------------------------------------- |
| **Vite Dev Server** | `5173`  | React UI with HMR (proxies `/api` and `/ws` to gateway) |
| **Gateway**         | `8080`  | REST API + WebSocket                                    |
| **PostgreSQL**      | `25432` | Database                                                |

```bash
pnpm dev     # Starts gateway (8080) + Vite UI (5173)
```

Open **http://localhost:5173** for development. Vite automatically proxies API calls (`/api/*`) and WebSocket (`/ws`) to the gateway on port 8080.

### Manual Production

```bash
pnpm build        # Build all packages (includes UI static assets)
ownpilot start    # Start production server on port 8080
```

---

## Development

### Scripts

```bash
# Setup wizard (interactive)
./setup.sh              # Linux/macOS
.\setup.ps1             # Windows PowerShell

# Start scripts
./start.sh              # Linux/macOS
.\start.ps1             # Windows PowerShell

# Start options:
#   --dev      Development mode with hot reload (default)
#   --prod     Production mode (build & serve)
#   --docker   Start with Docker Compose
#   --no-ui    Gateway only, without UI

# Package scripts
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

| Layer          | Technology                                    |
| -------------- | --------------------------------------------- |
| **Monorepo**   | pnpm 10+ workspaces + Turborepo 2.x           |
| **Language**   | TypeScript 5.9 (strict, ES2023, NodeNext)     |
| **Runtime**    | Node.js 22+                                   |
| **API Server** | Hono 4.12                                     |
| **Web UI**     | React 19 + Vite 7 + Tailwind CSS 4            |
| **Database**   | PostgreSQL (with pgvector)                    |
| **Telegram**   | Grammy 1.41                                   |
| **CLI**        | Commander.js 14                               |
| **MCP**        | @modelcontextprotocol/sdk                     |
| **Testing**    | Vitest 4.x (545+ test files, 26,500+ tests)   |
| **Linting**    | ESLint 10 (flat config)                       |
| **Formatting** | Prettier 3.8                                  |
| **Container**  | Docker multi-arch (ghcr.io/ownpilot/ownpilot) |
| **Git Hooks**  | Husky (pre-commit: lint + typecheck)          |
| **CI**         | GitHub Actions (Node 22, Ubuntu)              |

### Architecture Patterns

| Pattern                  | Usage                                                             |
| ------------------------ | ----------------------------------------------------------------- |
| **Result<T, E>**         | Functional error handling throughout core                         |
| **Branded Types**        | Compile-time distinct types (UserId, SessionId, PluginId)         |
| **Service Registry**     | Typed DI container for runtime service composition                |
| **Middleware Pipeline**  | Tools, MessageBus, providers all use middleware chains            |
| **Builder Pattern**      | Plugin and Channel construction                                   |
| **EventBus + HookBus**   | Event-driven state + interceptable hooks                          |
| **Repository**           | Data access abstraction with BaseRepository                       |
| **Meta-tool Proxy**      | Token-efficient tool discovery and execution                      |
| **Tool Namespaces**      | Qualified names (`core.`, `mcp.`, `plugin.`, `custom.`, `skill.`) |
| **Context + Hooks**      | React state management (no Redux/Zustand)                         |
| **WebSocket Broadcasts** | Real-time data synchronization across all mutation endpoints      |

---

## License

MIT
