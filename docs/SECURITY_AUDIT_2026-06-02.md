# Security Audit — 2026-06-02

Manual, depth-first security audit of OwnPilot's untrusted-input boundary, with
all findings fixed and merged to `main` during the session. This complements the
automated scan output under `security-report/`.

## Scope

External / attacker-reachable surfaces plus the autonomous-agent containment layer:

- Channels (incoming-message pipeline, pairing/ownership, tool-approval, normalizers)
- VM / sandbox code execution (extension sandbox, core sandbox, workflow `codeNode`, `claw_create_tool`)
- Auth / session (API-key, JWT, UI password + session store)
- SSRF (every `fetch` callsite that can take an influenced URL)
- Webhook signature verification (Telegram, SMS/Twilio, Email, Slack, workflow triggers)
- Tool-authorization / permission gate (autonomy-policy enforcement)

## Findings & fixes (all merged)

| #   | Severity     | Finding                                                                                                                                                                                                                                                                                                                                      | Fix                                                                                                                                                                                        |
| --- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Critical** | Core code sandbox (`buildSandboxContext`) injected host-realm `URL`/`TextEncoder`/`fetch`; `.prototype` / `getPrototypeOf` / nested host objects let sandboxed code reach the host `Function` constructor and run arbitrary host code (reproduced returning host `process.pid`). Reachable via dynamic/custom tools and trigger preRun code. | PR #35 — recursive security membrane (`.constructor`→stub, `getPrototypeOf`→null, recursive harden, fail-closed on non-config `.prototype`). 8 escape vectors proven blocked + functional. |
| 2   | High         | Redirect-based SSRF in RSS plugin — feed URL validated once, then bare `fetch` followed a 302 to `169.254.169.254` / internal hosts.                                                                                                                                                                                                         | PR #37 — route through `safeFetch` (re-validates every hop incl. fresh DNS).                                                                                                               |
| 3   | High         | Channel ownership hijack — an unclaimed bot replied to the first messager with the secret pairing key in-band, contradicting the console-only design.                                                                                                                                                                                        | PR #34 — direct the owner to the console/UI; never echo the key.                                                                                                                           |
| 4   | Medium       | Channel model-resolution divergence — cost tracking + the context-saturation warning used a different model than the one that actually replied; Telegram `/model` was cosmetic.                                                                                                                                                              | PR #34 — single effective provider/model from channel routing + `preferredModel`; new `inferProviderForModel`.                                                                             |
| 5   | Low          | UI session cache-hit path skipped the password-change cutoff the DB path enforces, so a cached session could survive a password change for ~5 min.                                                                                                                                                                                           | PR #36 — enforce the cutoff at the validation layer (store `createdAt`).                                                                                                                   |
| —   | —            | Plus: UCP bridges wired into the live pipeline, Telegram approval clicks bound to the prompt chat, SMS/Matrix long-reply splitting.                                                                                                                                                                                                          | PR #34                                                                                                                                                                                     |

## Surfaces audited clean (no change needed)

- **Webhook signatures** — every handler uses timing-safe comparison, is fail-closed on a
  missing secret (503) and missing/bad signature (403), and the workflow-executing
  endpoints add timestamp-based replay protection. Slack verifies HMAC over the **raw**
  body before parsing. (Tags H-S3/H-S7/H-S9/AUTH-001..004 reflect prior hardening.)
- **Auth** — API-key SHA-256 + `timingSafeEqual` (no early return); JWT pinned to HS256,
  required `exp`/`iat`, max-age, ≥64-char secret; login throttle + lockout; first-password
  setup gated by `BOOTSTRAP_TOKEN`; change-password requires session **and** current password.
- **Extension sandbox** (`services/extension/sandbox.ts`) — worker-isolated `__host`
  bootstrap; injects no host objects.
- **Workflow `safeVmEval`** — serializes context to JSON and re-parses inside the VM; no
  host objects cross the boundary.
- **`claw_create_tool`** — `__host` bootstrap; the one host-fn ingress (a malicious thenable
  returned to `await __result`) is blocked both by the codegen flag and by the absence of a
  non-codegen property path to `process`.
- **Image/audio tools** — bare `fetch` only to configured provider endpoints; untrusted
  provider-response URLs go through `safeFetch`.

## Residual limitations (defense-in-depth, not active bugs)

1. **`safeFetch` DNS TOCTOU** — a small window remains between the fresh-DNS check and
   `fetch`'s own resolution. Full closure needs IP-pinning, which Node `fetch` doesn't
   expose. Documented and minimized in `utils/safe-fetch.ts`.
2. **Permission gate is name-based** — `FILE_TOOLS` / `ALWAYS_DESTRUCTIVE_TOOLS` /
   `PATH_ARG_KEYS` are hardcoded lists, complete for today's built-in tools but requiring
   maintenance as tools are added. The filesystem-scope check **fails open** when a file
   tool exposes no recognizable path argument. Recommended hardening: make that path
   `require_approval` (fail-closed). The shell destructive-action regex is a best-effort
   heuristic (e.g. `rm --recursive` evades it), layered atop the claw workspace boundary.
3. **No-password deployment** authenticates everyone as `default` without a CSRF/origin
   check (mostly mitigated by CORS preflight for JSON APIs). This is the documented
   local single-user posture, not a code bug.

## Method

Each finding was confirmed with a proof-of-concept (e.g. the sandbox escape returning the
host PID, including `fromCharCode`-obfuscated chains that evade the static validator), fixed
with a focused change + regression test, verified (typecheck + targeted suites), and merged
behind green CI.
