# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.2] - 2026-06-05

### Fixed

- **Plan cancellation is now prompt during parallel wave execution.** When every concurrency slot was full of slow steps, a cancelled plan kept spinning the `maxConcurrent` slot-wait until a step happened to finish — the wave-top abort check couldn't fire while the inner scheduling loop held control. The slot-wait (and the step-scheduling loop) now re-check `signal.aborted` and stop scheduling new steps immediately. Already-scheduled steps are still awaited via `Promise.all` before the abort is surfaced, so no in-flight promise is orphaned (which would otherwise become an unhandled rejection).

## [0.7.1] - 2026-06-05

### Fixed

- **Job-queue worker no longer leaks unhandled promise rejections on DB errors.** `JobQueueService` runs `executeJob` and `pollWorker` fire-and-forget from three callsites; only `pollAll` isolated rejections (via `allSettled`). A transient DB failure while finalizing a job (`repo.complete`/`repo.fail`) or claiming one (`repo.claimJob`) therefore surfaced as an unhandled rejection — a misleading "Unhandled Promise Rejection" log with no job context. `executeJob` now swallows + logs its own persistence errors (never rejects), and the immediate-start and per-job re-poll go through a `safePoll` wrapper that catches `pollWorker` rejections. The worker still frees the slot and re-polls in every case.

## [0.7.0] - 2026-06-05

### Added

- **Personal memory now has an always-on retention schedule.** Previously, personal-memory decay and cleanup ran only via manual REST calls or user-enabled triggers — there was no default daily enforcement (unlike the autonomous Claw runtime, which already trims its own tables daily). A new daily scheduler runs importance decay + dead-memory cleanup automatically. It is pure hygiene — no LLM calls, no conversation extraction, no semantic consolidation — and only removes already-dead entries (importance below 0.1, older than 90 days, and untouched for 90 days), so it runs by default while the LLM-driven `memory_extract` / `memory_consolidate` triggers stay opt-in. Cleanup (an idempotent delete) runs on startup and daily; the compounding decay step runs only on the daily tick, so it stays independent of how often the process restarts.

### Fixed

- **UI shipped unstyled when the Tailwind native scanner fell back to WASM.** Tailwind v4 scans sources with the native `@tailwindcss/oxide` addon; when its platform binary fails to load (a corrupt `@tailwindcss/oxide-win32-x64-msvc` install — missing `package.json` — on Windows), oxide silently falls back to its WASM build, which scans nothing and emits a utility-less ~13 KB stylesheet instead of ~250 KB, with no error. A new build-only `css-size-guard` Vite plugin now **fails the build** if total emitted CSS is under 80 KB, so this can never silently ship (including in Docker images) again.
- **Skills uninstall now hard-deletes files from disk.** Skills were stored both as a `user_extensions` row and as files in a scanned directory; uninstall only removed the row, so the boot scan re-imported them. Managed/personal/workspace-tier skills now have their directory removed on uninstall (bundled skills stay marker-only).
- **Compiled `vite.config` no longer shadows the source.** `tsconfig.node.json` was emitting `vite.config.js`/`.d.ts` next to the source and both were committed; Vite resolves `.js` before `.ts`, so `pnpm dev` silently loaded the stale compiled config. The emit is redirected to a cache dir and the artifacts are gitignored — `vite.config.ts` is now the single source for both dev and build.

### Changed

- **Maintainability sweep (internal, no behavior change).** A Knip-driven pass removed 15 unused files, 4 dead functions, and a long tail of unused type/value exports across core, cli, gateway, ui, and the website; `knip.json` was made accurate across all workspaces (unused-files 63 → 0). Two genuine runtime import cycles were broken in core (costs, plugins). Several oversized files were split into focused co-located modules — `ChatPage`, `TemplateGallery` (1379 → 122 lines), `CodingAgentsPage`, `McpServersPage` (1425 → 1089), `SystemPage`, and `ProfilePage` (1641 → ~1270) — extracting pure data, constants, URL-safety helpers (with new tests), and self-contained presentational components.

## [0.6.0] - 2026-06-04

### Security

A sustained hardening campaign (manual audits 2026-05-30 → 2026-06-04) across all four packages. Highlights:

- **Core sandbox host-Function RCE escape closed.** A second escape path (beyond the 0.5.1 constructor-chain fix) let sandboxed code reach the host `Function` constructor; now blocked at both the context-injection and code-validator layers.
- **Critical RCE + High findings remediated** from the 2026-06-01 scan (CI actions pinned to commit SHAs, OpenAPI docs disabled in production by default, persisted error-stack length capped, dev UI container hardened).
- **IDOR sweep.** Owner-scoping enforced on previously-unscoped endpoints: notification send + preferences, CLI providers `PUT`/`DELETE`/`test`, channel-user management (`approve`/`block`/`unblock`/`unverify`/`delete`), plus IDOR-004 through IDOR-019. The single-user `default` owner guard no longer 401-loops legitimate access.
- **SSRF.** Sandbox network `fetch` now defaults to an SSRF-safe wrapper instead of raw `globalThis.fetch`; IPv4-mapped IPv6 addresses are treated as private; RSS feed fetches routed through `safeFetch` to close a redirect-based SSRF.
- **Filesystem sandbox.** Scoped-fs workspace jail resolves symlinks (including for non-existent paths); PDF and image tool I/O confined to the workspace; local-executor output bounded during streaming.
- **Channels.** `/connect` single-use tokens claimed atomically (TOCTOU); redelivered inbound webhooks deduplicated before paid AI routing; bridge filter patterns rejected when ReDoS-prone; Telegram tool-approval clicks must originate from the prompt's own chat; pairing key no longer disclosed to unclaimed-bot messagers; Discord/Slack/Matrix `connect()` guarded against double-connect handle leaks.
- **Auth / transport.** WebSocket auth key-length timing side-channel closed (timing-safe compare); password-change cutoff enforced on the session cache-hit path; WS self-origins forced to HTTPS with a production origin warning.
- **Coding agents / CLI.** Gateway secrets no longer leak into spawned CLI environments (both `child_process` and Claude Code SDK paths); Windows `cmd.exe` arguments escaped to prevent command injection.
- **Privacy.** PII detector match loop guarded against infinite loops; overlapping matches coalesced so redaction can't leak through gaps.
- **Plugins / skills.** Isolated-fetch response size cap enforced while streaming; npm skill installer redirects capped to prevent infinite recursion; a loud warning is emitted when a signed manifest is verified without an integrity check.
- **Budget.** Pre-spend enforcement added on the chat route (BUDGET-001/002); soul monthly budget cap now enforced (previously only the daily cap was).

### Added

- **Capability accessor architecture.** Every `Services.X` registry token now has a matching `getXService()` / `setXService()` / `hasXService()` accessor (30/30). A new `RuntimeContext` bundles the horizontal capabilities (LLM router, channels, config, events, permissions, memory, audit) that every autonomous runtime needs; Claw and Soul Heartbeat consume it explicitly for mockable dependencies.
- **Dynamic provider discovery.** Provider listings now read the `data/providers/` directory (140 synced model catalogs from models.dev) instead of a hardcoded list, so newly-synced providers surface without code changes.
- **Claw guardrail enforcement + learning loop.** `ClawAutonomyPolicy` is now enforced at tool-call time (was prompt-only); completed runs are auto-distilled into reusable `claw-learned` skills (`claw_save_skill` / `claw_recall_skill`), with ShareGPT trajectory export, browser accessibility-tree mode, and programmatic tool calling (`claw_execute`).
- **Startup security enforcement.** `enforceSecurityConfig()` is wired into server boot — mode-aware Docker requirement (hard-fails only when `EXECUTION_MODE=docker`) plus dangerous-env-var checks in production.
- **Browser tools** — `browser_navigate_back` and `browser_hover`.
- **Cross-channel bridges** — UCP bridges wired into the live message pipeline with bot-origin + self-target loop guards.

### Changed

- **Single-tenant model.** Gateway route handlers use a fixed `LOCAL_OWNER_ID` (`'default'`) instead of per-request user resolution; residual ownership guards are retained so cross-owner resources still 404.
- **Cost pricing** falls back to synced provider-JSON pricing for models absent from the static table (so e.g. Cohere bills at real price instead of $0); the static table stays primary.
- **Source tree reorganized** into family subdirectories under `services/`, `routes/`, `tools/`, and `db/repositories/`; file prefixes dropped inside each family.

### Fixed

- **Extensions** — removal-marker queries cast params to `::text` to fix Postgres "could not determine data type of parameter" errors (the feature was silently non-functional).
- **Plans** — a user-aborted running plan is persisted as `cancelled`, not overwritten to `failed`.
- **Autonomy** — the pulse timer re-arms when a scheduled tick overlaps a manual pulse (previously the autonomous loop silently died until restart).
- **Workflow** — approval pauses are no longer finalized as `failed` (approvals were entirely broken); conditional/switch skips no longer swallow downstream rejoin/merge nodes; the execution lock is released when run setup throws.
- **Triggers** — schedule and condition triggers advance their cursor on failure too, so a throwing trigger no longer hot-loops every poll.
- **Channels** — error paths replace the dangling "Thinking…" placeholder instead of orphaning it; SMS/Matrix long replies are split instead of truncated; `/model` and cost tracking use the real resolved model.
- **Coding agents** — `terminateSession` fires completion callbacks (waiters no longer hang); the PTY is disposed on error/timeout, not just clean exit; ACP terminal state is guarded against overwrite; cancellation is honored instead of being overwritten with `completed`.
- **ACP** — `AcpClient.close()` and `TerminalManager` now have working SIGKILL fallbacks.
- **WebSocket** — idle-session reaping unsubscribes EventBus listeners (was leaking up to 50 listeners per dropped client); the UI no longer auto-reconnects after an intentional close.
- **Edge** — MQTT `+` wildcard requires a present level; reconnect ends the prior client and guards stale handlers.
- **Claw** — mid-cycle inbox messages are preserved when the inbox is at its cap.
- **Concurrency** — the scheduler never runs the same task concurrently with itself; the job pool serializes `pollWorker` so a worker can't exceed its concurrency; batch embeddings enforce a 1:1 input/output count.
- **Compaction** — the DB mirror is skipped when there's nothing older to summarize.
- **Postgres** — per-connection timeouts are applied via libpq `options` startup params instead of a racing `SET`.
- **Extensions** — `recover()` clears the error state after a successful reload.

### Removed

- **Fleet, Subagent, and Orchestra subsystems removed.** These three autonomous-agent surfaces overlapped with existing primitives without adding unique value: Fleet's "worker army" was covered by Claw's concurrent cycles + `claw_spawn_subclaw` and Workflow's `parallelNode`; Subagent's ephemeral spawn was covered by `claw_spawn_subclaw` and Crew's `delegate_task`; Orchestra was tightly coupled to Subagent and couldn't survive its removal. Migration 038 drops `fleets`, `fleet_sessions`, `fleet_tasks`, `fleet_worker_history`, `subagent_history`, and `orchestra_executions`. The mental model is now **Agent (base) → Claw (unified runtime) → Soul/Crew/Heartbeat (persistent team identity)** with Workflow and Coding Agents as separate paradigms.
- **Dead-code sweep** — a Knip-driven pass removed ~1,700 lines of unused exports, dead singletons, and phantom dependencies (gateway unused exports: 225 → 27).

### Dependencies

- `react-router-dom` → `^7.16.0` (resolves 5 CVEs).

## [0.5.1] - 2026-05-22

### Security

Forensic audit pass on `packages/core`. 11 CRITICAL+HIGH findings; all closed.

- **CRITICAL — sandbox host-realm RCE via constructor chain.** Verified end-to-end: before this fix, plugin code running in `WorkerSandbox` could execute `new URL('http://x').constructor.constructor('return process.versions.node')()` and obtain real host-realm `process` access. The injected host `URL` (and `URLSearchParams`, `TextEncoder`, `TextDecoder`, `Response`, `Request`, `Headers`) walked into the host `Function` constructor, which compiles strings in the host realm and is NOT governed by `vm.createContext`'s `codeGeneration.strings:false`. Three-layer fix in `core/sandbox/context.ts` + `core/sandbox/code-validator.ts`: (a) stop injecting V8-already-provided constructors (`Date`, `RegExp`, `Error`, `JSON`, `Math`, typed arrays, `DataView`) — the VM context provides its own safe versions; (b) Proxy-wrap the Node-only host constructors V8 doesn't supply, returning a sandbox-realm stub Proxy from `.constructor` that recursively returns itself and throws on call; (c) extend the static code-validator regex to catch the `'construct'+'or'` string-concat bypass.
- **CRITICAL — `SecurePluginRuntime` removed.** The legacy runtime in `core/plugins/runtime.ts` advertised plugin isolation but provided none: its worker had `eval: true` with full Node access, `pluginModule` was never assigned (so every `call()` returned "Method not found"), and the entire API had zero callers in gateway/cli/ui. Deleted the file, its 1,500-line test, and the corresponding re-exports from `core/plugins/index.ts`. The functional plugin system is `PluginRegistry`.
- **CRITICAL — WorkerSandbox concurrency race.** Two concurrent `execute()` calls both passed the `state !== 'idle'` check after the lazy-init `await`; the second overwrote `currentResolve`/`currentReject`/`executionTimeout` — the first promise hung forever. Now serialized via a sync busy-flag + queue; uncontended calls still run inline so the synchronous `worker.postMessage` side-effect is preserved.
- **HIGH — Plugin network SSRF (no DNS resolution).** `PluginIsolatedNetwork.fetch` only checked literal IPv4 octets, so `evil.com` whose A record points at `169.254.169.254` (cloud-metadata endpoint) sailed past the guard. Added DNS resolution via `node:dns/promises` with 1-minute block cache, IPv4-mapped-IPv6 and CGNAT (`100.64.0.0/10`) ranges in the static check, redirect-target re-check, and fail-closed on unresolvable hostnames.
- **HIGH — Unbounded parallel tool execution.** `ToolRegistry.executeToolCalls` did `Promise.allSettled` with no concurrency cap; an LLM (possibly driven by prompt injection) could return 100+ tool calls in a turn and spawn sandboxes, hit paid APIs, and drain rate limits in parallel. Capped at 8 concurrent via an index-based worker pool.
- **HIGH — HookBus has no per-handler timeout.** A handler that never resolves used to block the entire chain and every awaiting caller (e.g. `tool:before-execute` blocked every tool call). Each handler is now raced against a 5-second timeout; the chain continues with the offender skipped.
- **HIGH — Memory store path traversal via userId.** `ConversationMemoryStore` and `PersonalMemoryStore` joined `userId` directly into the storage path; a caller passing `../../../etc/foo` escaped the per-user partition. Added `assertSafeUserId(/^[A-Za-z0-9_.-]{1,128}$/)` in both constructors.
- **HIGH — `SecureMemoryStore` empty salt default.** `loadOrCreateSalt()` resolved the salt and used it to derive the encryption key, but never propagated it back to `config.installationSalt` — so `hashUserId()` and `hashContent()` silently used the empty-string default, making both hashes deterministic and identical across every OwnPilot install on earth. Defeats the per-installation isolation property. Now propagated.
- **HIGH — `CredentialContext` plaintext cache TTL.** Decrypted credential plaintext used to linger in the cache forever in long-lived services (background workers, soul heartbeat). Entries now expire after 5 minutes.
- **HIGH — Silent random encryption key.** `createInMemoryCredentialStore` silently generated a random key when none was configured. If a persistent backend was swapped in, all credentials would be unreadable after restart. Now throws in `NODE_ENV=production`; emits a loud warning otherwise.
- **HIGH — Worker exit cross-plugin pending-call leak.** When one plugin's worker exited, the runtime iterated the global `pendingCalls` map and rejected EVERY in-flight call, including those belonging to other plugins. Now tagged with `pluginId` and scoped to the exiting plugin only.

### Fixed

- **WhatsApp channel resilience (440 displace storm).** `consecutive440Count` was reset on every successful `'open'` event, which defeated `MAX_CONSECUTIVE_440=3` during brief-reconnect storms. Now deferred behind a 2-minute stable-connection window so a flapping connection cannot zero the counter on every cycle.
- **Telegram channel resilience (409 conflict storm).** Symmetric to the WhatsApp fix: `reconnectAttempts = 0` in `onStart` was deferred behind the same 2-minute stable-connection window, so `RECONNECT_CONFIG.maxAttempts=10` can no longer be defeated by a 409 conflict bouncing the poller between brief successes.

### Removed

- `SecurePluginRuntime`, `createPluginRuntime`, `getDefaultRuntime`, `resetDefaultRuntime`, `type PluginState`, `type PluginInstance`, `type LoadOptions`, `type RuntimeConfig`, `type RuntimeEvents`, and class `PluginSecurityBarrier` from `@ownpilot/core/plugins`. Net diff: -2,489 lines. External consumers should migrate to `PluginRegistry` (already used internally).

## [0.5.0] - 2026-05-22

### Added

- **Tunnel system** — Full tunnel wizard, service, routes, and UI for exposing local services securely.
- **OpenAPI 3.1 spec** — Auto-generated OpenAPI document with embedded Swagger UI explorer for gateway endpoints.
- **Pulse Engine: claw monitoring** — Claw runtime state surfaced through the Pulse Engine.
- **Heartbeat: full feature set** — Circuit breaker, retries, metrics, and forecasting layered onto the soul heartbeat service.
- **Claws: 8 new management tools** — `pause_claw`, `resume_claw`, `update_claw`, `delete_claw`, `doctor_claw`, `apply_fixes_claw`, `restart_claw`, plus one additional management primitive.
- **Claws: LLM concurrency slot limiter** — Bounded provider parallelism with live UI feedback in `ClawsPage`.
- **Claws UI rework** — Sidebar tabs, header start/stop/pause controls, dedicated Runs tab, Schedules tab for interval/mode monitoring, enriched Overview/Stats/Skills/Config/Doctor/Audit/Conversation/Output tabs (search, filters, expanded views, JSON export), bulk start/pause and escalations batch approve/deny, needs-attention badge in header, live output feed, interval config in CreateClawModal and ClawCard, AI mission assist in CreateClawModal and SettingsTab.
- **FileBrowser enrichment** — In-tree search, folder creation, and folder toggle.
- **ClawCard enrichment** — Skills, coding agent, and preset badges surfaced on each card.

### Changed

- Bumped OwnPilot workspace packages from `0.4.0` to `0.5.0` for the next minor release.

### Fixed

- **Channel resilience** — Both WhatsApp (`consecutive440Count`) and Telegram (`reconnectAttempts`) now defer the on-success counter reset behind a 2-minute stable-connection window. A 409/440 displace storm with brief successful opens between conflicts can no longer zero the counter on every cycle and loop past `maxAttempts`.
- **8 CRITICAL gateway findings** — Transaction boundaries, semaphore correctness, retention sweeps, and schema/DB mismatches across hot paths.
- **Database hardening** — Authorization scoping, deterministic ordering, missing row locks, JSONB tag handling, OFFSET caps, and batch-insert correctness across multiple repositories.
- **Multi-tenant authz** — `conversations.getAll` scoped by `userId`, claws scans capped, three additional cross-tenant leaks closed, SSE cancel signals propagated, bridges route updated to `repo.listForUser(userId)`.
- **Chat** — Accurate context-window resolution via `resolveContextWindow` / `resolveMaxOutput` / `computeMemoryMaxTokens` (synced from models.dev, no hardcoded limits). Durable auto-compact mirrors compaction to the database so it survives gateway restart / agent eviction; concurrency guard rechecks message count after summarization to refuse mid-flight collisions.
- **Concurrency** — Singleton timers now stop in graceful shutdown; race-safe conversation create with dead cache deletes removed; orchestrator cancel propagated through stream tear-down; single `--disallowed-tools` flag; pre-flight LLM API-key check.
- **WebSocket** — Backpressure guard on broadcast/send drops slow clients instead of unbounded queueing.
- **Fleet / MQTT** — Orphan detection, true round-robin scheduling, MQTT host fallback.
- **Tunnel routes** — `apiResponse`/`apiError` envelope normalization and input validation.
- **Gateway routing** — Route ordering fix, dead code removed, load all env files.
- **UI** — WS event names, trigger validation, subagents nav; artifact card view truncates long markdown with scroll; ArtifactDetailModal iframe auto-height for HTML/SVG and fills full height; skip-home targets `tools` tab (not `customtools`); FleetPage refetch coalescing; radix and v2 copy polish; ZoneEditor docs.

### Security

- **Token hygiene** — `pg_dump` output redaction, bootstrap token minimum length raised to 32, API-key comparison via timing-safe SHA-256 digest, JWT lifetime bounded with `requiredClaims: ['iat']` + `maxTokenAge`.
- **SSRF DNS-rebinding** — Shared `utils/ssrf.ts` (`isBlockedUrl` + `isPrivateUrlAsync` with 1-minute cache) covers `browser-service`, `/chat/fetch-url`, and `web-fetch` executors; `call_json_api` now in `PERMISSION_GATED_TOOLS` with the `network` permission.
- **Sandbox / signing** — Sandbox constructor escape closed; webhook signing hardened (HMAC + timestamp freshness).
- **Trusted-proxy gating** — `getRequestOrigin` / `getRequestUrl` / `isSecureRequest` honor `X-Forwarded-*` only when `TRUSTED_PROXY=true` and the connection IP is in `TRUSTED_PROXY_IPS`.
- **Extension privilege boundaries** — Skill script bridges gated behind `OWNPILOT_ENABLE_SKILL_SCRIPTS`; `git_branch` added to `BLOCKED_CALLABLE_TOOLS`.
- **Access control** — AUTH-001 through AUTH-003 closed.

### Performance

- **N+1 collapse** — `GET /acc/analytics` and `GET /acc/status` batch heartbeat lookups (N+1 → 1).
- **Hot-path indexes** — Composite indexes for `channel_messages` hot queries; composite + partial indexes for two additional polling queries.

### Dependencies

- `vite` → `7.3.3` (postcss XSS + path traversal/file read; also collapses duplicate `rollup` in UI build).
- `postcss` → `8.5.10` (CVE-2026-41305 XSS in `website`).
- `hono` → `4.12.21` (2 medium CVEs).
- `axios` → `1.16.1` (13 medium CVEs).
- `turbo` → `2.9.14` (2 medium CVEs).
- `protobufjs` → `7.6.0`.
- All vulnerable dependencies pinned to exact fixed versions via `pnpm.overrides`.

### CI

- Added a `Build @ownpilot/core` step before the migration smoke test so the smoke test can resolve `@ownpilot/core/dist/index.js`.

### Tests

- `bridges.test.ts` mock updated to match the user-scoped `repo.listForUser(userId)` route signature; added coverage for cross-tenant filtering.

## [0.4.0] - 2026-05-17

### Added

- **Release scripts** - Added root `pnpm run` commands for version inspection, semver bumps, release preflight checks, release notes extraction, verification, tagging, and publishing.
- **Cross-platform release helpers** - Added Node-based scripts for version bumping, release checks, changelog-based notes, and annotated Git tag creation.
- **Release documentation** - Documented the expanded command list and the minor release workflow in the README.

### Changed

- Bumped OwnPilot workspace packages from `0.3.2` to `0.4.0` for the next minor release.
- Updated architecture metadata and release documentation to match the `0.4.0` release train.

### Fixed

- Avoided passing an explicit `undefined` stream options argument when executing workflows without an abort signal.
- Aligned extension uninstall responses and middleware persistence tests with current gateway behavior.

### Release

- `pnpm release:check` validates workspace version alignment, changelog coverage, and release workflow presence.
- `pnpm release:verify` runs release preflight, production audit, build, typecheck, lint, and tests before tagging.
- `pnpm release:verify:strict` adds the full repository format check for CI parity.
- `pnpm release:notes` prints the current version's changelog section for GitHub release notes.

### Security

- Updated pnpm overrides for `fast-uri` and `protobufjs` to patched versions required by the production audit gate.

## [0.2.9] - 2026-03-16

### Added

- **Mini Pomodoro Timer** — Compact countdown widget in the global header bar, visible on all pages when a Pomodoro session is active. Shows progress ring, session type icon, and countdown. Click to navigate to Pomodoro page. Auto-hides when no session is running or when on the Pomodoro page itself.
- **MiniPomodoro component** (`packages/ui/src/components/MiniPomodoro.tsx`) — Self-contained component with WebSocket updates and independent countdown

### Fixed

- **Pomodoro Timer Broken on Non-UTC Machines** — Root cause: PostgreSQL `TIMESTAMP` (without timezone) columns + `pg` driver's default parser interprets stored values as local time. On non-UTC machines, `startedAt` was shifted backward, causing `fetchState()` to calculate `remaining = 0` and immediately auto-complete every session. Fix: `pg.types.setTypeParser(1114)` forces UTC interpretation for all timestamp columns.
- **Pomodoro Timer Effect** — Removed `timeLeft` from the timer `useEffect` dependency array, which was needlessly recreating the interval every second
- **CI: notification-router.test.ts** — Test was hitting real PostgreSQL (port 25432) instead of mocks after preferences were migrated to DB-backed storage. Added `settingsRepo` mock with in-memory Map.
- **Code Formatting** — Fixed 88 files with Prettier formatting issues that were failing `format:check` in CI

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
- **Agent Crew Context Cache** — 30-second TTL cache reduces N\*3 DB queries per heartbeat to 1
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

[0.6.0]: https://github.com/ownpilot/ownpilot/releases/tag/v0.6.0
[0.5.1]: https://github.com/ownpilot/ownpilot/releases/tag/v0.5.1
[0.5.0]: https://github.com/ownpilot/ownpilot/releases/tag/v0.5.0
[0.4.0]: https://github.com/ownpilot/ownpilot/releases/tag/v0.4.0
[0.2.9]: https://github.com/ownpilot/ownpilot/releases/tag/v0.2.9
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
