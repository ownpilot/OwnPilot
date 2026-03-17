#!/usr/bin/env bash
# bridge-diagnostics.sh — OpenClaw Bridge durum raporu
# Kullanım: ./scripts/bridge-diagnostics.sh

set -euo pipefail

BASE_URL="http://localhost:9090"
AUTH_TOKEN="YOUR_BRIDGE_API_KEY_HERE"
LOG_FILE="/tmp/bridge-daemon.log"
LOG_LINES=30

# Renk kodları
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

section() {
  echo ""
  echo -e "${BOLD}${CYAN}══════════════════════════════════════${NC}"
  echo -e "${BOLD}${CYAN}  $1${NC}"
  echo -e "${BOLD}${CYAN}══════════════════════════════════════${NC}"
}

format_json() {
  if command -v jq &>/dev/null; then
    jq '.'
  else
    python3 -m json.tool
  fi
}

# ── HEALTH ──────────────────────────────────────────────────────────────────
section "🩺 HEALTH STATUS"
HEALTH=$(curl -sf "${BASE_URL}/health" 2>/dev/null) || {
  echo -e "${RED}❌ Bridge erişilemiyor: ${BASE_URL}/health${NC}"
  echo "   Bridge çalışıyor mu? ps aux | grep bridge"
  exit 1
}

STATUS=$(echo "$HEALTH" | jq -r '.status // "unknown"')
ACTIVE=$(echo "$HEALTH" | jq -r '.activeSessions // 0')
PAUSED=$(echo "$HEALTH" | jq -r '.pausedSessions // 0')
CB_STATE=$(echo "$HEALTH" | jq -r '.circuitBreaker.state // "unknown"')

if [ "$STATUS" = "ok" ]; then
  echo -e "${GREEN}✅ Status: ${STATUS}${NC}"
else
  echo -e "${RED}⚠️  Status: ${STATUS}${NC}"
fi
echo -e "   Active Sessions : ${ACTIVE}"
echo -e "   Paused Sessions : ${PAUSED}"
echo -e "   Circuit Breaker : ${CB_STATE}"
echo ""
echo "Full Response:"
echo "$HEALTH" | format_json

# ── VERSION ─────────────────────────────────────────────────────────────────
section "📦 VERSION INFO"
VERSION=$(curl -sf "${BASE_URL}/version" 2>/dev/null) || {
  echo -e "${YELLOW}⚠️  /version endpoint erişilemiyor${NC}"
}

if [ -n "${VERSION:-}" ]; then
  VER=$(echo "$VERSION" | jq -r '.version // "unknown"')
  MODEL=$(echo "$VERSION" | jq -r '.model // "unknown"')
  UPTIME=$(echo "$VERSION" | jq -r '.uptime // 0')
  STARTED=$(echo "$VERSION" | jq -r '.startedAt // "unknown"')

  echo -e "   Version  : ${VER}"
  echo -e "   Model    : ${MODEL}"
  echo -e "   Uptime   : ${UPTIME}s"
  echo -e "   Started  : ${STARTED}"
  echo ""
  echo "Full Response:"
  echo "$VERSION" | format_json
fi

# ── METRICS ─────────────────────────────────────────────────────────────────
section "📊 METRICS"
METRICS=$(curl -sf \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  "${BASE_URL}/metrics" 2>/dev/null) || {
  echo -e "${YELLOW}⚠️  /metrics endpoint erişilemiyor veya auth hatası${NC}"
}

if [ -n "${METRICS:-}" ]; then
  SPAWN_COUNT=$(echo "$METRICS" | jq -r '.spawnCount // 0')
  SPAWN_OK=$(echo "$METRICS" | jq -r '.spawnSuccess // 0')
  SPAWN_ERR=$(echo "$METRICS" | jq -r '.spawnErrors // 0')
  AVG_FIRST=$(echo "$METRICS" | jq -r '.avgFirstChunkMs // 0')
  AVG_TOTAL=$(echo "$METRICS" | jq -r '.avgTotalMs // 0')

  echo -e "   Spawn Total    : ${SPAWN_COUNT}"
  echo -e "   Spawn Success  : ${SPAWN_OK}"
  echo -e "   Spawn Errors   : ${SPAWN_ERR}"
  echo -e "   Avg First Chunk: ${AVG_FIRST}ms"
  echo -e "   Avg Total      : ${AVG_TOTAL}ms"
  echo ""
  echo "Full Response:"
  echo "$METRICS" | format_json
fi

# ── LOG ─────────────────────────────────────────────────────────────────────
section "📋 BRIDGE LOG (son ${LOG_LINES} satır)"
if [ -f "$LOG_FILE" ]; then
  echo -e "   Dosya: ${LOG_FILE}"
  echo ""
  if command -v jq &>/dev/null; then
    tail -n "${LOG_LINES}" "$LOG_FILE" | while IFS= read -r line; do
      if echo "$line" | jq -e '.msg' &>/dev/null 2>&1; then
        LEVEL=$(echo "$line" | jq -r '.level // "?"')
        MSG=$(echo "$line" | jq -r '.msg // ""')
        TIME=$(echo "$line" | jq -r '.time // ""' | cut -c12-19 2>/dev/null || echo "")
        echo "  [${TIME}] ${LEVEL}: ${MSG}"
      else
        echo "  $line"
      fi
    done
  else
    tail -n "${LOG_LINES}" "$LOG_FILE"
  fi
else
  echo -e "${YELLOW}⚠️  Log dosyası bulunamadı: ${LOG_FILE}${NC}"
  echo "   Bridge hiç başlatılmamış olabilir."
fi

# ── FOOTER ──────────────────────────────────────────────────────────────────
section "✅ TAMAMLANDI"
echo -e "  Rapor zamanı: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""
