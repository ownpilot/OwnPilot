#!/bin/bash
# Start dev-proxy + Vite together. Kills both on exit.
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

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

# Wait for either to exit
wait -n $PROXY_PID $VITE_PID
