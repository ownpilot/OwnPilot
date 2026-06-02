# Plan 02 — Authentication & Authorization Hardening

**Priority:** P0
**Effort:** L (1–2 weeks)
**Risk:** Medium
**Depends on:** none
**Source reports:** `CODE_REVIEW.md` AUTH-001/002/003/004/005/006, SET-001, SET-002

---

## Context

The gateway has systemic auth gaps that affect every authenticated endpoint
in the system:

- Debug endpoints are open unless `NODE_ENV === 'production'` exactly. In bare
  Node deployments `NODE_ENV` is commonly unset, exposing log inspection,
  error detail, circuit breaker state, and sandbox traces to anonymous
  callers.
- `/api/v1/provider-auth` is mounted via `app.route()` at its own prefix,
  bypassing the auth middleware entirely. All OAuth device-code endpoints
  (start, poll, signout, providers, full CRUD on config) are unauthenticated.
- `/api/v1/execution-permissions/approvals/:id/resolve` accepts an
  `approvalId` with no ownership check — anyone who guesses an ID can
  approve or reject an arbitrary pending execution.
- API key management (`/api/v1/settings` provider keys) is unauthenticated
  for any request, including writes to `process.env`.
- Sandbox settings (`/api/v1/settings` sandbox base path) accept arbitrary
  user-controlled `basePath` without traversal validation.
- Login brute-force is unbounded (already addressed in `refactor_plan.md`
  C2, marked done — verify before re-implementing).
- JWT secret minimum is 32 chars (HS256 best practice is 64).

This plan introduces a single layered auth model: a default-deny middleware
that runs on **every** route, with explicit opt-outs for genuinely public
endpoints, plus token entropy and ownership-check utilities reused across
the codebase.

## Scope

- `packages/gateway/src/app.ts` (route registration, default-deny middleware)
- `packages/gateway/src/middleware/auth.ts` (JWT secret min length, entropy)
- `packages/gateway/src/middleware/default-deny.ts` (new)
- `packages/gateway/src/routes/debug.ts` (lines 13–41)
- `packages/gateway/src/routes/register/platform.ts` (line 38)
- `packages/gateway/src/routes/execution-permissions.ts` (lines 83–101)
- `packages/gateway/src/routes/settings.ts` (lines 163–185, 268–361)
- `packages/gateway/src/routes/ui-auth.ts` (lines 220–253)
- `packages/gateway/src/utils/ownership.ts` (new — shared ownership check)

## Goals

1. Every HTTP route in the gateway passes through an auth check by default.
   Public endpoints (health, OAuth start) must be explicitly allowlisted.
2. The `/api/v1/provider-auth` route group runs behind the same auth
   middleware as every other API route, except the two genuinely public
   endpoints: `POST /oauth/device/start` and `POST /oauth/device/poll`.
3. The approval resolution endpoint requires the requester to be the
   approval's `requesterUserId` or a designated approver.
4. API key and sandbox path changes require an authenticated session, and
   sandbox `basePath` is validated against a path-traversal sequence list.
5. `BOOTSTRAP_TOKEN` and JWT secret both require minimum 64 characters
   **and** an entropy check (e.g., 50+ unique chars across the string).
6. A shared `requireOwnership(repo, id, userId, action)` utility lives in
   `utils/ownership.ts` and is used by every IDOR-vulnerable route (this
   plan delivers the utility; Plan 03 is the per-route application).

## Implementation Steps

### Step 1 — Default-deny middleware

Create `packages/gateway/src/middleware/default-deny.ts`:

```ts
import type { MiddlewareHandler } from 'hono';
import { createAuthMiddleware } from './auth.js';

const PUBLIC_PATHS = new Set([
  '/health',
  '/api/v1/oauth/device/start',
  '/api/v1/oauth/device/poll',
  '/api/v1/auth/login',
]);

export const defaultDeny: MiddlewareHandler = async (c, next) => {
  if (PUBLIC_PATHS.has(c.req.path)) return next();
  return createAuthMiddleware()(c, next);
};
```

Register `defaultDeny` in `app.ts` _before_ any other middleware that might
short-circuit (e.g., CORS). The auth middleware must reject when
`c.get('userId')` is unset.

### Step 2 — Debug routes require admin key

In `packages/gateway/src/routes/debug.ts`:

- Replace the `if (process.env.NODE_ENV === 'production')` branch with
  `if (c.get('isAdmin') === true)`.
- The admin flag is set by `createAuthMiddleware` when the request presents
  the `X-Admin-Key` header matching the configured admin key (using
  `safeKeyCompare`).
- Document the env-var contract: in non-production, set `OWNPILOT_ADMIN_KEY`
  to enable the same admin path locally.

### Step 3 — Authenticate `/api/v1/provider-auth`

In `packages/gateway/src/routes/register/platform.ts`:

- Remove the standalone `app.route('/api/v1/provider-auth', providerAuthRoutes)`.
- Move `providerAuthRoutes` under the main `/api/v1` mount with the standard
  auth middleware.
- Explicitly mark `/oauth/device/start` and `/oauth/device/poll` as
  `public: true` in the route definition (consumed by `defaultDeny`).

### Step 4 — Approval ownership check

In `packages/gateway/src/routes/execution-permissions.ts`:

- Add an ownership check at the top of the resolve handler:
  ```ts
  const approval = await approvalRepo.getById(approvalId);
  if (!approval) return c.json(apiError('not_found'), 404);
  if (approval.requesterUserId !== userId && !approval.approverUserIds.includes(userId)) {
    return c.json(apiError('forbidden'), 403);
  }
  ```
- Add `requesterUserId` and `approverUserIds: string[]` to the approval row
  via a new migration `NNN_approvals_ownership.sql`.

### Step 5 — Require auth on `/api/v1/settings` writes

In `packages/gateway/src/routes/settings.ts`:

- Wrap the provider-key write handler (lines 163–185) in a `getUserId(c)`
  check; reject 401 if absent.
- Wrap the sandbox settings handler (lines 268–361) in the same check; also
  validate `basePath` against `validateSafePath()` (new util — rejects `..`,
  absolute paths outside the configured workspace root, null bytes, and
  Windows reserved names).

### Step 6 — Token & secret entropy

In `packages/gateway/src/middleware/auth.ts` and
`packages/gateway/src/routes/ui-auth.ts`:

- Raise the JWT secret minimum to 64 characters.
- Raise the `BOOTSTRAP_TOKEN` minimum to 64 characters.
- Add a `entropyBits(s: string): number` helper that estimates Shannon
  entropy and require `>= 256` bits (i.e., 32 random bytes hex-encoded).
- Surface clear errors at boot if the secret is missing or weak, and refuse
  to start in production with a weak secret.

### Step 7 — Shared `requireOwnership` utility

Create `packages/gateway/src/utils/ownership.ts`:

```ts
export interface OwnershipContext {
  userId: string | undefined;
  isAdmin: boolean;
}

export async function requireOwnership<T extends { userId?: string | null }>(
  repo: { getById(id: string): Promise<T | null> },
  id: string,
  ctx: OwnershipContext,
  resourceLabel: string
): Promise<T> {
  /* throws ApiError 404/403 */
}
```

The utility:

- Returns 404 if the resource does not exist (never leak existence).
- Returns 403 if the resource exists but `userId` does not match and the
  caller is not an admin.
- Logs the access denial at `warn` with the resource label for audit.

The utility is purely additive; Plan 03 applies it route by route.

## Acceptance Criteria

1. A request to `GET /api/v1/debug/logs` without an admin key returns 401 in
   any `NODE_ENV`, including unset.
2. A request to `POST /api/v1/provider-auth/oauth/device/start` succeeds
   without auth; a request to `GET /api/v1/provider-auth/config/openai`
   without auth returns 401.
3. A request to `POST /api/v1/execution-permissions/approvals/:id/resolve`
   by a user who is not the requester or an approver returns 403.
4. A request to `PUT /api/v1/settings/providers` without a session returns
   401; a request with `basePath: '../../etc'` returns 400.
5. The gateway refuses to start if `JWT_SECRET` is unset or shorter than 64
   chars in production (`NODE_ENV=production`).
6. `requireOwnership` correctly returns 404 (not 403) when the resource
   does not exist.
7. Existing authenticated endpoints (e.g., `/api/v1/agents`) continue to
   work unchanged.

## Test Plan

- `default-deny.test.ts` — table-driven: every route returns 401 without
  auth, the allowlisted routes return their normal response.
- `auth.test.ts` — entropy check rejects `'aaaa...64a'` (low entropy) and
  accepts a 64-char hex string from `crypto.randomBytes(32)`.
- `execution-permissions.test.ts` — resolve as non-owner returns 403, resolve
  as approver returns 200, resolve non-existent returns 404.
- `settings.test.ts` — write to provider keys without auth returns 401;
  sandbox `basePath: '../../etc'` returns 400.
- `ownership.test.ts` — table-driven for the new utility covering all
  branches.

## Risks & Rollback

- **Risk:** The default-deny middleware might reject requests that were
  previously accepted via implicit auth or no auth (e.g., the voice endpoints
  flagged in IDOR-017, the WebSocket upgrade). Mitigation: the allowlist is
  consulted in a single place; the deployment checklist requires a full
  integration test pass before merge.
- **Risk:** Raising the JWT secret minimum breaks existing deployments with
  32-char secrets. Mitigation: ship the change behind a
  `OWNPILOT_AUTH_STRICT_ENTROPY` flag, default-off for one release, log a
  warning when off.
- **Rollback:** The default-deny middleware is a single registration in
  `app.ts`. Revert that one line and all routes fall back to their
  per-route auth checks (the existing broken behavior).

## Out of Scope

- Per-route IDOR fixes. Plan 03 covers the ~20 IDOR findings using the
  `requireOwnership` utility introduced here.
- Per-user accounts / multi-tenant user model. The codebase is single-tenant
  with a shared UI password; per-user accounts are a much larger feature.
- WebSocket authentication changes. The WS layer has its own
  `authAttempts` throttling (Plan 10 / M7) and is treated as a separate
  surface.
