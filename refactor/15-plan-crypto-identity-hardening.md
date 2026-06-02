# Plan 15 — Cryptographic Identity & Token Hardening

**Priority:** P1
**Effort:** S (1 day)
**Risk:** Low
**Depends on:** none
**Source reports:** `CODE_REVIEW.md` ID-001, AUTH-004, AUTH-005, AUTH-006,
`refactor_plan.md` C3 (done for Signal registration IDs)

---

## Context

The codebase has a centralized `generateId(prefix)` utility in
`packages/core/src/services/id-utils.ts` that uses `randomBytes` (per
MEMORY.md, replaced 23+ `Math.random()` sites). The remaining stragglers
and adjacent issues:

- **ID-001:** `id-utils.ts:18-22` uses `Date.now()` + 8-char random.
  `Date.now()` exposes approximate creation time; 8 chars (4 bytes) is
  brute-forceable within a known time window.
- **AUTH-004:** `BOOTSTRAP_TOKEN` is only checked for length (32
  chars); entropy is not verified. A trivially weak token (e.g.,
  `'a'.repeat(32)`) passes.
- **AUTH-005:** JWT secret minimum is 32 chars; HS256 best practice
  is 64.
- **AUTH-006:** OAuth URL validation uses `z.string().url()` which
  accepts `http://` and `file://`. SSRF is blocked at fetch time but
  not at write time.
- **Predictable IDs leak in tool result cache keys** (related to
  IDEMP-001 in Plan 11).
- **The `id-utils.ts` format** is regex-bounded but not collision-
  resistant at scale.

This plan hardens identity generation, token validation, and OAuth URL
acceptance.

## Scope

- `packages/core/src/services/id-utils.ts` (ID-001)
- `packages/gateway/src/routes/ui-auth.ts:220-253` (AUTH-004)
- `packages/gateway/src/middleware/auth.ts:128` (AUTH-005)
- `packages/gateway/src/routes/auth.ts:194-200` (AUTH-006)
- `packages/gateway/src/utils/entropy.ts` (new)
- `packages/gateway/src/utils/oauth-url.ts` (new)

## Goals

1. All protocol-identity values are 16 bytes of CSPRNG entropy
   (128 bits, brute-force infeasible).
2. `id-utils.ts` no longer embeds `Date.now()` in the public ID format.
3. `BOOTSTRAP_TOKEN` and `JWT_SECRET` both require ≥ 64 chars and
   ≥ 256 bits of Shannon entropy.
4. OAuth URL validation rejects non-`https` schemes (except an
   explicit dev-mode allowlist for `http://localhost`).
5. Every existing call site continues to work — the format change is
   backward-compatible (old IDs are still valid; new IDs are simply
   longer and unguessable).

## Implementation Steps

### Step 1 — Replace `Date.now()` in `id-utils.ts`

In `packages/core/src/services/id-utils.ts`:

- Replace the `Date.now()` component with a 12-byte (24 hex char)
  CSPRNG value. The format becomes:
  ```
  <prefix>_<24 hex chars>
  ```
- 12 bytes = 96 bits, well above the 64-bit collision-free range
  for any realistic row count (a billion rows, 96 bits, collision
  probability ~ 10⁻¹⁶).
- The `Date.now()` is preserved in a separate, non-public metadata
  field if needed for debugging; it never appears in the ID itself.
- Update the format docs in `id-utils.ts` and any external
  documentation that references the format.

### Step 2 — Entropy helper

Create `packages/gateway/src/utils/entropy.ts`:

```ts
import { createHash } from 'node:crypto';

/**
 * Estimate Shannon entropy of a string in bits.
 * Returns the entropy in bits (e.g., 256 for a 32-byte hex string).
 */
export function shannonEntropy(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  const len = s.length;
  let h = 0;
  for (const c of counts.values()) {
    const p = c / len;
    h -= p * Math.log2(p);
  }
  return h * len;
}

export function meetsEntropy(s: string, minBits: number): boolean {
  return s.length >= 32 && shannonEntropy(s) >= minBits;
}
```

### Step 3 — Token entropy checks

In `packages/gateway/src/routes/ui-auth.ts:220-253`:

- After the length check, call `meetsEntropy(BOOTSTRAP_TOKEN, 256)`.
  Reject weak tokens with a clear boot-time error.
- The token is generated via `crypto.randomBytes(32).toString('hex')`
  (64 hex chars) at install time if not provided.

In `packages/gateway/src/middleware/auth.ts:128`:

- Raise the JWT secret minimum to 64 chars.
- Add the entropy check: `meetsEntropy(JWT_SECRET, 256)`.
- The boot error message includes a one-liner to generate a strong
  secret: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

### Step 4 — OAuth URL scheme validation

In `packages/gateway/src/utils/oauth-url.ts`:

```ts
import { z } from 'zod';

export const oauthUrlSchema = z
  .string()
  .url()
  .refine(
    (url) => {
      const u = new URL(url);
      if (u.protocol === 'https:') return true;
      if (u.protocol === 'http:' && u.hostname === 'localhost') return true;
      if (u.protocol === 'http:' && u.hostname === '127.0.0.1') return true;
      return false;
    },
    { message: 'OAuth URL must be https:// or http://localhost' }
  );
```

Replace `z.string().url()` in `routes/auth.ts:194-200` with
`oauthUrlSchema`. The SSRF guard at fetch time is preserved as
defense-in-depth; the input validation is the new front line.

### Step 5 — Cache key collision check

For `services/tool/executor.ts:592` (IDEMP-001) — the stable serializer
from Plan 11 handles the equivalent-invocation case. Add a separate
collision check: generate 10 M keys, verify zero collisions in a
hash set. Run as a benchmark in CI to catch regressions if the
serialization changes.

## Acceptance Criteria

1. `generateId('agent')` returns a 32-character string after the
   prefix; it does not contain a timestamp.
2. `BOOTSTRAP_TOKEN='a'.repeat(64)` is rejected with a clear error.
3. `JWT_SECRET` shorter than 64 chars is rejected at boot.
4. A request to set an OAuth URL with `http://attacker.com` returns
   400; `https://attacker.com` is accepted; `http://localhost:3000`
   is accepted.
5. 10 M tool cache keys generated with the stable serializer have
   zero collisions in a hash set.
6. All existing IDs in the database remain valid (the format change
   is additive — old IDs are still parseable).

## Test Plan

- `tests/core/id-utils.test.ts` — format check; 10 M id generation
  is collision-free; no `Date.now()` substring.
- `tests/utils/entropy.test.ts` — table-driven: `'a'.repeat(64)` is
  rejected, `randomBytes(32).toString('hex')` is accepted.
- `tests/utils/oauth-url.test.ts` — `https://x`, `http://localhost`,
  `http://127.0.0.1` pass; `http://x`, `file:///x` fail.
- `tests/auth/jwt-secret.test.ts` — boot fails with a clear error
  when the secret is short or low-entropy.
- `tests/services/tool-cache-bench.test.ts` — 10 M keys, zero
  collisions.

## Risks & Rollback

- **Risk:** The new ID format breaks a downstream consumer that
  expected a specific shape. Mitigation: the format is documented;
  consumers that match a regex should update the regex. Add a
  deprecation log if any consumer is found in the wild.
- **Risk:** The entropy check rejects a secret a user is currently
  using. Mitigation: log a `warn` (not error) for one release; the
  strict check is opt-in via env var first.
- **Rollback:** The format change is additive; old IDs continue to
  parse. The entropy check is env-gated; revert the env var.

## Out of Scope

- Migrating the ID format to UUIDv7. The custom format is sufficient
  and avoids a dependency. UUIDv7 is a future consideration.
- Replacing HS256 with EdDSA / RS256 for JWTs. The current HS256 is
  fine; the secret-length fix is enough.
- Token rotation. Belongs to a broader session management plan.
