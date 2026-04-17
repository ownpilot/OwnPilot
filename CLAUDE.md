# OwnPilot

Privacy-first personal AI assistant platform. TypeScript monorepo with Turborepo.

## Project Rules (auto-loaded)

All files in `.claude/rules/` are loaded as project instructions for every AI agent:

- **`data-safety.md`** — **MANDATORY** data protection rules. Forbidden commands (no `docker compose down -v`, no destructive migrations without backup), volume inventory, pre-action checklist. Read BEFORE any DB/volume/migration work.
- `page-contexts.md` — Per-page (workflow/agent/MCP/etc.) context templates for sidebar chat spawns.
- `sidebar-chat.md` — Sidebar chat assistant behavior + API/DB access patterns.

## Architecture

```
packages/
  core/      - Agent engine, tools, plugins, events, sandbox, privacy
  gateway/   - Hono HTTP API server, routes, services, DB, channels, triggers, WebSocket
  ui/        - React 19 + Vite + Tailwind frontend (64 pages, code-split)
  cli/       - Commander.js CLI (bot, config, start, workspace commands)
```

## Key Patterns

- **Response helpers**: `apiResponse(c, data, status?)` and `apiError(c, message, code, status)` in `packages/gateway/src/routes/helpers.ts`
- **Error codes**: `ERROR_CODES` constants in `packages/gateway/src/routes/helpers.ts`
- **Pagination**: `parsePagination(c)` and `paginatedResponse(c, items, total, page, limit)` helpers
- **Event system**: EventBus, HookBus, ScopedBus in `packages/core/src/events/`
- **Plugin system**: PluginRegistry with isolation, marketplace, runtime in `packages/core/src/plugins/`
- **User Extensions**: Native tool bundles (JS code, triggers, services) in `packages/gateway/src/services/extension-service.ts`. DB table: `user_extensions`. API: `/extensions`
- **Skills (AgentSkills.io)**: Open standard SKILL.md format for agent instructions. Parser: `packages/gateway/src/services/agentskills-parser.ts`. Format field: `'ownpilot' | 'agentskills'`
- **Edge/IoT**: MQTT broker (Mosquitto) integration for edge device management. Types: `packages/core/src/edge/`. Service: `packages/gateway/src/services/edge-service.ts`. Routes: `/api/v1/edge`
- **Test framework**: Vitest across all packages. 26,500+ tests total (gateway: 16,294+; core: 9,714; cli: 340; ui: 141). 549 test files
- **Analytics Page**: `packages/ui/src/pages/AnalyticsPage.tsx` — recharts-powered dashboard at `/analytics`. 6 KPI cards, cost/token area+bar charts, provider donut, agent distribution bar, claw mode/state donuts, task/habit radial gauges, daily requests line chart, claw runtime summary grid, personal data overview. Period toggle (7d/30d). Uses `costsApi.usage()`, `costsApi.getBreakdown()`, `clawsApi.stats()`, `summaryApi.get()` + agent list endpoints
- **Autonomous Agent Runners**: Shared utilities in `packages/gateway/src/services/agent-runner-utils.ts` — `createConfiguredAgent()`, `registerAllToolSources()`, `resolveProviderAndModel()`, `executeAgentPipeline()`, `calculateExecutionCost()`, `createToolCallCollector()`, `resolveToolFilter()`, `createCancellationPromise()`
- **Habit Tracking**: 8 AI tools in `packages/gateway/src/tools/habit-tools.ts`, DB repo in `db/repositories/habits.ts` (645 lines), REST API in `routes/productivity.ts`, HabitsPage UI with streak heatmap
- **Utilities**: `TTLCache<K,V>` in `packages/gateway/src/utils/ttl-cache.ts` — generic cache with auto-prune. `chat-post-processor.ts` in `assistant/` — extracted from conversation-service
- **Extension splits**: `extension-trigger-manager.ts` (trigger lifecycle), `extension-scanner.ts` (directory scanning), `cli-chat-parsers.ts` (CLI output parsers + arg builders)
- **Cost tracking**: `calculateExecutionCost(provider, model, usage)` in `agent-runner-utils.ts` — wraps `@ownpilot/core` `calculateCost()`. Used by ClawRunner, SubagentRunner, FleetWorker, SoulHeartbeatService
- **Workflow system**: 24 node types (including `clawNode`), copilot prompt in `routes/workflow-copilot-prompt.ts`, executors in `services/workflow/node-executors.ts`, service in `services/workflow/workflow-service.ts`. Centralized `dispatchNode()` method handles all node types. Copilot uses short type names (e.g. `"llm"`, `"claw"`) — UI's `convertDefinitionToReactFlow()` converts to `*Node` suffix
- **Fleet Command**: FleetManager + FleetWorker with 5 worker types (ai-chat, coding-cli, api-call, mcp-bridge, claw). 68 tests in `fleet-manager.test.ts`. Task dependencies cascade failures via `failDependentTasks()`
- **Claw Runtime**: Unified autonomous agent composing LLM + workspace + soul + coding agents + 250+ tools. Types in `core/src/services/claw-types.ts`. Runner/Manager/Service in `gateway/src/services/claw-{runner,manager,service}.ts`. 16 claw tools + 7 management tools in `tools/claw-tools.ts` + `tools/claw-management-tools.ts`. DB: `claws`, `claw_sessions`, `claw_history`, `claw_audit_log` (migrations 022, 023). REST: `/api/v1/claws` (16 endpoints including `/stats`, `/audit`, `/deny-escalation`). UI: ClawsPage (8-tab management panel + search/filter + bulk actions) + ClawsWidget (live WS updates). 117+ tests. Modes: `continuous` / `interval` / `event` / `single-shot`. Limits: MAX_CONCURRENT_CLAWS=50, MAX_CLAW_DEPTH=3, mission 10K chars. `.claw/` directive system: INSTRUCTIONS.md, TASKS.md, MEMORY.md, LOG.md (auto-scaffolded, injected into prompt). Working Memory: `claw_set_context`/`claw_get_context` for persistent cross-cycle state. Stop conditions: `max_cycles:N`, `on_report`, `on_error`, `idle:N`. Auto-fail after 5 consecutive errors. Daily cleanup: 90d history, 30d audit retention. Workflow: `clawNode` type in workflow system. Triggers can call `start_claw` tool action

## UI Preview (Claude Code Preview MCP)

This project is developed across multiple machines. Preview setup differs per environment.
**Before starting preview**, read the project memory for machine-specific context:
`~/.claude/projects/-Users-ayazmutlu-ownpilot/memory/project_dev_setup.md`

That file contains: device map, decision tree (which machine → which approach), data flow diagram, and known issues per platform. Do NOT blindly follow steps — understand which machine you're on first.

**Key files:** `packages/ui/dev-proxy.mjs` (reverse proxy), `packages/ui/dev-start.sh` (launcher), `.claude/launch.json` (Preview MCP config)

## Commands

```bash
pnpm install          # Install dependencies
pnpm run test         # Run all tests (turbo)
pnpm run build        # Build all packages
pnpm run dev          # Dev mode with hot reload
pnpm run lint         # ESLint check
pnpm run lint:fix     # ESLint auto-fix
pnpm run format       # Prettier format
pnpm run typecheck    # TypeScript type checking
```

## Tech Stack

- **Runtime**: Node.js 22+, pnpm 10+
- **Language**: TypeScript 5.9
- **Server**: Hono 4.x
- **Frontend**: React 19, Vite 7, Tailwind CSS 4
- **Testing**: Vitest 4.x
- **Build**: Turborepo 2.x
- **Linting**: ESLint 10 (flat config), Prettier

## Database

PostgreSQL via pg adapter. Repositories in `packages/gateway/src/db/repositories/`. Adapter abstraction in `packages/gateway/src/db/adapters/`.

### Migration Best Practices

**Critical:** All migrations must be idempotent (`IF NOT EXISTS` / `IF EXISTS`).

**Pattern for new tables:**

1. Add `CREATE TABLE IF NOT EXISTS` to `001_initial_schema.sql` (for fresh installs)
2. Add same `CREATE TABLE IF NOT EXISTS` to your migration file (for existing installs)
3. Never assume table exists - always use `IF NOT EXISTS`

**Example (009_skills_platform.sql):**

```sql
-- Create table if not exists (idempotent)
CREATE TABLE IF NOT EXISTS user_extensions (...);

-- Alter table (idempotent)
ALTER TABLE user_extensions ADD COLUMN IF NOT EXISTS npm_package TEXT;
```

**Testing migrations:**

```bash
# Fresh install test
docker run -d --name test-db -p 35432:5432 \
  -e POSTGRES_USER=testuser \
  -e POSTGRES_PASSWORD=testpass \
  -e POSTGRES_DB=testdb \
  -v "$(pwd)/packages/gateway/src/db/migrations/postgres:/docker-entrypoint-initdb.d" \
  pgvector/pgvector:pg16
```

## Conventions

- Barrel exports via `index.ts` in each module
- Route files return Hono app instances
- All API responses use `apiResponse`/`apiError` helpers (standardized)
- Tests colocated with source (`*.test.ts`)
- Unused variables prefixed with `_` (ESLint convention)
