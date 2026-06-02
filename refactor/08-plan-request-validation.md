# Plan 08 — Request Validation Standardization

**Priority:** P0
**Effort:** L (1 week; one PR per route domain)
**Risk:** Low
**Depends on:** 06 (the registry migration is orthogonal but reduces churn)
**Source reports:** `refactor.md` §3.3, `CODE_REVIEW.md` AUTH-006, CSV-001, TYPE-001, HELP-001

---

## Context

The gateway has dozens of Zod schemas in
`packages/gateway/src/middleware/validation.ts`, but **only ~12 explicit
`Schema.parse` calls** versus **79 raw `await c.req.json()` invocations**
across 80+ route files. The most security-sensitive surfaces (agents,
claws, MCP, personal-data, fleet, edge, bridges, costs, crews,
notifications) parse JSON without runtime validation — meaning a
malformed or hostile payload reaches the application layer before any
type check.

Beyond the security gap, the lack of validation has three operational
consequences:

1. **Error responses are inconsistent.** A missing required field might
   return a Postgres constraint error (500), a 400 with a verbose
   stack trace, or silently default. The `apiError` helper exists but
   is bypassed when the route hand-rolls its body parsing.
2. **OpenAPI documentation drifts from reality.** `docs/API_ROUTES.md`
   is hand-maintained and lags behind route changes. Generated OpenAPI
   from the Zod schemas would stay current automatically.
3. **`c.req.json()` returns `any`.** TypeScript narrows nothing. The
   downstream code path is unsafe by construction.

This plan introduces a `validateBody` middleware that all routes opt
into, with a custom ESLint rule that flags raw `c.req.json()` calls in
route files.

## Scope

- `packages/gateway/src/middleware/validation.ts` (existing schemas)
- 79 raw `c.req.json()` call sites across 80+ route files
- `packages/gateway/src/middleware/validate-body.ts` (new)
- `eslint.config.js` (custom rule, or `eslint-plugin-no-secrets` extension)
- `packages/gateway/src/openapi/generator.ts` (new; auto-generates
  OpenAPI from schemas)
- `docs/API_ROUTES.md` (will be auto-generated, kept for compatibility)

## Goals

1. Every `POST`, `PUT`, `PATCH` route in the gateway uses
   `validateBody(schema)` middleware.
2. A new ESLint rule flags `await c.req.json()` calls inside
   `routes/**/*.ts` files unless wrapped in a `validateBody` chain.
3. `docs/API_ROUTES.md` is generated from the Zod schemas; manual edits
   are flagged by CI.
4. Every validation failure returns a structured `apiError` response
   with `code: 'validation_error'`, a list of field-level errors, and a
   `requestId` for log correlation.
5. TypeScript narrows the validated body to the inferred Zod type, so
   the downstream handler is type-safe end-to-end.

## Implementation Steps

### Step 1 — `validateBody` middleware

Create `packages/gateway/src/middleware/validate-body.ts`:

```ts
import { z, type ZodTypeAny } from 'zod';
import { apiError, ERROR_CODES } from '../utils/api-response.js';
import type { MiddlewareHandler } from 'hono';

export function validateBody<S extends ZodTypeAny>(schema: S): MiddlewareHandler {
  return async (c, next) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch (err) {
      return c.json(apiError(ERROR_CODES.BAD_REQUEST, 'Invalid JSON body'), 400);
    }
    const result = schema.safeParse(raw);
    if (!result.success) {
      return c.json(
        apiError(ERROR_CODES.VALIDATION_ERROR, 'Request body failed validation', {
          issues: result.error.issues,
        }),
        400
      );
    }
    c.set('validatedBody', result.data);
    await next();
  };
}

export type Validated<S extends ZodTypeAny> = { validatedBody: z.infer<S> };
```

The middleware stores the validated (and typed) body on the Hono context
under `validatedBody`. Handlers retrieve it via
`c.get('validatedBody') as z.infer<typeof schema>`.

### Step 2 — Migrate one route family per PR

Each PR picks a route family and converts every handler. The families
mirror the IDOR sweep (Plan 03) for natural pairing:

- **PR-A: `routes/agents/*`** — agents CRUD, messages, command-center
- **PR-B: `routes/claws/*`** — claw CRUD, lifecycle, audit, stats
- **PR-C: `routes/chat/*`** — messages, streaming, history, fetch-url
- **PR-D: `routes/workflow/*`** — workflow CRUD, executions, approvals
- **PR-E: `routes/souls/*`** — souls and all 15 sub-routes
- **PR-F: `routes/personal-data/*`, `custom-data/*`, `database/*`**
- **PR-G: `routes/costs/*`, `audit/*`, `notifications/*`**
- **PR-H: `routes/mcp/*`, `bridges/*`, `edge/*`**

Each PR follows the same template:

1. Co-locate the schema with the route: `routes/agents/schemas.ts`
   contains every Zod schema for the agents family.
2. Replace each `await c.req.json()` with `c.get('validatedBody')` after
   the `validateBody(schema)` middleware is registered on the route.
3. Update the route's tests to assert 400 responses on schema-violating
   payloads.

### Step 3 — Custom ESLint rule

Add a custom rule to `eslint.config.js` (or a new local rule in
`packages/gateway/eslint-rules/no-raw-req-json.js`):

```js
'no-raw-req-json': {
  meta: { type: 'problem', messages: { raw: 'Use validateBody(schema) middleware instead of c.req.json() in route files.' } },
  create(context) {
    return {
      AwaitExpression(node) {
        if (
          node.argument.type === 'CallExpression' &&
          node.argument.callee.type === 'MemberExpression' &&
          node.argument.callee.property.name === 'json' &&
          /routes\/.*\.ts$/.test(context.getFilename())
        ) {
          context.report({ node, messageId: 'raw' });
        }
      },
    };
  },
},
```

Run `pnpm lint` to find all 79 sites; each must be converted before the
rule can be set to `'error'`.

### Step 4 — OpenAPI generation

Create `packages/gateway/src/openapi/generator.ts`:

- Iterate every route registration in `app.ts`.
- For each route, look up the `validateBody` schema (stored in a
  registry of `{ routePath, method, schema }`).
- Emit a valid OpenAPI 3.1 document.
- Add `pnpm run openapi:generate` to write `docs/API_ROUTES.md` and
  `openapi.json` (the latter served at `/api/openapi.json` for
  developer tooling).

### Step 5 — Wire `parseJsonBody` and `parseQuery` helpers

The existing `parseJsonBody` in `routes/helpers.ts:335` returns `null`
after sending 415 — that masks the real error. Replace it with a
`parseJsonBody(c, schema)` helper that uses the same `validateBody`
machinery and returns the typed body. Add `parseQuery(c, schema)` for
the 30+ routes that parse query parameters via `c.req.query()`.

## Acceptance Criteria

1. `grep -rn 'c.req.json' packages/gateway/src/routes/` returns zero
   matches after Step 3 lands.
2. `pnpm lint` passes with the new rule enabled.
3. A POST to any migrated route with a missing required field returns
   `400` with a structured `apiError` body listing the failing fields.
4. `pnpm run openapi:generate` produces a valid OpenAPI 3.1 document;
   the file is checked in.
5. `docs/API_ROUTES.md` is generated by the script; a CI check fails
   the build if a manual edit drifts from the generated content.
6. TypeScript narrows `c.get('validatedBody')` to the schema's inferred
   type — verified by removing an explicit cast and confirming
   `tsc --noEmit` is clean.

## Test Plan

- `tests/middleware/validate-body.test.ts` — happy path, schema failure,
  malformed JSON, missing Content-Type.
- Per-route negative tests: every schema has a `rejects_extra_field`,
  `rejects_missing_field`, and `rejects_wrong_type` test.
- `tests/openapi/generator.test.ts` — golden-file comparison of the
  generated OpenAPI document.

## Risks & Rollback

- **Risk:** Tightening validation surfaces 400s on previously-accepted
  malformed payloads. Mitigation: log a one-time `warn` for the first
  occurrence of each validation failure type, monitor for false
  positives for one release, then enforce.
- **Risk:** The custom ESLint rule has false positives on legitimate
  non-route files (e.g., a `getJson` helper inside `routes/` that does
  not directly serve a request). Mitigation: the rule's file path
  matcher is `/routes\/.*\/[^/]+\.ts$/` (a leaf file, not a directory
  helper), and the rule can be disabled with a comment.
- **Rollback:** Each route family PR is independently revertible. The
  ESLint rule is set to `'warn'` for one release before becoming
  `'error'`.

## Out of Scope

- Request body _size_ limits. Belongs to Plan 01 (SSRF & outbound
  hardening — outbound body cap) and the gateway-level inbound body cap
  is a separate, simpler change.
- Header validation. `c.req.header()` returns `string | undefined` and
  is consistent enough; a separate `validateHeaders` middleware can be
  added if needed.
- Form-data and multipart validation. The current API surface is JSON-
  only; a future file-upload API would need separate treatment.
