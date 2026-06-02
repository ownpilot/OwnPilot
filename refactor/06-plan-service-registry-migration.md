# Plan 06 — Service Registry Migration & Singleton Cleanup

**Priority:** P0 (foundational; multiple other plans depend on it)
**Effort:** XL (2–3 weeks; 4–5 services per PR)
**Risk:** Medium
**Depends on:** 04 (the extension sandbox and other services are migrated
in the same wave)
**Source reports:** `refactor.md` §3.2 (revised), `CODE_REVIEW.md` IDEMP-001, MEM-002

---

## Context

The OwnPilot core exposes a typed `ServiceToken`-based dependency
injection container in `packages/core/src/services/registry.ts`, with a
`getServiceRegistry()` accessor and a `register()` method. The gateway
already uses it for ~14 services registered in `server.ts`. However, **20+
services in `packages/gateway/src/services/` still use the legacy
`let instance: X | null` singleton pattern**, and **zero of those legacy
services are registered through the registry**.

The mixed pattern causes three observable problems:

1. **Tests cannot reliably reset state.** Without `registry.reset()` or
   a per-test reset helper, module-singleton state leaks between tests.
   This is the root cause of the 3–4 known-flaky tests that pass in
   isolation and fail under full-suite concurrency.
2. **Boot ordering is opaque.** `server.ts` is now ~1 194 LoC and contains
   69 initialize/import lines that must execute in a specific order.
   Each singleton's lifecycle is implicit.
3. **`await import()` workarounds proliferate.** When singletons live at
   module scope, order matters and `await import()` is the typical escape
   hatch. 344 such calls exist in the codebase; the dynamic import of a
   module's own relative path is a strong circular-dependency smell.

This plan migrates every legacy singleton to the registry in coordinated
groups, with a single boot orchestrator that documents the dependency
order, and a per-test reset helper.

## Scope

20+ legacy singletons identified in `refactor.md` §3.2:

```
packages/gateway/src/services/artifact-service.ts
packages/gateway/src/services/browser-service.ts
packages/gateway/src/services/claw-manager.ts
packages/gateway/src/services/claw-service.ts
packages/gateway/src/services/cli-tool-service.ts
packages/gateway/src/services/coding-agent-service.ts
packages/gateway/src/services/coding-agent-sessions.ts
packages/gateway/src/services/custom-data-service.ts
packages/gateway/src/services/edge-mqtt-client.ts
packages/gateway/src/services/edge-service.ts
packages/gateway/src/services/embedding-queue.ts
packages/gateway/src/services/embedding-service.ts
packages/gateway/src/services/extension-sandbox.ts
packages/gateway/src/services/agent-registry.ts
packages/gateway/src/services/custom-tool-registry.ts
... (and others; verify by grep)
```

Files outside `services/`:

- `packages/gateway/src/server.ts` (1 194 LoC) — boot orchestration
- `packages/gateway/src/test-helpers.ts` — needs `resetAllServices()`
- `packages/core/src/services/registry.ts` — gains new tokens
- `packages/gateway/src/utils/registry-tokens.ts` (new) — gateway-specific
  tokens, mirrored from `core`

## Goals

1. Every `let instance: X | null = null` plus the corresponding
   `export function getX()` / `setX()` pair is replaced by a registry
   registration and a `getServiceRegistry().get(Token.X)` accessor.
2. `server.ts` declares a single boot pipeline in dependency order
   (topological sort by `Services.X.dependsOn`), reducing it to <400
   LoC.
3. `registry.reset()` is available and used in `test-helpers.ts` so
   every test starts from a clean state.
4. The flaky tests listed in `CODE_REVIEW.md` and `refactor.md` pass
   under full-suite concurrency.
5. The number of `await import(./relative-path)` calls in production
   code drops by at least 80%.

## Implementation Steps

The migration is structured as a sequence of focused PRs, grouped by
service type to keep each PR small and reviewable.

### PR-1 — Registry infrastructure

- Add a `reset()` method to `core/src/services/registry.ts` that
  clears the instance map (test-only; gated by a
  `process.env.NODE_ENV !== 'production'` check).
- Add a `dispose()` lifecycle hook to `ServiceToken` that services can
  implement for graceful shutdown (close DB connections, flush buffers,
  stop intervals).
- Add the gateway-specific tokens in a new
  `packages/gateway/src/utils/registry-tokens.ts` file.
- Document the registry contract in `docs/SERVICE_CATALOG.md`.

### PR-2 — Tool/extension registry (smallest blast radius)

- Migrate `custom-tool-registry.ts`, `agent-registry.ts`, and
  `extension-sandbox.ts` to the registry.
- Verify all call sites work; no public API change (the `getX()` function
  is preserved as a thin wrapper around the registry call).

### PR-3 — Coding agents

- Migrate `coding-agent-service.ts`, `coding-agent-sessions.ts`, and
  `cli-tool-service.ts`.
- These touch the session manager — verify session persistence and
  recovery flows still work.

### PR-4 — Edge / embedding

- Migrate `edge-service.ts`, `edge-mqtt-client.ts`, `embedding-service.ts`,
  and `embedding-queue.ts`.
- The MQTT client and embedding queue have background subscriptions
  that need explicit `start()` and `stop()` lifecycle hooks.

### PR-5 — Data services

- Migrate `custom-data-service.ts`, `artifact-service.ts`,
  `browser-service.ts`.
- These are leaf services; the migration is mechanical.

### PR-6 — Claw / fleet

- Migrate `claw-service.ts`, `claw-manager.ts`. (Note: `claw-manager.ts`
  is also a god file — see Plan 07 — but the registry migration is
  independent and should land first.)
- Verify claw lifecycle (start, pause, stop) still works; this is
  critical-path for autonomous agents.

### PR-7 — Boot orchestrator rewrite

- Replace the 1 194-line `server.ts` with a declarative boot file that
  reads the service dependency graph from the registry and produces
  a topological boot order.
- Each service's `init` is invoked in order; failures abort boot with a
  clear error and the partial boot is unwound.
- Target: `server.ts` < 400 LoC, with the bulk of the file being
  dependency declarations and the boot pipeline itself.

### PR-8 — Test helper integration

- Add `resetAllServices()` to `test-helpers.ts` that calls
  `registry.reset()` and re-initializes the test database.
- Update all test setup files (`test-setup.ts`) to call
  `resetAllServices()` in `beforeEach`.
- The known-flaky tests in `agent-runner-utils.test.ts`,
  `cli-chat-provider.test.ts`, `subagent-runner.test.ts` should now
  pass under full-suite concurrency.

### PR-9 — Dynamic import cleanup

- After the registry is in place, identify the remaining
  `await import(./relative-path)` calls. Each one is a candidate for
  removal — the registered service can be looked up synchronously.
- For optional native packages (e.g., `discord.js`, `slack-web-api`),
  keep the dynamic import but move it into a single
  `lazy-deps.ts` barrel with a typed accessor.

## Acceptance Criteria

1. `grep -r "let instance:" packages/gateway/src/services/` returns zero
   matches in production code (test fixtures may keep it for
   convenience).
2. `server.ts` is < 400 LoC.
3. The 3 known-flaky tests pass under `pnpm test -- --pool=threads
--poolOptions.threads.maxThreads=8` (or the equivalent).
4. `await import(./` returns < 70 calls in production code (down from
   344).
5. `registry.reset()` works without leaking listeners; verified by
   `process._getActiveHandles().length === 0` after a test runs.
6. All existing functionality (claw cycles, agent sessions, edge MQTT,
   embedding queue) continues to work.

## Test Plan

- `tests/services/registry.test.ts` — `register`, `get`, `reset`,
  `dispose`, dependency cycle detection.
- `tests/server-boot.test.ts` — boot completes in dependency order;
  failure of a single service unwinds the partial state.
- The full test suite, run with `--reporter=verbose` to surface the
  previously-flaky tests. All 26 500+ tests pass.
- A smoke test that boots the gateway, lists every registered service,
  and verifies the boot order matches the declared dependency graph.

## Risks & Rollback

- **Risk:** Boot order changes break an existing implicit dependency.
  Mitigation: the dependency graph is _derived_ from the registered
  `dependsOn` declarations; an inconsistency is caught at boot, not at
  runtime. The existing 69-line boot sequence in `server.ts` is the
  ground truth — the new orchestrator must produce the same order.
- **Risk:** The `dispose()` lifecycle hook is invoked on shutdown, but
  some services do not currently support graceful shutdown. Mitigation:
  `dispose` is best-effort; failures are logged but do not block
  process exit. A follow-up audit identifies services that need real
  shutdown handling.
- **Risk:** `registry.reset()` in tests accidentally resets a service
  that another test depends on. Mitigation: tests should request
  services via `getServiceRegistry().get()` per test, not capture
  references in module scope.
- **Rollback:** Each PR is independently revertible. If a service's
  registry migration breaks behavior, the previous `let instance`
  pattern can be restored in one file while the other migrations ship.

## Out of Scope

- Replacing the registry with a third-party DI library (e.g., `tsyringe`,
  `inversify`). The current registry is small, typed, and well-suited;
  a replacement is a much larger change.
- Service-level health checks and metrics. Belongs to Plan 14
  (OpenTelemetry migration).
- Multi-tenant scoping of services. The registry currently has one
  global scope; per-user scoping is a future feature.
