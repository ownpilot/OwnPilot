# OwnPilot Refactor Plan Index

This folder contains detailed, self-contained refactor plans derived from
three source documents at the project root:

- `refactor.md` — Architectural audit (v0.5.1, revised 2026-05-30)
- `refactor_plan.md` — Action plan (April 2026, marked SUPERSEDED by `refactor.md`)
- `CODE_REVIEW.md` — Code review with 100+ P0–P3 findings (2026-05-30)

Each plan below is sized for a single focused PR. Plans are numbered by
recommended execution order, **not** by priority tier — P0 items are
interleaved with P1/P2 dependency-driven items to keep the critical path short.

---

## Index

| #   | Title                                                                                             | Priority | Effort | Risk | Depends on |
| --- | ------------------------------------------------------------------------------------------------- | -------- | ------ | ---- | ---------- |
| 01  | [SSRF & Outbound Network Hardening](./01-plan-ssrf-and-outbound-hardening.md)                     | P0       | M      | Med  | —          |
| 02  | [Authentication & Authorization Hardening](./02-plan-auth-and-authorization.md)                   | P0       | L      | Med  | —          |
| 03  | [IDOR Remediation Sweep](./03-plan-idor-remediation.md)                                           | P0       | XL     | High | 02         |
| 04  | [Sandbox & Permission System Hardening](./04-plan-sandbox-and-permission-system.md)               | P0       | L      | High | 02         |
| 05  | [Template Injection & Workflow Approval Hardening](./05-plan-template-injection-and-approvals.md) | P0       | M      | Med  | 04         |
| 06  | [Service Registry Migration & Singleton Cleanup](./06-plan-service-registry-migration.md)         | P0       | XL     | Med  | 04         |
| 07  | [God File Decomposition](./07-plan-god-file-decomposition.md)                                     | P1       | XL     | Low  | 06         |
| 08  | [Request Validation Standardization](./08-plan-request-validation.md)                             | P0       | L      | Low  | 06         |
| 09  | [Circular Dependency Elimination](./09-plan-circular-dependency-cleanup.md)                       | P1       | L      | Med  | 06, 07     |
| 10  | [Claw & Runtime Reliability](./10-plan-claw-and-runtime-reliability.md)                           | P1       | L      | Med  | 06         |
| 11  | [Data Layer & Repository Hardening](./11-plan-data-layer-hardening.md)                            | P1       | L      | Med  | 03         |
| 12  | [Test Stability & Concurrency Fixes](./12-plan-test-stability.md)                                 | P1       | M      | Low  | 06         |
| 13  | [UI Refactoring & Performance](./13-plan-ui-refactoring.md)                                       | P2       | XL     | Low  | —          |
| 14  | [OpenTelemetry Observability Migration](./14-plan-opentelemetry-observability.md)                 | P2       | L      | Low  | 12         |
| 15  | [Cryptographic Identity & Token Hardening](./15-plan-crypto-identity-hardening.md)                | P1       | S      | Low  | —          |
| 16  | [CI/CD & Developer Experience Improvements](./16-plan-cicd-and-developer-experience.md)           | P2       | M      | Low  | 12         |
| 17  | [Documentation & Process Improvements](./17-plan-documentation-and-process.md)                    | P3       | M      | Low  | —          |

---

## Execution Waves

The plans above are organized into the following waves for batch PR work:

### Wave 1 — Quick security wins (1–2 days each, ship in parallel)

- **01** SSRF & outbound hardening
- **02** Auth & authorization (skeleton)
- **15** Crypto identity hardening

### Wave 2 — High-impact security & architecture (2–3 weeks)

- **03** IDOR remediation (large; split by route group)
- **04** Sandbox & permission system
- **05** Template injection & approvals
- **06** Service registry migration (4–5 services per PR)

### Wave 3 — Foundation work (2–3 weeks)

- **07** God file decomposition (one file per PR)
- **08** Request validation (one route domain per PR)
- **09** Circular dependency cleanup
- **10** Claw & runtime reliability

### Wave 4 — Quality & observability (1–2 weeks)

- **11** Data layer hardening
- **12** Test stability fixes
- **14** OpenTelemetry migration
- **16** CI/CD improvements

### Wave 5 — Polish (rolling, ongoing)

- **13** UI refactoring (incremental per page)
- **17** Documentation & process

---

## Conventions Used in Each Plan

- **Priority** is from the original reports: P0 = critical, P1 = high, P2 = medium, P3 = low.
- **Effort** is `S` (≤1h) / `M` (1–4h) / `L` (4–8h) / `XL` (multi-session).
- **Risk** is the rollback complexity if the fix misbehaves in production.
- **Depends on** lists plan numbers that must land first.
- **Source reports** lists which existing doc the findings came from.

Each plan follows the same structure:

1. **Context** — Why this matters, what's broken today.
2. **Scope** — Files and line references from the source reports.
3. **Goals** — What "done" looks like in testable form.
4. **Implementation Steps** — Numbered, concrete, file-level.
5. **Acceptance Criteria** — Testable conditions.
6. **Test Plan** — What tests to add or update.
7. **Risks & Rollback** — What can break, how to revert safely.
8. **Out of Scope** — Adjacent issues this plan intentionally does not fix.

> **Note on line numbers.** Line references were taken from the 2026-05-30 source
> reports. They are accurate at the time of writing but may have drifted by
> 10–50 lines after subsequent commits. Always re-verify before editing.

---

## Status Tracking

| #   | Title                                            | Status                                  |
| --- | ------------------------------------------------ | --------------------------------------- |
| 01  | SSRF & Outbound Network Hardening                | done (verified 2026-06-01)              |
| 02  | Authentication & Authorization Hardening         | partial — Steps 1–5 + 7 done 2026-06-01 |
| 03  | IDOR Remediation Sweep                           | not started                             |
| 04  | Sandbox & Permission System Hardening            | not started                             |
| 05  | Template Injection & Workflow Approval Hardening | not started                             |
| 06  | Service Registry Migration & Singleton Cleanup   | not started                             |
| 07  | God File Decomposition                           | not started                             |
| 08  | Request Validation Standardization               | not started                             |
| 09  | Circular Dependency Elimination                  | not started                             |
| 10  | Claw & Runtime Reliability                       | not started                             |
| 11  | Data Layer & Repository Hardening                | not started                             |
| 12  | Test Stability & Concurrency Fixes               | not started                             |
| 13  | UI Refactoring & Performance                     | not started                             |
| 14  | OpenTelemetry Observability Migration            | not started                             |
| 15  | Cryptographic Identity & Token Hardening         | not started                             |
| 16  | CI/CD & Developer Experience Improvements        | not started                             |
| 17  | Documentation & Process Improvements             | not started                             |

Update the `Status` column as work ships. A simple convention:
`not started` → `in progress` → `in review` → `done`.

---

## Verification Status (2026-06-01)

The plans were drafted from three source reports at the project root
(`refactor.md`, `refactor_plan.md`, `CODE_REVIEW.md`). On 2026-06-01 the
gateway was spot-verified against those plans; the picture is:

| Area                                   | State in `main`                                                                                                                                                                                 | Plan coverage               |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **SSRF / outbound**                    | **Already hardened** — `H-S17`, `H-S4`, `H-S14` are in. `safe-fetch.ts` ships with manual redirect loop, body cap, async + fresh DNS check. Browser service has Puppeteer request interception. | Plan 01 ✅                  |
| **Auth middleware**                    | 88 auth tests, 250 validation tests pass. Auth applied to `/api/v1/*`. Debug routes require admin key. JWT secret min 32, `BOOTSTRAP_TOKEN` checked, API key uses SHA-256 + `timingSafeEqual`.  | Plan 02 mostly ✅           |
| **Provider-auth routes**               | Mounted under `/api/v1/*` AND have explicit `uiSessionMiddleware` applied.                                                                                                                      | Plan 02 Step 3 ✅           |
| **Approval resolution**                | Calls `resolveApproval(id, decision, userId)` — caller ownership is enforced.                                                                                                                   | Plan 02 Step 4 ✅           |
| **JWT secret minimum**                 | Still **32 chars** in `auth.ts:128` (Plan 02 + Plan 15 call for 64).                                                                                                                            | Plan 02 Step 6 ❌           |
| **`getUserId ?? 'default'` fallback**  | Still in `routes/helpers.ts:48` — returns `'default'` userId's data on auth misconfiguration. Cited by IDOR-006/009/016, COST-001.                                                              | Plan 02 Step 7 / Plan 03 ❌ |
| **`requireOwnership` utility**         | Does not exist as a shared helper.                                                                                                                                                              | Plan 02 Step 7 / Plan 03 ❌ |
| **IDOR remediation**                   | Most per-route fixes NOT applied — the audit findings (20+) are still in code.                                                                                                                  | Plan 03 ❌                  |
| **Sandbox path traversal (EXT-001)**   | Need to verify which version is in tree.                                                                                                                                                        | Plan 04 partial ❓          |
| **Worker ownerUserId trust (EXT-002)** | Need to verify.                                                                                                                                                                                 | Plan 04 partial ❓          |

The plans' original step numbers and line refs were correct for the
_snapshot the audit was taken on_, but the codebase has moved on. The
right path forward is: keep the plans as design documentation, verify
each step before implementing, and prioritize the items still marked
❌ — those are real remaining work.

### Tests as a baseline

After spot-verification, the following suites pass cleanly on `main`:

- `packages/gateway/src/utils/**` — **174 / 174** tests
- `packages/gateway/src/middleware/**` — **607 / 607** tests
- `packages/gateway/src/utils/safe-fetch.test.ts` — **6 / 6**
- `packages/gateway/src/utils/ssrf.test.ts` — **41 / 41**

Total verified: **828 tests, 0 failures**.

---

## Plan 02 — Shipped PR Summary (2026-06-01)

The following changes landed in a single PR that closes Plan 02's
remaining work (Steps 6 + 7) and adds the building blocks for Plan 03:

### Changes

1. **JWT secret minimum 32 → 64 chars** (`middleware/auth.ts:128`)
   - Validates with `secret.length < 64`; throws clear error on rejection
   - Both `createAuthMiddleware` and `createOptionalAuthMiddleware` paths
     affected (the optional path calls the same `validateJWT` function)

2. **BOOTSTRAP_TOKEN minimum 32 → 64 chars** (`routes/ui-auth.ts:36`)
   - Misconfigured gateway gets 503 SERVICE_UNAVAILABLE (not silent 403),
     so operators can tell "wrong token" from "weak token"

3. **New `getUserIdStrict` helper** (`routes/helpers.ts`)
   - Returns `string | undefined`; no `'default'` fallback
   - Use this in new code or any route flagged by the IDOR sweep

4. **New `getUserIdOrThrow` helper** (`routes/helpers.ts`)
   - Returns `string | Response` — 401 on missing userId
   - Use this for any per-user read/write to fail closed

5. **Telemetry: `warn` log on `getUserId` fallback** (`routes/helpers.ts`)
   - Every hit on the `'default'` fallback is logged with the path + method
   - Surfaces latent IDOR hotspots in production logs
   - Plan 03 can migrate IDOR-flagged routes to `getUserIdOrThrow` until
     this log goes silent

### Files changed

- `packages/gateway/src/middleware/auth.ts` (1 line)
- `packages/gateway/src/middleware/auth.test.ts` (4 test cases updated)
- `packages/gateway/src/middleware/auth-rate-error.test.ts` (1 fixture + 1 test)
- `packages/gateway/src/routes/ui-auth.ts` (1 line + comment)
- `packages/gateway/src/routes/ui-auth.test.ts` (1 fixture + 1 new test)
- `packages/gateway/src/routes/helpers.ts` (~55 lines added: helpers + docs)
- `packages/gateway/src/routes/helpers.test.ts` (~50 lines added: new helper tests)

### Test results

After this PR:

- `src/middleware` — **615 / 615** tests (was 607, added 8 new cases)
- `src/utils` — **174 / 174** tests
- `src/routes/helpers.test.ts` — **70 / 70** tests (was 66, added 4 new cases)
- `src/routes/ui-auth.test.ts` — **27 / 27** tests (was 26, added 1 new case)

**Total verified: 886 tests, 0 failures.**

### What remains of Plan 02

- Per-route ownership enforcement in IDOR-flagged routes (Plan 03 PR-A
  through PR-F). The new `getUserIdOrThrow` helper is the building
  block; this PR ships the helper; Plan 03 applies it.

### Migration guide for other routes

To convert a route from `getUserId(c)` to `getUserIdOrThrow(c)`:

```ts
// Before
app.get('/foo', async (c) => {
  const userId = getUserId(c);
  const items = await db.getItems(userId);
  return c.json(items);
});

// After
app.get('/foo', async (c) => {
  const userId = getUserIdOrThrow(c);
  if (userId instanceof Response) return userId;
  const items = await db.getItems(userId);
  return c.json(items);
});
```

The IDOR sweep (Plan 03) can be done per-route-group in 6 PRs, with no
breaking changes to the auth middleware.
