# OwnPilot Refactor Plan

**Generated:** 2026-04-19
**Scope:** Action items from the codebase review. Each entry is a self-contained task sized for a single focused PR.
**Target:** Prioritized punch list — work top-down, but items within the same severity tier can be parallelized across sessions.

---

## Contents

- [Legend](#legend)
- [Execution Order](#execution-order)
- [Critical](#critical)
  - [C1. Extension sandbox permission bypass](#c1-extension-sandbox-permission-bypass)
  - [C2. No rate-limit on UI login (brute-force target)](#c2-no-rate-limit-on-ui-login-brute-force-target)
  - [C3. Signal registration ID uses `Math.random()`](#c3-signal-registration-id-uses-mathrandom)
  - [C4. UI sessions are in-memory only](#c4-ui-sessions-are-in-memory-only)
- [High](#high)
  - [H1. Workflow HTTP node follows redirects blindly (SSRF)](#h1-workflow-http-node-follows-redirects-blindly-ssrf)
  - [H2. BrowserService skips DNS-rebinding check](#h2-browserservice-skips-dns-rebinding-check)
  - [H3. `safeVmEval` sandbox prototype-chain leak](#h3-safevmeval-sandbox-prototype-chain-leak)
  - [H4. `invalidateAllSessions()` not fired on all password-state transitions](#h4-invalidateallsessions-not-fired-on-all-password-state-transitions)
  - [H5. Claw `executeCycle` emits `cycle.start` before the concurrency guard](#h5-claw-executecycle-emits-cyclestart-before-the-concurrency-guard)
  - [H6. Fleet pause/stop doesn't await in-flight cycle](#h6-fleet-pausestop-doesnt-await-in-flight-cycle)
  - [H7. Workflow HTTP node missing request-body size cap](#h7-workflow-http-node-missing-request-body-size-cap)
- [Medium](#medium)
  - [M1. God files: ClawsPage (2972 LoC), FleetPage (2368 LoC)](#m1-god-files-clawspage-2972-loc-fleetpage-2368-loc)
  - [M2. `Math.random()` suffix for name-collision retry](#m2-mathrandom-suffix-for-name-collision-retry)
  - [M3. Unused `escapeHtml` in WS server — dead or missing guard](#m3-unused-escapehtml-in-ws-server--dead-or-missing-guard)
  - [M4. Probabilistic pulse-log cleanup via `Math.random() < 0.05`](#m4-probabilistic-pulse-log-cleanup-via-mathrandom--005)
  - [M5. `agent_messages.findConversation` OR-query can't use compound indexes](#m5-agent_messagesfindconversation-or-query-cant-use-compound-indexes)
  - [M6. Claw inbox race — new messages dropped during cycle execution](#m6-claw-inbox-race--new-messages-dropped-during-cycle-execution)
  - [M7. WS `_authCleanupTimer` runs on module import, not lifecycle](#m7-ws-_authcleanuptimer-runs-on-module-import-not-lifecycle)
  - [M8. Transformer/HTTP `|| N` timeout fallback treats 0 as undefined](#m8-transformerhttp--n-timeout-fallback-treats-0-as-undefined)
- [Low](#low)
  - [L1. ClawManager conversation-lookup failure logged at `debug`](#l1-clawmanager-conversation-lookup-failure-logged-at-debug)
  - [L2. `scaffoldClawDir` does 4 sync disk I/Os on startClaw hot path](#l2-scaffoldclawdir-does-4-sync-disk-ios-on-startclaw-hot-path)
  - [L3. `checkPermission` is a dead export](#l3-checkpermission-is-a-dead-export)
- [What's already solid](#whats-already-solid)

---

## Legend

| Field | Meaning |
|---|---|
| **Severity** | `critical` (security/data loss) / `high` (security-adjacent or subtle correctness) / `medium` (scaling/maintainability) / `low` (nits w/ measurable upside) |
| **Effort** | `S` ≤ 1 hr · `M` 1–4 hr · `L` 4–8 hr · `XL` multi-session |
| **Risk** | Rollback complexity if a fix misbehaves in prod |
| **Depends on** | Other plan items that must land first |

Each entry uses the same structure: **Problem**, **Goal**, **Implementation**, **Test Plan**, **Risks / Rollback**, **Effort**, **Dependencies**.

---

## Execution Order

A suggested running order. Items across the same tier can ship in any order; items marked with `⇒` block something later.

1. **C2** — Login rate limit (fastest win, ~30 min, security-critical) ⇒ enables safe C4 rollout
2. **C1** — Extension permission bypass ⇒ unblocks L3 deletion of dead `checkPermission` (become caller, not deleter)
3. **C3** — Signal crypto ID (trivial, do while warm)
4. **H5** — Claw cycle guard ordering (subtle, test-heavy)
5. **H6** — Fleet pause/stop cycle drain (same family)
6. **H1 + H2 + H7** — SSRF hardening bundle (all SSRF touching → single PR for concentration)
7. **H3** — VM sandbox isolation (research task; worth scheduling)
8. **C4** — Session persistence (bigger lift; do after rate-limit + SSRF stabilize)
9. **M1** — God-file splits (ClawsPage first, FleetPage second)
10. **M5** — agent_messages index migration (run in off-peak window)
11. **M2–M8** — Remaining mediums, batch as time allows
12. **H4** — Session invalidation audit (small, do alongside C4)
13. **L1–L3** — Mop up

Everything listed is intended as a **single PR per item** unless explicitly grouped (H1+H2+H7).

---

## Critical

### C1. Extension sandbox permission bypass

- **Severity:** `critical`
- **Files:**
  - `packages/gateway/src/services/tool-executor.ts:405-436`
  - `packages/gateway/src/services/extension-sandbox.ts:30`, `:108-118`
  - `packages/gateway/src/services/extension-permissions.ts:144-160` (currently-dead `checkPermission`)

**Problem**
`SandboxExecutionOptions.grantedPermissions` is accepted but never forwarded into the worker. The `setupSandboxCallToolHandler` bridge in `tool-executor.ts` invokes the registered tool directly, passing `userId: 'system'`. Consequences:

1. Any enabled extension can invoke any of the 250+ registered tools (including `shell_exec`, `write_file`, `send_email`) via `utils.callTool(name, args)` — regardless of what the user approved during install.
2. The `userId: 'system'` hoists privileges above the actual extension owner, breaking downstream authorization checks that rely on user scoping (DB RLS, per-user tool blocklists, audit trails).
3. `checkPermission()` in `extension-permissions.ts` is the intended gate but has **zero call sites** in production code.

**Goal**
Every `utils.callTool()` invocation from inside an extension sandbox must:
- Run under the extension owner's `userId`
- Pass through `checkPermission(toolName, grantedPermissions)` and be rejected before executing if the permission isn't granted
- Be audit-logged (extension id, tool, user, result) in the existing audit pipeline

**Implementation**
1. In `extension-sandbox.ts`, propagate `grantedPermissions: string[]` and `ownerUserId: string` through the `workerData` payload when spawning the sandbox worker.
2. In the worker, persist these into a module-level const on startup; expose a read-only accessor.
3. In `tool-executor.ts` `setupSandboxCallToolHandler` (around line 405), accept the extension identity from the bridge message envelope, look up (or pass through) `grantedPermissions`, and call:
   ```ts
   if (!checkPermission(toolName, grantedPermissions)) {
     return { ok: false, error: 'permission_denied', toolName, required: requiredPermissionFor(toolName) };
   }
   ```
   Call `checkPermission` from `extension-permissions.ts` rather than re-inventing.
4. Replace `userId: 'system'` with the extension's `ownerUserId` in the `toolContext` passed to `tool.handler`. Add a `callerKind: 'extension'` flag so downstream tools can distinguish user calls vs. extension calls (some tools may want stricter rules for extensions even when permission is granted).
5. Emit `audit.extension.callTool` event with `{ extensionId, toolName, userId, allowed, reason }` regardless of allow/deny outcome. Reuse the existing audit bus — don't invent a new channel.

**Test Plan**
- Unit test `checkPermission` with each permission category (happy + unknown tool + empty grants).
- Integration test in `extension-service.test.ts`: install an extension with only the `network` permission, then have its code try to call a `filesystem.*` tool — assert the call returns `permission_denied` and an audit event fires.
- Regression: all existing extension tests still pass with `grantedPermissions: ['*']` for back-compat during migration.
- Snapshot test on the audit log shape — downstream consumers may depend on it.

**Risks / Rollback**
- Users with legitimate extensions that already implicitly relied on the bypass will see failures. Mitigation: ship behind `EXT_STRICT_PERMISSIONS` feature flag, default-off for one release, flip to default-on after telemetry confirms no legit break. Explicit rollback is flipping the flag.
- Tool names in permission declarations may not exactly match runtime-registered names (prefix/namespace skew). Audit `BLOCKED_CALLABLE_TOOLS` and existing permission → tool mapping before flipping the default.

**Effort:** L
**Dependencies:** none (blocks L3)

---

### C2. No rate-limit on UI login (brute-force target)

- **Severity:** `critical`
- **Files:**
  - `packages/gateway/src/routes/ui-auth.ts:49-71`
  - Pattern to copy: `packages/gateway/src/ws/server.ts` (`authAttempts` map)

**Problem**
`POST /auth/login` runs a full scrypt verify on every request with no throttle. There is a single shared UI password (no per-user accounts), so every login attempt targets the same secret. Scrypt is slow by design (~100ms), which limits naive attacks, but a parallel attacker can still try thousands/hr. The WebSocket auth path already has rate limiting — HTTP is asymmetric.

**Goal**
Per-IP login attempt cap (e.g., 5 attempts per 5 minutes), with exponential backoff on repeated failure and optional lockout that surfaces in the audit log.

**Implementation**
1. Extract the `authAttempts` pattern from `ws/server.ts` into a shared helper, e.g. `packages/gateway/src/utils/login-throttle.ts`:
   ```ts
   export function createLoginThrottle(opts: { maxAttempts: number; windowMs: number; lockoutMs: number }): {
     check(ip: string): { allowed: true } | { allowed: false; retryAfterMs: number };
     recordFailure(ip: string): void;
     recordSuccess(ip: string): void;
   }
   ```
2. In `ui-auth.ts`, create a module-level throttle instance with `{ maxAttempts: 5, windowMs: 5 * MS_PER_MINUTE, lockoutMs: 15 * MS_PER_MINUTE }` pulled from `defaults.ts` constants.
3. In the `POST /auth/login` handler, before scrypt verify, call `throttle.check(clientIp)`. On deny, return 429 with `Retry-After` header set from `retryAfterMs / 1000`.
4. On auth failure, call `throttle.recordFailure(clientIp)` and emit an `audit.auth.loginFailed` event with `{ ip, attempts, lockedOut }`.
5. On success, call `throttle.recordSuccess(clientIp)` to reset the counter.
6. Refactor `ws/server.ts` to consume the same helper. Single source of truth.

**Client IP resolution:** honor `X-Forwarded-For` only if behind a configured trusted proxy (`TRUST_PROXY` env, existing pattern in `gateway/src/server.ts`). Otherwise use `c.req.header('cf-connecting-ip')` fallback chain → raw socket.

**Test Plan**
- Unit tests for `createLoginThrottle` — clean window, failure accumulation, lockout, success-reset, clock advancement with fake timers.
- Integration test in `ui-auth.test.ts`: 6 failed attempts from same IP → 6th returns 429. Different IPs each get their own quota.
- E2E test: verify Retry-After header is honored by the UI (prompt "try again in X seconds").

**Risks / Rollback**
- Shared IP scenarios (corporate NAT, mobile carrier NAT) could lock out legitimate users. Mitigation: lockout window is short (15m); also consider a cookie-based soft identifier to disambiguate users behind the same IP. Explicit rollback is setting `maxAttempts` very high.
- The in-memory throttle doesn't survive restarts. That's acceptable for rate limiting (attacker restarts too). Not a replacement for ban-list DB.

**Effort:** S
**Dependencies:** none

---

### C3. Signal registration ID uses `Math.random()`

- **Severity:** `critical`
- **Files:**
  - `packages/gateway/src/channels/hub/crypto/key-store.ts:202-208`

**Problem**
The Signal registration ID — a 31-bit protocol identifier — is generated via `Math.floor(Math.random() * 0x7fffffff) + 1`. `Math.random()` is not a CSPRNG. V8's xorshift128+ can leak internal state (well-documented research). For a crypto-adjacent identifier, the predictability is unacceptable.

**Goal**
All protocol-identity values use a CSPRNG.

**Implementation**
1. At top of file: `import { randomInt } from 'node:crypto'`.
2. Replace the body of `getRegistrationId()` with: `return randomInt(1, 0x7fffffff + 1)`. (Upper is exclusive in `randomInt`.)
3. Audit the same file and sibling files under `channels/hub/crypto/*` for other `Math.random()` calls — replace any that touch keys, nonces, identifiers. Leave UX-only randomness (animation jitter, etc.) alone.

**Test Plan**
- No behavioral test — IDs are opaque. Add a repetition test that generates 10k IDs and asserts uniqueness distribution (hash set + Chi-square under 1% tail).
- Snapshot test the output shape (positive 31-bit integer).
- Verify no existing tests rely on a specific deterministic value (grep the test tree for the old constant).

**Risks / Rollback**
- None meaningful — output shape unchanged.

**Effort:** S
**Dependencies:** none

---

### C4. UI sessions are in-memory only

- **Severity:** `critical`
- **Files:**
  - `packages/gateway/src/services/ui-session.ts:26-27`, `:65-90`, `:115-123`
  - `packages/gateway/src/db/migrations/postgres/` — new migration to add

**Problem**
The `sessions` `Map<string, UISession>` lives in process memory. Consequences:
- Every gateway restart logs out all users, including MCP tokens that are advertised as 30-day TTL.
- Horizontal scaling (clustering, multiple gateway instances behind a load balancer) is impossible without sticky sessions + session sharing; forced to pick one.
- Compromised DB backups could still leak raw tokens if a future maintainer naively adds persistence without hashing.

**Goal**
Sessions persisted in Postgres, indexed by token hash (not plaintext), with a lazy expiry sweep. Restart-safe. Compatible with multi-instance deployments (future-proofing, not a current requirement).

**Implementation**
1. New migration `NNN_ui_sessions.sql` (pick next number):
   ```sql
   CREATE TABLE IF NOT EXISTS ui_sessions (
     token_hash TEXT PRIMARY KEY,           -- sha256(token) hex
     kind TEXT NOT NULL,                    -- 'ui' | 'mcp'
     user_id TEXT,                          -- nullable until auth adds per-user
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     expires_at TIMESTAMPTZ NOT NULL,
     metadata JSONB NOT NULL DEFAULT '{}'::jsonb
   );
   CREATE INDEX IF NOT EXISTS idx_ui_sessions_expires_at ON ui_sessions (expires_at);
   CREATE INDEX IF NOT EXISTS idx_ui_sessions_kind ON ui_sessions (kind);
   ```
   Also add to `001_initial_schema.sql` so fresh installs include it.
2. Add `UISessionsRepository` in `db/repositories/ui-sessions.ts` with `create`, `getByTokenHash`, `delete`, `deleteByKind`, `deleteExpired`.
3. Rewrite `services/ui-session.ts`:
   - `createSession(kind, ttlMs)`: generate token via `randomBytes(32).toString('base64url')`, compute `tokenHash = sha256(token)`, insert row, return token.
   - `validateSession(token)`: hash the incoming token, query repo, return `null` on miss or expired.
   - `invalidateSession(token)`: hash + delete.
   - `invalidateAllSessions(kind?)`: delete by kind.
4. In-process **read cache** (TTL 60s) on `token_hash → session` using the existing `TTLCache`. Avoids a DB round-trip per request. Cache invalidation on delete.
5. Background cleanup: every 10 min, call `deleteExpired()`. Reuse the existing `.unref()` interval pattern.
6. Migration of existing in-memory sessions on startup is not needed — graceful forced re-login is acceptable (one-time; announce in release notes).

**Test Plan**
- Unit tests for the repository — standard repo-test pattern (`mockAdapter.query.mockResolvedValueOnce`, assert SQL + params).
- Integration tests in `ui-session.test.ts`:
  - Create → validate → invalidate → re-validate returns null
  - Expired token via fake timers returns null
  - `invalidateAllSessions('ui')` leaves mcp sessions intact
- Migration test: run against a fresh Postgres container, assert table exists and indexes present.
- Load test (bench, optional): 1000 validations with cache warm should stay under current latency.

**Risks / Rollback**
- DB outage → all logins fail. Mitigation: the read cache smooths brief outages; fatal failure mode is acceptable (we're a DB-backed app).
- Token hash migration means all existing users log out on deploy. Announce and schedule.
- Rollback: revert migration + service; cache is ephemeral.

**Effort:** L
**Dependencies:** none (C2 ideally first so brute-force window on persistent tokens is closed)

---

## High

### H1. Workflow HTTP node follows redirects blindly (SSRF)

- **Severity:** `high`
- **Files:**
  - `packages/gateway/src/services/workflow/node-executors.ts:613-628`

**Problem**
`isSsrfTarget(url)` is checked once against the initial URL. Default `fetch` follows redirects. A public URL that returns `302 Location: http://169.254.169.254/latest/meta-data/` (AWS metadata) or `http://127.0.0.1:5432/` bypasses the SSRF check entirely.

**Goal**
Redirects are followed manually up to a bounded count, with an SSRF re-check at each hop.

**Implementation**
1. Set `redirect: 'manual'` on the `fetchOptions` passed into `fetch`.
2. Wrap the call in a redirect loop:
   ```ts
   const MAX_REDIRECTS = 5;
   let currentUrl = url;
   let response: Response;
   for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
     if (await isSsrfTarget(currentUrl)) throw new Error('blocked: ssrf target');
     response = await fetch(currentUrl, { ...fetchOptions, redirect: 'manual', signal: abortSignal });
     if (response.status < 300 || response.status >= 400) break;
     const location = response.headers.get('location');
     if (!location) break;
     currentUrl = new URL(location, currentUrl).toString();
     if (hop === MAX_REDIRECTS) throw new Error('too many redirects');
   }
   ```
3. Bundle this as a utility: `packages/gateway/src/utils/safe-fetch.ts` with the SSRF check + redirect loop. Replace the existing callsite and audit `browser-service.ts` (see H2) and `routes/chat.ts :/fetch-url` for adoption.
4. Use `isPrivateUrlAsync` (DNS-resolving variant) not the sync hostname check on every hop — the cache keeps it cheap.

**Test Plan**
- Unit tests for `safeFetch` with a mock server that:
  - Returns 200 immediately (pass-through)
  - Redirects public → public (allowed, up to limit)
  - Redirects public → localhost (blocked at hop 1)
  - Redirects in a 6-deep chain (rejected at hop 5)
  - Redirects with a `Location` that resolves via DNS to 10.x (blocked async)
- Snapshot test: HTTP node output shape unchanged on the happy path.

**Risks / Rollback**
- Users depending on >5 redirects will break. Configurable cap, default 5. Raise via node config if a legit use emerges.

**Effort:** M
**Dependencies:** none (bundle with H2, H7)

---

### H2. BrowserService skips DNS-rebinding check

- **Severity:** `high`
- **Files:**
  - `packages/gateway/src/services/browser-service.ts:13`, `:487-516`

**Problem**
`validateUrl()` uses only the sync `isBlockedUrl()` (hostname-based). DNS rebinding attacks: a domain resolves to a public IP at registration, then repoints to 10.x when the browser actually fetches. Sync check misses this; the async version (`isPrivateUrlAsync`) in `utils/ssrf.ts` is the correct defense.

**Goal**
Browser navigation and every sub-request it triggers pass both the sync hostname check AND the DNS-resolving check.

**Implementation**
1. Make `validateUrl()` async; await `isPrivateUrlAsync(url)` after the sync check.
2. Propagate async up: `navigate()`, `screenshot()`, and any other entry points that feed URLs to Puppeteer.
3. Enable Puppeteer request interception for every browser session: `await page.setRequestInterception(true)`; in the handler, run `validateUrl` on every sub-request's URL. Block (`request.abort('blockedbyclient')`) if denied.
4. Optional hardening: set `ignoreHTTPSErrors: false` (should already be the default), disable `accessibility.legacy` preferences that could enable file://.

**Test Plan**
- Unit test: URL with public hostname but private resolved IP is rejected.
- Playwright/Puppeteer integration test (if feasible in CI): page that issues an XHR to 127.0.0.1 — intercept fires, request aborted, page state reflects failure.

**Risks / Rollback**
- Request interception adds overhead (~5-15% on busy pages). Acceptable for the security gain.
- Legitimate workflows screenshot-ing local dev servers fail. Document the behavior; add an `allowPrivateHosts: boolean` flag on the browser service config, default false, overridable by admin.

**Effort:** M
**Dependencies:** shares `safe-fetch` utility with H1 (bundle PRs)

---

### H3. `safeVmEval` sandbox prototype-chain leak

- **Severity:** `high`
- **Files:**
  - `packages/gateway/src/services/workflow/node-executors.ts:52-68`, `:482-491`

**Problem**
`safeVmEval` spreads `context` (including raw `nodeOutputs[*].output` values — typically JSON from HTTP responses) into the sandbox globals. Node's `vm` module shadows `Function`/`eval`/`process`, but cross-realm objects still carry their outer-realm prototype chain. A malicious upstream HTTP response body can define getters or `Symbol.toPrimitive` that execute in the outer realm when the workflow expression touches them — effectively escaping the VM.

**Goal**
Values crossing into the sandbox cannot run outer-realm code on access.

**Implementation** (pick one; prefer option A for faster ship)
- **Option A (structured clone, ship this first):**
  1. Before calling `createContext`, deep-clone each value: `safeCtx[k] = structuredClone(v)`. `structuredClone` rejects functions and strips getters (throws on non-cloneable — we catch and reject with a clear error).
  2. Accept the performance cost (clone on every node execution). Benchmark: for typical payloads (<100KB), clone overhead is <1ms.
- **Option B (isolated-vm, deeper fix):**
  1. Replace `vm` module with `isolated-vm` — a true separate V8 isolate, no cross-realm leak possible.
  2. Larger rewrite; memory-per-isolate cost (~5MB); worth planning but may not fit a single PR.

Ship Option A in this PR; file a follow-up for Option B if perf allows and security posture justifies.

**Test Plan**
- Attack regression test: construct a node output object with a getter that throws if accessed in the wrong realm; verify the sandbox rejects or the clone sterilizes it.
- Normal operation: existing transformer-node tests pass.
- Benchmark: median execution time of a transformer node before/after — fail if > 20% regression on typical payload.

**Risks / Rollback**
- `structuredClone` fails on non-serializable values (functions, symbols with strings). Wrap in try/catch, return a clear error. Document: "Transformer inputs must be JSON-serializable."
- Rollback: revert the clone wrapper.

**Effort:** M (Option A) / XL (Option B)
**Dependencies:** none

---

### H4. `invalidateAllSessions()` not fired on all password-state transitions

- **Severity:** `high`
- **Files:**
  - `packages/gateway/src/services/ui-session.ts:115-123`
  - `packages/gateway/src/routes/ui-auth.ts` (password set/change/remove)

**Problem**
`removePassword()` invalidates sessions, but if the stored password hash is wiped via another path (a migration, an admin DB edit, a factory-reset script), existing tokens remain valid forever — `validateSession` doesn't re-check `isPasswordConfigured()`.

**Goal**
Session validity is tied to the current auth state. Any state transition that changes the hash invalidates every session.

**Implementation**
1. Add `hashCreatedAt: number` to the settings row that stores the password hash (timestamp of last change).
2. Store `createdAt` on the session alongside token/expires.
3. In `validateSession(token)`, after fetching the session, load the current `hashCreatedAt` and reject the session if `session.createdAt < hashCreatedAt`.
4. The `ui_sessions` persistence from C4 makes this cheap (single row lookup or cached).
5. Add explicit invalidation on any admin-initiated auth reset endpoint (factory reset, migration runner that touches settings).

**Test Plan**
- Integration test: create session → rotate password → old token rejected.
- Unit test: `validateSession` with a session older than `hashCreatedAt` returns null.
- Regression: existing tests still pass.

**Risks / Rollback**
- Adds one row lookup per validate unless cached; measure. Cache in TTLCache with 30s TTL on `hashCreatedAt` read.

**Effort:** S
**Dependencies:** C4 (persistent sessions) strongly preferred first

---

### H5. Claw `executeCycle` emits `cycle.start` before the concurrency guard

- **Severity:** `high`
- **Files:**
  - `packages/gateway/src/services/claw-manager.ts:435-558`, `:611-680`

**Problem**
The `cycleInProgress` boolean guard lives inside `executeCycle` but the check happens AFTER `emitEvent('claw.cycle.start', ...)`. When an event-mode subscriber fires `executeCycle` concurrently with a still-scheduled `setTimeout`, the second call can emit `cycle.start` and then early-return `null`, leaving downstream listeners with a "ghost" cycle that never produces a corresponding `cycle.complete`. Metrics, audit, WebSocket live views all desync.

**Goal**
Either `cycle.start` fires only for runs that will actually execute, or `cycle.aborted`/`cycle.skipped` always pairs with `cycle.start`.

**Implementation** (pick one; prefer option A)
- **Option A:** Move the `cycleInProgress` check above the emit. Before emitting `cycle.start`, check the flag. If in progress, emit `cycle.skipped` with reason `concurrent` and return null.
- **Option B:** Replace the boolean with a proper mutex — queue pending calls on a promise, or use `async-mutex`. More invasive but eliminates the race entirely.

Ship A; consider B in a follow-up if we see further concurrency issues.

**Test Plan**
- Targeted test `claw-manager.test.ts`: kick two `executeCycle` calls in parallel with fake timers. Assert exactly one `cycle.start` emitted for the executing call, one `cycle.skipped` for the loser.
- Regression: existing claw tests pass.
- Long-run integration: run a claw for 100 cycles in event mode with concurrent triggers — no `start` without matching `complete` or `skipped`.

**Risks / Rollback**
- Listeners that assume `cycle.start` always implies execution will change behavior. Audit consumers (WS handlers, audit log, metrics) and update to handle `cycle.skipped`.

**Effort:** M
**Dependencies:** none

---

### H6. Fleet pause/stop doesn't await in-flight cycle

- **Severity:** `high`
- **Files:**
  - `packages/gateway/src/services/fleet-manager.ts:530-620`, `pauseFleet`/`stopFleet`

**Problem**
`pauseFleet`/`stopFleet` set state to `stopped` and await `persistSession`, but an in-flight `runCycle` (concurrent workers mid-task) can continue writing to `sharedContext` AFTER persistence completes. Result: persisted state is stale relative to in-memory state at stop time.

**Goal**
Stop/pause is a true drain point — when it returns, no further writes happen.

**Implementation**
1. Track the current cycle promise on the managed fleet: `managed.currentCyclePromise: Promise<void> | null`. Set at the start of `runCycle`, clear in its finally.
2. In `pauseFleet`/`stopFleet`:
   - Flip state to `stopping` (not `stopped`) immediately to prevent new cycles.
   - `await managed.currentCyclePromise` (with a bounded timeout — e.g., 30s — to avoid hanging forever; on timeout, log a warning and persist anyway).
   - Flip state to final (`paused`/`stopped`).
   - Call `persistSession`.
3. On worker completion, check `managed.state` — if `stopping`/`stopped`, skip shared-context merge and log.

**Test Plan**
- Integration test in `fleet-manager.test.ts`: start a fleet with a long-running task (simulated via controlled Promise), call `stopFleet` mid-cycle, assert `stopFleet` resolves after the task finishes and `sharedContext` reflects the final state.
- Regression: existing 68 tests still pass.

**Risks / Rollback**
- `stopFleet` becomes slower (now waits for drain). Acceptable — correct. Bound the wait at 30s.

**Effort:** M
**Dependencies:** H5 same pattern — consider sharing the mutex/drain helper between ClawManager and FleetManager.

---

### H7. Workflow HTTP node missing request-body size cap

- **Severity:** `high`
- **Files:**
  - `packages/gateway/src/services/workflow/node-executors.ts:619-628`

**Problem**
`maxResponseSize` caps inbound. Outbound `data.body` is passed to `fetch` directly after template resolution. A templated body can expand massively (e.g., `{{node.output}}` where output is a 100MB HTTP response chained from an earlier node) — the outbound fetch then stalls or OOMs the gateway, and DoSes any upstream service being called.

**Goal**
Outbound body size is capped and reported as a user-visible error, not a silent stall.

**Implementation**
1. After template resolution, compute `Buffer.byteLength(resolvedBody, 'utf8')`.
2. Reject if it exceeds `data.maxRequestBodySize ?? DEFAULT_MAX_REQUEST_BODY (e.g., 10 * 1024 * 1024)`, with a clear error: `"Request body size (X bytes) exceeds maximum (Y bytes). Consider streaming or chunking."`
3. Surface the error through the normal node failure path so the workflow's error-handler node can catch it.

**Test Plan**
- Unit test: template resolves to 11MB body → node fails with the right error. 9MB body passes.
- Happy-path regression tests unchanged.

**Risks / Rollback**
- Workflows that currently rely on large bodies fail. Expose the cap as a node config; document.

**Effort:** S
**Dependencies:** none (bundle with H1)

---

## Medium

### M1. God files: ClawsPage (2972 LoC), FleetPage (2368 LoC)

- **Severity:** `medium`
- **Files:**
  - `packages/ui/src/pages/ClawsPage.tsx` (2972 lines)
  - `packages/ui/src/pages/FleetPage.tsx` (2368 lines)

**Problem**
Both pages mix layout, data fetching, WebSocket subscription, forms, editors, detail panels, bulk-action logic, and search/filter state in a single file. Rendering performance degrades (every state change re-renders everything), code review is painful, test isolation is impossible.

**Goal**
Each page reduces to a thin shell routing between sub-components, each under ~400 LoC, independently testable.

**Implementation (ClawsPage example)**
1. Create `packages/ui/src/pages/claws/` directory.
2. Extract sub-components:
   - `ClawList.tsx` — left panel list + search/filter
   - `ClawDetailPanel.tsx` — right panel wrapper
   - `ClawDetailTabs/` — each tab as its own file (Overview, History, Audit, Directives, Working Memory, Logs, Settings, Stats)
   - `ClawEditor.tsx` — create/edit form
   - `ClawDirectiveEditor.tsx` — `.claw/*` file editors
   - `ClawWebSocketSubscription.ts` — custom hook wrapping WS reconnect + per-claw message routing
   - `hooks/useClaws.ts` — data fetching + cache invalidation
   - `hooks/useClawAuditLog.ts` — audit-tab data
3. Move inline `authedFetch` into the shared `api` module (see callout). Fix the only two non-standard callers: `ClawsPage.tsx:49-59` and `api/endpoints/extensions.ts`.
4. `ClawsPage.tsx` shrinks to:
   ```tsx
   export default function ClawsPage() {
     const [selected, setSelected] = useState<string | null>(null);
     return (
       <Split>
         <ClawList selectedId={selected} onSelect={setSelected} />
         {selected && <ClawDetailPanel clawId={selected} />}
       </Split>
     );
   }
   ```
5. FleetPage mirror-image split into `packages/ui/src/pages/fleet/*`.

**Test Plan**
- Move existing tests alongside each new component.
- Add unit tests for the new hooks (`useClaws`, `useClawAuditLog`) — mock `fetch` via `msw` or existing test harness.
- Visual regression: take a full-page screenshot before and after — should be pixel-identical.

**Risks / Rollback**
- Mechanical refactor with no behavior change. Risk is in missed state dependencies; mitigation is small, reviewable commits per extraction.

**Effort:** L per page (so ClawsPage + FleetPage = two PRs)
**Dependencies:** none

---

### M2. `Math.random()` suffix for name-collision retry

- **Severity:** `medium`
- **File:** `packages/gateway/src/routes/souls-deploy.ts:196-201`

**Problem**
On duplicate-name error, retry appends a 4-digit `Math.random()`-derived suffix, up to N attempts. Birthday paradox hits ~40 names → collisions → exhausted attempts → user sees "please try a different name" even though only dozens exist.

**Goal**
Deterministic next-available suffix with negligible retry overhead.

**Implementation**
Pick the cleaner of:
- **Option A:** Query `SELECT MAX(suffix) FROM souls WHERE base_name = $1` (or regex-extract from name) and use `max + 1`.
- **Option B:** `randomBytes(3).toString('hex')` (6 hex chars, 16M space, collisions practically zero even at thousands of souls).

Option B is one line; ship it.

**Test Plan**
- Deploy 100 souls with the same base name, assert all succeed on first attempt.
- Assert suffix format (6 hex chars).

**Effort:** S
**Dependencies:** none

---

### M3. Unused `escapeHtml` in WS server — dead or missing guard

- **Severity:** `medium`
- **File:** `packages/gateway/src/ws/server.ts:32-40`

**Problem**
`escapeHtml` is declared at top-level with no callers. Either vestigial from a removed feature (dead code) or a guard that was meant to wrap WS responses that now isn't — latent XSS risk.

**Goal**
Confirm one or the other; act accordingly.

**Implementation**
1. `rtk grep -rn escapeHtml packages/gateway/src/` to confirm no callers (grep gave us files_with_matches; run content-mode).
2. Scan `ws/server.ts` for any response path that renders user-supplied strings into HTML — if none (WS sends JSON, not HTML), delete `escapeHtml`.
3. If any HTML-rendering path exists, wire `escapeHtml` in and add a test.

**Test Plan**
- If deleted: typecheck + existing tests pass (no callers).
- If wired: targeted unit test with `<script>alert(1)</script>` input.

**Effort:** S
**Dependencies:** none

---

### M4. Probabilistic pulse-log cleanup via `Math.random() < 0.05`

- **Severity:** `medium`
- **File:** `packages/gateway/src/autonomy/engine.ts:611-614`

**Problem**
Cleanup fires with 5% probability on each pulse. Low pulse traffic → days without cleanup → unbounded table growth. High pulse traffic → cleanup steals cycles from actual work. Also non-deterministic in tests.

**Goal**
Deterministic schedule matching the rest of the codebase.

**Implementation**
1. Use the existing daily-timer pattern from `ClawManager.runCleanup` — `setInterval(cleanup, 24 * MS_PER_HOUR).unref()`.
2. Optional: keep a one-time cleanup on engine boot so operators can force a sweep via restart.

**Test Plan**
- Unit test with fake timers: advance 24h → cleanup called once.
- Remove any random-mocked test paths that relied on the probabilistic behavior.

**Effort:** S
**Dependencies:** none

---

### M5. `agent_messages.findConversation` OR-query can't use compound indexes

- **Severity:** `medium`
- **Files:**
  - `packages/gateway/src/db/repositories/agent-messages.ts:135-145`
  - `packages/gateway/src/db/migrations/postgres/011_agent_souls.sql:55-58`

**Problem**
The query `WHERE (from = $1 AND to = $2) OR (from = $2 AND to = $1)` with existing single-column-ish indexes forces bitmap OR or a seq scan at scale. No normalized pair index exists.

**Goal**
A single index the planner can use for both directions of a conversation pair.

**Implementation**
1. New migration:
   ```sql
   CREATE INDEX IF NOT EXISTS idx_agent_messages_pair
   ON agent_messages (LEAST(from_agent_id, to_agent_id), GREATEST(from_agent_id, to_agent_id), created_at DESC);
   ```
2. Rewrite the query to use the normalized order:
   ```sql
   WHERE LEAST(from_agent_id, to_agent_id) = LEAST($1,$2)
     AND GREATEST(from_agent_id, to_agent_id) = GREATEST($1,$2)
   ORDER BY created_at DESC
   ```
3. Alternative (if we'd rather not depend on function-on-column indexes): rewrite as `UNION ALL` of two single-side queries, each backed by existing indexes.

**Test Plan**
- Explain plan before and after on a DB with 1M rows — should switch from seq scan / bitmap to index scan.
- Repo-layer unit tests: same input/output contract.

**Risks / Rollback**
- Function-on-column index is immutable and must match query shape exactly. If the query and index drift, planner silently falls back to seq scan. Prefer the `UNION ALL` approach if concerned.

**Effort:** M
**Dependencies:** none (schedule the migration during off-peak)

---

### M6. Claw inbox race — new messages dropped during cycle execution

- **Severity:** `medium`
- **File:** `packages/gateway/src/services/claw-manager.ts:307-318`, `:469-481`

**Problem**
`sendMessage` pushes to `managed.session.inbox`. `executeCycle` snapshots then clears the inbox before running the cycle and restores on throw. If a new message arrives between snapshot and clear (separated by microtasks via `appendToInbox`/await), the new message is silently dropped on success — snapshot missed it; clear removed it.

**Goal**
No message is lost regardless of arrival timing.

**Implementation**
1. Merge restored/current arrays: on restore (throw path), do `managed.session.inbox = [...managed.session.inbox, ...snapshotNotYetCleared]`.
2. Or, simpler: delay the clear until after `cycle.complete`:
   ```ts
   const snapshot = [...managed.session.inbox];
   try {
     await runCycle(snapshot);
     managed.session.inbox = managed.session.inbox.slice(snapshot.length); // remove only what we processed
   } catch (...) {
     // nothing to restore
   }
   ```

**Test Plan**
- Targeted test: kick `executeCycle`, send a message during the await, assert it's processed in the next cycle (or included in this one, depending on the chosen semantic).

**Risks / Rollback**
- Double-processing if the semantic is misunderstood. Write the test FIRST to pin the expected behavior.

**Effort:** S
**Dependencies:** none (natural companion to H5)

---

### M7. WS `_authCleanupTimer` runs on module import, not lifecycle

- **Severity:** `medium`
- **File:** `packages/gateway/src/ws/server.ts:53-62`

**Problem**
Top-level `setInterval` for `authAttempts` cleanup runs on module import. `.unref()` means it doesn't block process exit, but tests importing the module create stray timers and vitest occasionally warns. Test isolation breaks if a test clears `authAttempts` and the cleanup purges it mid-test.

**Goal**
Auth cleanup lives in the `WSGateway` instance lifecycle like `heartbeatTimer` and `cleanupTimer` already do.

**Implementation**
1. Move `setInterval` inside `WSGateway.start()` and store on `this._authCleanupTimer`.
2. Add `clearInterval(this._authCleanupTimer)` in `stop()`.
3. Remove the module-level declaration.

**Test Plan**
- Existing tests should pass and stop warning about stray timers.
- Add an integration test: start gateway, stop it, assert no active timers (`process._getActiveHandles().length === 0` or equivalent).

**Effort:** S
**Dependencies:** C2 extracts login-throttle — do C2 first, then M7 can reuse the extracted helper's lifecycle.

---

### M8. Transformer/HTTP `|| N` timeout fallback treats 0 as undefined

- **Severity:** `medium`
- **File:** `packages/gateway/src/services/workflow/node-executors.ts:490`, `:616`

**Problem**
`const vmTimeout = (node.data).timeoutMs || 5000;` — users setting `timeoutMs: 0` (intended as "disable" by some) get 5000ms silently. Same at 616 for HTTP (default 30000). Also error messages don't surface the timeout value that fired.

**Goal**
`??` is the correct semantic; errors are explicit about the timeout that fired.

**Implementation**
1. Replace `||` with `??` at both sites.
2. If `timeoutMs` should reject 0/negative, add to the zod schema: `timeoutMs: z.number().int().min(1).max(300000).optional()`.
3. Surface the timeout in the error: `"Transformer timed out after ${vmTimeout}ms"`.

**Test Plan**
- Unit test: `timeoutMs: undefined` → defaults used; `timeoutMs: 1000` → 1s used; `timeoutMs: 0` → rejected by schema with a clear validation error.

**Effort:** S
**Dependencies:** none

---

## Low

### L1. ClawManager conversation-lookup failure logged at `debug`

- **Severity:** `low`
- **File:** `packages/gateway/src/services/claw-manager.ts:797-820`

**Problem**
`ensureConversationRow` logs at `debug` on DB failure. Under default log level (`info`), the failure is invisible — users lose chat history for the claw until restart with no warning.

**Goal**
Operators can see transient DB failures at default log level.

**Implementation**
1. Bump to `log.warn` for failed `create` (second catch).
2. Keep `log.debug` on the benign "not found" path in `getById` (not a failure).

**Effort:** S
**Dependencies:** none

---

### L2. `scaffoldClawDir` does 4 sync disk I/Os on startClaw hot path

- **Severity:** `low`
- **File:** `packages/gateway/src/services/claw-manager.ts:176`, `:826-920`

**Problem**
Four sequential `readSessionWorkspaceFile`/`writeSessionWorkspaceFile` calls during `startClaw()`. Local dev: fine. Production: ~20-50ms blocking the event loop. Not a bug, but an easy win for responsiveness.

**Goal**
Scaffolding runs in parallel; startClaw completes ~4× faster for its I/O portion.

**Implementation**
1. Add a `createIfMissing: boolean` option to `writeSessionWorkspaceFile`.
2. Replace the four sequential calls with `await Promise.all([...])` of four idempotent creates.

**Test Plan**
- Existing claw-manager tests pass.
- Benchmark: measure startClaw before/after; expect ~75% reduction in scaffold time.

**Effort:** S
**Dependencies:** none

---

### L3. `checkPermission` is a dead export

- **Severity:** `low`
- **File:** `packages/gateway/src/services/extension-permissions.ts:144-160`

**Problem**
Function exists with no callers. See C1 — it's the intended gate but never wired.

**Goal**
Either wire it (C1) or delete it.

**Implementation**
1. Land C1 first — this wires `checkPermission`.
2. After C1 ships, verify no alternative "half-implemented" permission check still exists. If one does, remove it.

**Effort:** S (dependent)
**Dependencies:** **C1** — do C1, this becomes trivial follow-up.

---

## What's already solid

These are genuinely impressive pieces of the codebase; don't touch them in the cleanup cycle.

- **SSRF shared utility** (`packages/gateway/src/utils/ssrf.ts`) — sync + async check with DNS-resolution caching. The H1/H2 fixes are about *using* it everywhere, not replacing it.
- **Fleet cascade & isolation design** — `failDependentTasks`, `structuredClone(sharedContext)` per worker snapshot. Thoughtful concurrency work most projects this size don't pull off.
- **Claw adaptive scheduling** — `CONTINUOUS_MIN/MAX/IDLE_DELAY_MS` pivoting on last-cycle outcome. Many autonomous runners hammer LLMs with no backoff; this one doesn't.
- **Performance migration `027`** — `idx_fleet_tasks_status_priority`, `idx_chat_history_chat_id_created`, partial index on `workflow_executions WHERE status IN ('running','paused')`. Indexes clearly chosen after reading real query plans.
- **Centralized `generateId()` with `randomBytes`** — replaced 23+ `Math.random()` sites across the codebase per MEMORY.md. The stragglers flagged above (C3, M2) are the last holdouts worth finishing.
- **`apiResponse` / `apiError` / `ERROR_CODES` + zod middleware** — remarkably consistent route code. A reviewer can scan a new route and spot missing validation instantly.

---

## How to use this document

- Pick a single item per PR; match the branch name to the ID (`fix/c2-login-rate-limit`).
- Paste the item's content into the PR description with any clarifications.
- Update the Status column below as items ship (or track externally).
- Re-review after ~10 items ship — the landscape will have shifted and priorities may change.

### Status Tracker

| ID  | Title                                                             | Status    |
|-----|-------------------------------------------------------------------|-----------|
| C1  | Extension sandbox permission bypass                               | planned   |
| C2  | No rate-limit on UI login                                         | planned   |
| C3  | Signal registration ID uses Math.random()                         | planned   |
| C4  | UI sessions are in-memory only                                    | planned   |
| H1  | Workflow HTTP node follows redirects blindly                      | done      |
| H2  | BrowserService skips DNS-rebinding check                          | done      |
| H3  | safeVmEval sandbox prototype-chain leak                           | done      |
| H4  | invalidateAllSessions not fired on all password-state transitions | planned   |
| H5  | Claw executeCycle emits cycle.start before concurrency guard      | done      |
| H6  | Fleet pause/stop doesn't await in-flight cycle                    | done      |
| H7  | Workflow HTTP node missing request-body size cap                  | done      |
| M1  | God files: ClawsPage / FleetPage                                  | planned   |
| M2  | Math.random suffix for name-collision retry                       | planned   |
| M3  | Unused escapeHtml in WS server                                    | planned   |
| M4  | Probabilistic pulse-log cleanup                                   | planned   |
| M5  | agent_messages.findConversation OR-query                          | planned   |
| M6  | Claw inbox race                                                   | planned   |
| M7  | WS _authCleanupTimer runs on module import                        | planned   |
| M8  | Transformer/HTTP \|\| N timeout fallback                          | planned   |
| L1  | ClawManager conversation-lookup logged at debug                   | planned   |
| L2  | scaffoldClawDir does 4 sync disk I/Os on startClaw                | planned   |
| L3  | checkPermission is a dead export                                  | planned   |
