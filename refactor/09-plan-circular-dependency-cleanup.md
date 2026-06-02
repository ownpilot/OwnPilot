# Plan 09 — Circular Dependency Elimination

**Priority:** P1
**Effort:** L (1 week + ongoing)
**Risk:** Medium
**Depends on:** 06, 07
**Source reports:** `refactor.md` §3.4, `refactor.md` §11 ("Don't merge core
and gateway"), `CODE_REVIEW.md` CORS-001

---

## Context

The codebase has **30+ files with explicit "circular dependency
workaround" comments** and **344 `await import()` calls** in production
code. The pattern is consistent:

- `routes/agents.ts` and `ws/server.ts` have a cycle. The WS server
  lazy-imports the routes module to break it.
- `routes/custom-tools.ts` and `services/custom-tool-registry.ts` form a
  cycle. The route module lazy-imports the registry.
- `services/conversation-service.ts` and `assistant/chat-post-processor.ts`
  form a cycle.
- `routes/chat.ts` and `routes/chat-state.ts` form a cycle.
- `plans/executor.ts`, `routes/webhooks.ts`, `routes/mcp.ts`,
  `services/cli-chat-provider.ts`, `services/mcp-server-service.ts` all
  have documented circular workarounds.

The root cause is the lack of a strict layering rule. Once `routes/ →
services/ → db/repositories/ → core/` becomes a hard rule (with no upward
imports), the cycles become structurally impossible.

This plan introduces the layering rule, enforces it with
`dependency-cruiser` in CI, and converts the remaining `await import(./)`
calls into direct imports or registered service lookups.

## Scope

- `packages/gateway/src/` — every directory, especially the 30+ files
  flagged with circular workaround comments
- `packages/gateway/eslint-rules/strict-layering.js` (new)
- `packages/gateway/.dependency-cruiser.cjs` (new)
- `.github/workflows/ci.yml` — adds the dependency-cruiser step
- `docs/ARCHITECTURE.md` — documents the layering rule

## Goals

1. A strict layering rule is documented and enforced:
   `routes/` → `services/` → `db/repositories/` → `core/`.
   No upward imports. Cross-layer imports go through a barrel.
2. The `await import(./relative-path)` count in production code drops
   to zero (or to < 5, for the rare `node:vm` style escape hatches).
3. The dependency-cruiser CI gate fails the build on any layering
   violation.
4. The 30+ files with circular workaround comments have those comments
   removed because the workarounds are no longer needed.
5. CORS / config drift between `app.ts` and `ui-session.ts`
   (CODE_REVIEW CORS-001) is fixed as part of the layering work.

## Implementation Steps

### Step 1 — Define the layering rule

Document in `docs/ARCHITECTURE.md`:

```
Layer 4 (UI / routes)        packages/gateway/src/routes/**
Layer 3 (services)           packages/gateway/src/services/**
Layer 2 (data access)        packages/gateway/src/db/repositories/**
Layer 1 (core)               packages/core/src/**
Layer 0 (vendor)             node_modules
```

**Rules:**

- An import may only flow downward by one or more layers.
- Cross-layer communication uses the registry (Plan 06) — services
  expose methods; routes call them.
- Within a layer, imports are allowed freely; cycles within a layer
  are flagged but not blocking (they're harder to break and rarely
  harmful).
- `core/` must not import from `gateway/`. The `core/` package is the
  zero-dependency public surface for plugin authors.

### Step 2 — `dependency-cruiser` configuration

Create `packages/gateway/.dependency-cruiser.cjs`:

```js
module.exports = {
  forbidden: [
    {
      name: 'no-upward-imports',
      severity: 'error',
      from: { path: '^src/routes/' },
      to: { path: '^src/(?!routes/)', dependencyTypes: ['esm', 'cjs', 'tsd'] },
    },
    {
      name: 'no-routes-from-services',
      severity: 'error',
      from: { path: '^src/services/' },
      to: { path: '^src/routes/' },
    },
    {
      name: 'no-repos-from-routes-or-services',
      severity: 'error',
      from: { path: '^src/(routes|services)/' },
      to: { path: '^src/db/repositories/[^/]+\\.ts$' }, // only direct repository imports
    },
    {
      name: 'no-relative-dynamic-import',
      severity: 'warn',
      from: { path: '.+\\.ts$' },
      to: { path: '\\./' },
      // matches `await import('./...')`
    },
  ],
};
```

Add the gate to `.github/workflows/ci.yml`:

```yaml
- name: Dependency cruiser
  run: pnpm exec depcruise packages/gateway --config packages/gateway/.dependency-cruiser.cjs
```

### Step 3 — Fix the cycles file by file

The 30+ cycles are fixed one PR per logical group:

- **PR-A: Routes ↔ WS server.** Extract a `ws/event-bridge.ts` module
  that depends only on the registry; both `routes/agents.ts` and
  `ws/server.ts` import from it. The cycle dissolves.
- **PR-B: Routes ↔ Custom-tool registry.** Move the cross-cutting
  concern into `services/custom-tool-registry/index.ts` (already
  registry-aware post-Plan 06). Routes call
  `getServiceRegistry().get(Services.CustomToolRegistry)`.
- **PR-C: Services ↔ Post-processor.** The `chat-post-processor` is
  invoked synchronously by the conversation service; pass the
  post-processor function as a constructor argument or via the
  registry. No cycle.
- **PR-D: Routes/chat.ts ↔ Routes/chat-state.ts.** Move the shared
  state into a `services/chat-state.ts` module; both routes import
  from it.
- **PR-E: plans/executor.ts** — extract the circular bits into
  `services/plans/` sub-modules.
- **PR-F: routes/webhooks.ts, routes/mcp.ts, services/cli-chat-provider.ts,
  services/mcp-server-service.ts** — same treatment.

Each PR is small and reviewable. Run `pnpm exec depcruise` to verify
the cycle is gone before merging.

### Step 4 — Convert `await import(./relative)` to direct imports

After the layering rule lands, the `await import(./relative-path)` calls
are no longer needed for cycle-breaking. For each:

- If the import is a same-layer module: convert to a direct top-level
  `import` statement.
- If the import is a lower-layer module: convert to a direct import.
- If the import is an _optional_ native package (`discord.js`, `slack`,
  `telegram`, etc.): keep as dynamic import in `lazy-deps.ts`.

### Step 5 — Fix the CORS drift (CODE_REVIEW CORS-001)

The `app.ts` and `ui-session.ts` independently configure CORS, and the
two configurations drift. Unify:

- Move the CORS origin list computation into
  `utils/cors-origins.ts`. The function takes the env and the request
  and returns the allowed origin.
- Both `app.ts` (for the CORS middleware) and `ui-session.ts` (for
  `isTrustedBrowserOrigin`) call the same function.
- The unit test ensures the two never drift.

## Acceptance Criteria

1. `pnpm exec depcruise packages/gateway` returns zero errors and zero
   warnings.
2. `grep -rn 'await import(' packages/gateway/src/ | grep -v 'node:' |
grep -v 'discord\|slack\|telegram\|whatsapp\|signal'` returns zero
   matches in production code (test fixtures may keep dynamic imports).
3. No file in the gateway has a comment matching `/circular (dep|import)/i`.
4. `app.ts` and `ui-session.ts` produce identical CORS origin lists for
   every test case.
5. The CI gate fails the build on any new layering violation.

## Test Plan

- `tests/utils/cors-origins.test.ts` — table-driven: same inputs →
  same outputs from both call sites.
- `dependency-cruiser` golden run: a known violation is added to a test
  branch, the gate fails, the test confirms the gate's behavior.
- Boot smoke test: the gateway starts in < 5 seconds (dynamic imports
  are slow; the conversion to static imports should make this faster).

## Risks & Rollback

- **Risk:** Converting `await import(./relative)` to direct imports
  changes the load order. If a module had side effects that the
  previous async order was relying on, behavior may shift. Mitigation:
  run the full test suite after each conversion; if a test fails, the
  conversion is the cause (verify by reverting).
- **Risk:** The dependency-cruiser rule is overly strict and blocks
  legitimate patterns (e.g., a `services/` file that needs to import
  from another `services/` file via a type-only import). Mitigation:
  the rule distinguishes `import type` from `import`; type-only
  imports across layers are allowed.
- **Rollback:** Each PR is independently revertible. The CI gate can
  be downgraded to `warn` if it blocks too much; individual
  violations are easy to fix once flagged.

## Out of Scope

- A general dependency graph audit of `core/`. The `core/` package is
  already small and layered correctly.
- A circular dependency detector for runtime cycles (the existing
  `loadtest` and `node:trace_events` can be used, but a static
  analyzer is enough).
- Replacing dynamic imports for legitimate reasons (e.g., lazy-loading
  to reduce startup time). The pattern is preserved; the `await
import(./relative)` anti-pattern is what this plan removes.
