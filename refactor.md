# OwnPilot — Refactor & Improvement Report

**Date:** 2026-05-15
**Scope:** Full monorepo audit — `packages/{core,gateway,ui,cli}`
**Version baseline:** v0.3.2

---

## 1. Executive Summary

OwnPilot is in healthy shape for a feature-rich product of its age. The codebase is a TypeScript monorepo of **~108 K lines** across **1 223 source files** and **564 test files**, with a strong test culture (**~26 K passing tests**). The boundaries between `core` (zero runtime deps), `gateway` (HTTP + integrations), `ui`, and `cli` are clear. Recent work has eliminated almost all `TODO/FIXME/HACK` markers (only 4 left, all in docs/prompts), normalised tool naming, and added a `ServiceRegistry` pattern that is _partially_ adopted.

The remaining technical risks are not architectural — they are **scale fatigue**:

1. Several "god files" have grown past 1 000–1 800 lines and need decomposition.
2. Two parallel singleton patterns (`ServiceRegistry` vs `let instance = null`) coexist; 27+ ad-hoc singletons remain.
3. Request validation is inconsistent — only **12** explicit Zod uses across **133** route files; most handlers parse JSON without runtime validation.
4. **30+** files explicitly carry "circular dependency workaround" comments with dynamic `import()` — a sign that the gateway has gravitational pull issues.
5. **4 failing tests** under full-suite concurrency (3 known-flaky from `MEMORY.md`, 1 new in `routes/database/operations.test.ts`).
6. No observability layer (no OpenTelemetry, Sentry, Prometheus); only an internal `tracing` ALS context.

None of these are emergencies. Each is a candidate for a focused refactor PR.

---

## 2. Repository Health at a Glance

| Metric                                 | Value                                            | Notes                                                      |
| -------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------- |
| Total TS/TSX lines                     | **107 895**                                      | Source + tests                                             |
| Source files                           | **1 223**                                        | Excluding tests/dist                                       |
| Test files                             | **564**                                          | 46% test-to-source ratio — strong                          |
| Largest source file                    | `claw-tools.ts` (1 852 LoC)                      | Over budget                                                |
| `TODO`/`FIXME`/`HACK` in code          | **4**                                            | Almost all eliminated                                      |
| `as any` (production)                  | **5**                                            | All intentional, with eslint-disable                       |
| `@ts-ignore`/`@ts-expect-error`        | **1**                                            | Excellent                                                  |
| Silent `.catch(() => {})`              | **46**                                           | UI-heavy; gateway has 1–2 legit ones                       |
| `console.*` (production)               | **107**                                          | 82 in `core/agent/debug.ts` (legitimate), 19 UI, 6 gateway |
| Lint warnings                          | **417 (gateway) / 60 (core) / 0 (ui) / 0 (cli)** | All `no-explicit-any`, almost entirely in `*.test.ts`      |
| Migrations                             | **34**                                           | All idempotent                                             |
| Singletons (`let instance: X \| null`) | **27** in gateway/services                       | Should adopt `ServiceRegistry` uniformly                   |
| Dynamic `await import()` count         | **344**                                          | High; reflects circular-dep workarounds                    |
| Files marked as circular workaround    | **30+**                                          | Codified in comments                                       |
| Failing tests under full concurrency   | **4 / 16 773**                                   | 3 known-flaky, 1 new                                       |

### Per-package size

| Package   | Source LoC | Test LoC | Test files                         |
| --------- | ---------- | -------- | ---------------------------------- |
| `gateway` | ~83 K      | ~66 K    | 403 test files vs 523 source files |
| `core`    | ~37 K      | ~34 K    | 138 test files                     |
| `ui`      | ~68 K      | small    | mostly Playwright                  |
| `cli`     | ~5 K       | full     | small surface                      |

---

## 3. Top-Priority Refactors (P0)

### 3.1 Decompose god files (>1 000 LoC)

Several files are too large to navigate, review, or test in isolation. Each should be split along clear domain seams.

| File                                                                                                                             | LoC   | Suggested split                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [packages/gateway/src/tools/claw-tools.ts](packages/gateway/src/tools/claw-tools.ts)                                             | 1 852 | One file per logical group: `lifecycle-tools.ts` (install, run_script), `delegation-tools.ts` (spawn_subclaw, send_agent_message), `output-tools.ts` (send_output, complete_report, publish_artifact), `context-tools.ts` (set/get_context, reflect), `meta-tools.ts` (get_status, get_history, update_config). Re-export an aggregate `CLAW_TOOLS` array. |
| [packages/ui/src/pages/claws/ClawDetailTabs.tsx](packages/ui/src/pages/claws/ClawDetailTabs.tsx)                                 | 1 799 | Already named `*Tabs.tsx` — pull each tab into `ClawDetail/<TabName>.tsx`.                                                                                                                                                                                                                                                                                 |
| [packages/gateway/src/services/workflow/node-executors.ts](packages/gateway/src/services/workflow/node-executors.ts)             | 1 694 | One file per executor (`condition-executor.ts`, `code-executor.ts`, `http-executor.ts`, …). Centralise shared helpers (`toToolExecResult`, `resolveWorkflowToolName`) into `node-executor-utils.ts`.                                                                                                                                                       |
| [packages/gateway/src/services/workflow/workflow-service.ts](packages/gateway/src/services/workflow/workflow-service.ts)         | 1 549 | Extract resume/approval, scheduling, persistence into siblings. The DAG runner itself should be the only thing left.                                                                                                                                                                                                                                       |
| [packages/gateway/src/channels/plugins/whatsapp/whatsapp-api.ts](packages/gateway/src/channels/plugins/whatsapp/whatsapp-api.ts) | 1 439 | Connection management, message handlers, media handling, auth — each is its own file.                                                                                                                                                                                                                                                                      |
| [packages/gateway/src/ws/server.ts](packages/gateway/src/ws/server.ts)                                                           | 1 427 | Extract login/throttle, channel routing, heartbeat, and per-event handlers. Keep the server bootstrap thin.                                                                                                                                                                                                                                                |
| [packages/ui/src/components/MarkdownContent.tsx](packages/ui/src/components/MarkdownContent.tsx)                                 | 1 416 | Split renderers (code, table, math, mermaid, citation) into a `markdown/renderers/` folder.                                                                                                                                                                                                                                                                |
| [packages/gateway/src/services/claw-manager.ts](packages/gateway/src/services/claw-manager.ts)                                   | 1 305 | Scheduling, lifecycle, persistence, and audit are separate concerns.                                                                                                                                                                                                                                                                                       |
| [packages/gateway/src/middleware/validation.ts](packages/gateway/src/middleware/validation.ts)                                   | 1 243 | One file per domain schema set (`agent-schemas.ts`, `chat-schemas.ts`, …).                                                                                                                                                                                                                                                                                 |
| [packages/ui/src/components/ToolPicker.tsx](packages/ui/src/components/ToolPicker.tsx)                                           | 1 247 | Extract list, filters, dialog, search hook.                                                                                                                                                                                                                                                                                                                |
| [packages/gateway/src/routes/workflow-template-ideas.ts](packages/gateway/src/routes/workflow-template-ideas.ts)                 | 1 186 | Move template seed data into a `data/` JSON file; keep the route thin.                                                                                                                                                                                                                                                                                     |
| [packages/gateway/src/tools/skill-tools.ts](packages/gateway/src/tools/skill-tools.ts)                                           | 1 180 | Split definitions vs. handlers.                                                                                                                                                                                                                                                                                                                            |
| [packages/core/src/plugins/isolation.ts](packages/core/src/plugins/isolation.ts)                                                 | 1 177 | Sandbox setup, permission gate, audit hooks are distinct.                                                                                                                                                                                                                                                                                                  |
| [packages/gateway/src/tools/agent-tool-registry.ts](packages/gateway/src/tools/agent-tool-registry.ts)                           | 1 159 | Group registrations by domain (`registerHabitTools()`, `registerClawTools()`, …) in companion files.                                                                                                                                                                                                                                                       |

**Acceptance:** no production file >800 LoC except dense data tables.

### 3.2 Unify singleton management on `ServiceRegistry`

`packages/core/src/services/registry.ts` defines a typed `ServiceToken`-based DI container. Gateway server.ts registers ~14 services through it, but **27** other services in `packages/gateway/src/services/` still use the legacy `let instance: X | null = null; export function getX()` pattern.

Sample offenders (full list grepped above):

- `artifact-service.ts`, `browser-service.ts`, `claw-manager.ts`, `claw-service.ts`,
  `cli-tool-service.ts`, `coding-agent-service.ts`, `coding-agent-sessions.ts`,
  `custom-data-service.ts`, `edge-mqtt-client.ts`, `edge-service.ts`,
  `embedding-queue.ts`, `embedding-service.ts`, `extension-sandbox.ts`,
  `agent-registry.ts`, `custom-tool-registry.ts`, …

**Problems caused by mixed patterns:**

- Tests cannot reliably reset state (no `resetSingleton()` helpers — grep returns 0).
  This is the root cause of the three known-flaky tests
  (`backup.test.ts`, `context-injection.test.ts`, `pipeline-middleware.test.ts`)
  documented in `MEMORY.md`.
- Boot ordering becomes opaque — `server.ts` is **841 LoC** and contains
  **69** initialize/import lines.
- Cyclic-dep workarounds (`await import()`) proliferate because order matters at
  module load time when singletons live at module scope.

**Plan:**

1. Promote every `let instance` to `register(Services.X, …)` at the proper boot stage in `server.ts`.
2. Add `Services.X` tokens to `core/src/services/registry.ts`.
3. Replace `getX()` call sites with `getServiceRegistry().get(Services.X)`.
4. Add `registry.reset()` per-test (already supported by the disposable interface).
5. Document the boot order in `docs/SERVICE_CATALOG.md`.

### 3.3 Standardise request validation

Today's reality:

- `packages/gateway/src/middleware/validation.ts` defines **dozens of Zod schemas** but they are _only used in select routes_ (~12 explicit `Schema.parse` calls vs **79** raw `await c.req.json()` invocations).
- Routes that parse JSON without validation include `agent-command-center.ts`, `claws.ts`, `mcp.ts`, `personal-data.ts`, `fleet.ts`, `edge.ts`, `bridges.ts`, `costs.ts`, `crews.ts`, `notifications.ts`, … — i.e. the most security-sensitive surface.

**Plan:**

1. Adopt `@hono/zod-validator` or wrap the existing schemas in a `validateBody(schema)` middleware that 400s on failure with `apiError(c, msg, ERROR_CODES.VALIDATION, 400)`.
2. Define one schema per route in `<route>-schemas.ts` next to the route file.
3. Enforce via lint rule: a custom ESLint rule that flags `await c.req.json()` inside a `routes/*.ts` file unless wrapped in `validateBody`.
4. Generate OpenAPI from the schemas (e.g. `@hono/zod-openapi` or `zod-to-openapi`) — eliminates `docs/API_ROUTES.md` drift.

### 3.4 Replace circular-import workarounds with explicit layering

`grep` found **30+** files with comments like `Lazy-imported to break circular dependency` and **344** `await import()` calls overall. Specific cases:

- `routes/agents.ts` ↔ `ws/server.ts` (lazy import in WS)
- `routes/custom-tools.ts` ↔ `services/custom-tool-registry.ts` (already extracted, but pattern persists)
- `services/conversation-service.ts` ↔ `assistant/chat-post-processor.ts`
- `routes/chat.ts` ↔ `routes/chat-state.ts`
- `plans/executor.ts`, `routes/webhooks.ts`, `routes/mcp.ts`, `services/cli-chat-provider.ts`, `services/mcp-server-service.ts`

**Each `await import('relative.js')` is a code-smell signal**, not a design choice — it pays a startup cost, defeats tree-shaking and bundle analysis, and obscures the dependency graph.

**Plan:**

1. Introduce a strict layering rule: `routes/` → `services/` → `db/repositories/` → `core/`. No upward imports.
2. Add `dependency-cruiser` to CI with rules forbidding both upward layer crossings and the `await import(./relative)` workaround.
3. Move dynamic imports of external packages (e.g. optional `node-pty`, `@anthropic-ai/claude-agent-sdk`) into a single `lazy-deps.ts` so the rule can carve them out cleanly.

### 3.5 Fix the four failing tests under full-suite concurrency

```
FAIL  src/services/agent-runner-utils.test.ts > uses openai provider type for non-native providers
FAIL  src/services/cli-chat-provider.test.ts > streams ToolBridge progress across rounds for gemini
FAIL  src/services/subagent-runner.test.ts > uses non-native provider type as "openai"
FAIL  src/routes/database/operations.test.ts > GET /db/stats > returns detailed stats when connected
```

The first three are documented in `MEMORY.md` as "passes in isolation, hangs under concurrency" — suspected module-singleton pollution. **3.2 resolves these by design** (`registry.reset()` between tests).

The `routes/database/operations.test.ts` failure appears new and is not in memory — investigate next session.

---

## 4. Architecture-Level Improvements (P1)

### 4.1 Adopt OpenTelemetry for end-to-end tracing

Today's `packages/gateway/src/tracing/index.ts` is a custom in-process trace context, not exported anywhere. There is no OTel, no Sentry, no Prometheus exporter.

Recommendation: keep the internal trace types (they're domain-flavoured — `tool_call`, `memory_recall`, `autonomy_check`) but emit them as OTel spans via `@opentelemetry/sdk-node`. Auto-instrument Postgres, HTTP, Hono. Add a `pino` → OTel logs bridge (you already use pino). Self-hosted users can ignore OTel; ops users can wire any backend.

### 4.2 Remove dead Discord/Slack channel plugins (or revert the memory note)

`MEMORY.md` says "Channels: Telegram + WhatsApp (Baileys). Discord/Slack/LINE/Matrix removed."
But:

- `packages/gateway/package.json` still depends on `@slack/socket-mode`, `@slack/web-api`, `discord.js`.
- `packages/gateway/src/channels/plugins/{discord,slack,matrix}/` still contain code, tests, and normalizers.
- `dead-code-audit-report.md` from April 2026 is contradictory to the March 2026 cleanup note.

This is the largest **memory ↔ code drift** in the project. Either:

1. Genuinely retire those plugins (drop deps — `discord.js` alone is ~50 transitive packages — and delete the folders), or
2. Update `MEMORY.md` to reflect that they are still active.

### 4.3 Reduce console.\* in the agent debug layer

82 of the 107 production `console.*` calls live in [packages/core/src/agent/debug.ts](packages/core/src/agent/debug.ts). They render formatted boxes with `─`/`═` characters. Pipe these through the structured logger (`getLog('AgentDebug')`) with a custom `debug-trace` level. Benefits: respect log levels, work in non-TTY contexts (Docker, CI), enable redaction.

### 4.4 Audit silent `.catch(() => {})`

46 instances; most are UI fire-and-forget (`hooks/useChatStore.tsx`, `components/MiniChat.tsx`). The dangerous ones live in gateway:

- [packages/gateway/src/services/agent-runner-utils.ts:456](packages/gateway/src/services/agent-runner-utils.ts#L456) — `getProviderMetricsRepository().record(metricInput).catch(() => {})` swallows persistence errors silently. Should log at `warn` and surface via `getLog` so an ops user sees billing-data drift.

Triage rule: every silent catch should either (a) be replaced by `.catch(err => log.warn('…', err))`, (b) use a `void` operator with a comment explaining why the failure is safe to discard, or (c) be eliminated by handling at a higher level.

### 4.5 De-duplicate the `resolveProviderAndModel` family

`MEMORY.md` documents that "two `resolveProviderAndModel()` exist by design: simple (settings.ts) vs full waterfall (agent-runner-utils)." Reconsider — is the simple variant ever the right answer when the full waterfall exists? A single canonical resolver with a `{ strict: boolean }` flag would remove the divergence risk.

### 4.6 Replace MD5 in tool-templates

[packages/gateway/src/routes/tool-templates.ts:762](packages/gateway/src/routes/tool-templates.ts#L762) advertises `md5` and `sha1` as default hash algorithms. Both are broken; keep them only if a tool explicitly opts in for compatibility with legacy data. Default should be `sha256` (already supported). Same for [packages/core/src/sandbox/context.ts:115](packages/core/src/sandbox/context.ts#L115) — `md5` exposed in the sandbox should at minimum be deprecated with a warning.

### 4.7 `getAdapterSync()` removal

`packages/gateway/src/db/adapters/index.ts` exposes `getAdapterSync()` "for backwards compatibility with existing synchronous code." Grep its call sites and migrate them; sync DB access in an async runtime is a foot-gun (initialization races).

---

## 5. UI Refactors (P1)

### 5.1 Page-component decomposition

Twelve pages exceed 1 000 LoC. Each is loaded lazily, so bundle impact is contained, but maintainability is poor. Standard split: `Page → SectionContainer → Card → Field`.

Pages to split first (by frequency of recent change vs. size):

- [`ChatPage.tsx`](packages/ui/src/pages/ChatPage.tsx) (1 299) — extract `MessageList`, `Composer`, `ToolbarBar`, `ScrollManager`.
- [`McpServersPage.tsx`](packages/ui/src/pages/McpServersPage.tsx) (1 328).
- [`CodingAgentsPage.tsx`](packages/ui/src/pages/CodingAgentsPage.tsx) (1 362).
- [`SystemPage.tsx`](packages/ui/src/pages/SystemPage.tsx) (1 212), [`ProfilePage.tsx`](packages/ui/src/pages/ProfilePage.tsx) (1 219), [`LogsPage.tsx`](packages/ui/src/pages/LogsPage.tsx) (1 185), [`TriggersPage.tsx`](packages/ui/src/pages/TriggersPage.tsx) (1 096), [`PlansPage.tsx`](packages/ui/src/pages/PlansPage.tsx) (1 066).

### 5.2 Centralise UI fire-and-forget pattern

The 13+ `.catch(() => {})` in hooks/components are real bugs in disguise. Provide a small helper:

```typescript
export const ignore = <T>(p: Promise<T>) =>
  p.catch((err) => {
    log.warn('ignored:', err);
  });
```

…and require its use. The eslint rule can flag bare `.catch(() => {})`.

### 5.3 Component memo audit

262 of 327 `*.tsx` files do **not** use `React.memo`, `useMemo`, or `useCallback`. Most are leaf components where that is correct, but several of the >700-LoC components likely benefit (large lists, charts in `AnalyticsPage`). React DevTools profiling would identify hotspots.

---

## 6. Data Layer (P2)

### 6.1 Repository abstraction is good — keep tightening it

`BaseRepository` (`db/repositories/base.ts`) provides `query/queryOne/execute/exec/transaction/now/boolean`. Excellent. But:

- **140** repositories is a lot. Several can merge (`pomodoro` + `habits` + `goals` arguably form one "productivity" repo; `model-configs` + `local-providers` overlap).
- Transaction usage is rare — only 2 call sites in production grep (`channel-messages.ts:405`, plus the type signatures). Many multi-statement flows that should be atomic likely aren't.
- The largest repositories (workflows: 960 LoC, memories: 952, plans: 921, claws: 899) carry domain logic that belongs in the matching `services/`. Repos should be CRUD-only; complex queries are fine, but business decisions ("should this claw run now?") are not.

### 6.2 Test the migration set against PostgreSQL 16 in CI

CI runs against an arbitrary database; migrations 001–034 should be applied against `pgvector/pgvector:pg16` in CI on every PR to catch ordering or idempotency regressions. The pattern is documented in `CLAUDE.md` ("Testing migrations") but not wired into `.github/workflows/ci.yml`.

### 6.3 Index review with `EXPLAIN ANALYZE`

Migration 027 (`performance_indexes.sql`) was added April 2026. Worth a fresh `EXPLAIN ANALYZE` pass against a realistic dataset — particularly for:

- `chat_history (chat_id, created_at DESC)` — interaction with the `claw_history` truncation work in commit `032868e8`.
- `workflow_executions (status) WHERE status IN ('running', 'paused')` — partial indexes are fragile across PG upgrades.

---

## 7. Security & Privacy (P1)

### 7.1 CSP and security-headers tightening

`app.ts` already uses `secureHeaders()` from Hono. Audit the actual emitted CSP — long-running interactive UI plus eval'd workflow code nodes means a clean CSP is hard. Document what is loosened and why.

### 7.2 Workflow code-node sandbox

The workflow node-executors run user-controlled JS via `node:vm`. Memory note `MAX_ARRAY_EVAL_SIZE = 10_000`, `MAX_EXPRESSION_LENGTH = 10_000`, and `validateToolCode` is invoked. Good. But `vm.runInContext` is not a security boundary — confirm that all node-executor entry points run in an actual sandbox (Workers, isolated-vm, or Docker), not just `vm`. The same applies to `core/src/agent/tools/dynamic-tool-sandbox.ts`.

### 7.3 SSRF coverage

`MEMORY.md` notes the `packages/gateway/src/utils/ssrf.ts` helper. Confirm every outbound HTTP call goes through `safeFetch` (it's used by workflow node-executors). `WebFetch`-equivalents elsewhere (browser-service, channel webhooks) need an audit.

### 7.4 PostgreSQL credentials in `.env.example`

`POSTGRES_PASSWORD=ownpilot_secret` is documented as the default in both `docker-compose.yml` and `.env.example`. Self-hosters who skim the README will deploy with the published default. Add a SECURITY note and a pre-flight check in `server.ts` that warns when the default is detected in `NODE_ENV=production`.

---

## 8. Tooling & DX (P2)

### 8.1 ESLint cleanup target

417 warnings in gateway are almost entirely `@typescript-eslint/no-explicit-any` in **test files**. Two options:

1. Allow `any` in test files via an overrides block in `eslint.config.js`.
2. Type the test mocks properly — better, but ~358 sites of work.

Pick (1) so production warnings remain visible.

### 8.2 Vitest watch/concurrency tuning

The 3 flaky tests are concurrency-related (module singletons). Once §3.2 lands, consider lowering `vitest.config.ts` `pool` concurrency from default if cost is acceptable, or run flagged tests in a serial pool.

### 8.3 Type-only imports

`tsconfig.base.json` has `verbatimModuleSyntax: true` — good. Run `eslint-plugin-import` with `consistent-type-imports` to catch missing `import type` (helps tree-shaking, faster builds).

### 8.4 Pre-commit hook

`husky` is installed but the project doesn't show a `.husky/` directory in root. Wire `lint-staged` for fast `prettier` + `eslint --fix` on changed files; cuts CI failures.

### 8.5 Bundle analysis for UI

`packages/ui` lazy-loads 64 pages, which keeps the main bundle small. Add `rollup-plugin-visualizer` to `vite.config.ts` and gate the PR on bundle-size diff (e.g. via `bundle-stats`).

---

## 9. Documentation Drift (P2)

`docs/` has 25 markdown files. Several show drift:

- `dead-code-audit-report.md` (April 2026) is now ~5 weeks stale and contradicts `MEMORY.md` re: Discord/Slack plugins.
- `refactor_plan.md` (April 2026, 49 KB) overlaps with this file's intent — merge or supersede.
- `architecture.md` (93 KB, dated 2026-05-08) is huge but recent — verify it reflects the post-Claw runtime layout.
- `ADR/` directory exists; encourage one ADR per major decision and reference them from `CLAUDE.md`.

`CHANGELOG.md` is well-maintained; keep it.

---

## 10. Recommended Refactor Sequencing

The work in §3 and §4 can land as small PRs that don't block product development.

| Wave                                | PRs                                                                                                                                                                                      | Risk           | Effort           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ---------------- |
| **1. Quick wins**                   | (a) ESLint test-file overrides<br>(b) Replace remaining `console.*` outside `agent/debug.ts`<br>(c) Audit silent `.catch(() => {})` in gateway<br>(d) Add CI migration test against pg16 | Low            | 1–2 days each    |
| **2. Service registry adoption**    | Migrate `let instance` services in groups of 4–5 per PR; add `registry.reset()` in tests                                                                                                 | Medium         | 2–3 weeks        |
| **3. Validation rollout**           | `validateBody` middleware + one PR per route domain (agents, chat, workflows, …)                                                                                                         | Low (additive) | 1 PR per domain  |
| **4. God-file decomposition**       | One refactor PR per file in §3.1, smallest first                                                                                                                                         | Low            | 1–2 days each    |
| **5. Circular-dep elimination**     | Add `dependency-cruiser`, fix violations in groups                                                                                                                                       | Medium         | 1 week + ongoing |
| **6. Memory ↔ code reconciliation** | Decide Discord/Slack fate; update `MEMORY.md` either way                                                                                                                                 | Low            | 1 day            |
| **7. OTel adoption**                | Span emission shim + auto-instrumentation                                                                                                                                                | Medium         | 1 week           |
| **8. UI page split**                | Tackle the 12 large pages incrementally                                                                                                                                                  | Low            | 1 PR per page    |

---

## 11. What is _not_ recommended

A few things deliberately left out — they would be churn for churn's sake:

- **Don't replace pg with an ORM.** The repository pattern + raw SQL is fast, explicit, and the team owns it. Prisma/Drizzle would add ceremony without much win.
- **Don't merge `core` and `gateway`.** Core's zero-dependency boundary is genuinely valuable for plugin authors and for tests.
- **Don't migrate Hono → Fastify/Express.** Hono is fast, edge-ready, and you have ~1 900 `apiResponse`/`apiError` call sites tied to it.
- **Don't switch test runners.** Vitest 4.x is current and 26 K tests is a sunk cost worth keeping.
- **Don't introduce a state-management library in UI.** The current Zustand-flavoured stores (`useChatStore`, etc.) plus React Query patterns are sufficient.

---

## 12. Appendix — How this report was generated

- File counts via `find ... | wc -l`
- LoC via `wc -l` filtered by package
- Pattern grep over `packages/*/src` with `--include="*.ts" --include="*.tsx"` excluding `*.test.*`
- Test failure data from a fresh `pnpm --filter @ownpilot/gateway test`
- Singleton inventory via `grep -rn "^let _\?\(instance\|service\|manager\)"`
- Validation gap via `grep -c "await c.req.json()"` vs `grep -c "Schema.parse\|safeParse"`
- ESLint warnings via `pnpm lint` per package

All findings cross-referenced against `CLAUDE.md` and the auto-memory at
`C:\Users\ersin\.claude\projects\d--Codebox-PROJECTS-OwnPilot\memory\MEMORY.md`.

---

_End of report._
