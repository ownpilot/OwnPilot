# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.4] - 2026-02-28

### Added

- **Background Agents** — Persistent autonomous agents that run independently on interval, continuous, or event-driven schedules with rate limiting, budget tracking, auto-pause on errors, and graceful shutdown
- **Background Agent Full Tool Access** — Background agents now have the same capabilities as chat agents: all 170+ tools, extension/skill tools, plugin tools, MCP tools, memory injection, and configurable provider/model selection
- **Background Agent Workspace Isolation** — Each background agent gets an isolated file workspace for safe file operations
- **WhatsApp Baileys Integration** — Replaced Meta Cloud API with Baileys library for WhatsApp; QR code authentication (no Meta Business account needed), self-chat mode with loop prevention, session persistence in app data directory
- **Channel User Approval System** — Multi-step verification for channel users: approval code flow, manual admin approval, user blocking/unblocking with real-time notifications
- **EventBus Deep Integration** — Unified event backbone across the entire system; EventBusBridge translates dot-notation events to WebSocket colon-notation for real-time UI updates
- **Event Monitor UI** — Live event stream viewer for debugging EventBus events in the web UI
- **Extension SDK** — Extensions can call any of 150+ built-in tools via `utils.callTool()`, with `utils.listTools()`, Config Center access, and blocked tool enforcement
- **6 Default Extensions** — Daily Briefing, Knowledge Base, Project Tracker, Smart Search, Automation Builder, Contact Enricher bundled out-of-the-box
- **Extension Security Audit** — LLM-powered security analysis for skills and extensions before installation
- **Selective Extension Injection** — Request-preprocessor routing for targeted extension injection per conversation
- **Channel Soft Disconnect / Hard Logout** — `disconnect()` preserves session for instant reconnect; `logout()` clears session data requiring re-authentication (e.g. new QR scan)
- **Workflow Enhancements** — 7 new node types, input_schema column, workflow versioning and approvals

### Changed

- Extension tools synced into shared ToolRegistry with `ext.*`/`skill.*` namespace prefixes
- Channel user events (`first_seen`, `blocked`, `unblocked`, `pending`) emitted via EventBus with complete WS forwarding
- Channels reduced to Telegram + WhatsApp (Discord/Slack/LINE/Matrix removed)

### Fixed

- **Scheduler Day Boundary** — `getNextRunTime` test failed on month-end dates (e.g. Feb 28 → Mar 1) due to incorrect rollover arithmetic
- **Vitest Constructor Mocks** — Fixed test stability issues with constructor mocking patterns across gateway tests
- **Test Helpers Build Error** — Added explicit return types to test-helpers to fix TS2742 build error

### Testing

- 366+ test files, 21,500+ tests total
- New: background-agent-manager, background-agent-runner, background-agent-tools, service-impl logout tests

## [0.1.3] - 2026-02-26

### Added

- **Model Routing** — Per-process model selection (chat, telegram, pulse) with provider fallback chains, configurable via API and UI
- **Extended Thinking** — Anthropic extended thinking support with configurable budget tokens for deeper reasoning
- **Sidebar Reorganization** — Navigation menus reordered by usage frequency: daily items at top, power-user features in collapsible groups, settings ordered by domain

### Fixed

- **Telegram FK Constraint** — Second message after server restart failed with `channel_sessions_conversation_id_fkey` violation; conversation recovery now persists to DB before updating FK (fixes #7)
- **Dashboard Streaming** — Null model parameter caused TypeScript build failures in `generateAIBriefingStreaming`
- **Expenses Page** — Feb-31 date bug when filtering by month; added edit support with modal form
- **SystemPage Polling** — Database operation status polling leaked timers on unmount; added ref-based cleanup
- **ApiKeysPage** — Default model save silently swallowed errors; now shows toast feedback
- **AutonomyPage** — `Promise.all` → `Promise.allSettled` so partial API failures don't blank the page
- **ModelsPage** — Settings link pointed to `/settings` instead of `/settings/api-keys`
- **WorkspacesPage** — Empty workspace badge showed for workspaces with 1 file (should be 0)
- **CalendarPage** — No validation when end date/time was before start
- **TasksPage** — Missing `cancelled` status in filter and visual styling
- **SKILL.md Parser** — Improved YAML metadata parsing for block sequences and nested maps

### Changed

- Config Center: removed 5 orphaned seed services (Deepgram, DeepL, Tavily, Serper, Perplexity) with no built-in consumer code
- Gateway routes: `parseJsonBody` helper adopted across all route modules
- Dev dependencies bumped: ESLint 10.0.2, Turbo 2.8.11, typescript-eslint 8.56.1
- `.gitignore`: broader protection patterns for stray generated files

## [0.1.2] - 2026-02-26

### Added

- **CLI Tools Platform** — 40+ discoverable CLI tools with automatic PATH-based binary detection, categorization (linters, formatters, build tools, package managers, security scanners, databases, containers), and version detection
- **Per-Tool Security Policies** — `allowed` (auto-execute), `prompt` (require approval), `blocked` (reject) per user per tool, with batch policy updates via API
- **Dynamic Risk Scoring** — Catalog-based risk levels (low/medium/high/critical) feed into the autonomy risk engine, overriding generic tool risk scores
- **Custom CLI Tool Registration** — Register any binary as a CLI tool with category and risk metadata via `POST /cli-tools/custom`
- **CLI Policy Approval Integration** — Per-tool policies wired into the real-time approval flow in the orchestrator, dynamic risk scoring based on catalog risk levels
- **Coding Agents** — Orchestrate external AI coding CLIs (Claude Code, Codex, Gemini CLI) with session management, real-time terminal output streaming, and result persistence
- **Dual Execution Modes** — Auto mode (headless `child_process.spawn`) and interactive mode (PTY terminal) for coding agents
- **Custom Coding Agent Providers** — Register any CLI binary as a coding agent provider via the CLI Providers API
- **Model Routing** — Per-process model selection (chat, telegram, pulse) with fallback chains, configurable via API and UI
- **Extended Thinking** — Anthropic extended thinking support for deeper reasoning in complex tasks

### Changed

- Gateway route modules: 40 → 43 top-level (added `coding-agents.ts`, `cli-tools.ts`, `cli-providers.ts`, `model-routing.ts`)
- Repositories: 37 → 41 (added `coding-agent-results`, `cli-providers`, `cli-tool-policies`, `autonomy-log`)
- UI pages: 41 → 47 (added CodingAgentsPage, CodingAgentSettingsPage, CliToolsSettingsPage, ModelRoutingPage, SecurityPage, AboutPage)
- WebSocket events: added `coding-agent:session:*` for coding agent lifecycle

### Testing

- 315+ test files, 19,200+ tests total
- New: coding-agent-service, coding-agent-sessions, cli-providers, cli-tool-policies, coding-agent-results repository tests

## [0.1.1] - 2026-02-23

### Added

- **Pulse System** — Autonomous AI-driven engine that proactively gathers context, evaluates signals, invokes the LLM, executes actions, and reports results on an adaptive timer (5–15 min)
- **Pulse Directives** — Configurable evaluation rules, action cooldowns, blocked actions, custom instructions, and 4 preset templates (Balanced, Conservative, Proactive, Minimal)
- **Pulse Execution Lock** — Prevents concurrent pulse execution; manual and auto pulses share the same lock
- **Pulse Activity Broadcasting** — Real-time WebSocket `pulse:activity` events with stage progression (starting → gathering → evaluating → deciding → executing → reporting → done)
- **Pulse Activity Monitor (UI)** — Live activity banner with stage name and elapsed time, "Run Now" button disables during pulse, 409 toast on concurrent attempts
- **Pulse History & Stats** — Paginated pulse log with signal IDs, urgency scores, action results, and expandable details
- **Pulse Route Guard** — `POST /pulse/run` returns 409 `ALREADY_RUNNING` when a pulse is in progress

### Changed

- `AutonomyEngine.getStatus()` now includes `activePulse` field (null when idle)
- Broadcaster in `server.ts` routes `pulse:activity` events separately from `system:notification`

### Testing

- 315 test files, 19,100+ tests total
- New: 5 engine execution lock tests + 2 route guard tests

## [0.1.0] - 2026-02-22

Initial release of OwnPilot.

### Added

- **Multi-Provider AI** — 4 native providers (OpenAI, Anthropic, Google, Zhipu) + 8 aggregators (Together AI, Groq, Fireworks, DeepInfra, OpenRouter, Perplexity, Cerebras, fal.ai) + any OpenAI-compatible endpoint
- **Local AI Support** — Auto-discovery for Ollama, LM Studio, LocalAI, and vLLM
- **Smart Provider Routing** — Cheapest, fastest, smartest, balanced, and fallback strategies
- **Anthropic Prompt Caching** — Static system prompt caching to reduce input token costs
- **Context Management** — Real-time token tracking, detail breakdown, and AI-powered context compaction
- **170+ Built-in Tools** across 28 categories (personal data, files, code execution, web, email, media, git, translation, weather, finance, automation, vector search, data extraction, utilities)
- **Meta-tool Proxy** — Only 4 meta-tools sent to the LLM; all tools available via dynamic discovery
- **Tool Namespaces** — Qualified tool names (`core.`, `custom.`, `plugin.`, `skill.`, `mcp.`)
- **MCP Integration** — Client (connect to external MCP servers) and Server (expose tools to MCP clients)
- **User Extensions** — Installable tool bundles with custom tools, triggers, services, and configs
- **Skills** — Open standard SKILL.md format (AgentSkills.io) for instruction-based AI knowledge packages
- **Custom Tools** — Create new tools at runtime via LLM (sandboxed JavaScript)
- **Connected Apps** — 1000+ OAuth integrations via Composio
- **Personal Data** — Notes, Tasks, Bookmarks, Contacts, Calendar, Expenses with full CRUD
- **Productivity** — Pomodoro timer, habit tracker, quick capture inbox
- **Memories** — Long-term persistent memory with importance scoring, vector search, AES-256-GCM encryption
- **Goals** — Goal creation, decomposition, progress tracking, next-action recommendations
- **Custom Data Tables** — User-defined structured data with AI-determined schemas
- **5 Autonomy Levels** — Manual, Assisted, Supervised, Autonomous, Full
- **Triggers** — Schedule-based (cron), event-driven, condition-based, webhook
- **Heartbeats** — Natural language to cron conversion for periodic tasks
- **Plans** — Multi-step autonomous execution with checkpoints and retry logic
- **Workflows** — Visual multi-step automation with drag-and-drop builder and Workflow Copilot
- **Web UI** — React 19 + Vite 7 + Tailwind CSS 4 with 41 pages, 60+ components, dark mode
- **Telegram Bot** — Grammy-based bot with user/chat filtering and message splitting
- **WebSocket** — Real-time broadcasts for all data mutations
- **REST API** — 40 route modules with standardized responses, pagination, and error codes
- **Sandboxed Code Execution** — Docker isolation, VM, Worker threads with 4-layer security
- **PII Detection & Redaction** — 15+ categories
- **Zero-Dependency Crypto** — AES-256-GCM + PBKDF2 using only Node.js built-ins
- **Authentication** — None, API Key, or JWT modes
- **Rate Limiting** — Sliding window with burst support
- **Tamper-Evident Audit** — Hash chain verification for audit logs

### Infrastructure

- TypeScript 5.9 monorepo with Turborepo
- 307 test files with 19,200+ tests (Vitest)
- GitHub Actions CI/CD pipeline
- Docker multi-arch image (amd64 + arm64) published to `ghcr.io/ownpilot/ownpilot`
- PostgreSQL with pgvector for vector search

[0.1.4]: https://github.com/ownpilot/ownpilot/releases/tag/v0.1.4
[0.1.3]: https://github.com/ownpilot/ownpilot/releases/tag/v0.1.3
[0.1.2]: https://github.com/ownpilot/ownpilot/releases/tag/v0.1.2
[0.1.1]: https://github.com/ownpilot/ownpilot/releases/tag/v0.1.1
[0.1.0]: https://github.com/ownpilot/ownpilot/releases/tag/v0.1.0
