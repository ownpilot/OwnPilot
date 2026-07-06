# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.8.x   | Yes       |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, use [GitHub Security Advisories](https://github.com/ownpilot/ownpilot/security/advisories/new) to report vulnerabilities privately. You will receive a response within 72 hours acknowledging receipt.

Please include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Security Architecture

OwnPilot implements multiple layers of security:

### Authentication

- **3 modes**: None (development only), API Key (timing-safe comparison), JWT (HS256/384/512)
- All credentials stored in the PostgreSQL database via Config Center, not in environment variables

### Code Execution Sandbox

- **4-layer model**: Critical pattern blocking (100+ regex patterns) -> Permission matrix (per-category blocked/prompt/allowed) -> Real-time user approval (SSE with 120s timeout) -> Sandbox isolation (Docker/VM/Worker)
- Docker containers run with `--read-only`, `--network=none`, `--cap-drop=ALL`, memory/CPU limits

### Encryption & Privacy

- **AES-256-GCM** encryption for personal memories with PBKDF2 key derivation
- **PII detection** across 15+ categories (SSN, credit cards, emails, phone numbers, etc.)
- Zero-dependency crypto implementation using only Node.js built-ins

### Rate Limiting

- Sliding window algorithm with configurable window, max requests, and burst limit
- Per-IP tracking with standard `X-RateLimit-*` response headers

### Audit

- Tamper-evident hash chain logging for audit trail verification

## Deployment Hardening (exposed gateways)

The defaults target a localhost, single-tenant deployment. When exposing the
gateway beyond localhost (e.g. via a tunnel or `0.0.0.0` bind), also set:

- **`TRUSTED_PROXY=true` + `TRUSTED_PROXY_IPS`** — required for the rate limiter
  and TLS detection to trust `X-Forwarded-*`. Without it, external clients can
  collapse into the local-exempt bucket and the global limiter becomes
  ineffective.
- **`UI_SESSION_COOKIE_SECURE=true`** (or **`HTTPS_ONLY=true`**) — ensures the UI
  session cookie carries the `Secure` flag when TLS is terminated upstream.
- **MQTT (edge)** — the bundled Mosquitto broker allows anonymous connections and
  is bound to loopback behind the optional `mqtt` compose profile. Configure
  broker credentials before binding it to any non-loopback interface.
- **API auth** — set `auth.type` to `api-key` or `jwt` (with a strong key/secret);
  authentication covers the entire `/api/*` surface (all versions).
- **UI password** — when an API key / JWT is configured but no UI password is set,
  the web UI and WebSocket run as the implicitly-authenticated local owner (a
  single-user-localhost convenience). Set a UI password before exposing the
  gateway; the gateway logs a startup warning otherwise.

## Security hardening toggles (opt-in)

These default to the **secure** behavior; set to `true` only if you understand the
trade-off. (See `packages/gateway/.env.example` for the full list.)

| Variable                                | Default (unset)                                               | Effect when `true`                                                        |
| --------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `OWNPILOT_STRICT_CALLTOOL`              | custom/extension tools may call any non-blocked tool          | default-deny: only read-only / explicitly-permissioned tools are callable |
| `OWNPILOT_ENABLE_EXTENSION_HOST_ACCESS` | extension `sandbox:'none'` is forced into the isolated worker | allow extensions to opt out of the sandbox (host fs/exec)                 |
| `OWNPILOT_CODING_AGENT_ANY_DIR`         | coding agents confined to the workspace root                  | allow coding agents to run in any directory                               |
| `OWNPILOT_ALLOW_LOCAL_EMBEDDING_URL`    | embedding base URL is SSRF-guarded (private blocked)          | allow a private/local embedding endpoint (e.g. Ollama)                    |
| `OWNPILOT_ALLOW_LOCAL_LLM_URL`          | LLM-provider base URL is SSRF-guarded (private blocked)       | allow a private/local LLM endpoint (Ollama / LM Studio / vLLM)            |
| `OWNPILOT_ENABLE_SKILL_SCRIPTS`         | agentskills `script_paths` are not auto-wired as tools        | allow skills to auto-create shell/python/js tool bridges                  |
| `OWNPILOT_TOOL_SANDBOX=worker`          | dynamic tools run on the in-process vm sandbox                | route them through the memory-limited Worker sandbox                      |

Autonomous **Claw** agents with no explicit `autonomyPolicy` block destructive
actions (delete / git push / shell) and self-modification by default; set a
per-claw policy to widen that.

## Dependency Management

- Dependencies are pinned and audited regularly.
- Dependabot or manual `pnpm audit` is used to track known vulnerabilities.
- Security-critical dependencies (crypto, auth) use zero-dependency implementations where possible.
