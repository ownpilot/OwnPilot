#!/usr/bin/env bash
# Test: Basic health check and service availability
# Requires: gateway running on localhost:8080

set -euo pipefail
BASE="${API_URL:-http://localhost:8080}"
PASS=0; FAIL=0; TOTAL=0

ok()   { PASS=$((PASS+1)); TOTAL=$((TOTAL+1)); echo "  ✓ $1"; }
fail() { FAIL=$((FAIL+1)); TOTAL=$((TOTAL+1)); echo "  ✗ $1: $2"; }

check_status() {
  local desc="$1" url="$2" method="${3:-GET}" expect="${4:-200}"
  local code
  code=$(curl -s -o /tmp/test_resp -w '%{http_code}' -X "$method" "$url")
  if [[ "$code" == "$expect" ]]; then
    ok "$desc (HTTP $code)"
  else
    fail "$desc" "expected $expect, got $code"
  fi
}

echo "=== Health & Availability Tests ==="

# --- Core ---
echo ""
echo "--- Core Health ---"
check_status "GET /health" "$BASE/health"

# --- API Endpoints Exist ---
echo ""
echo "--- API Endpoints Exist ---"
check_status "GET /api/v1/tools" "$BASE/api/v1/tools"
check_status "GET /api/v1/settings" "$BASE/api/v1/settings"
check_status "GET /api/v1/agents" "$BASE/api/v1/agents"

# --- New Tier 1 Endpoints Exist ---
echo ""
echo "--- Tier 1 Endpoints ---"
check_status "GET /api/v1/knowledge-graph/entities" "$BASE/api/v1/knowledge-graph/entities"
check_status "GET /api/v1/hitl/requests/pending" "$BASE/api/v1/hitl/requests/pending"
check_status "GET /api/v1/workflow-generator/history" "$BASE/api/v1/workflow-generator/history"
check_status "GET /api/v1/workflow-hooks/test-wf" "$BASE/api/v1/workflow-hooks/test-wf"

# --- Summary ---
echo ""
echo "=== Results: $PASS passed, $FAIL failed, $TOTAL total ==="
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
