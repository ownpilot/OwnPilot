# OwnPilot

Privacy-first personal AI assistant platform. TypeScript monorepo with Turborepo.

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
- **User Extensions**: Native tool bundles (JS code, triggers, services) in `packages/gateway/src/services/extension/service.ts`. DB table: `user_extensions`. API: `/extensions`
- **Skills (AgentSkills.io)**: Open standard SKILL.md format for agent instructions. Parser: `packages/gateway/src/services/skill/agentskills-parser.ts`. Format field: `'ownpilot' | 'agentskills'`
- **Edge/IoT**: MQTT broker (Mosquitto) integration for edge device management. Types: `packages/core/src/edge/`. Service: `packages/gateway/src/services/edge/service.ts`. Routes: `/api/v1/edge`
- **Test framework**: Vitest across all packages. 26,500+ tests total (gateway: 16,294+; core: 9,714; cli: 340; ui: 141). 549 test files
- **Analytics Page**: `packages/ui/src/pages/AnalyticsPage.tsx` — recharts-powered dashboard at `/analytics`. 6 KPI cards, cost/token area+bar charts, provider donut, agent distribution bar, claw mode/state donuts, task/habit radial gauges, daily requests line chart, claw runtime summary grid, personal data overview. Period toggle (7d/30d). Uses `costsApi.usage()`, `costsApi.getBreakdown()`, `clawsApi.stats()`, `summaryApi.get()` + agent list endpoints
- **Autonomous Agent Runners**: Shared utilities in `packages/gateway/src/services/agent/runner-utils.ts` — `createConfiguredAgent()`, `registerAllToolSources()`, `resolveProviderAndModel()`, `executeAgentPipeline()`, `calculateExecutionCost()`, `createToolCallCollector()`, `resolveToolFilter()`
- **Habit Tracking**: 8 AI tools in `packages/gateway/src/tools/habit-tools.ts`, DB repo in `db/repositories/habits.ts` (645 lines), REST API in `routes/productivity.ts`, HabitsPage UI with streak heatmap
- **Utilities**: `TTLCache<K,V>` in `packages/gateway/src/utils/ttl-cache.ts` — generic cache with auto-prune. `chat-post-processor.ts` in `assistant/` — extracted from conversation-service. `safeCost`/`safeDuration` live ONLY in `packages/core/src/utils/safe-value.ts` (exported from `@ownpilot/core`); the gateway duplicate was removed 2026-06-10
- **UI page-data hooks (2026-06-10)**: `usePageData<T>(fetcher, deps, {errorMessage, enabled, onError})` in `packages/ui/src/hooks/usePageData.ts` replaces the hand-rolled `isLoading+error+useEffect` fetch block (returns `{data, isLoading, error, refetch, setData}`, stale-response safe; `refetch({silent:true})` for WS-driven background refreshes). `usePagination(initialSize)` in `usePagination.ts` for offset/limit state. Exemplars: CostsPage, ClawsPage, CodingAgentSettingsPage, ArtifactsPage, EdgeDevicesPage. Migrate other pages as touched
- **Chat store split (2026-06-10)**: `useChatStore.tsx` delegates two concerns — `useAutoCompact.ts` (threshold prompt, decline set, opt-out, `compactSession`; owns `computeAutoCompactPrompt` + AUTO_COMPACT constants, re-exported from useChatStore) and `useChatSessions.ts` (snapshot map + session tabs, generic over the snapshot type, takes a capture/restore/clear/orphanStream controller from the provider). Public ChatStore API unchanged. When touching tab lifecycle or compaction, edit the dedicated hook, not the provider
- **UI modal primitives (2026-06-10)**: `Modal` in `packages/ui/src/components/Modal.tsx` is the base shell (backdrop/header/scrollable-body/footer; size presets, headerContent, overridable footer layout) — migrate plain dialogs to it as touched (exemplars: PlanHistoryModal, TriggerHistoryModal). `MultiStepModal` composes Modal and adds step tabs + Cancel/Back/Next/Submit; `AgentFormSteps.tsx` has the shared agent info/model/tools steps + `useAgentFormData()` (exemplars: Create/EditAgentModal). NOT candidates: form-wrapped dialogs (RegisterDeviceModal), async wizards (ChannelSetupModal), animated popovers (QuickAddModal), full-height viewers (ArtifactDetailModal) — keep their own markup
- **CLI gateway client (2026-06-10)**: ALL CLI subcommands talk to the gateway via `apiFetch`/`getBaseUrl`/`ensureGatewayError` from `packages/cli/src/commands/gateway-client.ts` (env: `OWNPILOT_GATEWAY_URL`, auth from `OWNPILOT_API_KEY`/`OWNPILOT_JWT`). Never hand-roll a fetch wrapper in a command file — soul.ts/claw.ts were migrated off their private `api()` copies (which used the now-removed `OWNPILOT_API_URL`)
- **Provider shared plumbing (2026-06-10)**: `packages/core/src/agent/providers/shared.ts` — `readSseData(body)` (SSE reader loop, buffer handling, reader.cancel in finally), `runProviderHealthCheck({providerId, ready, notConfiguredError, request, authErrorIsOk})`, `approximateTokenCount(messages)`. All 4 providers + BaseProvider consume these; new providers MUST too — never copy the reader/health-check scaffolds again
- **Trigger action handlers (2026-06-10)**: chat handler + workflow/run_heartbeat/profile_learn/memory_extract/memory_consolidate live in `packages/gateway/src/triggers/action-handlers.ts` (`registerTriggerActionHandlers(engine)`, called once from server.ts boot). LLM resolution in these handlers goes through `getLLMRouter().pick({process:'pulse'})` — the last `resolveProviderAndModel` legacy seams (server.ts + tools/memory-tools.ts) were migrated
- **WS legacy event bridge (2026-06-10)**: EventBus dot-notation → colon WS broadcast forwarding lives in `packages/gateway/src/ws/legacy-events.ts` with one typed payload interface per event family (TriggerExecutionData, ClawEventData, CrewTaskData, ChannelUserEventData…) — one documented cast per handler, not per field. When an emitter's payload changes, update the matching interface there
- **Extension splits**: `extension/trigger-manager.ts` (trigger lifecycle), `extension/scanner.ts` (directory scanning), `cli/chat-parsers.ts` (CLI output parsers + arg builders)
- **Cost tracking**: `calculateExecutionCost(provider, model, usage)` in `services/agent/runner-utils.ts` — wraps `@ownpilot/core` `calculateCost()`. Used by ClawRunner and SoulHeartbeatService
- **Workflow system**: 24 node types (including `clawNode`), copilot prompt in `services/workflow/copilot-prompt.ts`, executors in `services/workflow/node-executors.ts`, service in `services/workflow/workflow-service.ts`. Centralized `dispatchNode()` method handles all node types. Copilot uses short type names (e.g. `"llm"`, `"claw"`) — UI's `convertDefinitionToReactFlow()` converts to `*Node` suffix and returns `skippedNodes` for unknown types (callers toast). Canonical type whitelist: `services/workflow/node-types.ts` (`WORKFLOW_NODE_TYPES`) — enforced at save-time (semantic validation rejects unknown types) AND run-time (dispatch errors instead of tool-node fallback). When adding a node type, touch ALL layers: executor + dispatch + validation + copilot prompt + UI (component, panel, registry in `pages/workflows/shared.ts`, converter, both serializers `workflowDefinition.ts`/`workflowPersistence.ts`, `useWorkflowNodes` add fn + `handleAddNode` case, ToolPalette + NodeSearchPalette, editor load whitelist in `useWorkflowEditor.ts`) — `clawNode` was missing from every UI layer until 2026-06-10. LLM node `provider`/`model` are OPTIONAL (executor resolves user defaults for empty/`'default'`); only `userMessage` is required. Template catalog guard: `workflow-templates.test.ts` converts every template and asserts all types registered
- **Autonomous agents (consolidated 2026-05-23)**: The autonomous side is now just **Agent (base) → Claw (unified runtime) → Soul/Crew/Heartbeat (persistent team identity)**. The Fleet, Subagent, and Orchestra subsystems were removed because they overlapped with Claw's concurrent cycles + subclaw spawn and Workflow's `parallelNode`. Migration 038 dropped their tables. Workflow and Coding Agents stay as separate paradigms.
- **Channel tool surface (2026-05-23)**: `packages/gateway/src/tools/channel-tools.ts` exposes channels to agents via the standard tool path — `send_channel_message`, `broadcast_channel_message`, `list_channels`, `get_channel_inbox`. Without this any autonomous agent (Claw, soul heartbeat) had no way to reach Telegram / Discord / WhatsApp except through hard-wired triggers. Wraps `channelService.send/broadcast/broadcastAll/listChannels` + `channelMessagesRepo.getInbox/getByChannel`. Registered in `core-registration.ts` alongside CREW_TOOLS / HABIT_TOOLS.
- **LLMRouter capability (2026-05-23)**: `ILLMRouter` contract in `packages/core/src/services/llm-router.ts`, gateway impl in `packages/gateway/src/services/llm-router.ts` via `getLLMRouter()`. Single named import for `pick()` (provider+model waterfall), `getContextWindow()`, `getMaxOutput()`, `computeMemoryMaxTokens()`, `calculateCost()`. NEW code should consume the router; legacy direct imports of `resolveProviderAndModel` / `resolveContextWindow` / etc. are migrated as their files are touched. Established as the first capability of the two-layer architecture (capabilities below, runtimes above — runtimes never import implementations).
- **ChannelService consolidation (2026-05-23)**: `IChannelService` in `packages/core/src/channels/service.ts` is now the only import path — runtimes consume `getChannelService()` + `hasChannelService()` from `@ownpilot/core`, never `getChannelServiceImpl()` from gateway internals. `processIncomingMessage()` was promoted from gateway-internal to the public contract so webhook handlers (email, sms) and synthetic-send paths (chat-history, webchat-handler) no longer reach into `ChannelServiceImpl` directly. Five production callsites migrated; `getChannelServiceImpl()` remains exported only for legacy tests that need direct class access.
- **ConfigCenter capability (2026-05-23)**: `ConfigCenter` contract in `packages/core/src/services/config-center.ts` now exposes `getConfigCenter()` / `setConfigCenter()` / `hasConfigCenter()` globals (matches the channel and LLM router pattern). All 6 built-in channel plugins (telegram, discord, slack, whatsapp, sms, email, matrix) migrated from `configServicesRepo.getFieldValue(...)` direct imports to `getConfigCenter().getFieldValue(...)`. Gateway impl `GatewayConfigCenter` registers itself via `setConfigCenter()` at startup (server.ts). Other callsites (autonomy engine, agent-cache, agent-service) still use `configServicesRepo` directly — migrate when those files are touched. `configServicesRepo` keeps CRUD ownership; ConfigCenter is the read-only access contract.
- **RuntimeContext + LLMRouter core promotion (2026-05-23)**: LLMRouter access (`getLLMRouter` / `setLLMRouter` / `hasLLMRouter`) moved from gateway to `@ownpilot/core` so all three capabilities live in core symmetrically. Gateway provides `installLLMRouter()` at startup. NEW: `RuntimeContext` type and `getRuntimeContext()` in `packages/core/src/services/runtime-context.ts` bundles the four horizontal capabilities (`llm`, `channels`, `config`, `events`) every runtime needs. Runtimes can take it as a constructor parameter for explicit dependency or pull from globals. `hasRuntimeContext()` returns true once all three explicit capabilities (LLMRouter, ChannelService, ConfigCenter) are registered. Future runtimes constructed as `new MyRunner(getRuntimeContext())` get mockable dependencies for free.
- **ClawRunner takes RuntimeContext explicitly (2026-05-23)**: `ClawRunner` constructor now accepts `runtime: RuntimeContext = getRuntimeContext()` as an optional second arg. The pattern is `class Runner { constructor(private config, private runtime = getRuntimeContext()) {} }` — production constructs the runner without the second arg and inherits the singleton; tests pass a mock bundle (one mock instead of four separate global overrides). Internally `getLLMRouter().pick(...)` became `this.runtime.llm.pick(...)`. Soul Heartbeat and future runtimes should follow the same shape. This is the "make the bundle load-bearing" step that turns RuntimeContext from a typed view into an enforceable dependency.
- **Soul Heartbeat uses LLMRouter (2026-05-23)**: `createHeartbeatAgentEngine()` in `soul-heartbeat-service.ts` migrated from `resolveForProcess('pulse')` to `getLLMRouter().pick({ process: 'pulse' })`. To carry fallback info through the unified contract, `LLMResolvedModel` was extended with optional `fallbackProvider` + `fallbackModel`; `resolveProviderAndModel` in agent-runner-utils now returns them when the per-process routing supplies them.
- **SoulHeartbeatService extracted as a class (2026-05-23)**: The module-level runner/communicationBus/circuitBreaker/metricsCollector/budgetForecasters/crewContextCache singletons in `soul-heartbeat-service.ts` are now instance fields of a `SoulHeartbeatService` class that takes an optional `RuntimeContext` in its constructor (resolved lazily so construction stays cheap). Capability access goes through `this.runtime.{llm, permissions, memory, events}` — same shape as `ClawRunner`. The legacy module-level exports (`getHeartbeatRunner`, `resetHeartbeatRunner`, `getCommunicationBus`, `runAgentHeartbeat`) remain as thin wrappers around a process-default instance so every caller (trigger engine, crew tools, shutdown hook) keeps working unchanged. Soul Heartbeat is the second autonomous runtime to adopt the RuntimeContext pattern (after Claw).
- **PermissionGate capability (2026-05-23)**: `IPermissionGate` in `packages/core/src/services/permission-gate.ts` is the unified contract for "is this tool call allowed?" — `check({ actorId, tool, context }) -> { type: 'allow' | 'deny' | 'require_approval', reason? }`. Gateway impl `DefaultPermissionGate` in `services/permission-gate-impl.ts` absorbs the three filters previously inlined in soul-heartbeat's `onBeforeToolCall`: `skillAccessBlocked`, `skillAccessAllowed`, `allowedTools`. Installed at startup via `installPermissionGate()`. Promoted to `RuntimeContext.permissions` so runtimes consume it through the bundle. Phase A only covers per-call filters; approval-middleware (action categories + human-in-the-loop) and claw `autonomyPolicy` (sandbox-tier defaults) migrate in Phase B. NEW runtimes that authorize tool calls should call `ctx.permissions.check(...)` instead of growing another bespoke filter.
- **MemoryService capability (2026-05-23)**: `IMemoryService` in `packages/core/src/services/memory-service-interface.ts` is now the 6th horizontal capability with `getMemoryService()` / `setMemoryService()` / `hasMemoryService()` accessors (same pattern as LLMRouter / ChannelService / ConfigCenter / PermissionGate). The gateway impl registers itself via `setMemoryService()` at startup right alongside `Services.Memory`. Promoted to `RuntimeContext.memory` so runtimes that need per-user memory (autonomous agents, chat, soul) consume it through the bundle. Existing `registry.get(Services.Memory)` callsites keep working — `MemoryToken` is the same instance the registry was already wired with. `hasRuntimeContext()` now requires all five explicit capabilities (LLMRouter, ChannelService, ConfigCenter, PermissionGate, MemoryService) to be initialized.
- **Personal-memory retention scheduler (2026-06-05)**: `services/memory/retention.ts` — an always-on daily `setInterval` (mirrors the ClawManager retention pattern) running `MemoryService.decayMemories()` + `cleanupMemories()` for owner `'default'`. Wired into `server.ts` startup (after Autonomy Engine) + shutdown (`stopMemoryRetention()`). Pure hygiene — no LLM, no extraction, no consolidation — so it's default-on, unlike the opt-in `memory_extract` / `memory_consolidate` triggers in `triggers/proactive.ts`. Cadence split: idempotent `cleanup` (deletes importance<0.1, >90d old, unaccessed 90d) runs on boot + daily; compounding `decay` (`importance *= 0.9`) runs ONLY on the daily tick, so it's independent of restart frequency. `runMemoryRetentionCleanup(userId, {decay})` is exported + unit-tested.
- **AgentRunnerUtils on LLMRouter (2026-05-23)**: `agent-runner-utils.ts` was the last gateway-internal runtime path still importing `resolveContextWindow` / `resolveMaxOutput` / `computeMemoryMaxTokens` directly from `agent-cache.ts`. Migrated to `getLLMRouter().getContextWindow(...)` / `.getMaxOutput(...)` / `.computeMemoryMaxTokens(...)`. With this change all three autonomous runtimes (Claw, Soul Heartbeat, AgentRunner) and the chat path consume the LLMRouter capability uniformly — the legacy free functions in agent-cache remain as the _implementation_ the router delegates to, but no runtime code imports them directly anymore.
- **AuditService capability (2026-05-23)**: `IAuditService` in `packages/core/src/services/audit-service.ts` is now the 7th horizontal capability with `getAuditService()` / `setAuditService()` / `hasAuditService()` accessors. Gateway registers it at startup via `setAuditService()` right alongside `Services.Audit`. Promoted to `RuntimeContext.audit` so runtimes that emit request logs or security audit events consume the contract through the bundle. `AuditToken` matches the `Services.Audit` registry entry so legacy `registry.get(Services.Audit)` callsites still resolve to the same instance. `hasRuntimeContext()` now requires all six explicit capabilities (LLMRouter, ChannelService, ConfigCenter, PermissionGate, MemoryService, AuditService).
- **ConfigCenter migration sweep (2026-05-23)**: Four read-only services migrated from `configServicesRepo` direct imports to `getConfigCenter()`: `composio-service.ts`, `browser-service.ts`, `embedding-service.ts`, `coding-agent-providers.ts`. These consume config but don't own CRUD, so they're the cleanest candidates for the read-only contract. `configServicesRepo` remains the CRUD owner (and is still the right import in repos / route handlers / config-center-impl). Pattern for migration: replace `configServicesRepo.getFieldValue(...)` / `.getApiKey(...)` with `getConfigCenter().getFieldValue(...)` / `.getApiKey(...)`, and update the test's `vi.mock('@ownpilot/core', ...)` to provide a stub `getConfigCenter()` returning the same mock fns previously hung off the repo mock.
- **gatewayConfigCenter import removal (2026-05-23)**: Four runtime callers (`routes/agent-service.ts`, `routes/tools.ts`, `services/agent-runner-utils.ts`, `services/tool-executor.ts`) imported `gatewayConfigCenter` from `services/config-center-impl.js` just to call `tools.setConfigCenter(...)`. That bypassed the capability seam — gateway code shouldn't import the impl module directly. Migrated each to `getConfigCenter()` from `@ownpilot/core`. After this commit only `server.ts` imports `gatewayConfigCenter` directly (it owns the install), and the file remains exported as the impl. Five test mocks of `./config-center-impl.js` were dropped or replaced with `getConfigCenter` stubs in the respective `@ownpilot/core` mocks.
- **Memory accessor sweep (2026-05-23)**: All `registry.get(Services.Memory)` callsites migrated to `getMemoryService()` direct accessor across 8 production files: `services/soul-heartbeat-service.ts`, `services/dashboard.ts`, `autonomy/context.ts`, `autonomy/executor.ts`, `routes/memories.ts` (11 callsites), `routes/souls-agent-routes.ts`, `triggers/engine.ts`, `assistant/orchestrator.ts`. The capability accessor pattern is now consistent: when a service has been promoted to a capability (`getMemoryService` / `getLLMRouter` / etc.), prefer that over the registry detour. Registry stays correct for services that aren't promoted yet (Goal, Trigger, Database, Plan, Workspace, etc.). Eleven test mocks gained a `getMemoryService` stub alongside their existing registry mocks so existing assertions still hit the same spy.
- **GoalService capability (2026-05-23)**: `IGoalService` (8th capability) gets the same accessor treatment — `getGoalService()` / `setGoalService()` / `hasGoalService()` in `packages/core/src/services/goal-service.ts`. Gateway registers at startup via `setGoalService()`. Not added to `RuntimeContext` bundle because Goal is a domain CRUD service used by routes + orchestrators rather than a horizontal capability every runtime needs — the RuntimeContext stays focused on shared infrastructure (LLM, channels, config, events, permissions, memory, audit). Eight callsites migrated: `routes/goals.ts` (14 callsites), `autonomy/context.ts`, `autonomy/executor.ts`, `services/dashboard.ts`, `triggers/engine.ts`, `assistant/orchestrator.ts` (3 callsites), `routes/souls-agent-routes.ts`. `autonomy/context.ts` no longer threads the registry through gather functions since the only services it touched (Memory + Goal) both have accessors now.
- **TriggerService capability (2026-05-23)**: `ITriggerService` (9th capability) — same pattern as Goal. `getTriggerService()` / `setTriggerService()` / `hasTriggerService()` in `packages/core/src/services/trigger-service.ts`. Not added to RuntimeContext for the same reason (domain CRUD service). Migrations: `routes/triggers.ts` (13 callsites), `assistant/orchestrator.ts` (2 callsites), `services/dashboard.ts`, `triggers/engine.ts`. After this commit `triggers/engine.ts` no longer touches `getServiceRegistry()` at all — every service it needs has an accessor (Trigger + Goal + Memory).
- **Claw Runtime**: Unified autonomous agent composing LLM + workspace + soul + coding agents + 250+ tools. Types in `core/src/services/claw-types.ts`. Runner/Manager/Service in `gateway/src/services/claw/{runner,manager,service}.ts`. 16 claw tools + 7 management tools in `tools/claw/tools.ts` + `tools/claw/management-tools.ts`. DB: `claws`, `claw_sessions`, `claw_history`, `claw_audit_log` (migrations 022, 023). REST: `/api/v1/claws` (16 endpoints including `/stats`, `/audit`, `/deny-escalation`). UI: ClawsPage (8-tab management panel + search/filter + bulk actions) + ClawsWidget (live WS updates). 117+ tests. Modes: `continuous` / `interval` / `event` / `single-shot`. Limits: MAX_CONCURRENT_CLAWS=50, MAX_CLAW_DEPTH=3, mission 10K chars. `.claw/` directive system: INSTRUCTIONS.md, TASKS.md, MEMORY.md, LOG.md (auto-scaffolded, injected into prompt). Working Memory: `claw_set_context`/`claw_get_context` for persistent cross-cycle state. Stop conditions: `max_cycles:N`, `on_report`, `on_error`, `idle:N`. Auto-fail after 5 consecutive errors. Daily cleanup: 90d history, 30d audit retention. Workflow: `clawNode` type in workflow system. Triggers can call `start_claw` tool action
- **Context Window Management**: `resolveContextWindow` / `resolveMaxOutput` / `computeMemoryMaxTokens` in `gateway/src/services/agent/cache.ts` — never hardcode per-model limits; resolve via these helpers (data syncs from models.dev). Memory cap formula budgets system prompt + dynamic-injection reserve + per-model output ceiling + 1024 safety margin, bounded by `ctxWindow * 0.75`. Shared by chat (`services/agent/service.ts`) and autonomous runners (`services/agent/runner-utils.ts`). Chat bar (`ContextBar.tsx` + `ContextDetailModal.tsx`) shows system + messages + cache rate; sessionInfo prefers provider's real `usage.promptTokens` over char/4 estimate
- **Auto-Compact**: `compactContext` in `services/agent/service.ts` rewrites older messages as a structured `GOAL / DECISIONS / ARTIFACTS / OPEN QUESTIONS` summary (user+assistant pair — NOT `role:'system'`, see below). UI banner at 85% fill (`AUTO_COMPACT_THRESHOLD` in `useChatStore.tsx`) with hysteresis, per-session decline, persistent "Don't ask again" via `STORAGE_KEYS.AUTO_COMPACT_DISABLED`. Compaction mirrors to DB via `mirrorCompactionToDatabase` so the change survives gateway restart / agent eviction. Concurrency guard rechecks message count after the summarization await to refuse if a chat stream landed mid-flight (`reason: 'concurrent_modification'`)
- **Provider message-format gotcha**: Anthropic provider in `core/src/agent/providers/anthropic-provider.ts:173-174` does `find(role:'system')` then `filter(role !== 'system')` — ALL system-role messages are stripped from the messages array (top-level `system` field is used instead). NEVER inject mid-conversation system anchors; use a `role:'user'` + `role:'assistant'` pair with an in-content tag (`[Conversation summary from compaction — ...]`)

## UI Preview (Claude Code Preview MCP)

This project is developed across multiple machines. Preview setup differs per environment.
**Before starting preview**, read the project memory for machine-specific context:
`~/.claude/projects/<your-project-slug>/memory/project_dev_setup.md`

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

<!-- dfmt:v1 begin -->

## Context Discipline

This project uses DFMT to keep tool output from flooding the context
window and to preserve session state across compactions. When working
in this project, follow these rules.

### Tool preferences

Prefer DFMT's MCP tools over native ones:

| Native     | DFMT replacement | `intent` required? |
| ---------- | ---------------- | ------------------ |
| `Bash`     | `dfmt_exec`      | yes                |
| `Read`     | `dfmt_read`      | yes                |
| `WebFetch` | `dfmt_fetch`     | yes                |
| `Glob`     | `dfmt_glob`      | yes                |
| `Grep`     | `dfmt_grep`      | yes                |
| `Edit`     | `dfmt_edit`      | n/a                |
| `Write`    | `dfmt_write`     | n/a                |

Every `dfmt_*` call MUST pass an `intent` parameter — a short phrase
describing what you need from the output (e.g. "failing tests",
"error message", "imports"). Without `intent` the tool returns raw
bytes and the token savings are lost.

On DFMT failure, report it to the user (one short line — which call,
what error) and then fall back to the native tool so the session is
not blocked. The ban is on _silent_ fallback — every switch must be
announced. After a fallback, drop a brief `dfmt_remember` note tagged
`gap` when practical, so the journal records that a call was bypassed.
If the native tool is also denied (permission rule, sandbox refusal),
stop and ask the user; do not retry blindly.

### Session memory

DFMT tracks tool calls automatically. After substantive decisions or
findings, call `dfmt_remember` with descriptive tags (`decision`,
`finding`, `summary`) so future sessions can recall the context after
compaction.

### When native tools are acceptable

Native `Bash` and `Read` are acceptable for outputs you know are small
(< 2 KB) and will not be referenced again. For everything else, DFMT
tools are preferred.

<!-- dfmt:v1 end -->
