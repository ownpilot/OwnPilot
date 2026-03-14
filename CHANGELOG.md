# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.10] - 2026-03-14

### Added

- **6 Workflow Node UI Components** — DataStore (cyan), SchemaValidator (orange), Filter (emerald), Map (sky), Aggregate (amber), WebhookResponse (rose) with color-coded canvas nodes, status indicators, and execution timing
- **6 Node Config Panels** — Full right-panel editors for each new node type with field editors, template validation, output alias, retry/timeout
- **LLM Conversation Context Editor** — Add/edit/remove multi-turn messages with role selector before main user message
- **LLM Response Format UI** — Text/JSON selector with JSON badge on canvas node
- **Execution Progress Bar** — Real-time toolbar showing running node name, completed/total count, retry counter
- **Execution Timeline Labels** — Node labels instead of raw IDs in both live and historical log views
- **9 Workflow Integration Tests** — Template resolution, condition branching, ForEach body, error propagation, filter/map/aggregate, DataStore persistence

### Fixed

- **Workflow Execution** — `node_complete` event now includes `retryAttempts`; cancelled workflows logged as 'cancelled' instead of 'failed'
- **Circular Dependencies (core)** — Broke fragile `tool-validation ↔ tools` cycle with lazy import (was last remaining dangerous cycle)
- **Circular Dependencies (gateway)** — Broke 45+ cycles across 4 root causes: `agents↔ws/server` (lazy import), `tool-providers↔routes` (cached lazy executors), `webchat-handler↔server` (lazy import), `normalizers barrel` (extracted types.ts)

### Changed

- ToolPalette sidebar now shows all 23 node types
- NodeSearchPalette includes 6 new node types
- Node config router dispatches to 23 panel types
- All normalizers import from `types.ts` instead of barrel `index.ts`

### Removed

- Deleted orphan `services/_gen.js` (console.log stub, unused)

## [0.1.9] - 2026-03-14

### Added

- **6 New Workflow Nodes** — DataStore (key-value persistence), SchemaValidator (JSON schema validation), Filter (array filtering), Map (array transformation), Aggregate (sum/count/avg/min/max/groupBy/flatten/unique), WebhookResponse (HTTP response for webhook triggers)
- **LLM Node Improvements** — `responseFormat: 'json'` for auto-parsed JSON output, `conversationMessages` for multi-turn context
- **5 Workflow Templates** — GitHub Issue Triage, Data Pipeline, Scheduled Report, Multi-Source Merge, Approval Workflow
- **Webhook Trigger Integration** — `POST /webhooks/workflow/:path` endpoint with HMAC-SHA256 signature validation
- **Approval Recovery** — `resumeFromApproval()` auto-resumes paused workflows when approval is decided
- **Fleet Command Tests** — 68 comprehensive tests covering lifecycle, scheduling, task execution, budgets, concurrency
- **Fleet Event-Driven Scheduling** — Fleets can now trigger cycles on EventBus events
- **Fleet Shared Context Feedback** — Worker outputs automatically feed back into shared context for downstream workers
- **Fleet Session Cleanup** — Old completed/failed sessions automatically cleaned on boot

### Fixed

- **Cost Tracking (all systems)** — `calculateExecutionCost()` shared utility now populates `costUsd` in BackgroundAgentRunner, SubagentRunner, FleetWorker, and SoulHeartbeatService; budget enforcement is now functional
- **Fleet Dependency Cascade** — Failed tasks now propagate failure to all dependent tasks (no more deadlocked task chains)
- **Fleet Shared Context Mutation** — `structuredClone()` prevents cross-worker context corruption
- **Fleet Cron Scheduling** — Now uses `getNextRunTime()` from core instead of stub 60s fallback
- **Fleet Orphaned Tasks** — Tasks stuck in 'running' from crashes are re-queued on fleet start
- **Fleet `executed_at` Timestamp** — Worker execution time now properly saved to DB
- **Workflow DataStore Memory Leak** — Added 10K entry limit with LRU eviction and `clearDataStore()` export
- **Workflow SubWorkflow Auth** — Added userId ownership check (prevents cross-user access)
- **Workflow SubWorkflow Abort** — Parent abort signal now propagates to child workflow execution
- **Workflow Node Limit** — Max 500 nodes per workflow (DoS prevention)
- **Workflow Copilot Prompt** — All 23 node types documented with correct short names matching `convertDefinitionToReactFlow`
- **Workflow Wizard Templates** — Rewritten with valid node types (previously used non-existent `start`/`ai`/`end` types)
- **Merge Node `firstCompleted`** — Mode parameter now functional (was no-op returning same as `waitAll`)
- **Notification Node** — Awaits broadcast instead of fire-and-forget, surfaces delivery warnings
- **Code Node** — Validates language input (rejects unsupported languages instead of silent fallback)
- **Delay Node** — Logs warning when 1-hour safety cap is applied
- **Agent Concurrent Guard** — `cycleInProgress` flag prevents double cycle execution
- **Agent Rate Limit Retry** — Re-schedules with backoff after throttling (was silently stopping)
- **Agent Crew Context Cache** — 30-second TTL cache reduces N*3 DB queries per heartbeat to 1
- **getCommunicationBus()** — Throws descriptive error instead of unsafe non-null assertion crash
- **Subagent spawnCounts** — Cleaned up when conversations have no active sessions (was growing unbounded)
- **Workspace Creation** — Warning logged instead of silent debug on failure

### Changed

- Extracted `agent-runner-utils.ts` — shared tool registration, agent factory, model resolution, timeout, JSON parsing (~360 LOC dedup)
- Centralized scheduling constants (`config/defaults.ts`) — `MANAGER_MAX_CONSECUTIVE_ERRORS`, `MANAGER_SESSION_PERSIST_INTERVAL_MS`, per-system delay bounds
- `AutonomousAgentResult` base interface for unified result types across all runners
- Fleet mission context included in all worker types (coding-cli, mcp-bridge were missing it)

### Security

- Bump hono 4.12.3 → 4.12.8 (arbitrary file access, prototype pollution, cookie/SSE injection)
- Bump @hono/node-server 1.19.9 → 1.19.11 (authorization bypass via encoded slashes)
- Bump undici override >=6.23.0 → >=6.24.1 (WebSocket DoS, CRLF injection, request smuggling)

### Testing

- 26,650+ tests total (core: 9,832; gateway: 16,236; ui: 141; cli: 293; channels: 148)
- New: 68 Fleet Command tests, workflow node executor improvements

## [0.1.8] - 2026-03-14

### Added

- **Unified Channel System** — Extensible channel SDK with UnifiedBus event router and UCP (Unified Channel Protocol) adapters; channels register via builder pattern with standardized lifecycle hooks
- **Web Chat Channel Plugin** — Embeddable floating chat widget for websites with real-time WebSocket messaging, session management, and customizable appearance
- **SMS Channel Plugin** — SMS messaging channel via Twilio integration with send/receive support
- **Email Channel Plugin** — Email channel via SMTP/IMAP with inbound parsing and outbound delivery
- **Matrix Channel Plugin** — Matrix protocol channel for federated messaging support
- **Cross-Channel Notification System** — Unified notification dispatching across all connected channels with priority routing, delivery tracking, and fallback chains
- **Fleet System** — Multi-worker fleet management with worker assignment, budget configuration, schedule parameters, real-time status events, and full admin UI with detail panels
- **Claw Mode (Autonomy L5)** — Enhanced crew orchestration mode with elevated autonomy capabilities for coordinated multi-agent operations
- **Crew UI Panels** — Shared memory and task queue panels for crew collaboration visibility
- **Dashboard Enhancements** — Claw badges and crew metrics widgets on the main dashboard
- **ACP for Coding Agents** — Agent Communication Protocol enabled for all coding agent providers with critical bug fixes
- **Autonomy Logging** — Comprehensive structured logging across all autonomous systems (pulse, heartbeat, triggers, background agents)
- **Database Backup Endpoints** — Backup listing and download via REST API
- **Setup Wizard Documentation** — Interactive setup wizard docs with type safety improvements

### Fixed

- **Fleet Boot/Lifecycle** — Fixed critical bugs preventing fleet system from starting: worker config snake_case→camelCase mapping, race condition guard, missing tool registrations
- **Autonomous Agent Scheduling** — Fixed provider fallback, duration calculation, and scheduling bugs in background agents
- **Session Shutdown Cleanup** — Removed hardcoded `limit:100` truncation and added proper session cleanup on shutdown
- **Production Hardening** — Fixed shutdown ordering, memory leaks in timers, security edge cases, and logging gaps
- **Autonomy Performance** — Skip LLM call when no signals detected; skip high-frequency tool events in trigger engine
- **Silent Failures** — Upgraded swallowed errors to warn-level logging across autonomous systems
- **CLI Provider Endpoints** — Added CLI provider support to detail and models API endpoints
- **Docker Monorepo Build** — Fixed Dockerfile for correct monorepo structure
- **UI Wizard Scroll** — Fixed wizard buttons scrolling out of view
- **Husky Pre-Commit Hook** — Added missing shebang line
- **WebSocket Server Test** — Fixed circular import TDZ error and missing mock exports

### Changed

- Comprehensive complexity reduction refactoring across the codebase
- Database API path changed from `/database` to `/db`
- Removed unused dependencies and dead code cleanup

### Performance

- Skip LLM call when no autonomy signals detected
- Skip high-frequency tool events in trigger engine evaluation

## [0.1.6] - 2026-03-06

### Added

- **Conversation Sidebar** — Persistent conversation sidebar with ID-based session persistence, inline rename support, and auto-refresh on channel events
- **Pairing Key Ownership** — Per-channel rotating pairing keys for channel access control with revoke support; pairing key banner on Channels page
- **WhatsApp Group Support** — Group message storage, group messages API endpoint, group/chat listing endpoints, and passive history sync with on-demand fetch
- **WhatsApp Anti-Ban Hardening** — P0 anti-ban safety filters, auto-reply protection, history sync race condition fixes, and 440 connectionReplaced reconnect loop fix
- **WhatsApp Auto-Claim Owner** — Automatically claim channel ownership on first self-chat message, removing the need for manual `/connect`
- **Crew Orchestration Engine** — Runtime crew orchestration with Plans tab integration and agent lifecycle fixes
- **Debug System Prompt Breakdown** — Full system prompt section breakdown logged on every request with DebugDrawer UI showing per-section drill-down
- **Perplexity Agent API** — Added Perplexity Agent API provider configuration

### Fixed

- **Anthropic Prompt Caching** — Moved orchestrator to static cache block; round time context to hour boundary to prevent cache invalidation; moved extensions before cache split point
- **Provider Empty Content** — Send `null` content instead of `""` for assistant messages with tool_calls (fixes Anthropic validation errors)
- **Composio Integration** — Fixed `getAvailableApps` flat-array response handling, meta field mapping, and invalid `'google'` slug
- **Chat Double-Persistence** — Extracted ConversationService, fixed messages being persisted twice
- **WhatsApp QR Code** — Fixed QR code not appearing when session is stale/expired
- **WhatsApp Self-Chat** — Fixed intermittent self-chat send failures
- **Channel Owner Flow** — Reply with `/connect` instructions when no owner claimed; sidebar auto-refresh on channel events
- **UI Logout Button** — Show Logout button in both connected and disconnected channel states
- **Extension Creator DOM Error** — Resolved `insertBefore` DOM error in extension creator (#8)
- **Debug Log Truncation** — Removed truncation from debug log entries, store full section content
- **Soul Agent Pipeline** — 17 FIXPLAN fixes across heartbeat pipeline and extension creator (commit `12e996d`)

### Changed

- Extracted `ConversationService` from chat route for cleaner separation of concerns
- Channel history improvements for better message threading
- Removed unused code and improved type safety in resource tools
- Removed generated `models-dev-full.json` artifact, updated `.gitignore`

### Security

- **SSRF / DNS Rebinding Protection** — `isBlockedUrl()` sync hostname check + `isPrivateUrlAsync()` with DNS rebinding detection and 1-min cache; applied to browser service, `/fetch-url`, and web-fetch executors
- **Rate Limiter TTL Cleanup** — Fixed memory leak in sliding window rate limiter
- **XSS Escaping** — Added output escaping for user-controlled content in HTML responses

### Testing

- 389+ test files, 22,100+ tests total
- New: soul agent unit tests (127 core tests across 6 files), gateway soul coverage (souls repo, communication tools, heartbeat service)

## [0.1.5] - 2026-03-02

### Added

- **Soul Agent System** — Rich agent identity framework with personality, mission, role, relationships, heartbeat-driven lifecycle, evolution tracking, and boot sequences; gateway service with full CRUD and heartbeat execution
- **Autonomous Hub** — Unified command center consolidating soul agents, background agents, crews, messaging, and activity into a single tabbed dashboard with search, filters, and real-time WebSocket status
- **AI Agent Creator** — Conversational agent creation via SSE streaming chat with a dedicated designer agent; describe what you need in plain language, refine through conversation, preview the JSON config, and create in one click
- **Crew System** — Multi-agent crews with role assignments, delegation protocols, and crew templates for coordinated multi-agent workflows
- **Agent Communication** — Inter-agent messaging system with inbox, compose, and message history; CommsPanel for viewing and sending messages between agents
- **Activity Feed** — Unified timeline of heartbeat logs and agent messages with aggregate stats (total runs, success rate, avg duration, total cost)
- **16+ Agent Templates** — Pre-built agent configurations (Morning Briefer, News Monitor, Code Reviewer, Budget Tracker, Social Media Manager, Health & Wellness Coach, etc.) with one-click creation
- **Agent Profile Page** — Detailed agent view with identity display, inline soul editor, heartbeat configuration, action controls (pause/resume/delete), and error/not-found handling
- **Global Status Bar** — Compact header showing live agent count, running/paused/error breakdown, daily cost, WebSocket connection state, and autonomy settings link
- **77 new AI providers** — Updated provider model data with 77 providers and 1 new addition

### Fixed

- **AI Creator chatbot behavior** — Fixed AI Agent Creator acting like a regular chatbot instead of designing agent configs; root cause was `BASE_SYSTEM_PROMPT` overriding the inline designer instruction; now uses a dedicated `__ai_agent_designer` agent with proper system prompt via `agentId` routing
- **Autonomous Hub modal backgrounds** — Replaced invalid `bg-surface` with valid `bg-bg-primary` Tailwind token
- **WebSocket connection status** — Fixed `useAgentStatus` hook to properly return `isConnected` state for live/offline indicator
- **Empty state UX** — Added differentiated empty state buttons (Browse Templates / Chat with AI / Create Manually) with separate `wizardInitialStep` tracking
- **Agent profile error handling** — Distinguished between loading errors (with retry) and agent-not-found (with navigation back) in AgentProfilePage
- **Activity feed error state** — Added inline error display with retry button in ActivityFeed
- **Template fetch errors** — Added toast notification when crew template loading fails on hub mount
- **CommsPanel improvements** — Fixed "from" field population in compose form and added loading spinner during data fetch
- **TemplateCatalog search** — Added clear button to search input for better UX
- **Silent catches** — Replaced empty catch blocks with user-facing error toasts in CrewSection, CommsPanel, and SoulEditor
- **Accessibility** — Added `aria-label` to all icon-only buttons across the autonomous hub (back button, stop generating, tag remove, close creator)
- **Type safety** — Removed unsafe `as any` and `as unknown` type assertions across all autonomous hub components
- **Structured logging** — Converted template-literal error logs to structured context objects in gateway observability
- **Fetch security** — Added fetch timeout and download size limits with budget enforcement tests
- **12 bugs from BUGS.md** — Resolved P0 through P3 priority bugs plus SEC-001 security finding

### Changed

- Provider model data updated (77 providers)
- Soul tools registered in gateway providers with formatted structured log context
- Cleaned up unused imports, dead code, and repo artifacts

### Testing

- 389+ test files, 22,100+ tests total

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

[0.1.10]: https://github.com/ownpilot/ownpilot/releases/tag/v0.1.10
[0.1.9]: https://github.com/ownpilot/ownpilot/releases/tag/v0.1.9
[0.1.8]: https://github.com/ownpilot/ownpilot/releases/tag/v0.1.8
[0.1.6]: https://github.com/ownpilot/ownpilot/releases/tag/v0.1.6
[0.1.5]: https://github.com/ownpilot/ownpilot/releases/tag/v0.1.5
[0.1.4]: https://github.com/ownpilot/ownpilot/releases/tag/v0.1.4
[0.1.3]: https://github.com/ownpilot/ownpilot/releases/tag/v0.1.3
[0.1.2]: https://github.com/ownpilot/ownpilot/releases/tag/v0.1.2
[0.1.1]: https://github.com/ownpilot/ownpilot/releases/tag/v0.1.1
[0.1.0]: https://github.com/ownpilot/ownpilot/releases/tag/v0.1.0
