#!/usr/bin/env bash
# Register the bridge MCP server in Claude Code user scope.
# Run once: bash scripts/register-bridge-mcp.sh
set -euo pipefail

BRIDGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MCP_ENTRY="$BRIDGE_DIR/mcp/index.ts"

if [[ ! -f "$MCP_ENTRY" ]]; then
  echo "ERROR: $MCP_ENTRY not found. Run this script from the bridge project root." >&2
  exit 1
fi

# Read API key from .env if available
BRIDGE_API_KEY="${BRIDGE_API_KEY:-YOUR_BRIDGE_API_KEY_HERE}"
if [[ -f "$BRIDGE_DIR/.env" ]]; then
  # shellcheck disable=SC1090
  source <(grep '^BRIDGE_API_KEY=' "$BRIDGE_DIR/.env" || true)
fi

claude mcp add bridge-local \
  --transport stdio \
  --scope user \
  --env "BRIDGE_API_KEY=$BRIDGE_API_KEY" \
  -- node --experimental-strip-types "$MCP_ENTRY"

echo "✅ bridge-local MCP registered. Restart Claude Code to activate."
echo "   Available tools: ping, spawn_cc, get_projects, get_sessions,"
echo "                    worktree_create, worktree_list, worktree_delete, get_events"
