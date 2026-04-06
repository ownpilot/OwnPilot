#!/usr/bin/env bash
# Run all integration tests against the running dev Docker Compose instance.
#
# Usage:
#   ./tests/run-all.sh                    # run all tests
#   ./tests/run-all.sh test-health.sh     # run a specific test
#   API_URL=http://localhost:9090 ./tests/run-all.sh  # custom URL
#
# Requires:
#   docker compose -f docker-compose.dev.yml --profile postgres up -d

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export API_URL="${API_URL:-http://localhost:8501}"

TOTAL_PASS=0; TOTAL_FAIL=0; TOTAL_SUITES=0; FAILED_SUITES=()

echo "╔══════════════════════════════════════════════════════════╗"
echo "║          OwnPilot Integration Test Runner               ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  API: $API_URL"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# Check gateway is reachable
if ! curl -sf "$API_URL/health" > /dev/null 2>&1; then
  echo "ERROR: Gateway not reachable at $API_URL"
  echo "Start dev environment first:"
  echo "  docker compose -f docker-compose.dev.yml --profile postgres up -d"
  exit 1
fi

# Determine which tests to run
if [[ $# -gt 0 ]]; then
  TESTS=("$@")
else
  TESTS=()
  for f in "$SCRIPT_DIR"/test-*.sh; do
    [[ -f "$f" ]] && TESTS+=("$(basename "$f")")
  done
fi

# Run each test file
for test_file in "${TESTS[@]}"; do
  full_path="$SCRIPT_DIR/$test_file"
  if [[ ! -f "$full_path" ]]; then
    echo "⚠ Test file not found: $test_file"
    continue
  fi

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Running: $test_file"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  TOTAL_SUITES=$((TOTAL_SUITES + 1))

  if bash "$full_path"; then
    echo ""
  else
    FAILED_SUITES+=("$test_file")
    echo ""
  fi
done

# Summary
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  FINAL SUMMARY                                          ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Suites run: $TOTAL_SUITES"
echo "║  Suites failed: ${#FAILED_SUITES[@]}"

if [[ ${#FAILED_SUITES[@]} -gt 0 ]]; then
  for s in "${FAILED_SUITES[@]}"; do
    echo "║    ✗ $s"
  done
  echo "╚══════════════════════════════════════════════════════════╝"
  exit 1
else
  echo "║  All suites passed!"
  echo "╚══════════════════════════════════════════════════════════╝"
  exit 0
fi
