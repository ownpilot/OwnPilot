#!/usr/bin/env bash
# Test: Knowledge Graph API (Graph RAG service)
# Requires: gateway running on localhost:8080

set -euo pipefail
BASE="${API_URL:-http://localhost:8080}/api/v1/knowledge-graph"
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

echo "=== Knowledge Graph API Tests ==="

# --- Entities ---
echo ""
echo "--- Entities ---"
check_status "GET /entities returns 200" "$BASE/entities"
check_status "POST /ingest-text accepts text" "$BASE/ingest-text" POST \
  '{"text":"Albert Einstein worked at the Institute for Advanced Study in Princeton. He developed the theory of relativity.","agentId":"test-agent"}'
check_status "GET /entities?agentId=test-agent" "$BASE/entities?agentId=test-agent"

# --- Search ---
echo ""
echo "--- Search ---"
check_status "GET /search?q=Einstein" "$BASE/search?q=Einstein"
check_status "GET /search?q=relativity&mode=keyword" "$BASE/search?q=relativity&mode=keyword"
check_status "GET /search?q=physics&mode=hybrid" "$BASE/search?q=physics&mode=hybrid"

# --- Collections ---
echo ""
echo "--- Collections ---"
check_status "POST /collections creates collection" "$BASE/collections" POST \
  '{"name":"test-collection","agentId":"test-agent","description":"Test KB"}' "201"
check_status "GET /collections lists collections" "$BASE/collections?agentId=test-agent"

# --- LightRAG ---
echo ""
echo "--- LightRAG ---"
check_status "GET /lightrag/status" "$BASE/lightrag/status"

# --- Decay ---
echo ""
echo "--- Maintenance ---"
check_status "POST /decay" "$BASE/decay" POST '{"decayFactor":0.95}'

# --- Summary ---
echo ""
echo "=== Results: $PASS passed, $FAIL failed, $TOTAL total ==="
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
