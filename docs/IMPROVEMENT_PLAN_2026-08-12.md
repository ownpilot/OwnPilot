# OwnPilot — Improvement Plan (from the 2026-08-12 audit)

**Date**: 2026-08-12
**Source**: `docs/CODEBASE_AUDIT_2026-08-12.md`
**Baseline**: `main` @ `6c93682f`, v0.8.3
**Status**: WI-1, WI-2, WI-3, WI-4, WI-6, WI-7 and WI-9b implemented on
`fix/audit-2026-08-12-tier1` (see §5 for outcomes). WI-5, WI-8 and the remaining
WI-9 items are still open.

This document turns the audit findings into executable work items. Each item states the
problem, the decision taken and _why_, the exact changes, the test plan, and acceptance
criteria. Items are independently shippable; nothing here depends on anything below it
unless the sequencing section says so.

---

## 0. Ground rules

- **One concern per commit**, branched from `main`. No mixed refactor + behavior commits.
- **Every item ships with tests.** Where an item exists _because_ a test was too weak
  (WI-1), strengthening that test is part of the item, not a follow-up.
- **Gates before every merge**: `pnpm typecheck` → `pnpm lint` → `pnpm test` → `pnpm format:check`.
- **No new public API** unless the item explicitly introduces one.
- Turkish is fine in discussion; **all code, comments, commit messages, and docs are English.**

---

## 1. Work items

### WI-1 — Repair the Prometheus metrics endpoint

**Priority**: HIGH · **Effort**: S (half a day) · **Risk**: low · **Blocks**: nothing

#### Problem

`packages/gateway/src/services/metric/service.ts` (209 LOC) has five defects. All were
verified by importing the compiled `dist/` module and rendering real output — none are
inferred from reading the source.

| #   | Defect                                                          | Location                                                                                               | Consequence                                                                                                            |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| a   | `# HELP`/`# TYPE` emitted per series inside a loop              | `formatCounter:123`, `formatGauge:135`, `renderMetrics:170`                                            | Duplicate family headers → Prometheus text parser rejects the payload once ≥2 series exist. **Endpoint unscrapeable.** |
| b   | Histogram double-cumulation                                     | write `recordHttpRequest:80-84` (already cumulative) + read `formatHistogram:148-152` (re-accumulates) | One 12 ms observation renders `_count 9`. All quantiles/rates garbage.                                                 |
| c   | `sum` is a single module-level number emitted under every label | `Histogram.sum:28`, `formatHistogram:155`                                                              | Each route reports total latency of _all_ traffic.                                                                     |
| d   | Series keyed on raw `c.req.path`                                | `recordHttpRequest:64,73`                                                                              | One permanent series per unique URL. No cap, no prune → unbounded memory.                                              |
| e   | Label values not escaped                                        | `formatCounter:121`, `formatGauge:133`                                                                 | A `"` in a path emits syntactically broken exposition.                                                                 |

Plus: the self-exclusion checks `path.startsWith('/metrics')` (line 62) but the route is
mounted at `/api/v1/metrics`, so every scrape counts itself (~5 760/day at a 15 s interval).

#### Decision: use `c.req.routePath`, not regex path-normalization

The obvious fix for (d) is to normalize IDs out of the path with a regex. **Rejected** —
it is guesswork that needs maintaining as URL shapes change. Hono already knows the
matched route template.

Verified against `hono@4.12.32` (the version `packages/gateway` resolves), reading
`c.req.routePath` **after `await next()`** inside the `app.use('/api/*', ...)` middleware:

```
path=/api/v1/agents/abc-123   status=200  routePath=/api/v1/agents/:id
path=/api/v1/nope/random-9f8e  status=404  routePath=/api/*
path=/api/v1/x/y/z/1/2/3       status=404  routePath=/api/*
```

Two properties matter:

1. **Matched requests collapse to the registered template** → cardinality is bounded by
   the number of registered routes, by construction.
2. **Unmatched requests collapse to `/api/*`** → scanner and probe traffic, the worst
   cardinality source, becomes a single series for free.

The middleware already performs all its work after `await next()`, so no restructuring is
needed. Note `c.req.routePath` is marked deprecated in favour of a `routePath()` helper
from `hono/route` — **that module does not exist in 4.12.32** (checked), so the getter is
the correct API for this version. A `TODO` comment should note the migration for whenever
hono is upgraded past it.

A hard series cap is still added as a backstop, since a future wildcard route could
reintroduce unbounded keys.

#### Changes

**`packages/gateway/src/services/metric/service.ts`**

1. Rename the `path` parameter to `route` throughout, so the contract is explicit that
   callers pass a template, not a URL.
2. Fix the exclusion list:
   ```ts
   const EXCLUDED_ROUTES = ['/health', '/api/v1/health', '/api/v1/metrics'];
   if (EXCLUDED_ROUTES.some((p) => route.startsWith(p))) return;
   ```
3. Change `Histogram.sum: number` → `sums: Map<string, number>` (per label key), and
   update the write site to `sums.set(key, (sums.get(key) ?? 0) + latencyMs)`.
4. Remove the double accumulation. Keep the cumulative write in `recordHttpRequest`
   (it is correct Prometheus semantics); make `formatHistogram` emit `bucketCounts[i]`
   directly and derive `_count` from the last bucket rather than a running total.
5. Add a series cap:
   ```ts
   const MAX_SERIES = 1000;
   const OVERFLOW_ROUTE = '__other__';
   ```
   When `httpRequests.size >= MAX_SERIES` and the key is new, record under
   `OVERFLOW_ROUTE` instead. Log once at WARN when the cap is first hit.
6. Split formatting into a family header emitted once plus per-sample lines:
   ```ts
   function formatFamilyHeader(
     name: string,
     help: string,
     type: 'counter' | 'gauge' | 'histogram'
   ): string;
   function formatSample(name: string, labels: Record<string, string>, value: number): string;
   function escapeLabelValue(v: string): string; // \ → \\ , " → \" , \n → \\n
   ```
   `renderMetrics` emits one header per family, then all samples for that family.

**`packages/gateway/src/middleware/audit.ts`**

7. Pass the route template to metrics while keeping the raw path for the audit record:
   ```ts
   recordHttpRequest(method, c.req.routePath, status, durationMs);
   ```

#### Test plan

The existing `service.test.ts` (100 lines) asserts only substring presence
(`toContain('# HELP')`, `toContain('..._bucket')`) — which is why every defect above
shipped green. Replace with value assertions:

- One 12 ms observation ⇒ `le="10"` is `0`, `le="25"` is `1`, `le="+Inf"` is `1`, `_count` is `1`, `_sum` is `12`.
- Two observations on **different** routes ⇒ each `_sum` reflects only its own route.
- Any number of series ⇒ exactly **one** `# HELP ownpilot_http_requests_total` line
  (`(out.match(/# HELP ownpilot_http_requests_total/g) ?? []).length === 1`).
- A route containing `"` ⇒ the emitted label value is escaped.
- `/api/v1/metrics` is not recorded.
- `MAX_SERIES + 1` distinct routes ⇒ map size stays at `MAX_SERIES`, overflow lands in `__other__`.

Add a middleware-level test asserting `recordHttpRequest` receives `/api/v1/agents/:id`
(not the raw URL) for a request to `/api/v1/agents/abc-123`.

#### Acceptance criteria

- [ ] Rendered output has exactly one `# HELP`/`# TYPE` pair per metric family.
- [ ] A single observation produces `_count 1` and a correct `_sum`.
- [ ] `_sum` is per-route.
- [ ] 1 000 requests to 1 000 distinct URLs under one route ⇒ **one** series.
- [ ] Label values are escaped.
- [ ] Scrapes of `/api/v1/metrics` do not appear in the output.
- [ ] `promtool check metrics < output.txt` passes (verify manually once; not wired into CI).

---

### WI-2 — Stop the full-suite test flake

**Priority**: HIGH · **Effort**: XS · **Risk**: none · **Blocks**: reliable releases

#### Problem

Full `pnpm test` on this baseline:

```
Test Files  2 failed | 468 passed (470)
     Tests  2 failed | 17899 passed (17901)
```

Both failures are `Error: Test timed out in 15000ms` — exactly the configured gateway
`testTimeout`:

- `src/routes/health.test.ts > GET /health > returns health status with version and uptime`
- `src/services/shutdown-cleanup.test.ts > shutdownAllServices completes without throwing`

Re-running **only those two files**: `2 passed (2) · 41 tests · 5.09 s`.

So this is resource contention, not a regression. Aggregate timings across 470 parallel
files were `transform 347 s, import 592 s`. Both offenders are import-bound —
`shutdown-cleanup` dynamically imports the real module graph, `health.test.ts` pulls in
the app — so under full parallelism the _import_ alone can exhaust a 15 s per-test budget.

This matters more than a normal flake: `release.yml` runs the suite fresh with
`TURBO_FORCE=true` and no cache, so a spurious timeout blocks a release.

#### Decision

Raise the budget now; fix the cause when those files are next touched. A 15 s per-test
timeout is not a meaningful quality signal for import-bound tests — it only encodes an
assumption about machine load that CI runners do not honour.

#### Changes

**`packages/gateway/vitest.config.ts`**

```ts
testTimeout: 30_000,   // was 15_000
hookTimeout: 30_000,   // add — setup hooks share the same import cost
```

Add a comment recording _why_: these are import-bound tests under 470-file parallelism,
not slow assertions.

#### Test plan

Run the full gateway suite three times consecutively. All three green.

#### Acceptance criteria

- [ ] `pnpm test` green three consecutive full runs.
- [ ] No test's _own_ runtime approaches 30 s (verify with `--reporter=verbose`; if one
      does, that is a real problem and gets its own item).

#### Follow-up (not this item)

Make `shutdown-cleanup.test.ts` and `health.test.ts` mock at the module boundary instead
of importing real graphs. Track as WI-9.

---

### WI-3 — Document the security escape hatches

**Priority**: HIGH · **Effort**: S · **Risk**: none

#### Problem

Code references **141** distinct `process.env.*` names; `.env.example` documents **38**
(including commented entries). The gap includes every flag that _disables a protection_ —
most introduced by the June 2026 security sweep as deliberate opt-ins:

```
OWNPILOT_ALLOW_LOCAL_LLM_URL          OWNPILOT_ENABLE_SKILL_SCRIPTS
OWNPILOT_ALLOW_LOCAL_EMBEDDING_URL    OWNPILOT_ENABLE_EXTENSION_HOST_ACCESS
OWNPILOT_ALLOW_LOCAL_EXEC             OWNPILOT_CODING_AGENT_ANY_DIR
LOCAL_EXEC_REQUIRE_APPROVAL           DOCKER_SANDBOX_RELAXED_SECURITY
EXPOSE_INTERNAL_ERRORS                TRUSTED_PROXY
HTTPS_ONLY / HTTPS_PORT               BOOTSTRAP_TOKEN
JWT_MAX_TOKEN_AGE                     CHANNEL_INBOUND_RATE_LIMIT_MAX
JWT_CLOCK_TOLERANCE_SEC               CHANNEL_INBOUND_RATE_LIMIT_WINDOW_MS
DB_STATEMENT_TIMEOUT_MS               DB_IDLE_TX_TIMEOUT_MS
```

Opt-in-by-default is the right design. But an opt-in nobody can discover is an opt-in
nobody can audit: an operator cannot answer _"which safety defaults has this deployment
turned off?"_ without grepping the source.

#### Changes

**`.env.example`** — add two sections:

```
# ===========================================
# Security escape hatches  (default: OFF — each DISABLES a protection)
# ===========================================
# Every flag below weakens a default. Set only with a specific reason.
# OWNPILOT_ALLOW_LOCAL_LLM_URL=0        # allow private/loopback LLM base URLs (bypasses SSRF guard)
# ... one line per flag: what it turns off, and the default
```

```
# ===========================================
# Operational tuning
# ===========================================
# DB_STATEMENT_TIMEOUT_MS=  DB_IDLE_TX_TIMEOUT_MS=  DB_BACKUP_TIMEOUT_MS=
# JWT_MAX_TOKEN_AGE=  JWT_CLOCK_TOLERANCE_SEC=  ...
```

Exclude provider API keys (deliberately Config-Center-managed — state this explicitly)
and scan false positives (`HOME`, `LANG`, `LOCALAPPDATA`, doc-example names).

**Optional, same item**: a startup WARN naming any active escape hatch. A deployment
running with relaxed sandboxing should say so on every boot. Small, high value for
operators, no runtime cost.

#### Acceptance criteria

- [ ] Every security-relevant env var read by `gateway`/`core` appears in `.env.example`
      with its default and what it disables.
- [ ] A reviewer can enumerate all escape hatches from `.env.example` alone.

---

### WI-4 — Gate coverage in `gateway` (ratchet, not aspiration)

**Priority**: MEDIUM · **Effort**: XS · **Risk**: none

#### Problem

| Package   | Prod LOC | Thresholds               |
| --------- | -------: | ------------------------ |
| `core`    |   80 522 | ✅ 80 % across the board |
| `gateway` |  173 032 | ❌ none                  |
| `ui`      |  146 671 | ❌ none                  |
| `cli`     |    5 078 | ❌ none                  |

The two largest packages — 320 k LOC containing every route, repository, and the whole
frontend — measure coverage and gate nothing. The CI `coverage` job runs on push to
`main`, uploads an artifact, and asserts nothing. Coverage nobody can fail is
documentation, not a control.

#### Decision: ratchet from measured, do not pick a round number

Setting an aspirational 80 % would fail the build immediately and get reverted. Measure
first, set the gate ~2 points _below_ the measured value so normal churn doesn't trip it,
then raise per release.

#### Changes

1. Run `pnpm --filter @ownpilot/gateway test:coverage`, record the four percentages.
2. Add to `packages/gateway/vitest.config.ts`:
   ```ts
   thresholds: { statements: M-2, branches: M-2, functions: M-2, lines: M-2 }
   ```
   with a comment stating the measured baseline, the date, and the ratchet intent.
3. Defer `ui` until WI-5 lands (its number would be too low to be useful).
4. Leave `cli` — 5 k LOC, low leverage.

#### Acceptance criteria

- [ ] `pnpm --filter @ownpilot/gateway test:coverage` fails when coverage drops below the gate.
- [ ] The gate value and its measurement date are recorded in the config comment.

---

### WI-5 — UI page smoke tests

**Priority**: MEDIUM · **Effort**: M · **Risk**: low

#### Problem

Every discipline applied rigorously to the backend is absent in the frontend:

| Metric             | gateway |       ui |
| ------------------ | ------: | -------: |
| Prod files         |     587 |      481 |
| Test files         |     471 |   **94** |
| Test : prod ratio  |    0.80 | **0.20** |
| Route / page files |     110 |       69 |
| Route / page tests | **110** |    **3** |

The 12 largest pages (1 041–1 285 LOC) have zero colocated tests: `CodingAgentsPage`,
`ClawsPage`, `LogsPage`, `MissionControlPage`, `coding-agent-settings-tabs`,
`ProfilePage`, `ChatHistoryPage`, `McpServersPage`, `TriggersPage`, `AnalyticsPage`,
`ChatPage`, `PlansPage`.

Existing UI tests cluster in `components/` (24), `hooks/` (18), `components/workflows/`
(13) — the _reusable_ layer is tested, the _composition_ layer is not. That is inverted
from where user-visible regressions actually occur.

The tooling is already in place (happy-dom, 72 files with `vitest-environment` docblocks,
`IS_REACT_ACT_ENVIRONMENT` configured). This is a discipline gap, not a tooling gap.

#### Decision: a fixed smoke-test shape, not bespoke suites

A ~40-line template per page, applied uniformly. Bespoke per-page suites are better tests
but will not get written for 69 pages; a uniform smoke test will, and it catches the
regressions that actually ship (crash on mount, wrong endpoint, empty state renders as
error).

#### Changes

Per page, assert:

1. Mounts without throwing.
2. Renders its loading state.
3. Fires its primary data call (assert on the mocked API client).
4. Renders the empty state for an empty successful response.
5. Renders an error state for a rejected response.

Start with three, in this order: `ChatPage`, `ClawsPage`, `AnalyticsPage` — highest
traffic × highest complexity. Then proceed by page size.

Add to `CLAUDE.md`: **a page touched is a page tested** — any PR modifying a page under
`packages/ui/src/pages/` adds or extends its colocated smoke test.

#### Acceptance criteria

- [ ] Top 5 pages by LOC have colocated smoke tests.
- [ ] The convention is recorded in `CLAUDE.md`.
- [ ] `ui` test-file count rises from 94; ratio trends toward 0.4.

---

### WI-6 — Take synchronous filesystem I/O off the chat hot path

**Priority**: MEDIUM · **Effort**: S · **Risk**: low

#### Problem

`packages/gateway/src/workspace/file-workspace.ts` holds 38 synchronous `fs` calls — the
highest count in the repo. `routes/chat/index.ts:479` calls
`getOrCreateSessionWorkspace(sessionId, body.agentId)` on **every chat request**, with the
comment `// Workspace — set on every request (cheap)`.

The chain runs `existsSync` → `statSync` → `readFileSync('.meta.json')` → `JSON.parse` →
`writeFileSync`: 4–6 blocking syscalls per chat turn on Node's single event-loop thread.

At single-user desktop scale this is invisible — which is why it reads as cheap. Under
concurrent sessions, or on a network/virtualised filesystem (Docker volume, WSL bind
mount), each call stalls _all_ other request handling.

#### Changes

1. Cache the resolved workspace path per `sessionId` in the existing
   `TTLCache` (`packages/gateway/src/utils/ttl-cache.ts`) so the fs round-trip happens
   once per session, not once per message.
2. Convert the remaining hot-path functions (`getSessionWorkspace`,
   `updateSessionWorkspaceMeta`) to `fs/promises`.
3. Leave the admin/CRUD paths in `routes/file-workspaces.ts` synchronous — they are not
   hot and converting them is churn.

#### Acceptance criteria

- [ ] A second chat message in the same session performs zero `fs` calls for workspace resolution.
- [ ] Existing `file-workspace` tests pass unchanged (or are updated for the async signature).

---

### WI-7 — Reduce audit write amplification

**Priority**: MEDIUM · **Effort**: XS · **Risk**: low

#### Problem

`packages/gateway/src/middleware/audit.ts:34-52`, mounted at `app.use('/api/*', ...)`,
writes an `audit.logAudit()` row for **every** request under `/api/*`. The only exclusions
are `/health` and `/api/v1/health`, so `/api/v1/metrics` scrapes and high-frequency polls
all generate rows. `resourceId` is the raw path, so the table accumulates one distinct
value per unique URL — the same cardinality problem as WI-1d, in Postgres instead of memory.

#### Changes

1. Extend the exclusion list with `/api/v1/metrics` and known high-frequency polling routes.
2. Store `c.req.routePath` alongside the raw path in `details`, so audit queries can group
   by route.
3. Consider (decide during implementation, record the decision): sampling non-mutating
   `GET`s. Security auditing wants mutations; list reads are mostly noise. **Do not**
   sample anything that touches auth, secrets, or permissions.

#### Acceptance criteria

- [ ] Metrics scrapes produce no audit rows.
- [ ] Audit rows carry the route template.
- [ ] Any sampling decision is documented in the file header with its rationale.

---

### WI-8 — Add Windows to the CI matrix

**Priority**: LOW · **Effort**: S · **Risk**: none

#### Problem

CI runs `ubuntu-latest`, Node 22 only. Primary development is on **Windows**, and the repo
carries at least two documented Windows-specific bug classes:

- `localhost` resolving to `::1` while Docker publishes on IPv4 only (called out in `.env.example`).
- The Tailwind `@tailwindcss/oxide` native-scanner WASM fallback that `cssSizeGuard` in
  `vite.config.ts` exists specifically to catch.

Neither would be caught by CI as configured. Both have bitten this project before.

#### Changes

Add a `windows-latest` job running `typecheck` + `lint` + `build` (which exercises
`cssSizeGuard`) + the `core` and `cli` test suites. Skip the gateway suite initially —
it needs Postgres and would double CI time; add it once the job is stable.

#### Acceptance criteria

- [ ] A Windows job runs on PRs and is a required check.
- [ ] It fails on a deliberately introduced path-separator bug (verify once, then revert).

---

### WI-9 — Deferred / smaller items

| ID  | Item                                                                                | Effort | Note                                                                                                                             |
| --- | ----------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 9a  | Mock at module boundary in `shutdown-cleanup.test.ts`, `health.test.ts`             | S      | Real fix behind WI-2                                                                                                             |
| 9b  | Split `console.*` / `child_process` signals per package in `report-code-health.mjs` | XS     | 507 of 548 `console.*` are CLI, where stdout is the product — the aggregate manufactures a phantom work item on every report     |
| 9c  | Refresh `refactor-next.md` metrics; retarget Phase 2A to include UI pages           | S      | UI now has more >1000-LOC files than gateway (15 vs 14) yet Phase 2A lists zero UI targets                                       |
| 9d  | Trim `ui/src/api/endpoints/index.ts` type barrel; delete genuine dead exports       | S      | 420 unused exported types, mostly this one barrel; noise hides the next real leftover                                            |
| 9e  | Colocated tests for the ~10 genuinely untested gateway services                     | M      | Start with `claw/manager/manager.ts` (1 315 LOC). Note the health script reports 30 — ~20 are prompt/template data with no logic |
| 9f  | Provision a backend for Playwright E2E, or remove the step                          | M      | Currently `continue-on-error: true` with no backend: a check that can never fail occupies the slot where a real one would go     |
| 9g  | Begin Phase 2 decomposition — 33 files >1 000 LOC, UI first                         | L      | Large; schedule separately                                                                                                       |

---

## 2. Sequencing

```
Week 1   WI-1  metrics repair            (HIGH, self-contained)
         WI-2  test timeout              (XS, unblocks trustworthy CI)
         WI-3  env documentation         (S,  no code risk)

Week 2   WI-4  gateway coverage gate     (needs a clean suite → after WI-2)
         WI-7  audit exclusions          (XS, shares context with WI-1)
         WI-6  chat-path fs              (S)

Week 3+  WI-5  UI page smoke tests       (M, ongoing convention)
         WI-8  Windows CI                (S)
         WI-9  as capacity allows
```

**Only real dependency**: WI-4 after WI-2 — you cannot ratchet a coverage gate against a
suite that flakes. Everything else is parallelisable.

**Suggested first commit**: WI-2. One line, removes noise from every subsequent run, and
makes the WI-1 test work legible.

---

## 3. Explicitly out of scope

- **Phase 2 file decomposition** (33 files >1 000 LOC). Real, but large, and unrelated to
  the defects above. Track in `refactor-next.md`, not here.
- **`as unknown as` reduction.** Already at 7 in production — the roadmap target was ≤40.
  Nothing to do.
- **Migrating gateway/core off `console.*`.** Effectively already done: gateway has 4,
  core 16. The 548 figure is a measurement artifact (WI-9b).
- **New features.** This plan is defect repair and control tightening only.

---

## 5. Implementation outcomes (2026-08-12)

Branch `fix/audit-2026-08-12-tier1`. Full suite green after every commit:
gateway 471 files / 17 922 tests, core 9 847, ui 1 902, cli 438.

| Item         | Commit      | Outcome                                                                                                                                                                                                             |
| ------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WI-2         | `49593a9c`  | `testTimeout`/`hookTimeout` → 30 s. Three consecutive full runs green.                                                                                                                                              |
| WI-1 + WI-7  | `927b82ba`  | All five exposition defects fixed and re-verified by rendering the built module. Route templates replace raw paths; `/api/v1/metrics` excluded from both metrics and audit; audit records carry the route template. |
| WI-3         | `3912d4eb`  | `.env.example` security section + `config/escape-hatches.ts` registry + startup WARN. 11 tests.                                                                                                                     |
| WI-6         | `f2684efb`  | `getOrCreateSessionWorkspacePath()` — cached, path-only.                                                                                                                                                            |
| WI-4 + WI-9b | `<pending>` | Gateway coverage gated at 83/75/84/84 (measured 85.55/77.04/86.37/86.40). Health script now reports production counts per package.                                                                                  |

### Findings that changed during implementation

Three things turned out differently from the plan. All three made the work
smaller or the fix better, and none invalidated a decision:

1. **WI-6 was worse than the audit described.** The audit called it "4–6
   blocking syscalls per chat turn". In fact `getSessionWorkspace()` calls
   `calculateDirSize()`, which **recursively walks the entire session workspace**
   with sync `readdirSync`/`statSync`. The per-message cost therefore grew with
   the session's accumulated file count. The caller only ever used `.path`, so
   the fix is a path-only resolver rather than an async conversion — smaller
   than planned and strictly better.

2. **WI-1's histogram had a sixth defect.** `_count` was derived from bucket
   totals, so observations slower than the largest bucket (10 s) were dropped
   from the count entirely — the slowest requests, precisely the ones worth
   measuring. Fixed by tracking observations separately from buckets.

3. **The escape-hatch flags do not share a convention.**
   `OWNPILOT_ALLOW_LOCAL_EXEC` activates on `'1'`; every sibling activates on
   `'true'`. Setting it to `true` silently does nothing. The registry encodes
   each flag's real activating value rather than assuming uniformity, and a test
   pins that behaviour.

### Coverage baseline recorded

Gateway, 2026-08-12: **statements 85.55 %, branches 77.04 %, functions 86.37 %,
lines 86.40 %** (35 677/41 703 statements). Higher than the audit assumed — the
gate locks in existing work rather than demanding new tests. `ui` remains
ungated pending WI-5.

---

## 4. Decisions taken

The four questions below were left open in the proposal and resolved during
implementation, each using the option recommended there. Revisit any of them if
the trade-off changes.

1. **WI-7 sampling — decided: no sampling.** Every non-excluded `/api/*` request
   still writes an audit row. Sampling reads would cut volume, but an audit log
   with holes cannot answer "what did this actor touch?", which is the only
   question it exists for. Exclusions stay limited to endpoints that carry no
   security signal and fire on a timer (health probes, metrics scrapes). The
   rationale is recorded in the `middleware/audit.ts` header so the next reader
   does not have to rediscover it. **Revisit if** audit write volume becomes a
   measured bottleneck — the answer then is retention policy, not sampling.

2. **WI-4 threshold — decided: ratchet from measured.** 83/75/84/84 against a
   measured 85.55/77.04/86.37/86.40. An aspirational 80 % across the board would
   have _passed_ on statements/functions/lines and failed on branches, teaching
   the team to lower the number. A ratchet cannot regress and cannot be argued
   with.

3. **WI-8 scope — decided: PRs only, initially.** Cheaper, and the bug classes it
   targets (path separators, the oxide WASM fallback) are introduced by code
   changes, which PRs already gate. Extend to `main` if a merge-order failure
   ever gets through. _Not yet implemented._

4. **WI-5 pace — decided: top 5 pages plus a standing convention.** A one-off
   push across 69 pages would age badly; the "page touched ⇒ page tested" rule
   accrues coverage with normal work. _Not yet implemented._
