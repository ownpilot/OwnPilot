#!/usr/bin/env bash
# Test: Workflow Generator API
# Requires: gateway running on localhost:8080
# Note: /generate and /decompose require a configured LLM provider.
#       These tests check that endpoints exist and respond correctly,
#       but LLM-dependent tests may return errors if no provider is configured.

set -euo pipefail
BASE="${API_URL:-http://localhost:8080}/api/v1/workflow-generator"
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

# Check endpoint responds (even if LLM not configured, should not 404)
check_not_404() {
  local desc="$1" url="$2" method="${3:-GET}" body="${4:-}"
  local args=(-s -o /tmp/test_resp -w '%{http_code}' -X "$method")
  [[ -n "$body" ]] && args+=(-H 'Content-Type: application/json' -d "$body")
  local code
  code=$(curl "${args[@]}" "$url")
  if [[ "$code" != "404" ]]; then
    ok "$desc (HTTP $code — endpoint exists)"
  else
    fail "$desc" "got 404 — endpoint not registered"
  fi
}

echo "=== Workflow Generator API Tests ==="

# --- Validation ---
echo ""
echo "--- Validation ---"
check_status "POST /generate without goal returns 400" "$BASE/generate" POST '{}' "400"
check_status "POST /decompose without goal returns 400" "$BASE/decompose" POST '{}' "400"
check_status "POST /review without workflow returns 400" "$BASE/review" POST '{}' "400"

# --- Endpoint existence (LLM may not be configured) ---
echo ""
echo "--- Endpoint Existence ---"
check_not_404 "POST /generate endpoint exists" "$BASE/generate" POST \
  '{"goal":"Create a workflow that fetches weather data"}'

check_not_404 "POST /decompose endpoint exists" "$BASE/decompose" POST \
  '{"goal":"Build a data pipeline"}'

check_not_404 "POST /review endpoint exists" "$BASE/review" POST \
  '{"workflow":{"name":"test","nodes":[],"edges":[],"variables":{},"metrics":{},"subtasks":[]}}'

# --- History ---
echo ""
echo "--- History ---"
check_status "GET /history returns 200" "$BASE/history"

# --- Summary ---
echo ""
echo "=== Results: $PASS passed, $FAIL failed, $TOTAL total ==="
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
