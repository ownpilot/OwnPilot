# Plan 12 — Test Stability & Concurrency Fixes

**Priority:** P1
**Effort:** M (3–5 days)
**Risk:** Low
**Depends on:** 06 (the registry `reset()` is the foundation)
**Source reports:** `refactor.md` §3.5, `refactor.md` §8.2, `CODE_REVIEW.md`
UI-001, UI-002, UI-003, UI-004

---

## Context

The test suite is 26 500+ tests with strong coverage (46% test-to-
source ratio). However:

- **3 known-flaky tests** pass in isolation and fail under full-suite
  concurrency:
  - `src/services/agent-runner-utils.test.ts` — "uses openai provider
    type for non-native providers"
  - `src/services/cli-chat-provider.test.ts` — "streams ToolBridge
    progress across rounds for gemini"
  - `src/services/subagent-runner.test.ts` — "uses non-native provider
    type as 'openai'"
    The root cause is module-singleton state pollution. Two tests
    instantiating the same provider in parallel race on shared state.
- **1 new failing test:** `src/routes/database/operations.test.ts` —
  "GET /db/stats > returns detailed stats when connected" — needs
  investigation.
- **UI hook tests** (UI-001 through UI-004 in `CODE_REVIEW.md`):
  - `event-bus.once()` calls `unsub()` before the handler — handler
    throws, no second event delivered.
  - `hook-bus` `Promise.race` timeout doesn't cancel the loser.
  - `useChatStore.setSessionId` bypasses React batching.
  - `useWebSocket` stale closure in `send`/`handleMessage`.

This plan delivers the per-test reset helper (PR-8 of Plan 06), tunes
Vitest concurrency, and fixes the four UI hook bugs.

## Scope

- `packages/core/src/services/registry.ts` — add `reset()` (covered in
  Plan 06 PR-1)
- `packages/gateway/src/test-helpers.ts` — add `resetAllServices()`
  (Plan 06 PR-8)
- `packages/gateway/src/test-setup.ts` — call reset per test
- `packages/gateway/vitest.config.ts` — concurrency tuning
- `packages/gateway/src/services/agent-runner-utils.test.ts` — verify
  the fix
- `packages/gateway/src/services/cli-chat-provider.test.ts` — verify
  the fix
- `packages/gateway/src/services/subagent-runner.test.ts` — verify
  the fix
- `packages/gateway/src/routes/database/operations.test.ts` — new
  failure investigation
- `packages/core/src/events/event-bus.ts:117-124` (UI-001)
- `packages/core/src/events/hook-bus.ts:178-184` (UI-002)
- `packages/ui/src/hooks/useChatStore.tsx:312-321` (UI-003)
- `packages/ui/src/hooks/useWebSocket.tsx:79, 220-240` (UI-004)

## Goals

1. The 3 known-flaky tests pass under full-suite concurrency
   (`pnpm test -- --reporter=verbose --pool=threads`).
2. The new `routes/database/operations.test.ts` failure is
   investigated, root-caused, and fixed (or marked `skip` with a
   documented reason).
3. The 4 UI hook bugs are fixed with regression tests.
4. The Vitest concurrency config is documented in
   `vitest.config.ts` with comments explaining each knob.
5. A `tests/concurrency.test.ts` smoke test runs every previously-
   flaky test in parallel and asserts they all pass.

## Implementation Steps

### Step 1 — `resetAllServices()` helper (Plan 06 PR-8)

- Add `resetAllServices()` to `packages/gateway/src/test-helpers.ts`:
  ```ts
  export async function resetAllServices() {
    const registry = getServiceRegistry();
    await registry.dispose(); // graceful shutdown
    registry.reset(); // clear instances
    // Re-initialize test DB, log levels, etc.
    await initTestEnvironment();
  }
  ```
- Update `test-setup.ts` to call `resetAllServices()` in `beforeEach`
  for the affected test files. Test files that do not touch services
  skip the reset (faster).

### Step 2 — Tune Vitest concurrency

In `packages/gateway/vitest.config.ts`:

- Set `pool: 'threads'`, `poolOptions.threads.maxThreads: 4` (default
  is unbounded; cap to limit file-handle exhaustion).
- Set `isolate: true` (default) — ensures module state doesn't leak
  between test files in the same worker.
- Add `sequence: { concurrent: true }` for the tests that benefit
  (the previously-flaky ones benefit from running in parallel within
  a file; the others can run serially).
- Document each knob in a comment block at the top of the config.

### Step 3 — Investigate the new failure

For `src/routes/database/operations.test.ts` — "GET /db/stats > returns
detailed stats when connected":

- Run the test in isolation to see the actual failure (it may be
  timing-related — a `setTimeout` race in the connection-probe).
- If timing-related, replace the `wait for connection` logic with a
  deterministic `await dbAdapter.isReady()`.
- If state-pollution, the `resetAllServices()` fix from Step 1 should
  cover it.
- Document the root cause and the fix in the test's commit message.

### Step 4 — Fix `event-bus.once()`

In `packages/core/src/events/event-bus.ts:117-124`:

- Move `unsub()` to _after_ `handler(event)`, wrapped in try/finally
  so that an exception in the handler still unsubscribes the listener
  for the next event.
- Add a regression test: a `once` listener that throws still fires for
  the next event (well, it doesn't, but the bus state is consistent —
  the next `emit` finds an empty handler set).

### Step 5 — Fix `hook-bus` race

In `packages/core/src/events/hook-bus.ts:178-184`:

- The current `Promise.race` lets the loser continue running. Replace
  with an `AbortController` pattern: pass `controller.signal` to each
  handler; the loser's handler should check the signal and bail
  before mutating `context.data`.
- Add a test: two handlers registered, the second is slow, the first
  times out — the second's mutation is _not_ applied to
  `context.data`.

### Step 6 — Fix `useChatStore.setSessionId`

In `packages/ui/src/hooks/useChatStore.tsx:312-321`:

- Wrap the direct `setState` call in `startTransition` so React
  batches the update:
  ```ts
  React.startTransition(() => {
    setSessionId(id);
    // related state changes
  });
  ```
- Add a React-testing-library test that asserts the update is
  batched (use `act` and verify no intermediate render).

### Step 7 — Fix `useWebSocket` stale closure

In `packages/ui/src/hooks/useWebSocket.tsx:79, 220-240`:

- Store `wsRef` and `send` in `useRef` instead of `useState` for the
  WebSocket instance; the `send` function reads from the ref, so the
  closure stays current.
- For the `onSessionChanged` listener (line 220), call the unsubscribe
  function in the cleanup of `useEffect`.
- Add a test: open a WebSocket, disconnect, reconnect — `send`
  operates on the current socket, not a stale closure.

## Acceptance Criteria

1. `pnpm test --filter @ownpilot/gateway` runs all 403 test files
   without a single failure or warning.
2. The 3 known-flaky tests pass when run in `--pool=threads
--poolOptions.threads.maxThreads=8`.
3. The new `routes/database/operations.test.ts` failure is fixed or
   documented; the test file has zero failures.
4. A regression test for `event-bus.once()` exists and passes.
5. A regression test for `hook-bus` `Promise.race` exists and passes.
6. A regression test for `useWebSocket` stale closure exists and
   passes.
7. `vitest.config.ts` has documented comments for every concurrency
   knob.

## Test Plan

- The 3 known-flaky tests are the primary test target. After the
  reset helper lands, they should pass without modification. If they
  still fail, the root cause is elsewhere and the investigation is
  in scope.
- `tests/concurrency.test.ts` (new) — runs every previously-flaky
  test 100 times in parallel; zero failures.
- The new UI regression tests are colocated with the existing tests
  for the affected hooks.

## Risks & Rollback

- **Risk:** The `resetAllServices()` helper is slow if many services
  are registered. Mitigation: lazy initialization; only services
  used in the test are reset. A benchmark before/after confirms
  the overhead is acceptable (< 50ms per test).
- **Risk:** The Vitest concurrency tuning might surface another
  hidden race. Mitigation: the `tests/concurrency.test.ts` smoke
  test catches regressions immediately.
- **Risk:** The UI hook fixes change observable behavior (e.g.,
  `useChatStore` batching may delay the UI update by a few ms).
  Mitigation: `startTransition` is the React 19 idiomatic solution;
  the delay is imperceptible.
- **Rollback:** Each fix is a local change. The reset helper is
  additive; reverting it leaves the test in its prior (flaky) state
  but does not introduce new failures.

## Out of Scope

- New test coverage for code that is currently untested. The existing
  46% ratio is healthy; the plan fixes reliability, not coverage.
- Migrating from Vitest to another runner. Per `refactor.md` §11,
  the 26 K+ tests are a sunk cost worth keeping.
- A test parallelization analysis (e.g., which tests _can_ run in
  parallel). The smoke test in this plan is sufficient; a full
  analysis is a future effort.
