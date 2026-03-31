# Developing with a Remote Backend

When the gateway and database run on a different machine (e.g. a home server, VM, or cloud instance) and you want to develop the UI locally, you need to bridge the frontend dev server to the remote backend.

This guide covers the **reverse-proxy pattern** used in this project, including integration with [Claude Code Preview MCP](https://docs.anthropic.com/en/docs/claude-code).

## Architecture

```
┌─────────────────── Local Machine ───────────────────┐
│                                                      │
│  Browser ──► Vite (5173) ──► dev-proxy (5174) ──────┼──► Remote Gateway (8080)
│              (HMR, static)    (API + CORS)           │    (Hono + PostgreSQL)
│                                                      │
│  Claude Preview MCP ──► Vite (5173)                  │
│                                                      │
└──────────────────────────────────────────────────────┘
```

The UI (Vite) runs locally for fast HMR. API requests (`/api/*`) are routed through `dev-proxy.mjs` to the remote gateway. WebSocket connections (`/ws`) are also proxied.

## Prerequisites

- Node.js 22+ (tested with 25.x)
- Network connectivity to the remote machine (VPN, Tailscale, SSH tunnel, etc.)
- The remote gateway must be reachable on port 8080 (or your configured port)

## Quick Start

### 1. Set the remote gateway host

```bash
# In your shell or .env.local (not tracked by git):
export GATEWAY_HOST=<remote-ip-or-hostname>

# Examples:
export GATEWAY_HOST=192.168.1.100       # LAN IP
export GATEWAY_HOST=my-server.tailnet   # Tailscale MagicDNS
export GATEWAY_HOST=10.0.0.5            # VPN IP
```

### 2. Start the dev environment

```bash
# Option A: Shell script (starts proxy + Vite together)
cd packages/ui
GATEWAY_HOST=<remote-ip> bash dev-start.sh

# Option B: Manual (two terminals)
# Terminal 1 — reverse proxy
GATEWAY_HOST=<remote-ip> node packages/ui/dev-proxy.mjs

# Terminal 2 — Vite dev server
cd packages/ui
VITE_API_BASE=http://localhost:5174 npx vite --host 0.0.0.0 --port 5173
```

### 3. Verify connectivity

```bash
# Check if remote gateway is reachable:
curl -s -o /dev/null -w "%{http_code}" http://<remote-ip>:8080/api/v1/health
# Expected: 200 or 401 (auth required but reachable)

# Check if proxy is forwarding:
curl -s -o /dev/null -w "%{http_code}" http://localhost:5174/api/v1/health
# Expected: same as above
```

Open `http://localhost:5173` — the UI should load and connect to the remote backend.

## Claude Code Preview MCP

The `.claude/launch.json` configuration starts both proxy and Vite via `dev-start.sh`:

```json
{
  "configurations": [
    {
      "name": "ui-dev",
      "runtimeExecutable": "bash",
      "runtimeArgs": ["packages/ui/dev-start.sh"],
      "port": 5173
    }
  ]
}
```

Set `GATEWAY_HOST` before starting Claude Code, or export it in your shell profile:

```bash
export GATEWAY_HOST=<remote-ip>
# Then in Claude Code:
# preview_start("ui-dev")
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GATEWAY_HOST` | `127.0.0.1` | Remote gateway IP or hostname |
| `GATEWAY_PORT` | `8080` | Remote gateway port |
| `DEV_PROXY_PORT` | `5174` | Local proxy listen port |
| `VITE_API_BASE` | _(empty)_ | Set to `http://localhost:5174` to bypass Vite's built-in proxy |

## How It Works

### Why not use Vite's built-in proxy?

Vite 7.x uses `http-proxy` which has issues with Node.js 24's IPv6-first DNS resolution. When `localhost` resolves to `[::1]` but the backend listens on `127.0.0.1`, requests timeout or fail silently.

Our `dev-proxy.mjs` uses native `node:http` with explicit IPv4 addressing, avoiding this issue entirely.

### Why a separate proxy instead of `VITE_API_BASE` pointing directly to the remote?

1. **CORS**: The proxy adds proper CORS headers, so the browser accepts responses from a different origin
2. **Consistent port**: The UI always talks to `localhost:5174` regardless of where the backend lives
3. **WebSocket support**: The proxy handles both HTTP and WS connections

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Black/loading screen | Gateway unreachable | Verify `curl http://<remote-ip>:8080/api/v1/health` |
| `EAGAIN` proxy errors | Wrong `GATEWAY_HOST` | Check env var is set, IP is correct |
| `NODE_ENV=production` warning | `.env` has `NODE_ENV=production` | Change to `development` or remove the line |
| `wait -n` error on macOS | macOS ships bash 3.2 | Already fixed — `dev-start.sh` uses `wait` (POSIX) |
| Port 5173 in use | Stale Vite process | `lsof -ti:5173 \| xargs kill -9` |

## Platform Notes

### macOS

- Default `/bin/bash` is version 3.2 — scripts avoid bash 4+ features (`wait -n`, associative arrays)
- If Docker is not installed, this remote-backend pattern is the recommended approach
- Config files synced from Linux may have wrong paths (`/home/` vs `/Users/`)

### Linux

- Default setup: gateway + DB run locally, no proxy needed
- For remote DB only: set `POSTGRES_HOST` in `.env` instead of using the proxy
