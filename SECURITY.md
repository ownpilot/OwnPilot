# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |

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

## Dependency Management

- Dependencies are pinned and audited regularly.
- Dependabot or manual `pnpm audit` is used to track known vulnerabilities.
- Security-critical dependencies (crypto, auth) use zero-dependency implementations where possible.
