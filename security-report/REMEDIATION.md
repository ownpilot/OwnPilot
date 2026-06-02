# Security Remediation Log

**Date:** 2026-06-02
**Scope:** Fixes for the Critical + High findings from `SECURITY-REPORT.md` (scan 2026-06-01).
**Verification:** `@ownpilot/core` + `@ownpilot/gateway` typecheck clean; 1,720 tests pass across all touched suites (incl. new regressions). core full suite 9,377 pass.

---

## Fixed — Critical

### RCE-001 — VM sandbox escape (3 sinks)
Root cause: host-realm objects injected into a `node:vm` context expose the host
`Function` constructor via `.constructor`, which `codeGeneration:{strings:false}`
does **not** disable. Empirically reproduced on Node v24:
`Math.max['constructo'+'r']('return process')()` returned the host `process`.

Fix pattern (canonical): never inject host-realm values; pass host fns under one
`__host` global + data as `__argsJson`, run a bootstrap Script that rebuilds
context-realm wrappers / `JSON.parse`s data into the context realm, then
`delete globalThis.__host`. The context's own intrinsics (JSON/Math/Date/…) are
used instead — their Function IS blocked.

- `packages/gateway/src/services/extension/sandbox.ts` — worker sandbox (extensions, `claw_execute`)
- `packages/gateway/src/tools/claw/lifecycle-executors.ts` — `claw_create_tool` (ran in main thread)
- `packages/gateway/src/services/workflow/executors/utils.ts` — `safeVmEval` (was `structuredClone` → host-realm leak; verifier under-rated this as RCE-003 Medium, but it was escapable)
- `packages/core/src/sandbox/code-validator.ts` — split-`constructor` regexes hardened (defense-in-depth)

### RCE-002 — Workflow code/expression template injection
Upstream node output (HTTP/LLM/webhook data) was spliced **raw** into code before
execution. Fix: new `resolveCodeTemplates` JS-literal-encodes every substituted
value, so data can never break into a code position.

- `packages/gateway/src/services/workflow/template-resolver.ts` — new `resolveCodeTemplates`
- `packages/gateway/src/services/workflow/executors/tool-llm-code.ts` — code node + transformer use it

**Regression tests:** `packages/gateway/src/services/workflow/executors/utils.test.ts` (new — live escape attempts), `packages/core/src/sandbox/code-validator.test.ts` (split-string cases).

---

## Fixed — High

| Finding | File(s) | Fix |
|---|---|---|
| EXPOSE-004 / TS-002 (weak PRNG) | `channels/service-impl.ts` | DM pairing code `Math.random()` → `crypto.randomInt(100000, 1000000)` |
| SSRF-001 | `tools/overrides/image.ts` | Provider-returned image URLs fetched via `safeFetch` (SSRF guard) |
| PATH-001 | `routes/extensions/install.ts` | `/install` path confined to `getAllScanDirectories()` via `isWithinDirectory` (+ rejection test) |
| EXPOSE-002 | `routes/database/shared.ts` | `system_settings` (gateway API keys, JWT secret, pairing keys) removed from `EXPORT_TABLES` → not exportable/CSV/importable |
| CRYPTO-004 | `core/credentials/index.ts` | Legacy no-salt entries lazily re-encrypted to PBKDF2+salt on read (`migrateLegacyEntryIfNeeded`) |
| DOCK-004 / IAC-002 | `docker-compose.yml` | MQTT broker ports bound to `127.0.0.1` (no LAN exposure; broker still ships `allow_anonymous true`) |
| BIZ-001 | `services/agent/runner-utils.ts` | Pre-spend budget check added to `executeAgentPipeline` (shared chokepoint for Claw/Soul/Subagent), fail-open, new `BudgetExceededError` + 3 tests |
| CICD-002 | `.github/workflows/release.yml` | All 9 actions pinned to full-length commit SHAs (version in trailing comment). SHAs resolved via `git ls-remote` on 2026-06-02 |
| DOCK-001 / IAC-001 | `packages/ui/Dockerfile.dev` | Runs as built-in non-root `node` user (matches prod Dockerfiles) + adds a HEALTHCHECK. Not wired into the shipped compose, so no bind-mount uid impact |
| DOCK-003 / IAC-004 | `docker-compose.db.yml` | Default DB password documented as local-dev-only with an explicit "set POSTGRES_PASSWORD for shared/prod" warning. Residual accepted: port is already bound to 127.0.0.1, so the DB is never LAN/remote-exposed |
| CICD-001 | `.github/workflows/ci.yml`, `deploy-website.yml` | All actions pinned to commit SHAs (completes the action-pinning started in CICD-002) |
| EXPOSE-001 | `db/repositories/logs.ts` | Persisted error stacks capped at 2000 chars (bounds internal-path disclosure in per-user `request_logs` exports + DB bloat). Fuller path-redaction / prod-gating left as a product decision |
| WS-001 | `ws/server.ts` | Gateway `https://` self-origins added (TLS same-origin WS upgrades were rejected) + startup warning when production has no `WS_ALLOWED_ORIGINS`/`CORS_ORIGINS` configured |
| API-001 | `routes/openapi.ts` | OpenAPI spec + Swagger UI disabled in production unless `ENABLE_API_DOCS=true` (hard on/off switch — deliberately avoids the delicate session-auth path). Dev unchanged |

## Reviewed — intentionally NOT fixed (false-positive in context / already-correct)

- **SESS-001** (session cookie `Secure` flag). Already correct: `isSecureCookie()` sets `Secure` whenever the connection is HTTPS (incl. behind a trusted proxy via `X-Forwarded-Proto`); over plain HTTP `Secure` is impossible anyway. No change.
- **MASS-003** (autonomy decision `modifications` spread). No mass-assignment: the body is a strict `z.object` (unknown keys stripped), ownership is enforced (403 on mismatch), and `processDecision` only merges into `action.params` (the owner's own pending tool args, then re-assesses risk) — never into ownership/status. NB: it also revealed a *functional* bug (API field `modifications` vs manager field `modifiedParams` → modify-with-params is a silent no-op); that's a behavior fix, out of security scope.


- **SSRF-002** (`tools/overrides/image.ts`, `audio.ts` — provider `base_url`/TTS/STT first-hop fetch). Wrapping these in `safeFetch` was attempted and **reverted**: `safeFetch` blocks private/localhost addresses, but (a) the local Whisper/Piper diagnostic + transcription paths legitimately hit `localhost`, and (b) this is a *privacy-first* platform where the admin-configured provider `base_url` may legitimately point at a **local** model server (OpenAI-compatible at 127.0.0.1). The `base_url` is admin-controlled, so this is self-SSRF (the verifier already rated it Medium for that reason). Forcing `safeFetch` would break local/self-hosted AI providers — a core use case. Only SSRF-001 (fetching URLs returned **inside** provider response bodies, which are always public CDN URLs) warrants the guard, and that is fixed.

---

## NOT changed — needs maintainer decision (ops trade-offs)

- **mosquitto.conf `allow_anonymous true`** — left as the documented local-dev default; LAN exposure already removed by the loopback port binding above. For production, set `allow_anonymous false` + `password_file` (already documented in the conf).
- **Medium / Low backlog** — see `verified-findings.md`.

---

## Committing note

Two fixed files contain **pre-existing uncommitted work** that predates this
remediation and must not be bundled into a security commit:

- `services/extension/sandbox.ts` — RCE-001 fix (in `workerMain()`) is mixed with prior `ExtensionSandboxManager` trusted-identity (EXT-002) changes.
- `routes/database/shared.ts` — EXPOSE-002 one-line removal is mixed with prior per-user export filtering (CSV-002).

Suggested grouping when committing (use `git add -p` for the two mixed files):
1. `fix(security): close vm sandbox escape (RCE-001) + workflow template injection (RCE-002)`
2. `fix(security): SSRF guard, path containment, secret export, weak PRNG, KDF migration, MQTT bind, budget on autonomous runners`
