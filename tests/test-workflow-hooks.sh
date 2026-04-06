#!/usr/bin/env bash
# Test: Workflow Hooks API
# Requires: gateway running on localhost:8080

set -euo pipefail
BASE="${API_URL:-http://localhost:8080}/api/v1/workflow-hooks"
PASS=0; FAIL=0; TOTAL=0

ok()   { PASS=$((PASS+1)); TOTAL=$((TOTAL+1)); echo "  ✓ $1"; }
fail() { FAIL=$((FAIL+1)); TOTAL=$((TOTAL+1)); echo "  ✗ $1: $2"; }

check_status() {
  local desc="$1" url="$2" method="${3:-GET}" body="${4:-}" expect="${5:-200}"
  local args=(-s -o /tmp/test_resp -w '%{http_code}' -X "$method")
  [[ -n "$body" ]] && args+=(-H 'Content-Type: application/json' -d "$body")
  local code
  code=$(curl "${args[@]}" "$url")
  if [[ "$code" == "$expect" ]]; then
    ok "$desc (HTTP $code)"
  else
    fail "$desc" "expected $expect, got $code — $(cat /tmp/test_resp | head -c 200)"
  fi
}

echo "=== Workflow Hooks API Tests ==="

WF_ID="test-workflow-hooks-$(date +%s)"

# --- CRUD ---
echo ""
echo "--- Create & List ---"

# List hooks (empty)
check_status "GET /:workflowId returns 200 (empty)" "$BASE/$WF_ID"

# Create logging hook
check_status "POST /:workflowId creates logging hook" "$BASE/$WF_ID" POST \
  '{"hookType":"logging","config":{"level":"debug"},"enabled":true}' "201"

# Create webhook hook
check_status "POST /:workflowId creates webhook hook" "$BASE/$WF_ID" POST \
  '{"hookType":"webhook","config":{"url":"https://httpbin.org/post"},"enabled":true}' "201"

# List hooks — should have 2
check_status "GET /:workflowId lists hooks" "$BASE/$WF_ID"

# Extract hook ID for toggle/delete
HOOK_ID=$(cat /tmp/test_resp | python3 -c "import sys,json; items=json.load(sys.stdin).get('data',[]); print(items[0]['id'] if items else '')" 2>/dev/null || echo "")

# --- Toggle ---
echo ""
echo "--- Toggle & Delete ---"

if [[ -n "$HOOK_ID" ]]; then
  check_status "PATCH /hook/:id/toggle disables" "$BASE/hook/$HOOK_ID/toggle" PATCH \
    '{"enabled":false}'

  check_status "PATCH /hook/:id/toggle enables" "$BASE/hook/$HOOK_ID/toggle" PATCH \
    '{"enabled":true}'

  check_status "DELETE /hook/:id deletes hook" "$BASE/hook/$HOOK_ID" DELETE
else
  echo "  ⚠ Skipping toggle/delete tests (could not extract hook ID)"
fi

# --- Validation ---
echo ""
echo "--- Validation ---"
check_status "POST without hookType returns 400" "$BASE/$WF_ID" POST '{"config":{}}' "400"
check_status "PATCH toggle without enabled returns 400" "$BASE/hook/nonexistent/toggle" PATCH '{}' "400"

# --- Summary ---
echo ""
echo "=== Results: $PASS passed, $FAIL failed, $TOTAL total ==="
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
