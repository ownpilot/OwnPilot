# OwnPilot — Codebase Audit & Improvement Report

**Date**: 2026-08-12
**Scope**: Full monorepo (`core`, `gateway`, `ui`, `cli`), CI, build, tests, docs, container setup
**Baseline**: `main` @ `6c93682f`, v0.8.3
**Method**: static scan + `scripts/report-code-health.mjs` + `knip` + full `typecheck`/`lint`/`test` runs + empirical execution of suspect modules
**Previous**: `refactor-next.md` (Round 9 roadmap, 2026-06-13) · `docs/CODEBASE_AUDIT_2026-07-08.md`

---

## 0. Executive summary

The codebase is in **materially better shape than its own roadmap assumes**. Round 9's correctness and type-safety targets were not just met — they were beaten by a wide margin, and the metrics in `refactor-next.md` are now stale enough to mis-direct effort.

| Gate                                         | Result                                                               |
| -------------------------------------------- | -------------------------------------------------------------------- |
| `pnpm typecheck` (4 packages)                | ✅ clean                                                             |
| `pnpm lint` (4 packages)                     | ✅ clean, 0 warnings                                                 |
| `pnpm build`                                 | ✅ clean                                                             |
| `pnpm test` (full, forced)                   | ⚠️ **2/470 gateway files failed** — both flake, pass in 5 s isolated |
| Production `as any`                          | ✅ **0**                                                             |
| Production `@ts-ignore` / `@ts-expect-error` | ✅ **0**                                                             |
| Production `Math.random()`                   | ✅ **0**                                                             |
| Production `TODO/FIXME/HACK`                 | ✅ **1 real** (in a prompt template string)                          |

**The headline**: Phase 1 of the roadmap is finished. Phase 2 (file decomposition) has effectively **not started** — and the file-size metric has moved _backwards_. Meanwhile there are new defects the roadmap does not cover, the most serious of which is that **the Prometheus metrics endpoint emits invalid, numerically wrong data and leaks memory unboundedly**.

**Priority order**: `M-1` (metrics) → `T-1` (test flake) → `C-1` (coverage gate) → `U-1` (UI test debt) → `A-1` (audit write amplification) → the rest.

---

## 1. What is genuinely strong

Worth stating explicitly, because it should not be regressed:

- **Type discipline.** 0 `as any`, 0 `@ts-ignore`, 7 `as unknown as` in ~405 k LOC of production code. The roadmap's Phase-1 target was ≤ 40; the current figure is **7**. This is exceptional for a codebase this size.
- **Gateway route coverage is 1:1.** 110 route files, 110 colocated test files. Repositories: 73 / 68. Triggers: 4 / 4.
- **CI is thoughtfully built.** Pinned action SHAs, least-privilege tokens, a real **migration smoke test** against `pgvector/pg16`, and a **gateway boot smoke test** that catches runtime-schema regressions unit tests can't. This is better than most projects of this size.
- **Build-time safety nets that reflect real scars.** `cssSizeGuard` in `vite.config.ts` fails the build when Tailwind's oxide native scanner silently falls back to WASM — a bug class that would otherwise ship an unstyled UI to Docker.
- **Capability-accessor architecture is complete and consistent.** Zero direct `getServiceRegistry()` calls outside `crud-factory.ts`.
- **Security posture.** The June 2026 sweep (10 commits) closed the SSRF and permission-gate classes; the follow-up commits through August continued the pattern (DNS pinning, MQTT auth, proxy-scheme trust).

---

## 2. New findings

Ranked by impact. Each was verified, not inferred.

### M-1 · **HIGH** — The Prometheus metrics endpoint is broken in five distinct ways

**File**: `packages/gateway/src/services/metric/service.ts` (209 LOC)
**Route**: `GET /api/v1/metrics` (`routes/register/platform.ts:76`)

I executed the compiled module directly with four synthetic requests. The observed output:

```
# HELP ownpilot_http_requests_total Total HTTP requests
# TYPE ownpilot_http_requests_total counter
ownpilot_http_requests_total{method="GET",path="/api/v1/agents/abc-123",status="200"} 1

# HELP ownpilot_http_requests_total Total HTTP requests      <-- duplicate family header
# TYPE ownpilot_http_requests_total counter
ownpilot_http_requests_total{method="GET",path="/api/v1/agents/def-456",status="200"} 1
...
ownpilot_http_requests_total{method="GET",path="/api/v1/x"quote",status="200"} 1   <-- unescaped
```

**M-1a — Duplicate `# HELP`/`# TYPE` per series.** `formatCounter` (line 123) and `formatGauge` (line 135) emit the family header inside the per-series string, and `renderMetrics` calls them in a loop. With ≥ 2 distinct request paths the payload contains repeated HELP lines for one metric family, which the Prometheus text parser rejects (`second HELP line for metric name`). **In practice this endpoint is unscrapeable on any real deployment.**

**M-1b — The latency histogram is numerically wrong (double cumulation).** `recordHttpRequest` (lines 80–84) already stores _cumulative_ counts — it increments every bucket whose bound ≥ the observed latency. `formatHistogram` (lines 148–152) then re-accumulates with `cumulative += bucketCounts[i]`. A **single 12 ms observation** renders as:

```
..._bucket{le="25"}  1
..._bucket{le="50"}  2
..._bucket{le="100"} 3
...
..._bucket{le="+Inf"} 9
..._count             9      <-- should be 1
```

Every `histogram_quantile()` and every `rate()` over this data is meaningless. Either the record loop or the format loop must accumulate — not both.

**M-1c — `_sum` is global, emitted per-label.** `httpLatencies.sum` is a single module-level number (line 85), but `formatHistogram` writes it under _every_ path label (line 155). Each path reports the total latency of all traffic across all paths, so `_sum / _count` is nonsense twice over.

**M-1d — Unbounded metric cardinality (memory leak).** `httpRequests` and `httpLatencies.counts` are keyed on `c.req.path` — the **raw** URL, not the route template. `/api/v1/agents/abc-123` and `/api/v1/agents/def-456` become separate permanent series. There is no cap, no prune, and no eviction anywhere in the file. A long-running gateway grows one map entry per unique URL ever seen, and the `/api/v1/metrics` payload grows with it.

**M-1e — Label values are not escaped.** A path containing `"` or `\` produces syntactically broken exposition output (demonstrated above).

**Bonus — self-exclusion prefix mismatch.** `recordHttpRequest` skips `path.startsWith('/metrics')` (line 62), but the route is mounted at `/api/v1/metrics`. Every scrape counts itself: at a 15 s interval that is ~5 760 phantom requests/day injected into the request-rate series.

**Why the tests didn't catch it**: `service.test.ts` (100 lines) asserts only substring presence — `expect(metrics).toContain('# HELP')`, `toContain('..._bucket')`. It never validates a single numeric value. Presence-only assertions on a serializer are close to no assertions.

**Fix sketch**

1. Use Hono's matched route pattern (`c.req.routePath`) instead of `c.req.path` as the label; keep raw paths out of metrics entirely.
2. Emit `# HELP`/`# TYPE` once per family in `renderMetrics`, not per series.
3. Remove the double accumulation — keep the cumulative write in `recordHttpRequest`, make `formatHistogram` emit `bucketCounts[i]` directly.
4. Track `sum` per label key, not globally.
5. Escape `\`, `"`, `\n` in label values.
6. Fix the exclusion to `/api/v1/metrics`.
7. Cap distinct series (e.g. 1 000) with an `__other__` overflow bucket.
8. Replace the presence assertions with numeric ones: one 12 ms observation ⇒ `_count 1`, `le="10" 0`, `le="25" 1`.

---

### T-1 · **HIGH** — The test suite is non-deterministic under full-suite load

The full `pnpm test` run failed:

```
Test Files  2 failed | 468 passed (470)
     Tests  2 failed | 17899 passed (17901)
```

Both failures were `Error: Test timed out in 15000ms` — exactly the gateway `testTimeout`:

- `src/routes/health.test.ts > GET /health > returns health status with version and uptime`
- `src/services/shutdown-cleanup.test.ts > shutdownAllServices completes without throwing`

Re-running **those two files in isolation**: `2 passed (2) · 41 tests · 5.09 s`.

So this is contention, not a regression. The aggregate timings tell the story: `transform 347 s, import 592 s` across 470 parallel files. Both failing tests are import-bound (`shutdown-cleanup` dynamically imports the real modules; `health.test.ts` pulls in the app), so under full parallelism the _import_ alone can exceed the 15 s per-test budget.

**Why this matters more than a normal flake**: `release.yml` runs the full suite fresh with `TURBO_FORCE=true` and no cache. A flaky timeout blocks a release even though nothing is broken — a failure mode already recorded in project memory. Left alone, it also trains the team to re-run red builds instead of reading them.

**Fix options** (in preference order)

1. Raise gateway `testTimeout` to 30 s — cheap, honest, matches what the suite actually needs on loaded hardware.
2. Bound worker concurrency (`poolOptions.threads.maxThreads`) so import cost per worker stays predictable.
3. Make the two offenders not import real module graphs (mock at the boundary) — best long-term, most work.

Option 1 now, option 3 when those files are next touched.

---

### C-1 · **MEDIUM** — Coverage is enforced in exactly one package

| Package   | Prod LOC | Coverage thresholds                         |
| --------- | -------: | ------------------------------------------- |
| `core`    |   80 522 | ✅ 80 % statements/branches/functions/lines |
| `gateway` |  173 032 | ❌ **none**                                 |
| `ui`      |  146 671 | ❌ **none**                                 |
| `cli`     |    5 078 | ❌ **none**                                 |

The two largest packages — 320 k LOC combined, containing every route, every repository, and the entire frontend — measure coverage but gate nothing. The CI `coverage` job runs only on push to `main`, uploads an artifact, and asserts nothing. Coverage that nobody can fail is documentation, not a control.

**Recommendation**: add thresholds to `gateway` at its _current measured_ level (ratchet, don't aspire), then raise by a point or two per release. Do the same for `ui` once `U-1` lands. A gate set at today's number costs nothing and makes regression impossible.

---

### U-1 · **MEDIUM** — The UI is the structural weak point, and it's the only one

Every discipline this project applies rigorously to the backend is absent in the frontend:

| Metric            | gateway |       ui |
| ----------------- | ------: | -------: |
| Prod files        |     587 |      481 |
| Test files        |     471 |   **94** |
| Test : prod ratio |    0.80 | **0.20** |
| Route/page files  |     110 |       69 |
| Route/page tests  | **110** |    **3** |

The 12 largest pages — all between 1 041 and 1 285 LOC — have **zero** colocated tests:

```
1285  CodingAgentsPage.tsx        1087  ChatHistoryPage.tsx
1203  ClawsPage.tsx               1083  McpServersPage.tsx
1171  LogsPage.tsx                1076  TriggersPage.tsx
1108  MissionControlPage.tsx      1058  AnalyticsPage.tsx
1103  coding-agent-settings-tabs  1050  ChatPage.tsx
1103  ProfilePage.tsx             1041  PlansPage.tsx
```

Existing UI tests cluster in `components/` (24), `hooks/` (18), and `components/workflows/` (13) — the reusable layer is tested, the _composition_ layer is not. That is exactly inverted from where user-visible regressions occur.

The infrastructure is already there (happy-dom, 72 files carrying `vitest-environment` docblocks, React act support configured). This is a discipline gap, not a tooling gap.

**Recommendation**: require a smoke test with every page touched — mount, assert loading state, assert the primary data call fires, assert the empty state. Roughly 40 lines per page. Start with `ChatPage`, `ClawsPage`, `AnalyticsPage` (highest traffic × highest complexity).

---

### A-1 · **MEDIUM** — Audit middleware writes one DB row per API request, keyed on raw path

**File**: `packages/gateway/src/middleware/audit.ts:34-52`, mounted at `app.use('/api/*', ...)`.

Every request under `/api/*` produces an `audit.logAudit()` write. The only exclusions are `/health` and `/api/v1/health` — so `/api/v1/metrics` scrapes, polling endpoints, and WebSocket handshake probes all generate rows. `resourceId` is the raw path, so the table accumulates one distinct value per unique URL, mirroring `M-1d`.

Two costs: write amplification proportional to request volume on the hot path, and an audit table whose cardinality is driven by URL shape rather than by security-relevant events.

**Recommendation**: extend the exclusion list (`/api/v1/metrics`, high-frequency polls), and consider sampling or level-filtering non-mutating `GET`s. Security auditing wants writes, reads-of-lists mostly aren't the signal.

---

### P-1 · **MEDIUM** — Synchronous filesystem I/O on the chat hot path

**File**: `packages/gateway/src/workspace/file-workspace.ts` — 38 synchronous `fs` calls, the highest count in the repo.

`routes/chat/index.ts:479` calls `getOrCreateSessionWorkspace(sessionId, body.agentId)` on **every chat request**, with the comment `// Workspace — set on every request (cheap)`. The call chain runs `existsSync` → `statSync` → `readFileSync('.meta.json')` → `JSON.parse` → `writeFileSync`. That is 4–6 blocking syscalls per chat turn on Node's single event-loop thread.

At single-user desktop scale this is invisible — which is presumably why it reads as "cheap". Under concurrent chat sessions, or on a network/virtualized filesystem (Docker volume, WSL bind mount), every one of those calls stalls _all_ other request handling.

**Recommendation**: cache the resolved workspace path per `sessionId` in a `TTLCache` (the utility already exists at `utils/ttl-cache.ts`) so the fs round-trip happens once per session rather than once per message; convert the remaining hot-path calls to `fs/promises`. Not urgent, but it is the single clearest event-loop blocker in the request path.

---

### D-1 · **MEDIUM** — 104 environment variables are undocumented, including security escape hatches

Code references **141** distinct `process.env.*` names. `.env.example` documents **38** (including commented entries). Filtering out provider API keys (deliberately UI-configured) and false positives (`HOME`, `LANG`, `LOCALAPPDATA`), the gap is real and includes the flags that **turn protections off**:

```
OWNPILOT_ALLOW_LOCAL_LLM_URL          OWNPILOT_ENABLE_SKILL_SCRIPTS
OWNPILOT_ALLOW_LOCAL_EMBEDDING_URL    OWNPILOT_ENABLE_EXTENSION_HOST_ACCESS
OWNPILOT_ALLOW_LOCAL_EXEC             OWNPILOT_CODING_AGENT_ANY_DIR
EXPOSE_INTERNAL_ERRORS                DOCKER_SANDBOX_RELAXED_SECURITY
HTTPS_ONLY / HTTPS_PORT               TRUSTED_PROXY
LOCAL_EXEC_REQUIRE_APPROVAL           BOOTSTRAP_TOKEN
JWT_MAX_TOKEN_AGE                     DB_STATEMENT_TIMEOUT_MS
JWT_CLOCK_TOLERANCE_SEC               DB_IDLE_TX_TIMEOUT_MS
CHANNEL_INBOUND_RATE_LIMIT_MAX/_WINDOW_MS
```

Most of these were introduced by the June security sweep as deliberate opt-ins — which is the right design. But an opt-in nobody can discover is an opt-in nobody can _audit_. An operator cannot answer "which safety defaults has this deployment disabled?" without grepping the source.

**Recommendation**: a `# Security escape hatches` section in `.env.example` listing every flag, its default, and what it disables. Optionally, log a startup WARN naming any that are active — a deployment running with relaxed sandboxing should say so on every boot.

---

### CI-1 · **LOW** — CI blind spots

- **Single-platform matrix.** `ubuntu-latest`, Node 22 only. Primary development is on **Windows**, and the repo carries at least two documented Windows-specific bug classes (`localhost` → `::1` vs Docker IPv4 publishing; the Tailwind oxide WASM fallback that `cssSizeGuard` exists to catch). Neither would be caught by CI. Adding `windows-latest` to the matrix — even lint + typecheck + a test subset — closes the gap that has historically bitten this project.
- **Playwright E2E is permanently non-signal.** It runs only on PRs, with `continue-on-error: true`, and the comment concedes it has no backend to talk against. A check that can never fail and never passes meaningfully is worse than no check — it occupies the slot where a real one would go. Either provision the stack (the `migration-smoke-test` job already shows how to stand up Postgres in CI) or drop the step until it can be real.

---

### Q-1 · **LOW** — The health script's own metrics are misleading priorities

`report-code-health.mjs` reports **548 production `console.*` calls**, and `refactor-next.md` reads this as "gateway/core runtime should move to structured logs". The actual distribution:

| Package | Production `console.*` |
| ------- | ---------------------: |
| cli     |                **507** |
| ui      |                     22 |
| core    |                     16 |
| gateway |                  **4** |

93 % is the CLI, where writing to stdout _is_ the product. Gateway and core have essentially completed the migration to `getLog()`. The metric as aggregated will keep generating a phantom work item every time the report is regenerated.

**Recommendation**: split the `console.*` signal by package in the script, or exclude `cli` from it. Same treatment for `child_process|spawn|exec` (112 production hits) — concentrated in sandbox and tool executors where it is the intended mechanism.

---

### K-1 · **LOW** — Dead export surface

`knip` reports **29 unused exports** and **420 unused exported types**. The overwhelming majority is one file: `packages/ui/src/api/endpoints/index.ts` re-exports roughly 200 types that nothing imports.

**Resolved 2026-08-12 — and the finding was largely wrong.** Checking each symbol individually showed that "unused export" here almost always means _"re-exported by a barrel nobody imports from"_, not dead code. `authApi`, `agenticApi`, `canvasApi` and the rest have 9–12 real call sites each; `WidgetShell` has 84. They are imported directly from their modules rather than through the barrel. Deleting them would have removed live symbols from barrels for a cleaner `knip` score — churn that makes the barrels inconsistent and fixes nothing.

Only four symbols were genuinely unreachable, and those are now gone: `useWizardDraft` + `clearWizardDraft` (superseded by `useWizardDraftSync`, which is independent of both), `EXTENSION_CATEGORIES`, and `widgets/JsonWidget.tsx` — a whole component reachable only via its own barrel line, since `ChatMessageWidget` defines and uses a local `JsonWidget` of the same name. Unused exports: 30 → 22.

`isPrivateUrlAsyncFresh` is left in place deliberately: its docstring records that it is retained after being superseded by `resolvePublicAddressesFresh` + DNS pinning. Removing something a previous author explicitly kept is the maintainer's call, not a cleanup sweep's.

**The remaining 22 are all live-code barrel re-exports.** Do not treat that number as debt; it measures barrel breadth, not dead code. This is the third metric in this audit that overstated a problem — see also `Q-1` (`console.*`, 93 % CLI) and the "untested services" list. A pattern worth naming: **every count in this codebase's tooling needs its denominator checked before it becomes a work item.**

---

## 3. Roadmap reconciliation — `refactor-next.md`

Metrics in that document were last refreshed **2026-06-22**. Current values:

| Signal                     | Roadmap (06-22) | Today (08-12) |              Target | Status       |
| -------------------------- | --------------: | ------------: | ------------------: | ------------ |
| `as unknown as` (prod)     |             150 |         **7** |                ≤ 40 | ✅ beaten 5× |
| `as any` (prod)            |               5 |         **0** |                   — | ✅           |
| `Math.random()` (prod)     |              22 |         **0** | 0 in security paths | ✅           |
| `eslint-disable`           |              40 |         **2** |          audit each | ✅           |
| `@ts-expect-error` (prod)  |               1 |         **0** |                 ≤ 5 | ✅           |
| `TODO/FIXME/HACK` (prod)   |               5 |         **1** |                   — | ✅           |
| Gateway services w/o tests |              41 |        **30** |                   — | 🟡 partial   |
| Files > 1000 LOC           |              37 |        **33** |                   — | 🟡 ~flat     |
| Files > 500 LOC            |             249 |       **256** |                   — | ❌ **grew**  |
| `console.*` (prod)         |             554 |           548 |                   — | ⚪ see `Q-1` |

**Phase 1 is done and overachieved.** Every correctness and type-safety exit criterion is met.

**Phase 2 has not started.** Its stated exit criterion — _"no file > 800 LOC in `gateway/src/services/` and `gateway/src/db/repositories/`"_ — is unmet: **89 files repo-wide exceed 800 LOC, 33 exceed 1 000**, distributed as:

| Package | > 500 LOC | > 1000 LOC |
| ------- | --------: | ---------: |
| gateway |       100 |         14 |
| ui      |        96 |     **15** |
| core    |        57 |          4 |
| cli     |         2 |          0 |

Two observations the roadmap does not make:

1. **The UI now has more > 1000-LOC files than the gateway** (15 vs 14), yet Phase 2A lists six gateway targets and zero UI targets. The decomposition plan is aimed at the package that is no longer the worst offender.
2. **The 30 "services without tests" figure overstates the gap — and my "~10 real files" estimate above was also wrong.** Measured coverage (added 2026-08-12, after this audit was first written) shows the flagged files are well covered by differently-named tests: `services/claw/manager/manager.ts` is at **82.2 %** via eight `manager-*.test.ts` files, `services/agent/agent-context.ts` at **98.9 %**, `services/agent/compaction-policy.ts` at **100 %**. The heuristic checks for `X.test.ts` beside `X.ts` and reports filename mismatches, not coverage. There is no ~10-file gap here; the correct action was to fix the metric, not write redundant tests.

   Sorting `coverage-final.json` by statement coverage gives a genuinely different — and useful — list, none of which this heuristic flagged:

   |  Coverage | File                                             |
   | --------: | ------------------------------------------------ |
   |     4.5 % | `channels/plugins/sms/sms-api.ts`                |
   |     8.0 % | `channels/plugins/webchat/webchat-api.ts`        |
   | **9.2 %** | `services/workflow/workflow-node-job-handler.ts` |
   |    10.5 % | `db/repositories/jobs.ts`                        |
   |    14.0 % | `tools/claw/management-tools.ts`                 |
   |    16.1 % | `channels/plugins/whatsapp/whatsapp-api.ts`      |
   |    22.1 % | `services/coding-agent/service.ts`               |
   |    29.0 % | `channels/plugins/discord/discord-api.ts`        |

   The 9.2 % entry turned out to contain a live defect: `transformerNode` silently executed as a tool node on the queue-backed path. Low coverage was the signal; the filename heuristic was noise.

**Recommendation**: refresh `refactor-next.md`'s metrics table, close out Phase 1, rewrite Phase 2A to include the UI pages, and retarget the coverage item at the ~10 real files rather than the 30 the heuristic reports.

---

## 4. Prioritized action plan

### Tier 1 — do next (small, high value, each independently shippable)

| #   | Action                                                                             | Files                                                                  | Effort |
| --- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------ |
| 1   | Fix all five `M-1` metrics defects + replace presence assertions with numeric ones | `services/metric/service.ts`, `middleware/audit.ts`, `service.test.ts` | S      |
| 2   | Raise gateway `testTimeout` to 30 s (or bound worker concurrency) — `T-1`          | `packages/gateway/vitest.config.ts`                                    | XS     |
| 3   | Document the security escape hatches in `.env.example` — `D-1`                     | `.env.example`                                                         | S      |
| 4   | Add coverage thresholds to `gateway` at today's measured level — `C-1`             | `packages/gateway/vitest.config.ts`                                    | XS     |

### Tier 2 — this cycle

| #   | Action                                                                                                   | Effort |
| --- | -------------------------------------------------------------------------------------------------------- | ------ |
| 5   | Smoke tests for the top 5 untested UI pages; add a "page touched ⇒ page tested" rule — `U-1`             | M      |
| 6   | Cache session-workspace resolution behind `TTLCache`; move hot-path fs to async — `P-1`                  | S      |
| 7   | Exclude `/api/v1/metrics` + high-frequency polls from audit writes — `A-1`                               | XS     |
| 8   | Add `windows-latest` to the CI matrix (lint + typecheck + test subset) — `CI-1`                          | S      |
| 9   | Colocated tests for the ~10 genuinely untested gateway services, starting with `claw/manager/manager.ts` | M      |

### Tier 3 — when convenient

| #   | Action                                                                                    | Effort |
| --- | ----------------------------------------------------------------------------------------- | ------ |
| 10  | Refresh `refactor-next.md` metrics; retarget Phase 2A at UI pages — §3                    | S      |
| 11  | Split `console.*` and `child_process` signals per package in the health script — `Q-1`    | XS     |
| 12  | Trim the `ui/src/api/endpoints/index.ts` type barrel; delete genuine dead exports — `K-1` | S      |
| 13  | Either provision a backend for Playwright E2E or remove the step — `CI-1`                 | M      |
| 14  | Begin Phase 2 decomposition — the 33 files > 1 000 LOC, UI first                          | L      |

---

## 5. Method notes

- All metrics are from a clean `main` working tree at `6c93682f`.
- `typecheck`, `lint`, `build`, and `test` were executed, not inferred.
- `M-1` was verified by importing the compiled `dist/services/metric/service.js` and rendering real output — every defect listed is observed, not deduced from reading.
- `T-1` was verified by re-running the two failing files in isolation to distinguish flake from regression.
- Counts exclude `node_modules`, `dist`, and `coverage`; production vs test split follows the same heuristic as `scripts/report-code-health.mjs` for comparability with the existing roadmap.
