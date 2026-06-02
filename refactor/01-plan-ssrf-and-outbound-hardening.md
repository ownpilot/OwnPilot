# Plan 01 — SSRF & Outbound Network Hardening

**Priority:** P0
**Effort:** M (2–3 days)
**Risk:** Medium
**Depends on:** none
**Source reports:** `CODE_REVIEW.md` SSRF-001/002/003, `refactor.md` §3.4, `refactor_plan.md` H1/H2/H7

---

## Context

Outbound HTTP from the gateway is a primary SSRF surface. The current
implementation has three confirmed bypasses in `packages/gateway/src/utils/ssrf.ts`
plus a structurally broken `safe-fetch.ts` whose body-size cap is non-functional
because the constant is referenced before it exists in scope, and whose
`clearTimeout` call crashes on every invocation. This is the **largest single
source of avoidable severity** in the codebase — every workflow HTTP node,
browser navigation, and channel webhook that touches an untrusted URL is
vulnerable.

Beyond the three concrete bypasses, the SSRF guard is inconsistently applied:
the workflow HTTP node calls it once on the initial URL but `fetch` follows
redirects by default, so a public URL that 302s to `127.0.0.1` walks right
through. The browser service uses only the sync hostname check, missing
DNS-rebinding attacks. The workflow HTTP node also lacks an outbound body
size cap, allowing a templated body to expand to hundreds of MB and OOM the
gateway.

This plan bundles all four fixes into a single coordinated PR because the
bypass classes overlap and tests for one verify the others.

## Scope

- `packages/gateway/src/utils/safe-fetch.ts` (lines 17–22, 48, 55)
- `packages/gateway/src/utils/ssrf.ts` (lines 36, 38–39)
- `packages/gateway/src/services/workflow/node-executors.ts` (lines 613–628)
- `packages/gateway/src/services/browser-service.ts` (lines 13, 487–516)
- `packages/gateway/src/utils/safe-fetch.test.ts` (existing; expand)
- `packages/gateway/src/utils/ssrf.test.ts` (existing; expand)

## Goals

1. The async SSRF guard rejects `127.1`, `127.2`, …, `127.255` (single-octet
   shorthand) and any zero-padded octet in the 172.16.0.0/12 range.
2. The `safeFetch` utility follows redirects manually, re-checking each hop
   against the SSRF guard, capped at 5 hops.
3. The `safeFetch` utility's `maxRequestBodySize` cap is functional — outbound
   bodies larger than the cap are rejected with a clear error before `fetch` is
   called, and `clearTimeout` no longer crashes on the happy path.
4. The browser service uses the async DNS-resolving check on every navigation
   and every sub-request, with Puppeteer request interception enabled.
5. All four fixes have unit + integration tests.

## Implementation Steps

### Step 1 — Fix `safe-fetch.ts` initialization order and timeout handling

In `packages/gateway/src/utils/safe-fetch.ts`:

- Move `const DEFAULT_MAX_REQUEST_BODY_SIZE = 10 * 1024 * 1024;` (and the other
  defaults) above the function declaration so the destructuring sees a defined
  value.
- Replace the `.unref?.()` chain on `timeout` with a properly-scoped
  `NodeJS.Timeout` declaration created via `setTimeout(() => abort(), timeoutMs)`.
  Store the handle in a local `let timer: NodeJS.Timeout | undefined` so the
  `finally` block can call `clearTimeout(timer)` unconditionally.
- Make `maxRequestBodySize` a required argument of the `options` type
  (with a default value) so the destructured value is always defined.

### Step 2 — Add single-octet & zero-padded bypasses to `ssrf.ts`

In `packages/gateway/src/utils/ssrf.ts`:

- Add a check: if the hostname matches `/^127\.\d+$/`, return `true` (blocks
  `127.1` through `127.255`).
- Normalize each octet of IPv4 addresses with `parseInt(octet, 10)` so that
  `Number("016")` is `16`, not `14`. The cleanest fix is to extract octets
  with a regex that only captures the numeric content and converts via
  `parseInt`; the existing 172.16.0.0/12 and 10.0.0.0/8 checks then work
  correctly.
- Apply the same normalization to the `0x` and `0[0-7]+` octal forms.

### Step 3 — Manual redirect loop in `safeFetch`

Replace the current `fetch(url, fetchOptions)` call with a bounded redirect
loop:

```ts
const MAX_REDIRECTS = 5;
let currentUrl = url;
for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
  if (await isPrivateUrlAsync(currentUrl)) {
    throw new SafeFetchError('ssrf_target', currentUrl, hop);
  }
  response = await fetch(currentUrl, { ...fetchOptions, redirect: 'manual' });
  if (response.status < 300 || response.status >= 400) break;
  const location = response.headers.get('location');
  if (!location) break;
  currentUrl = new URL(location, currentUrl).toString();
  if (hop === MAX_REDIRECTS) {
    throw new SafeFetchError('too_many_redirects', currentUrl, hop);
  }
}
```

Use the async `isPrivateUrlAsync` (DNS-resolving, cached) on every hop — the
cache makes it cheap.

### Step 4 — Outbound body size cap

Before the redirect loop, compute the serialized body size:

```ts
let bodyBytes = 0;
if (options.body !== undefined) {
  bodyBytes = Buffer.byteLength(
    typeof options.body === 'string' ? options.body : JSON.stringify(options.body),
    'utf8'
  );
  if (bodyBytes > maxRequestBodySize) {
    throw new SafeFetchError('body_too_large', currentUrl, bodyBytes);
  }
}
```

Add `DEFAULT_MAX_REQUEST_BODY_SIZE` (10 MB) to the exported constants. Surface
the cap as an option to allow workflow HTTP nodes to override per-call.

### Step 5 — Wire `safeFetch` into the workflow HTTP node

In `packages/gateway/src/services/workflow/node-executors.ts` at the HTTP
executor (~line 613):

- Replace the raw `fetch` call with `safeFetch(url, { ... })` from the new
  utility.
- Pass `maxRequestBodySize` from the node config (default 10 MB, override up
  to 100 MB via a node-level setting).
- On `SafeFetchError`, return a structured error result that the workflow's
  error-handler node can catch (`code: 'ssrf_target' | 'too_many_redirects' | 'body_too_large'`).

### Step 6 — Wire `safeFetch` into the browser service

In `packages/gateway/src/services/browser-service.ts`:

- Make `validateUrl()` async and await `isPrivateUrlAsync` after the sync check.
- Propagate async up: `navigate()`, `screenshot()`, and `pdf()` all become
  async at the boundary (they already are; just thread the await through).
- Enable Puppeteer request interception: `await page.setRequestInterception(true)`;
  in the handler, call `validateUrl` on every sub-request URL and abort with
  `request.abort('blockedbyclient')` if denied.
- Add an `allowPrivateHosts: boolean` config flag (default false) so an admin
  can opt-in for legitimate dev-server scenarios.

## Acceptance Criteria

1. `safeFetch('http://127.1/')` throws `SafeFetchError('ssrf_target', ...)`.
2. `safeFetch('http://172.016.0.1/')` throws `SafeFetchError('ssrf_target', ...)`.
3. `safeFetch` with a body of 11 MB throws `SafeFetchError('body_too_large', ...)`
   _before_ the first `fetch` call (verifiable by spying on the global `fetch`).
4. `safeFetch` does not throw `clearTimeout(undefined)` on the happy path.
5. A mock server that 302s from a public URL to `http://127.0.0.1/` results in
   `SafeFetchError('ssrf_target')` raised on hop 1, not a leaked response.
6. A mock server that 302s through 6 public URLs raises
   `SafeFetchError('too_many_redirects')` on hop 5.
7. Puppeteer integration test (CI-included, marked slow): a page that issues
   an XHR to `127.0.0.1` is intercepted and the request is aborted.
8. Workflow HTTP node exposed config knob for body cap is documented in
   `docs/CUSTOM_TOOLS.md` (or the equivalent workflow node reference).

## Test Plan

- **Unit tests in `safe-fetch.test.ts`:** all seven acceptance criteria above
  using a mocked `global.fetch` and a local `node:http` test server.
- **Unit tests in `ssrf.test.ts`:** add cases for `127.1`, `127.255`,
  `172.016.0.0`, `172.017.0.0`, `10.00.0.0`. Confirm sync and async variants
  both block.
- **Integration test in `workflow/node-executors.test.ts`:** HTTP node that
  templates a body referencing a 50 MB upstream node output fails with
  `body_too_large` rather than OOMing.
- **Puppeteer test in `browser-service.test.ts`:** page navigation to a
  URL that returns HTML with a script-tag XHR to 127.0.0.1 — assert the
  XHR is aborted and `page.on('requestfailed')` fires with `errorText ===
'net::ERR_FAILED'` (or the closest equivalent in the headless variant).

## Risks & Rollback

- **Risk:** The async SSRF check introduces a small DNS-resolution latency on
  every fetch. Mitigation: the existing cache (`utils/ssrf.ts` already caches
  resolved hostnames) keeps subsequent lookups under 1 ms.
- **Risk:** The 5-redirect cap breaks users depending on long redirect chains.
  Mitigation: expose `maxRedirects` in the node config; default value is 5.
- **Risk:** Browser interception adds 5–15% overhead on busy pages. Mitigation:
  gate interception behind the existing `enableRequestInterception` config
  flag (default true for security posture, can be disabled per-session).
- **Rollback:** The plan introduces no schema changes. Revert the commits in
  reverse order: Step 6 → Step 5 → Step 4 → Step 3 → Step 2 → Step 1. The
  `safeFetch` utility is additive; if it misbehaves, callers can fall back
  to the existing direct `fetch` calls.

## Out of Scope

- Replacing `node-fetch` / native `fetch` with a hardened HTTP client
  library. Native `fetch` in Node 22 is sufficient when wrapped correctly.
- IPv6 SSRF bypass classes. Audit found none; flagged for a follow-up audit.
- Rate limiting outbound HTTP at the gateway level. Belongs to Plan 16
  (CI/CD & DX) as part of a broader gateway rate-limit policy.
