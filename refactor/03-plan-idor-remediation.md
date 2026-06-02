# Plan 03 — IDOR Remediation Sweep

**Priority:** P0
**Effort:** XL (3–4 weeks; one PR per route group)
**Risk:** High
**Depends on:** 02 (the `requireOwnership` utility)
**Source reports:** `CODE_REVIEW.md` IDOR-001 through IDOR-020, COST-001

---

## Context

The gateway has 20+ Insecure Direct Object Reference (IDOR) findings. The
pattern is consistent: a route reads a path parameter or body field, looks
up the resource by ID, and returns or mutates it without checking that the
caller owns the resource. The same anti-pattern shows up in agents, souls,
messages, custom-data, conversations, workflows, plans, goals, costs, tools,
audit, file-workspaces, container workspaces, MCP proxies, voice endpoints,
pulse status, and the database export endpoint.

Two additional auth-flavored findings round out this plan:

- The `'default'` userId fallback (`getUserId(c) ?? 'default'`) silently
  returns another user's data on auth misconfiguration (IDOR-006, IDOR-009,
  IDOR-016, COST-001).
- API key auth runs through a session-derived `userId` for workflow
  ownership, allowing an API key bearer to access workflows owned by other
  sessions (IDOR-020).

This plan splits the work into 6 PRs by route group. Each PR is independent
once Plan 02's `requireOwnership` utility lands.

## Scope

The 20 IDOR findings in `CODE_REVIEW.md` and the related `getUserId` fallback
sites:

| ID       | Surface                     | Files                                                                                     |
| -------- | --------------------------- | ----------------------------------------------------------------------------------------- |
| IDOR-001 | Agents CRUD                 | `routes/agents/index.ts:80, 159-308`                                                      |
| IDOR-002 | Souls (15 sub-routes)       | `routes/souls/agent-routes.ts:49-662`                                                     |
| IDOR-003 | Messages + sender spoof     | `routes/agents/messages.ts:21-101`                                                        |
| IDOR-004 | Command-center              | `routes/agents/command-center.ts:437-766`                                                 |
| IDOR-005 | Crews + templates           | `routes/crews.ts:142-145, 683-704`                                                        |
| IDOR-006 | Souls `'/default'` fallback | `routes/souls/index.ts:42-46, 63-67`                                                      |
| IDOR-007 | Custom-data records         | `routes/custom-data.ts:97-362`                                                            |
| IDOR-008 | Chat history logs           | `routes/chat/history.ts:142-151, 859-878`                                                 |
| IDOR-009 | Costs / expensive / export  | `routes/costs.ts:105, 563-659`                                                            |
| IDOR-010 | Tools CRUD                  | `routes/tools.ts:299, 370`                                                                |
| IDOR-011 | Audit correlationId         | `routes/audit.ts:183-203`                                                                 |
| IDOR-012 | Database GETs               | `routes/database/index.ts:25`                                                             |
| IDOR-013 | Bridges                     | `routes/bridges.ts:53, 72-84`                                                             |
| IDOR-014 | File-workspaces             | `routes/file-workspaces.ts:53-68`                                                         |
| IDOR-015 | Container workspaces        | `routes/workspaces/container.ts:230-244`                                                  |
| IDOR-016 | MCP proxy `'default'`       | `routes/mcp.ts:178`                                                                       |
| IDOR-017 | Pulse / voice unauth        | `routes/pulse.ts:17-25, routes/voice.ts:44-86`                                            |
| IDOR-018 | Plans, goals, composio      | `routes/plans.ts:586, 603`; `routes/goals.ts:264-343`; `routes/composio.ts:143, 165, 184` |
| IDOR-019 | Conversations               | `routes/chat/index.ts:943-1018`                                                           |
| IDOR-020 | Workflow API key            | `routes/workflow/index.ts:883-1033`                                                       |
| COST-001 | Costs `'default'`           | `routes/costs.ts:105`                                                                     |

## Goals

1. Every IDOR-flagged route uses `requireOwnership` or its sibling helpers
   before reading or writing the resource.
2. No route returns the literal `'default'` userId's data on auth
   misconfiguration. Auth failures fail closed with 401.
3. API key auth on the workflow routes runs under the API key's identity,
   not the session's.
4. Each route has at least one negative test: a request from user A that
   targets user B's resource returns 403 (or 404, per `requireOwnership`
   semantics).
5. No regression in any existing authenticated flow.

## Implementation Steps

This is a multi-PR plan. Each PR is one route group; sequence them by
traffic sensitivity (high-traffic read paths first so any regression is
caught early).

### PR-A: Souls + Agents (largest blast radius)

- Apply `requireOwnership` to every soul sub-route handler
  (`routes/souls/agent-routes.ts:49-662`).
- Apply `requireOwnership` to agent CRUD in `routes/agents/index.ts:80, 159-308`.
- Add `requesterUserId` enforcement on `POST /api/v1/agents/messages`
  (block body-supplied `from` field; derive from session).
- Add the `userId` filter to command-center mission/execute/batch-update
  (`routes/agents/command-center.ts:437-766`).
- **Files touched:** ~10. **Estimated PR size:** 600–800 lines.

### PR-B: Chat & Conversations

- `routes/chat/index.ts:943-1018` — add ownership check on read/delete
  (IDOR-019).
- `routes/chat/history.ts:142-151, 859-878` — add `userId` filter to
  `listConversations`; cap the per-query limit when `olderThanDays` is
  supplied without a user filter; add ownership on `GET /logs/:id`.
- **Estimated PR size:** 200 lines.

### PR-C: Custom-Data, Tools, Costs, Audit

- `routes/custom-data.ts:97-362` — every record read/write goes through
  `requireOwnership`; the repository gains a `userId` filter on
  `list/search`.
- `routes/tools.ts:299, 370` — add ownership on tool read/execute by name.
- `routes/costs.ts:105, 563-659` — replace `getUserId(c) ?? 'default'`
  with strict auth failure; add `userId` filter on `/expensive`,
  `/export`, `/subscriptions`.
- `routes/audit.ts:183-203` — drop the `correlationId` cross-user lookup;
  the new contract is `actorId === userId` (with admin override). Add a
  separate `requestId` index for ops use, gated by admin key.
- **Estimated PR size:** 500 lines.

### PR-D: Workflows, Plans, Goals, Composio

- `routes/workflow/index.ts:883-1033` (IDOR-020) — derive ownership from
  the API key identity (add `keyId` to the auth context, persist key →
  user mapping at provision time).
- `routes/plans.ts:586, 603` — fetch the plan, verify ownership, then look
  up the step. Return 404 on either miss to avoid leaking step existence.
- `routes/goals.ts:264-343` — same pattern as plans.
- `routes/composio.ts:143, 165, 184` — connection operations gain
  `userId` filter at the repository level.
- **Estimated PR size:** 400 lines.

### PR-E: Workspaces, Bridges, MCP, Pulse, Voice

- `routes/file-workspaces.ts:53-68` — remove the falsy-userId bypass
  (IDOR-014); require explicit ownership or admin.
- `routes/workspaces/container.ts:230-244` — drop the userId array from
  the public response shape (IDOR-015); return only the requester's
  containers.
- `routes/bridges.ts:53, 72-84` — order operations as
  ownership-check-then-mutate; persist `userId` on create.
- `routes/mcp.ts:178` — replace `userId: 'default'` with the session's
  userId; reject the call if absent.
- `routes/pulse.ts:17-25` and `routes/voice.ts:44-86` — wrap in
  `defaultDeny` allowlist or move behind auth.
- **Estimated PR size:** 350 lines.

### PR-F: Crews, Database

- `routes/crews.ts:142-145, 683-704` — add `getUserId()` to `/templates`;
  verify `memoryId` belongs to the requested `crewId` on delete.
- `routes/database/index.ts:25` — drop the GET-bypass; require admin key
  for every `/database/*` endpoint, or split into public health-check
  routes and admin-only data routes.
- **Estimated PR size:** 200 lines.

### Cross-cutting changes (apply in PR-A, ship in all subsequent PRs)

- New repository method signature: `findByIdForUser(id, userId, opts)`
  that returns null if either the row does not exist **or** `userId` does
  not match. Replaces the `getById` + `ownershipCheck` pattern in every
  repository.
- Migration to add `user_id` columns where missing. Per the existing
  `001_initial_schema.sql` audit, only `bridges` and a few audit log
  tables are missing `user_id` — most already have it.

## Acceptance Criteria

1. A request from session A to `GET /api/v1/agents/:id` where `:id` belongs
   to session B returns 404 (not 403, per the existence-leakage policy in
   Plan 02).
2. A request from session A to `POST /api/v1/agents/messages` with a body
   `from: 'B'` stores the message as `from: A`.
3. A request from session A to `GET /api/v1/costs/expensive` returns only
   A's cost rows.
4. A request to `/api/v1/database/stats` without an admin key returns 401.
5. A request to `GET /api/v1/file-workspaces/:id` where the workspace's
   `userId` is `null` returns 404 (not the workspace).
6. Every IDOR-flagged route in the source report has at least one new
   negative test in its corresponding `.test.ts`.

## Test Plan

- `tests/security/idor-matrix.test.ts` (new) — a table-driven test that
  exercises every IDOR-flagged route from both a "user A" and a "user B"
  session. A passing run shows zero IDOR findings.
- Per-route negative tests inside each existing `*.test.ts`.
- The migration test in `tests/migrations/` confirms new `user_id` columns
  exist and are indexed.

## Risks & Rollback

- **Risk:** A missing `userId` filter on a previously-unscoped query
  surfaces rows that were silently shared. The application should treat
  this as a feature, not a bug, but downstream consumers (e.g., a UI
  dashboard showing "all tasks across users") may break. Mitigation: ship
  the changes behind a `OWNPILOT_STRICT_OWNERSHIP` flag (default-off for
  one release), flip to default-on after telemetry confirms no legit break.
- **Risk:** Adding `user_id` columns requires a data backfill. The
  existing single-tenant model assumes a single user, so backfill is
  straightforward (set all existing rows to `'default'`), but a future
  multi-tenant migration will need to revisit. Document the assumption in
  the migration comment.
- **Rollback:** The flag-based rollout is reversible in one config change.
  Per-route, the diff is additive (`requireOwnership` is a wrapper); revert
  one route per commit if necessary.

## Out of Scope

- Multi-tenant user model. The shared-password model remains; the `'default'`
  user is now an explicit, indexed, intentional identity rather than a
  silent fallback.
- Per-user rate limiting and quota tracking. Belongs to Plan 16.
- Audit log improvements (Plan 14 makes the audit log queryable; IDOR-011
  is fixed in PR-C of this plan).
