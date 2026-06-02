# Plan 10 — Claw & Runtime Reliability

**Priority:** P1
**Effort:** L (1 week)
**Risk:** Medium
**Depends on:** 06 (the registry migration of claw/manager lands first)
**Source reports:** `CODE_REVIEW.md` RACE-001, CLAW-001 through CLAW-004,
TRIG-001, TRIG-002, TRIG-003, `refactor_plan.md` H5, H6, M6, M7, M8, L1, L2

---

## Context

The Claw autonomous-agent runtime is the system's most consequential
component — a 1 839-line `ClawManager` plus a 895-line `Runner` together
own the user's persistent, scheduled, event-driven LLM cycles. After the
2026-05-23 consolidation (Claw/Soul/Crew) and the 2026-05-30 refactor
sweep (H5 done — `cycleInProgress` guard moved above the emit), the
remaining reliability gaps are:

- **RACE-001:** The `cycleInProgress` check in `services/claw/manager.ts`
  at line 925 is non-atomic with the write at line 936. Two concurrent
  callers (rate-limit timer + steer) both pass, both set
  `abortController`, both invoke `runner.runCycle()`. The guard fix in
  H5 is partial — it covers the _first_ call but the abortController
  swap race remains.
- **CLAW-001:** `approveEscalation` calls `repo.appendToInbox` without
  `markDirty(managed)`. The 30-second persistTimer skips, crash before
  next explicit persist loses the nudge.
- **CLAW-002:** `updateClawConfig` clears `managed.timer` but never
  `managed.persistTimer` when transitioning to single-shot. The
  interval keeps firing indefinitely.
- **CLAW-003:** `saveAuditLog` errors are caught and logged at `warn`,
  but the cycle result does not change. Audit records are permanently
  lost.
- **CLAW-004:** `workspaceDir` hot-reload poisons the in-flight
  guardrail closure (the closure captures the old path).
- **TRIG-001:** `Promise.allSettled` fires all due triggers with no
  cap; trigger storm with zero throttling. Duplicate trigger IDs are
  silently dropped.
- **TRIG-002:** Per-type circuit breaker is keyed by `eventType` only;
  50 different event types fire concurrently → 50 parallel tasks with
  no global cap.
- **TRIG-003:** The AI cron parser prompt embeds the user's
  `description` string unbounded; crafted input breaks the JSON
  structure before field extraction.

This plan bundles the fixes because they share the trigger / claw /
inbox / persist machinery and benefit from a single integrated test
suite.

## Scope

- `packages/gateway/src/services/claw/manager.ts` (RACE-001, CLAW-001, CLAW-002)
- `packages/gateway/src/services/claw/runner.ts` (CLAW-003, CLAW-004)
- `packages/gateway/src/triggers/engine.ts` (TRIG-001, TRIG-002)
- `packages/gateway/src/routes/triggers.ts` (TRIG-003)
- `packages/gateway/src/services/claw/inbox.ts` (new — extracted from manager)

## Goals

1. The `cycleInProgress` guard is implemented as an atomic, awaited
   mutex — either via `async-mutex` or a single-promise `chain`
   pattern. The abortController swap race is impossible.
2. Every `markDirty` site in the claw runtime is identified; missing
   calls are added.
3. `updateClawConfig` correctly resets the persistTimer; a unit test
   verifies the interval is cleared.
4. `saveAuditLog` failure aborts the cycle and emits an `audit`
   event so operators can detect the data loss.
5. `workspaceDir` hot-reload captures the new value in the guardrail
   closure on each cycle.
6. Trigger fan-out is capped (per-type and globally); duplicate trigger
   IDs are deduplicated.
7. The AI cron prompt is parameterized to bound the user input and the
   response is parsed defensively.

## Implementation Steps

### Step 1 — Atomic cycle mutex

In `packages/gateway/src/services/claw/manager.ts`:

- Introduce a `CycleMutex` class that holds `current: Promise<void> | null`.
- `acquire()` returns a release function and queues the caller if a
  cycle is in progress (bounded queue of 1 — overflow returns
  `cycle.skipped` with reason `concurrent`).
- Replace the `cycleInProgress` boolean and the `abortController` swap
  with the mutex. The release function is called in a `finally` block
  to guarantee the next cycle can start.
- Add a unit test that fires two `executeCycle` calls in parallel and
  asserts exactly one runs and the other gets `cycle.skipped`.

### Step 2 — `markDirty` audit

In `packages/gateway/src/services/claw/manager.ts`:

- `grep` for every call to `repo.appendToInbox` and
  `managed.session.inbox.push`. Each must be paired with
  `markDirty(managed)`.
- Specifically: `approveEscalation` (lines 759–760 and 774–776) is
  missing the call. Add it.
- Add a wrapper `inboxAppend(managed, message)` that does both the
  append and the `markDirty` in one place. New code uses the wrapper;
  existing direct calls are migrated in the same PR.

### Step 3 — `persistTimer` lifecycle

In `packages/gateway/src/services/claw/manager.ts:865-890`:

- Extract the persistTimer management into a
  `setPersistTimer(managed)` / `clearPersistTimer(managed)` pair.
- `updateClawConfig` calls `clearPersistTimer(managed)` when
  transitioning to single-shot; calls `setPersistTimer(managed)` when
  transitioning to scheduled.
- A unit test simulates the transition and asserts the interval is
  cleared (no `setInterval` handle leaks across the boundary).

### Step 4 — `saveAuditLog` failure handling

In `packages/gateway/src/services/claw/runner.ts:183-185`:

- Replace the silent `.catch(log.warn)` with a structured failure:
  - The cycle result becomes `status: 'error', error: 'audit_log_write_failed'`.
  - An `audit.claw.cycle` event fires with `ok: false, reason: 'audit_log'`.
- The cycle is still considered "executed" — the LLM response is real
  and shouldn't be discarded — but the failure is visible.

### Step 5 — `workspaceDir` hot-reload

In `packages/gateway/src/services/claw/runner.ts:554-556`:

- The guardrail closure should look up `workspaceDir` from a
  `ManagedConfig` accessor (a getter), not capture it in a closure.
- Each cycle's guardrail evaluates the current value, so hot-reload
  takes effect on the next cycle boundary, not mid-cycle.
- A test reloads the config mid-cycle and verifies the next guardrail
  check uses the new path.

### Step 6 — Trigger fan-out cap

In `packages/gateway/src/triggers/engine.ts:430-488`:

- Replace `Promise.allSettled(dueTriggers.map(...))` with a bounded
  pool: `pLimit(MAX_CONCURRENT_TRIGGERS, default 5)`.
- Add a global cap `MAX_CONCURRENT_TRIGGERS_TOTAL = 20` enforced via a
  semaphore; overflow is queued.
- Deduplicate due triggers by ID before fanning out — `Array.from(new
Set(dueTriggers.map(t => t.id))).map(id => dueTriggers.find(t =>
t.id === id))`.

### Step 7 — AI cron prompt hardening

In `packages/gateway/src/routes/triggers.ts:518-535`:

- Cap the `description` length at 500 characters before embedding in
  the prompt.
- Truncate with a clear marker (`...[truncated]`) and warn the user
  that the input was too long.
- Parse the LLM response defensively: validate that the cron field has
  exactly 5 or 6 space-separated tokens, each matching the cron
  grammar; reject anything else with a 400.

## Acceptance Criteria

1. Two `executeCycle` calls fired in parallel result in exactly one
   `cycle.start` event and one `cycle.complete` event; the other
   produces a `cycle.skipped` event.
2. `approveEscalation` followed by a simulated crash (no explicit
   `persist` call) recovers the persisted inbox from the next
   `persistTimer` tick — the nudge is not lost.
3. After `updateClawConfig({ mode: 'single-shot' })`, no `persistTimer`
   interval fires in the next 60 seconds.
4. A `saveAuditLog` failure causes the cycle to end with
   `status: 'error'` and emits `audit.claw.cycle` with `ok: false`.
5. A mid-cycle config reload that changes `workspaceDir` is reflected
   in the next cycle's guardrail check.
6. 50 triggers of different types fired simultaneously run in batches
   of 5; the 51st waits in the queue.
7. A 10 000-character `description` is rejected with a 400.

## Test Plan

- `tests/services/claw-manager.test.ts` — concurrent cycle mutex
  test; markDirty audit; persistTimer lifecycle.
- `tests/services/claw-runner.test.ts` — saveAuditLog failure
  propagation; workspaceDir hot-reload.
- `tests/triggers/engine.test.ts` — fan-out cap; trigger
  deduplication.
- `tests/routes/triggers.test.ts` — AI cron prompt length cap;
  defensive parsing.

## Risks & Rollback

- **Risk:** The atomic mutex changes the cycle-skipping semantic
  (now `cycle.skipped` with `concurrent` reason, previously a silent
  no-op). Mitigation: WS handlers and audit consumers are updated in
  the same PR; document the new contract in `docs/SERVICE_CATALOG.md`.
- **Risk:** The bounded trigger pool back-pressures legitimate
  high-throughput scenarios. Mitigation: the cap is configurable per
  deployment; default 5/20 is conservative.
- **Risk:** Truncating the AI cron `description` to 500 characters
  may reject legitimately-complex schedules. Mitigation: most cron
  expressions fit in well under 100 characters; the 500 cap is
  generous. If a real use case emerges, raise it.
- **Rollback:** Each step is a local change. The mutex is a drop-in
  replacement; reverting restores the (broken) `cycleInProgress`
  boolean.

## Out of Scope

- Replacing the Claw runtime with a different agent framework. The
  current design is sound; this plan is correctness, not redesign.
- New trigger types. The existing event and cron triggers are
  sufficient; this plan hardens them.
- The memory subsystem's eventual consistency model. Out of scope
  for runtime reliability.
