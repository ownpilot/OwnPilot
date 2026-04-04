#!/bin/bash
# Start dev-proxy + Vite together. Kills both on exit.
set -e

# Ensure node/npx are on PATH (macOS Preview MCP doesn't inherit zsh profile)
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin:$PATH"

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# On macOS, gateway runs on mainfedora via Tailscale
if [ "$(uname)" = "Darwin" ] && [ -z "$GATEWAY_HOST" ]; then
  export GATEWAY_HOST="100.75.115.68"
fi

cleanup() {
  echo "[dev-start] Shutting down..."
  kill $PROXY_PID 2>/dev/null
  kill $VITE_PID 2>/dev/null
  wait 2>/dev/null
}
trap cleanup EXIT INT TERM

# Start dev-proxy in background
node dev-proxy.mjs &
PROXY_PID=$!

# Start Vite in foreground (Preview MCP tracks this process)
VITE_API_BASE=http://localhost:5174 npx vite --host 0.0.0.0 --port 5173 &
VITE_PID=$!

# Wait for either to exit (wait -n requires bash 4+, macOS ships bash 3.2)
wait $PROXY_PID $VITE_PID
