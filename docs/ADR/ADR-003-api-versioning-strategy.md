# ADR-003: API Versioning Strategy

**Date:** 2026-05-07
**Status:** Implemented
**Deciders:** Architecture review

## Context

OwnPilot's API is at `/api/v1/`. As the platform matures, breaking changes will be needed (schema changes, authentication model changes, response format changes). Extensions and channel adapters that call v1 endpoints will break when those changes land. A versioning strategy is required.

## Decision

**Side-by-side versioning** (recommended in gap 24.7) is implemented:

- v1 (`/api/v1/*`) stays active for backward compatibility
- v2 (`/api/v2/*`) runs in parallel, initially with identical handlers
- Breaking changes land exclusively in v2
- v1 has no end-of-life date set; deprecation timeline will be published 90 days before removal
- Both versions share the same authentication middleware

## Why Side-by-Side

| Factor | Side-by-Side | Header-based |
|--------|-------------|--------------|
| Complexity | Low — same handlers registered twice | High — version detection logic in every handler |
| Backward compat | Full — callers migrate on their timeline | Partial — header must be present |
| Testability | Easy — same tests for both versions | Hard — version branching in tests |
| Extension impact | Extensions using v1 keep working | Extensions break if they don't send header |
| Observability | Version visible in URL | Requires header log extraction |

## Implementation

```
packages/gateway/src/routes/
  register-v2-routes.ts    # All v2 route registrations (mirrors v1 at /api/v2/*)
  register-platform-routes.ts   # /api/v1/* registrations
  register-agent-routes.ts      # ...
  register-data-routes.ts
  register-automation-routes.ts
  register-integration-routes.ts

packages/gateway/src/app.ts
  registerV2Routes(app)   # Called alongside registerV1 routes
  GET /api/v2              # v2 API info endpoint
```

### v2 Route Registration

`register-v2-routes.ts` imports all route modules and mounts them at `/api/v2/*` paths. Handlers are shared — the same `chatRoutes`, `agentRoutes`, etc. serve both versions.

### Version Detection

No version detection middleware. The URL path determines the version:
- `/api/v1/chat` → v1 handlers
- `/api/v2/chat` → v2 handlers (same implementation initially)

### Adding Breaking Changes to v2

When a breaking change is needed:

1. Implement the new behavior in the route handler
2. If the change is behavioral (not structural), add a version check in the handler
3. If the change is structural (different response schema), create a v2-specific handler

Example — adding a new field to chat response:

```typescript
// routes/chat.ts — both v1 and v2 use the same handler
const chatHandler = async (c: Context) => {
  const result = await executeChat(c);
  // v2 response includes new field
  if (c.req.path.startsWith('/api/v2')) {
    return c.json({ ...result, newField: true });
  }
  return c.json(result);
};
```

## What Stays at v1 Only

`/webhooks/*` routes are NOT versioned — external callers use secret-path authentication and versioning would break external integrations.

`/health` is also unversioned (shared between v1 and v2). `/api/v1/metrics` is auth-protected under the v1 chain.

## Future Deprecation of v1

When v1 is deprecated:

1. Publish 90-day deprecation notice in `/api/v1` response headers: `Deprecation: true`, `Sunset: <date>`
2. Add `Deprecation` response header to all v1 responses
3. Log v1 usage metrics to track active callers
4. After 90 days, remove v1 registrations from `register-platform-routes.ts`, etc.

## Consequences

**Positive:**
- Extensions and channel adapters continue working without changes
- v2 can evolve independently
- No complex version-detection logic in handlers

**Negative:**
- Route registration is duplicated (but consolidated in one file per domain)
- Some code duplication if v2-specific handlers are needed

## References

- Gap 24.7 in `architecture.md`
- `packages/gateway/src/routes/register-v2-routes.ts`
- `packages/gateway/src/app.ts` — `registerV2Routes()` call
