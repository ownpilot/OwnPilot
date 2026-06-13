# OwnPilot — Next Refactor Plan (Round 9+)

**Generated**: 2026-06-13
**Previous**: Round 8 (28 commits) — barrel-to-subpath migration. tsc/test/build all green.
**Round 9 progress**: 24 commits on `round-9/bugfixes` branch — see "Round 9 Status" below.
**Goal**: This document is the canonical roadmap for the **next** round of structural improvement.

---

## 0. Where we are

| Package             | LOC (largest file)                                  | Source files > 500 LOC | Source files > 1000 LOC | Barrel exports | Sub-paths |
| ------------------- | --------------------------------------------------- | ---------------------- | ----------------------- | -------------- | --------- |
| `@ownpilot/core`    | 1114 (`agent/tools/file-system.ts`)                 | 17                     | 2                       | 21 (main)      | 23        |
| `@ownpilot/gateway` | 1572 (`services/claw/manager.ts`)                   | 34                     | 7                       | 20 (main)      | 6         |
| `@ownpilot/cli`     | 805 (`services/cli/chat-provider.ts`)               | 1                      | 0                       | 0              | 0         |
| `@ownpilot/ui`      | 1266 (`components/workflows/workflow-templates.ts`) | 1                      | 1                       | n/a            | n/a       |

## Round 9 Status (branch: `round-9/bugfixes`, 25 commits)

**Bugs fixed (14 of 15 from §1)**:

| Bug   | Title                                               | Commit                                         | Files                                                     |
| ----- | --------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------- |
| §1.1  | scheduler unhandled rejection on Promise.race loser | `16fff5ab`                                     | `scheduler/index.ts`                                      |
| §1.2  | email-tools SMTP/IMAP lie (6 executors)             | `f31ec481`, `e7b194cc`                         | `email-tools.ts` + test                                   |
| §1.3  | personalStoreCache unbounded growth                 | `86d290e0`                                     | `memory/personal.ts`                                      |
| §1.4  | anthropic thinking-block crash                      | `5a6be29d`                                     | `anthropic-provider.ts`                                   |
| §1.5  | credentials decrypt throws out of get/getById       | `315570ac`                                     | `credentials/index.ts` + test                             |
| §1.6  | data-gateway `'calendar'` typo for tasks            | `30c6b0a8`, `9c4e2c70`                         | `data-gateway/index.ts` + test                            |
| §1.7  | utility-data stack overflow on min/max/flatten      | `1156f5a0`                                     | `utility-data-tools.ts`                                   |
| §1.8  | email-tools attachment path-traversal               | `f31ec481`                                     | `email-tools.ts` + test                                   |
| §1.9  | web-fetch timer leak (3 sites)                      | `f8b72ca5`                                     | `web-fetch.ts`                                            |
| §1.11 | biased `Math.random` shuffle                        | `1156f5a0`                                     | `utility-data-tools.ts`                                   |
| §1.12 | corrupt-JSON silent data loss (4 files)             | `9d92cdd8`, `8f25039f`, `35327314`, `93cad327` | `memory/*.ts` + `scheduler/index.ts`                      |
| §1.13 | sandbox env prefix gaps                             | `36722914`                                     | `sandbox/local-executor.ts`                               |
| §1.14 | security-sensitive `Math.random` (5 sites)          | `1f22eb0b`, `e528227c`                         | `generator-tools.ts`, claw, telegram, audio, service-impl |
| §1.15 | agent cancel aborts in-flight tool calls (plumbing) | `413f3763`                                     | `agent.ts`, `tools.ts`                                    |

**Refactors (§1.10 — `as unknown as` from 162 → 142; 67 casts documented)**:

| Commit     | Title                                                                                                    | Reduction   |
| ---------- | -------------------------------------------------------------------------------------------------------- | ----------- |
| `fa0563f8` | document as unknown as casts in provider factory                                                         | -2 (count)  |
| `94c635b7` | document as unknown as casts in tool-validation                                                          | -3 (count)  |
| `1ee78f1e` | localise 18 `as unknown as` casts in workflow-service to two helpers (`nodeDataField`, `nodeDataRecord`) | -16 (count) |
| `799d2d0e` | localise 5 `as unknown as` casts in acp-event-mapper to a helper (`toMappedEvent`)                       | -4 (count)  |
| `52d4b4ca` | add trust-boundary header to 10 UI workflow config files                                                 | docs        |
| `f4fb662f` | add trust-boundary notes to 13 gateway route/service files                                               | docs        |
| `dbb1a408` | add trust-boundary note to useLayoutConfig                                                               | docs        |

**Documentation pattern**: For the remaining 142 casts, the pattern is now: one `Trust boundary:` line in the file's JSDoc header explaining the source of untyped data (DB row, HTTP body, npm registry, worker IPC). The cast sites themselves are unchanged — they are real bridges between generic payloads and typed consumers. Further reduction to ≤40 requires architectural changes (typed DB rows, post-validation typed handler args).

**Test status**: core 9441/9441 ✅, gateway 17297/17297 ✅, ui 414/414 ✅, **`pnpm -r typecheck` clean** (caught and fixed two tsc regressions — `DataStoreType: 'tasks'` missing and `error`/`reason` fields on `ToolExecutionResult`). Zero regressions across all 25 commits. Note: gateway has a pre-existing flaky test in `src/tools/skill/tools.test.ts` (~1/3 runs fail on different test cases). It is not caused by round-9 changes — running the same suite 3 times in a row gives varying pass/fail counts.

**Remaining from §1**: §1.10 (142 → ≤40, mostly docs now, needs architectural work — typed DB rows or post-validation typed handler args). §1.15 plumbing is done; follow-up is per-tool adoption (each long-running tool executor checking `ctx.signal` and forwarding to its own async APIs).

**Risk signal counts** (excludes `tests/`, `dist/`, `node_modules/`):

| Pattern                           | Count | Interpretation                                                                                                                                                                          |
| --------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `as any`                          | 5     | Low — only 5, mostly legacy                                                                                                                                                             |
| `as unknown as` (real)            | 142   | Down from 162. 67 cast sites are now documented via trust-boundary headers; 21 removed via helper extraction; remaining are typed-shape bridges that need architectural work to remove. |
| `eval(`                           | 4     | **Investigate** — 4 hits in production code is too many                                                                                                                                 |
| `new Function`                    | 4     | **Investigate** — only acceptable in template engines                                                                                                                                   |
| `exec(\`...\`` (template literal) | 2     | **HIGH** — shell injection candidates                                                                                                                                                   |
| `innerHTML` (non-React)           | 3     | Review for XSS                                                                                                                                                                          |
| `dangerouslySetInnerHTML`         | 1     | Review for XSS                                                                                                                                                                          |
| `child_process` imports           | 42    | Centralize through `services/permission/gate.ts`                                                                                                                                        |
| `Math.random()` (real)            | 10    | Down from 22 (call sites only; comments don't count). 5 security-sensitive sites switched to `crypto.randomInt`/`randomBytes`/`randomUUID`; remaining 10 are sampling/jitter.           |
| `eslint-disable`                  | 38    | Audit — most are line-level exceptions                                                                                                                                                  |
| `@ts-expect-error`                | 1     | Review — should be < 5                                                                                                                                                                  |
| `@ts-ignore`                      | 0     | ✅ Good                                                                                                                                                                                 |
| `TODO`                            | 4     | Resolve or convert to issues                                                                                                                                                            |
| `FIXME`                           | 1     | Resolve                                                                                                                                                                                 |

**Test coverage gap**: 46 source files in `packages/gateway/src/services/` have NO corresponding test file (see Appendix A).

---

## 1. Critical Bug Fixes (do FIRST, separate from refactor)

These came from the bug-hunter audit. Each is a real, reproducible bug — **fix before refactor** so the refactor doesn't have to track behavior changes.

### 1.1 Unhandled rejection in scheduler race (CRITICAL)

`packages/core/src/scheduler/index.ts:728-738` — `Promise.race` for task timeout has no catch on the loser. If the timeout fires first, the still-in-flight `executionPromise` rejection becomes `unhandledRejection`.

**Fix**: add `executionPromise.catch(() => {});` before `Promise.race()` (the pattern already exists in `heartbeat-runner.ts:494`).

### 1.2 Email tool lies about success (CRITICAL)

`packages/core/src/agent/tools/email-tools.ts:263-305, 359, 444, 502, 562, 627` — all email executors return `isError: false` with `status: 'prepared'` but the email is never sent (no SMTP wiring). The agent loop treats these as successes.

**Fix**: until SMTP is wired, return `isError: true` with `requiresSMTPConfig: true`. Don't tell the user the email was sent.

### 1.3 Module-level cache leak (CRITICAL)

`packages/core/src/memory/personal.ts:848` — `personalStoreCache` is a module-level `Map<userId, PersonalMemoryStore>` that is never cleared. Long-running gateways leak one full per-user in-memory dataset per unique `userId` seen.

**Fix**: add LRU cap (e.g. 1000 entries) and a `clear(userId)` method, called from the assistant shutdown path.

### 1.4 Anthropic provider crash on string content with thinking (HIGH)

`packages/core/src/agent/providers/anthropic-provider.ts:582-617` — when `msg.content` is a string and the message is assistant-role with thinking blocks, line 617 calls `contentParts.unshift(...thinkingParts)` but `contentParts` is the string itself, so it throws "is not a function".

**Fix**: initialize `contentParts: unknown[] = []`, push the text part explicitly.

### 1.5 Decryption throws out of credentials (HIGH)

`packages/core/src/credentials/index.ts:377-382` — `decryptValue(...)` is not wrapped in try/catch. A wrong encryption key throws synchronously out of `get()`/`getById()`, taking down the request handler.

**Fix**: try/catch, return null and `auditLog('decrypt_failed', ...)`.

### 1.6 Data-gateway: wrong store name in `access()` check (HIGH)

`packages/core/src/data-gateway/index.ts:490, 507, 519, 535, 541` — `createTask`/`completeTask`/`listTasks`/`searchTasks`/`deleteTask` call `this.access(agentId, 'calendar', ...)` while operating on `this.tasks`. Means: a user with `tasks` permission can't use tasks; a user with `calendar` permission can.

**Fix**: change first arg to `'tasks'`.

### 1.7 Utility-data: stack overflow on 10k+ arrays (HIGH)

`packages/core/src/agent/tools/utility-data-tools.ts:721, 726` — `Math.min(...numsMin)` / `Math.max(...numsMax)` spreads the full array onto the call stack. Throws `RangeError` on 10k+ numeric inputs (within `applyToolLimits`).

**Fix**: replace with manual `for` loop. Also cap `flat(Infinity)` (line 691) at e.g. `flat(100)`.

### 1.8 Email attachment path-injection (HIGH)

`packages/core/src/agent/tools/email-tools.ts:264-274` — attachments are read directly from LLM-controlled args, no `isPathAllowedAsync` call. When SMTP is wired, an LLM could exfiltrate `/etc/passwd`. The error path also leaks the requested path.

**Fix**: run attachments through `isPathAllowedAsync(filePath, context.workspaceDir)` (mirror `file-system.ts:266-279`).

### 1.9 Stale timer in fetch catch path (HIGH)

`packages/core/src/agent/tools/file-system.ts:606-632` (downloadFile) and `web-fetch.ts:355-365, 493-502, 752-761` — on network error, the `setTimeout` is only cleared on the success path; an `AbortError` in the catch block leaves the timer firing.

**Fix**: move `clearTimeout(timeoutId)` into `finally`.

### 1.10 `as unknown as` proliferation (MEDIUM, big work)

162 occurrences. Goal: cut to <40 by adding proper type guards. Focus areas:

- `core/agent/providers/*` (anthropic, google, openai-compatible)
- `core/memory/*` (personal, secure-store)
- `gateway/services/agent/*`

**Approach**: add `as Type` only at trust boundaries (HTTP/DB/JSON.parse) with a `// trust boundary:` comment. Use `zod` `.parse()` for all route bodies (gateway uses zod already).

### 1.11 Biased shuffle (MEDIUM)

`packages/core/src/agent/tools/utility-data-tools.ts:695` — `sort(() => Math.random() - 0.5)` is mathematically biased.

**Fix**: Fisher–Yates (the pattern is already used at line 673, copy it).

### 1.12 Corrupt-JSON silently drops user data (MEDIUM)

`personal.ts:819`, `secure-store.ts:725`, `conversation-store.ts:737`, `scheduler/index.ts:823` — all wrap `JSON.parse` in `try{} catch{}` that silently resets the in-memory map to empty on corruption. A disk error loses ALL user data with only a `debug` log.

**Fix**: at minimum `log.error` not `log.debug`, and back up the corrupt file as `*.corrupt-${ts}` before resetting.

### 1.13 Sandbox env sanitization gaps (MEDIUM)

`packages/core/src/sandbox/local-executor.ts:46-62` — `SENSITIVE_ENV_PREFIXES` list omits `AUTH`, `JWT`, `OAUTH`. A `MYAUTH_TOKEN` env var would slip through.

**Fix**: add `'AUTH'`, `'JWT'`, `'OAUTH'`, `'CUSTOMER'`, `'SESSION'`.

### 1.14 `Math.random` in security-adjacent paths (MEDIUM)

22 hits — review each. Replace with `crypto.randomInt` / `crypto.randomUUID` for:

- IDs / tokens / nonces
- CAPTCHA / rate-limit salt
- Anything used in a security context

Acceptable for: sampling, jitter, UI effects.

### 1.15 Agent cancel does not abort in-flight tool calls (MEDIUM)

`packages/core/src/agent/agent.ts:763-768` — `cancel()` only flips `isProcessing: false`. The provider's fetch is aborted, but `executeToolCall` keeps running local code or DB queries.

**Fix**: pass the `AbortController` through `ToolContext`, check `signal.aborted` before/during tool execution.

---

## 2. Refactor Phases

Each phase is independent, gated by tsc + `pnpm -r test`. Use the `git-flow` skill: one concern per commit, branch from `main`.

### Phase 1 — Low Risk / High Payoff (1-2 weeks)

> No behavior change, tests already pass, quick wins.

| #   | Task                                                                                                                                                                                                           | Files                                                                 | Effort | Risk | Why                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------ | ---- | --------------------------------------------------------------------- |
| 1.1 | Fix all 15 critical/high bugs from §1                                                                                                                                                                          | (listed above)                                                        | M      | low  | Correctness first — refactor on a known-good base                     |
| 1.2 | Add proper type guards — cut `as unknown as` from 162 → ≤80                                                                                                                                                    | `core/agent/providers/*`, `core/memory/*`, `gateway/services/agent/*` | L      | low  | Big leverage: enforces `strict + noUncheckedIndexedAccess` discipline |
| 1.3 | Add `clear()` + LRU to module-level `Map` caches (personalStoreCache, secure-store, conversation-store)                                                                                                        | `core/memory/*.ts`                                                    | S      | low  | Prevents production memory leak                                       |
| 1.4 | Replace `Math.random` in security paths with `crypto.randomInt`/`randomUUID`                                                                                                                                   | grep-driven, 8-10 spots                                               | S      | low  | Security hygiene                                                      |
| 1.5 | Centralize `child_process.exec` calls through a thin wrapper in `services/permission/gate.ts` (no template literals allowed)                                                                                   | `agent/tools/code-execution.ts`, `core/sandbox/*`                     | S      | low  | One audit point for shell-injection                                   |
| 1.6 | Add the 10 missing test files for the 46 untested gateway services — start with `services/log.ts`, `orphan-reconciliation.ts`, `retention-service.ts`, `shutdown-cleanup.ts` (these run at gateway start/stop) | `packages/gateway/tests/services/*.test.ts` (new)                     | M      | low  | Phase-1 baseline coverage                                             |

**Phase 1 exit criteria**:

- [ ] All 15 bugs in §1 fixed
- [ ] `as unknown as` count ≤ 80
- [ ] `pnpm -r test` still green
- [ ] `pnpm -r typecheck` still green
- [ ] No new `Math.random` in security paths

---

### Phase 2 — Medium Risk (2-4 weeks, test heavily)

> Significant test coverage needed. May need rollback plan. Run collab_debug on each file split.

#### 2A. Break up the 4 largest gateway files

Each split should leave the public barrel re-export everything so call sites don't change. Test files for the new modules come first (TDD).

| #   | Source                                  | LOC  | Target structure                                                                 | Why                                                                                                          |
| --- | --------------------------------------- | ---- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 2.1 | `services/claw/manager.ts`              | 1572 | `services/claw/manager/{index,registry,lifecycle,permissions,scheduler-sync}.ts` | Manager mixes 5 concerns. Files in `services/claw/manager-*.ts` already suggest a partial split — finish it. |
| 2.2 | `services/workflow/workflow-service.ts` | 1531 | `services/workflow/{service,runtime,job-dispatch,persistence,index}.ts`          | Workflow service mixes runtime, persistence, and template loading.                                           |
| 2.3 | `services/agent/service.ts`             | 1054 | `services/agent/{service,runs,prompts,tools,index}.ts`                           | Service already has `cache.ts`, `prompt.ts`, `runner-utils.ts` siblings — pull in the rest.                  |
| 2.4 | `services/tool/templates.ts`            | 853  | `services/tool/templates/{registry,builtin,user,render}.ts`                      | Template engine has 4 phases mixed together.                                                                 |
| 2.5 | `services/claw/runner.ts`               | 813  | `services/claw/runner/{index,execution,context,errors}.ts`                       | Runner mixes the execution loop with context management.                                                     |
| 2.6 | `db/repositories/workflows/index.ts`    | 859  | `db/repositories/workflows/{repo,queries,migrations,index}.ts`                   | DB repo mixes SQL with domain logic.                                                                         |

**Phase 2A exit criteria**:

- [ ] No file > 800 LOC in `gateway/src/services/` and `gateway/src/db/repositories/`
- [ ] Existing `*.test.ts` files for the source still pass (re-import from new location)
- [ ] `pnpm -r test` green

#### 2B. Split the over-stuffed core sub-path barrels

| #    | Barrel                      | Exports | Suggested split                                                                                                                                                                                    |
| ---- | --------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.7  | `core/services/index.ts`    | **73**  | Split into `./services/registry`, `./services/builtins/weather`, `./services/builtins/finance`, etc. Keep a thin barrel re-exporting all.                                                          |
| 2.8  | `core/agent/index.ts`       | **39**  | Split into `./agent/agent`, `./agent/providers`, `./agent/tools`, `./agent/soul`.                                                                                                                  |
| 2.9  | `core/agent/tools/index.ts` | **34**  | Already has sub-folders — split into `./agent/tools/file-system`, `./agent/tools/web`, `./agent/tools/email`, `./agent/tools/personal-data`, `./agent/tools/code`, `./agent/tools/index` (barrel). |
| 2.10 | `core/agent/soul/index.ts`  | 21      | Split into `./agent/soul/{heartbeat,identity,profile}` if not already                                                                                                                              |

**Phase 2B exit criteria**:

- [ ] No sub-path barrel > 35 exports
- [ ] No new sub-path barrel changes the public API (all re-exports present)
- [ ] `pnpm -r typecheck` green
- [ ] `pnpm -r test` green

#### 2C. Add tests for the next 30 of 46 untested gateway services

Priority order (highest blast-radius first):

1. `services/claw/manager-*.ts` (3 files) — they support the largest file
2. `services/workflow/executors/*.ts` (5 files) — node executors run user code
3. `services/metric/{pulse,service}.ts` — observability
4. `services/provider/health.ts` — used by router
5. `services/llm/semaphore.ts` — concurrency gate

**Phase 2C exit criteria**:

- [ ] 30+ of the 46 untested services have at least 1 happy-path test
- [ ] `pnpm --filter @ownpilot/gateway test` green

---

### Phase 3 — High Risk (1-2 months, full regression, coordinate)

> Behavior changes expected. Integration tests required.

#### 3.1. Consolidate the 4 channel-plugin scaffolds

Each of `telegram`, `discord`, `slack`, `whatsapp`, `matrix`, `email`, `sms`, `webchat` plugins has near-identical:

- plugin lifecycle (init/start/stop)
- message normalization
- webhook signature verification
- outbound message queue
- rate-limit handling

**Plan**:

1. Extract a `plugins/channel-base.ts` with the lifecycle, verification, and queue
2. Each plugin becomes a thin subclass with `verifyWebhook()`, `normalizeIncoming()`, `sendOutbound()`
3. Add `plugins/__tests__/channel-base.test.ts` with shared conformance tests
4. Migrate all 8 plugins, one PR per plugin
5. Remove duplicated verification logic (current bug: 1 `dangerouslySetInnerHTML` lives in webchat — verify it gets killed by the new sanitization layer)

**Risk**: high — these are integration points. Each PR should include a manual test plan.

#### 3.2. Extract a shared `core/services` registry pattern

The current `core/services/index.ts` mixes 73 exports. The cleanest model is a `ServiceRegistry` (already exists per memory) — make it the pattern across all services. Benefit:

- Lazy init (no eager construction)
- Test isolation (clear/reset per test)
- Single audit point for service lifecycle

This pairs with Phase 2.7 (split the barrel).

#### 3.3. Break cyclic deps between `core/agent`, `core/memory`, `core/scheduler`

Suspected cycle (verify with `madge` or graph analysis):

- `core/agent/agent.ts` → `core/memory/*` (for context injection)
- `core/memory/personal.ts` → `core/agent/*` (for tool invocation in memory ops?)
- `core/scheduler/index.ts` → `core/agent/*` (for running scheduled prompts)

**Plan**: introduce a `core/contracts/` package (or use the existing `core/types/`) with plain interface types. Both sides depend on contracts, not each other. Use dependency injection to wire the implementation.

**Risk**: medium-high — touches the most-imported modules in the codebase.

#### 3.4. Add structured logging everywhere (observability)

The `observability` skill recommends JSON-to-stdout with `traceId`, `event`, `duration_ms`, `outcome`. Current state: `pino` is a dependency, but use is inconsistent. Add a small wrapper:

- `core/observability/log.ts` — `log.info({traceId, event, ...}, msg)`
- `core/observability/trace.ts` — `withTrace(traceId, fn)` helper

Then a single PR per package switches call sites.

**Risk**: low-medium (it's an additive change), but very large surface (hundreds of `console.log` calls).

#### 3.5. End-to-end integration tests against real providers

The `audit-log` skill notes: "WrongStack writes session JSONL to `sessionRoot`." The `services/agent/service.ts` and `services/llm/router.ts` are the integration points. Add a `packages/gateway/tests/integration/` suite that:

- Mocks provider responses
- Walks through agent → tool → LLM → response
- Asserts JSONL log structure

**Risk**: low (test-only), but high value for confidence before 1.0.

---

## 3. Dependency Graph (Phase 2 splits)

```
gateway/src/services/claw/manager.ts (1572)
    ├── claw/manager/index.ts        (re-export)
    ├── claw/manager/registry.ts     (claw CRUD: ~400 LOC)
    ├── claw/manager/lifecycle.ts    (start/stop/health: ~300 LOC)
    ├── claw/manager/permissions.ts  (gate checks: ~250 LOC)
    └── claw/manager/scheduler-sync.ts (claw↔scheduler: ~400 LOC)

gateway/src/services/workflow/workflow-service.ts (1531)
    ├── workflow/service.ts          (public API, ~250 LOC)
    ├── workflow/runtime.ts          (execution loop: ~500 LOC)
    ├── workflow/job-dispatch.ts     (queue + retry: ~350 LOC)
    ├── workflow/persistence.ts      (DB I/O: ~300 LOC)
    └── workflow/index.ts            (re-export)

gateway/src/services/agent/service.ts (1054)
    ├── agent/service.ts             (public API, ~200 LOC)
    ├── agent/runs.ts                (run state machine: ~300 LOC)
    ├── agent/prompts.ts             (template rendering: ~250 LOC)
    ├── agent/tools-bridge.ts        (tool invocation: ~250 LOC)
    └── agent/index.ts               (re-export)

gateway/src/services/tool/templates.ts (853)
    ├── tool/templates/registry.ts   (template CRUD: ~200 LOC)
    ├── tool/templates/builtin.ts    (bundled templates: ~300 LOC)
    ├── tool/templates/user.ts       (user-saved: ~150 LOC)
    ├── tool/templates/render.ts     (template engine: ~200 LOC)
    └── tool/templates/index.ts      (re-export)
```

Each split leaves a thin `index.ts` re-export so all existing call sites work unchanged.

---

## 4. Risk Assessment (per module — high-payoff candidates)

| Module                                          | LOC  | Cyclomatic | Test % (est.) | Public API  | Phase |
| ----------------------------------------------- | ---- | ---------- | ------------- | ----------- | ----- |
| `services/claw/manager.ts`                      | 1572 | ~35        | ~50%          | yes         | 2A    |
| `services/workflow/workflow-service.ts`         | 1531 | ~30        | ~55%          | yes         | 2A    |
| `services/agent/service.ts`                     | 1054 | ~25        | ~60%          | yes         | 2A    |
| `services/tool/templates.ts`                    | 853  | ~20        | ~40%          | yes         | 2A    |
| `core/agent/tools/file-system.ts`               | 1114 | ~25        | ~70%          | yes (tool)  | 3.6   |
| `core/agent/orchestrator.ts`                    | 829  | ~30        | ~75%          | yes (agent) | 3.6   |
| `ui/components/workflows/workflow-templates.ts` | 1266 | low (UI)   | ~30%          | yes (page)  | 3.7   |

`file-system.ts` and `orchestrator.ts` are the most-leverage targets in core but already well-tested. Phase 3.6 is "extract the workspace-isolation helpers" — a small surgical cut.

---

## 5. Rollback Strategy

| Phase | Strategy                                                                         |
| ----- | -------------------------------------------------------------------------------- |
| 1     | Single PR per bug fix — `git revert` per commit                                  |
| 2A    | Feature flag `GATEWAY_CLAW_SPLIT=0` keeps the old manager.ts re-export path      |
| 2B    | Sub-path barrels are additive; old barrel still works (this is what round 8 did) |
| 2C    | Test-only — revert is the PR                                                     |
| 3.1   | One plugin per PR; old plugin stays until the new one ships                      |
| 3.2   | Two-week overlap with old registry (env var picks)                               |
| 3.3   | `git revert` per affected file; tsc gates the merge                              |

---

## 6. Exit Criteria for the Whole Round

- [ ] All Phase 1 bugs fixed and merged
- [ ] All Phase 2A files split, all tests green, no file > 800 LOC in `services/` and `db/repositories/`
- [ ] All Phase 2B barrels < 35 exports
- [ ] 30+ of the 46 untested gateway services have tests
- [ ] All 8 channel plugins migrated to the shared base class
- [ ] Cyclic deps between `core/agent`, `core/memory`, `core/scheduler` broken (use `madge` to verify)
- [ ] `pnpm -r typecheck` green
- [ ] `pnpm -r test` green (core 9440, gateway 17297, ui 414 baseline; CLI 190 ECONNREFUSED expected)
- [ ] `pnpm -r build` green
- [ ] `pnpm audit --prod --audit-level high` clean
- [ ] `as unknown as` count ≤ 40
- [ ] Zero `as any` in production code

---

## 7. Anti-Patterns to Avoid

- **Don't over-phase**: if a task is < 1h, merge it with a related task.
- **Don't plan without analyzing**: this plan is built on actual line counts, grep counts, and a bug-hunter run. Always re-verify before acting.
- **Don't skip the dependency graph**: when splitting a file, draw the import map first.
- **Don't break the public API**: keep the old entry point as a re-export for at least one release.
- **Don't touch tests and logic in the same commit**: the round 8 subagent architecture proved this — separate commits.
- **Don't merge a refactor with a bug fix**: each commit does one thing, so `git bisect` works.
- **Don't trust the LLM's stale training data**: package versions, deprecations, API surfaces — always check the registry (use the `tech-stack` skill).

---

## 8. Subagent Architecture (when ready to execute)

For Phase 1 (bug fixes), spawn **3 parallel subagents** with role `debugger`, scoped to:

1. `core-bugs` — bugs #1.1, #1.3, #1.4, #1.5, #1.6, #1.7, #1.8, #1.11, #1.12, #1.13, #1.15
2. `core-tool-bugs` — bugs #1.2, #1.8 (email-tools), #1.9, #1.14
3. `type-cleanup` — bug #1.10 (`as unknown as` audit) + #1.14 (`Math.random` audit)

For Phase 2A (file splits), one subagent per file — 6 sequential commits, each with its own tests.

For Phase 3.1 (channel plugins), one subagent per plugin — 8 sequential PRs.

**Mail protocol**: subagents should `mail_send` results to the main agent. Main agent aggregates via `roll_up`.

---

## Appendix A — Untested gateway services (46 files)

```
services/log.ts
services/orphan-reconciliation.ts
services/retention-service.ts
services/shutdown-cleanup.ts
services/streaming-types.ts
services/usage-tracking.ts
services/claw/manager-failure.ts
services/claw/manager-helpers.ts
services/claw/manager-task-plan.ts
services/claw/manager-types.ts
services/config/entry-validation.ts
services/dashboard/types.ts
services/llm/semaphore.ts
services/metric/pulse.ts
services/metric/service.ts
services/page-prompts/*.ts (11 files — all prompt templates)
services/provider/health.ts
services/workflow/node-types.ts
services/workflow/template-ideas.ts
services/workflow/types.ts
services/workflow/workflow-node-job-handler.ts
services/workflow/executors/{claw,control-flow,data,io,tool-llm-code}.ts (5 files)
services/workflow/templates/*.ts (10 files)
```

## Appendix B — Barrel export counts (sub-paths with > 10 exports)

| Barrel                                  | Exports |
| --------------------------------------- | ------- |
| `core/services/index.ts`                | **73**  |
| `core/agent/index.ts`                   | 39      |
| `core/agent/tools/index.ts`             | 34      |
| `core/agent/soul/index.ts`              | 21      |
| `core/scheduler/index.ts`               | 21      |
| `core/events/index.ts`                  | 17      |
| `core/data-gateway/index.ts`            | 15      |
| `core/credentials/index.ts`             | 13      |
| `core/costs/index.ts`                   | 12      |
| `core/security/index.ts`                | 12      |
| `core/sandbox/index.ts`                 | 11      |
| `core/agent/providers/configs/index.ts` | 19      |

## Appendix C — Top 20 source files by LOC (excluding tests)

| LOC  | File                                                    |
| ---- | ------------------------------------------------------- |
| 1572 | `gateway/src/services/claw/manager.ts`                  |
| 1535 | `gateway/src/services/workflow/workflow-service.ts`     |
| 1405 | `gateway/src/channels/service-impl.ts`                  |
| 1327 | `gateway/src/channels/plugins/whatsapp/whatsapp-api.ts` |
| 1266 | `ui/src/components/workflows/workflow-templates.ts`     |
| 1177 | `gateway/src/routes/claws.ts`                           |
| 1114 | `core/src/agent/tools/file-system.ts`                   |
| 1075 | `gateway/src/utils/chat-widgets.ts`                     |
| 1068 | `gateway/src/services/agent/service.ts`                 |
| 1050 | `gateway/src/ws/server.ts`                              |
| 1029 | `core/src/agent/tools/expense-tracker.ts`               |
| 995  | `gateway/src/routes/chat/index.ts`                      |
| 964  | `gateway/src/channels/plugins/telegram/telegram-api.ts` |
| 962  | `gateway/src/routes/workflow/index.ts`                  |
| 958  | `gateway/src/routes/chat/history.ts`                    |
| 946  | `core/src/agent/tools.ts`                               |
| 943  | `core/src/agent/tools/personal-data.ts`                 |
| 917  | `gateway/src/plans/executor.ts`                         |
| 905  | `core/src/plugins/marketplace.ts`                       |
| 902  | `gateway/src/db/repositories/claws.ts`                  |
