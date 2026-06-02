# Plan 11 — Data Layer & Repository Hardening

**Priority:** P1
**Effort:** L (1 week)
**Risk:** Medium
**Depends on:** 03 (the user_id columns from IDOR remediation are
reused here)
**Source reports:** `CODE_REVIEW.md` SQL-001, CSV-001, CSV-002, IDEMP-001,
`refactor.md` §6 (Repository consolidation, Index review, Migrations
in CI)

---

## Context

The data layer is well-structured: `BaseRepository` provides
`query/queryOne/execute/exec/transaction/now/boolean`, the 84
repositories are CRUD-only, and 34+ idempotent migrations exist. The
remaining concerns are:

- **SQL-001:** `routes/custom-data.ts:376-381` builds a JSONB filter
  by interpolating the user-controlled key directly into the SQL
  expression (`data->>$${paramIndex++} = $${paramIndex++}`). The
  parameter value is sanitized, but the _key_ is not. A crafted
  payload with `key: 'a; DROP TABLE…'` could escape the parameter
  context if Postgres ever shifts the paramIndex math.
- **CSV-001:** `routes/database/csv-export.ts:406-416` accepts raw CSV
  headers and uses them directly in the `INSERT` column list. The
  `validateColumnName` helper exists but is not called.
- **CSV-002:** The export endpoint at `routes/database/transfer.ts:77`
  exports the entire `settings`, `agents`, `system_settings`,
  `user_workspaces` tables without a `user_id` filter — all system
  data is exposed.
- **IDEMP-001:** `services/tool/executor.ts:592` uses `JSON.stringify(args)`
  to build a cache key for tool execution. `{a:1,b:2}` and
  `{b:2,a:1}` produce different keys, so equivalent invocations miss
  the cache.
- **84 repositories is a lot** — several can be merged
  (`pomodoro` + `habits` + `goals` form one "productivity" repo;
  `model-configs` + `local-providers` overlap). This is _not_ a P0 —
  the code works — but the codebase would be easier to navigate with
  fewer, larger repositories.
- **Partial indexes are fragile** — `workflow_executions WHERE status
IN ('running', 'paused')` may degrade across Postgres major
  upgrades. `EXPLAIN ANALYZE` should be run on realistic data.

This plan hardens the data layer, consolidates the obvious overlapping
repos, and runs a query-plan audit.

## Scope

- `packages/gateway/src/routes/custom-data.ts:376-381` (SQL-001)
- `packages/gateway/src/routes/database/csv-export.ts:406-416` (CSV-001)
- `packages/gateway/src/routes/database/transfer.ts:77` (CSV-002)
- `packages/gateway/src/services/tool/executor.ts:592` (IDEMP-001)
- `packages/gateway/src/db/repositories/{pomodoro,habits,goals}.ts` (merge)
- `packages/gateway/src/db/repositories/{model-configs,local-providers}.ts` (merge)
- `packages/gateway/src/db/repositories/index.ts` (re-exports)

## Goals

1. The custom-data JSONB filter validates keys against an allowlist of
   column names defined on the table at creation time.
2. CSV import uses `validateColumnName` on every header before
   constructing the `INSERT`.
3. The database export endpoint adds a `userId` filter to every
   per-user table; system tables are gated behind an admin key.
4. The tool executor uses a stable, sorted JSON serialization for the
   cache key.
5. Three repo merges ship (`productivity`, `model-configs+local-providers`,
   and one more identified during the audit).
6. `EXPLAIN ANALYZE` is run against a 1 M-row dataset for the top 10
   slow queries, and any that show seq scan or bitmap OR are addressed
   with index additions.

## Implementation Steps

### Step 1 — Custom-data key allowlist

In `packages/gateway/src/db/repositories/custom-data.ts`:

- Add a `validateColumnName(name: string): boolean` helper that
  accepts only `[a-z_][a-z0-9_]{0,63}` and rejects reserved names
  (`user_id`, `id`, `created_at`, `updated_at`).
- The `search` and `filter` methods require the caller to pass the
  table's column allowlist (retrieved from the table metadata row,
  populated at table creation).
- Reject any filter key not in the allowlist with a 400.
- The route in `custom-data.ts:376-381` calls the validated variant.

### Step 2 — CSV import hardening

In `packages/gateway/src/routes/database/csv-export.ts:406-416`:

- For each header in the CSV, call `validateColumnName`. Reject the
  import with a 400 listing the invalid columns.
- Confirm the columns exist on the target table (via `information_schema`)
  before constructing the `INSERT`.
- Add a `maxColumns: 50` limit per import.

### Step 3 — Export user filtering

In `packages/gateway/src/routes/database/transfer.ts:77`:

- For each per-user table (`agents`, `custom_data`, `chat_history`,
  `souls`, `memories`, `goals`, `plans`, `workflows`), add a
  `WHERE user_id = $1` filter using the requesting session's
  `userId`.
- For system tables (`settings`, `system_settings`, `user_workspaces`),
  require the admin key; non-admin requests get 403.
- The export shape changes: per-user data is user-scoped, system data
  is admin-only. Document the new contract.

### Step 4 — Stable tool cache key

In `packages/gateway/src/services/tool/executor.ts:592`:

- Replace `JSON.stringify(args)` with a stable serializer:
  ```ts
  function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return (
      '{' +
      keys
        .map(
          (k) => JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k])
        )
        .join(',') +
      '}'
    );
  }
  ```
- Existing cache entries remain valid (the key shape is the same; only
  the serialization is canonical).
- A small unit test covers `{a:1,b:2}` ≡ `{b:2,a:1}` and nested cases.

### Step 5 — Repository consolidation

Three merges:

- **Productivity:** `pomodoro.ts` + `habits.ts` + `goals.ts` →
  `productivity.ts`. The class methods become `pomodoros`, `habits`,
  `goals` (sub-namespaces on the same repo). Total LoC drops ~30%.
- **Model configs:** `model-configs.ts` + `local-providers.ts` →
  `models.ts`. The two are tightly coupled; the merge makes the
  coupling explicit.
- One more merge identified during the audit (e.g., a pair of repos
  with overlapping query patterns).

For each merge:

- The new repo is in `db/repositories/<name>.ts`.
- The old files re-export from the new one for one release.
- All call sites are updated; CI grep confirms no stale imports after
  one release.

### Step 6 — Index audit

- Stand up a Postgres 16 container with 1 M rows seeded.
- Run `EXPLAIN ANALYZE` on the top 10 slow queries from the production
  log (gathered via the OpenTelemetry migration, Plan 14).
- For any query that shows `Seq Scan` or `Bitmap Heap Scan` on a table
  > 100 K rows, add an index in a new migration.
- Specifically verify the `agent_messages.findConversation` query
  (Plan 11 inherits this from `refactor_plan.md` M5 — apply the
  `idx_agent_messages_pair` migration if not already present).

## Acceptance Criteria

1. A request to `POST /api/v1/custom-data/tables/:table/filter` with
   a key matching `[a-z_]+; DROP TABLE x; --` returns 400.
2. A CSV import with a header `; DROP TABLE users; --` returns 400 with
   the invalid column name in the error.
3. A request to `GET /api/v1/database/export` from a non-admin session
   returns only the requesting user's data and 403s on system tables.
4. The tool executor's cache hit rate, measured in the integration
   test, increases by at least 10% for the canonical test case.
5. `db/repositories/{pomodoro,habits,goals}.ts` no longer exist; their
   functionality is in `productivity.ts` with no behavior change.
6. The `EXPLAIN ANALYZE` report for the top 10 slow queries shows
   `Index Scan` or `Index Only Scan` for every query after the new
   migrations are applied.

## Test Plan

- `tests/db/custom-data.test.ts` — key-allowlist cases; SQL injection
  attempts.
- `tests/database/csv-export.test.ts` — invalid column name
  rejection; column-existence check.
- `tests/database/transfer.test.ts` — user filtering; system-table
  admin gate.
- `tests/services/tool-cache.test.ts` — canonical key serialization;
  hit-rate measurement.
- `tests/db/repository-merges.test.ts` — every method on the old repo
  has an equivalent method on the new repo with the same behavior.
- `tests/db/query-plans.test.ts` — runs `EXPLAIN` against a seeded DB
  and asserts the expected plan type (e.g., `Index Scan`).

## Risks & Rollback

- **Risk:** The custom-data key allowlist breaks existing filters
  that use unvalidated keys. Mitigation: log a `warn` on first
  rejection, monitor for one release, then enforce.
- **Risk:** The CSV import column-existence check is slow (it
  queries `information_schema` for every import). Mitigation: cache
  the column list per table for the duration of the import.
- **Risk:** The repository merges break an internal call site that
  was relying on the old file's exact shape. Mitigation: re-exports
  for one release; CI grep ensures no stale imports.
- **Rollback:** Each step is independently revertible. The merges
  preserve the old file as a re-export barrel for one release.

## Out of Scope

- Replacing the `pg` driver with a query builder (e.g., Knex, Drizzle).
  The repository pattern + raw SQL is fast, explicit, and owned by the
  team. Per `refactor.md` §11, this is explicitly _not_ recommended.
- Multi-tenant scoping of the database. The `user_id` filter added in
  Plan 03 is the foundation; full multi-tenant isolation is a future
  feature.
- ORM adoption. Same as above.
