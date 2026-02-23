# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.1]: https://github.com/ownpilot/ownpilot/releases/tag/v0.1.1
[0.1.0]: https://github.com/ownpilot/ownpilot/releases/tag/v0.1.0
