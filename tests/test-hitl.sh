#!/usr/bin/env bash
# Test: HITL (Human-in-the-Loop) API
# Requires: gateway running on localhost:8080

set -euo pipefail
BASE="${API_URL:-http://localhost:8080}/api/v1/hitl"
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

echo "=== HITL API Tests ==="

# --- Create Request ---
echo ""
echo "--- Create & List ---"
check_status "POST /requests creates HITL request" "$BASE/requests" POST \
  '{"interactionType":"approve_reject","mode":"pre_execution","promptMessage":"Approve this action?","context":{"action":"delete_all"},"timeoutSeconds":60}' "201"

# Extract ID from response
REQ_ID=$(cat /tmp/test_resp | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('id',''))" 2>/dev/null || echo "")

check_status "GET /requests/pending lists pending" "$BASE/requests/pending"

# --- Get by ID ---
echo ""
echo "--- Get & Resolve ---"
if [[ -n "$REQ_ID" ]]; then
  check_status "GET /requests/:id returns request" "$BASE/requests/$REQ_ID"

  # Resolve it
  check_status "POST /requests/:id/resolve approves" "$BASE/requests/$REQ_ID/resolve" POST \
    '{"decision":"approve","feedback":"Looks good"}'

  # Should not be in pending anymore
  check_status "GET /requests/pending (after resolve)" "$BASE/requests/pending"
else
  echo "  ⚠ Skipping ID-based tests (could not extract request ID)"
fi

# --- Cancel ---
echo ""
echo "--- Cancel & Expire ---"
# Create another request to cancel
check_status "POST /requests (for cancel test)" "$BASE/requests" POST \
  '{"interactionType":"collect_input","mode":"post_execution","workflowLogId":"wf_log_test","promptMessage":"Enter value"}' "201"

check_status "POST /requests/cancel-workflow" "$BASE/requests/cancel-workflow" POST \
  '{"workflowLogId":"wf_log_test"}'

check_status "POST /expire cleans up stale" "$BASE/expire" POST ''

# --- Validation ---
echo ""
echo "--- Validation ---"
check_status "POST /requests/:id/resolve without decision fails" "$BASE/requests/nonexistent/resolve" POST \
  '{}' "400"

# --- Summary ---
echo ""
echo "=== Results: $PASS passed, $FAIL failed, $TOTAL total ==="
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
