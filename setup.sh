#!/usr/bin/env bash
set -euo pipefail

# ─── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ─── Helpers ──────────────────────────────────────────────────────────────────
info()  { echo -e "${BLUE}ℹ${NC}  $1"; }
ok()    { echo -e "${GREEN}✔${NC}  $1"; }
warn()  { echo -e "${YELLOW}⚠${NC}  $1"; }
fail()  { echo -e "${RED}✖${NC}  $1"; }

ask() {
  local prompt="$1" default="$2" var="$3"
  read -rp "$(echo -e "${CYAN}?${NC}  ${prompt} ${BOLD}[${default}]${NC}: ")" input
  eval "$var=\"\${input:-$default}\""
}

ask_secret() {
  local prompt="$1" default="$2" var="$3"
  read -rsp "$(echo -e "${CYAN}?${NC}  ${prompt} ${BOLD}[${default}]${NC}: ")" input
  echo
  eval "$var=\"\${input:-$default}\""
}

ask_choice() {
  local prompt="$1" default="$2" var="$3"
  shift 3
  local options=("$@")
  echo -e "${CYAN}?${NC}  ${prompt}"
  for i in "${!options[@]}"; do
    local marker="  "
    if [[ "${options[$i]}" == "$default" ]]; then marker="→ "; fi
    echo -e "   ${marker}${options[$i]}"
  done
  read -rp "$(echo -e "   ${BOLD}Choose [${default}]${NC}: ")" input
  eval "$var=\"\${input:-$default}\""
}

section() {
  echo
  echo -e "${BOLD}${BLUE}━━━ $1 ━━━${NC}"
  echo
}

# ─── Banner ───────────────────────────────────────────────────────────────────
clear
echo -e "${BOLD}${CYAN}"
cat << 'BANNER'
   ___                 ____  _ _       _
  / _ \__      ___ __ |  _ \(_) | ___ | |_
 | | | \ \ /\ / / '_ \| |_) | | |/ _ \| __|
 | |_| |\ V  V /| | | |  __/| | | (_) | |_
  \___/  \_/\_/ |_| |_|_|   |_|_|\___/ \__|

BANNER
echo -e "${NC}"
echo -e "  ${BOLD}Privacy-first personal AI assistant${NC}"
echo -e "  Interactive Setup Wizard"
echo

# ─── Idempotency check ───────────────────────────────────────────────────────
if [[ -f .env ]]; then
  warn "An existing .env file was found."
  read -rp "$(echo -e "${YELLOW}?${NC}  Overwrite it? (y/N): ")" overwrite
  if [[ ! "$overwrite" =~ ^[Yy]$ ]]; then
    info "Setup cancelled. Your .env was not modified."
    exit 0
  fi
  echo
fi

# ─── Prerequisites ────────────────────────────────────────────────────────────
section "Checking Prerequisites"

prereqs_ok=true

# Node.js
if command -v node &>/dev/null; then
  node_version=$(node -v | sed 's/v//')
  node_major=$(echo "$node_version" | cut -d. -f1)
  if (( node_major >= 22 )); then
    ok "Node.js v${node_version}"
  else
    fail "Node.js v${node_version} found — v22+ required"
    prereqs_ok=false
  fi
else
  fail "Node.js not found — install v22+ from https://nodejs.org"
  prereqs_ok=false
fi

# pnpm
if command -v pnpm &>/dev/null; then
  pnpm_version=$(pnpm -v)
  pnpm_major=$(echo "$pnpm_version" | cut -d. -f1)
  if (( pnpm_major >= 9 )); then
    ok "pnpm v${pnpm_version}"
  else
    fail "pnpm v${pnpm_version} found — v9+ required"
    prereqs_ok=false
  fi
else
  fail "pnpm not found — install with: npm install -g pnpm"
  prereqs_ok=false
fi

# Docker
if command -v docker &>/dev/null; then
  docker_version=$(docker --version | grep -oP '\d+\.\d+\.\d+' | head -1)
  ok "Docker v${docker_version}"
else
  warn "Docker not found — needed if you want to run PostgreSQL in a container"
fi

# Docker Compose
if docker compose version &>/dev/null 2>&1; then
  compose_version=$(docker compose version --short 2>/dev/null || echo "unknown")
  ok "Docker Compose v${compose_version}"
else
  warn "Docker Compose not found — needed for containerized PostgreSQL"
fi

if [[ "$prereqs_ok" == false ]]; then
  echo
  fail "Please install the missing prerequisites and re-run this script."
  exit 1
fi

# ─── Server Configuration ────────────────────────────────────────────────────
section "Server Configuration"

ask "Gateway API port" "8080" PORT
ask "UI dev server port" "5173" UI_PORT
ask "Bind address" "0.0.0.0" HOST
ask_choice "Environment" "development" NODE_ENV "development" "production"
ask "Extra CORS origins (comma-separated, empty = auto)" "" CORS_ORIGINS

# ─── Authentication ──────────────────────────────────────────────────────────
section "Authentication"

ask_choice "Auth type" "none" AUTH_TYPE "none" "api-key" "jwt"

API_KEYS=""
JWT_SECRET=""

case "$AUTH_TYPE" in
  api-key)
    ask "API keys (comma-separated)" "change-me-$(openssl rand -hex 8 2>/dev/null || echo "random-key")" API_KEYS
    ;;
  jwt)
    JWT_SECRET=$(openssl rand -hex 16 2>/dev/null || head -c 32 /dev/urandom | xxd -p | tr -d '\n' | head -c 32)
    ok "Generated JWT secret: ${JWT_SECRET:0:8}..."
    ;;
esac

# ─── Database ─────────────────────────────────────────────────────────────────
section "Database (PostgreSQL)"

ask "PostgreSQL host" "localhost" POSTGRES_HOST
ask "PostgreSQL port" "25432" POSTGRES_PORT
ask "PostgreSQL user" "ownpilot" POSTGRES_USER
ask_secret "PostgreSQL password" "ownpilot_secret" POSTGRES_PASSWORD
ask "PostgreSQL database name" "ownpilot" POSTGRES_DB

USE_DOCKER_PG="n"
if command -v docker &>/dev/null && docker compose version &>/dev/null 2>&1; then
  read -rp "$(echo -e "${CYAN}?${NC}  Start PostgreSQL with Docker? ${BOLD}[Y/n]${NC}: ")" USE_DOCKER_PG
  USE_DOCKER_PG="${USE_DOCKER_PG:-y}"
fi

# ─── Generate .env ────────────────────────────────────────────────────────────
section "Generating .env"

cat > .env << ENVFILE
# OwnPilot Configuration
# Generated by setup.sh on $(date -u +"%Y-%m-%d %H:%M:%S UTC")
# API keys and tokens are configured via Config Center UI.

# ===========================================
# Server
# ===========================================
PORT=${PORT}
UI_PORT=${UI_PORT}
HOST=${HOST}
NODE_ENV=${NODE_ENV}
CORS_ORIGINS=${CORS_ORIGINS}

# ===========================================
# Database (PostgreSQL)
# ===========================================
POSTGRES_HOST=${POSTGRES_HOST}
POSTGRES_PORT=${POSTGRES_PORT}
POSTGRES_USER=${POSTGRES_USER}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=${POSTGRES_DB}

# ===========================================
# Authentication (DB is primary, env is fallback)
# ===========================================
AUTH_TYPE=${AUTH_TYPE}
API_KEYS=${API_KEYS}
JWT_SECRET=${JWT_SECRET}

# ===========================================
# Logging
# ===========================================
LOG_LEVEL=info
ENVFILE

ok ".env file created"

# ─── Start PostgreSQL with Docker ─────────────────────────────────────────────
if [[ "$USE_DOCKER_PG" =~ ^[Yy]$ ]]; then
  section "Starting PostgreSQL"

  info "Running: docker compose -f docker-compose.db.yml up -d"
  docker compose -f docker-compose.db.yml up -d

  info "Waiting for PostgreSQL to be ready..."
  retries=0
  max_retries=30
  until docker compose -f docker-compose.db.yml exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" &>/dev/null; do
    retries=$((retries + 1))
    if (( retries >= max_retries )); then
      fail "PostgreSQL did not become ready in time. Check: docker compose -f docker-compose.db.yml logs"
      exit 1
    fi
    sleep 1
    printf "."
  done
  echo
  ok "PostgreSQL is ready"
fi

# ─── Install Dependencies ────────────────────────────────────────────────────
section "Installing Dependencies"

info "Running: pnpm install"
pnpm install

ok "Dependencies installed"

# ─── Build ────────────────────────────────────────────────────────────────────
section "Building Project"

info "Running: pnpm run build"
pnpm run build

ok "Build complete"

# ─── Summary ──────────────────────────────────────────────────────────────────
section "Setup Complete!"

echo -e "  ${GREEN}${BOLD}OwnPilot is ready to go.${NC}"
echo
echo -e "  ${BOLD}Configuration:${NC}"
echo -e "    Gateway:   http://${HOST}:${PORT}"
echo -e "    UI:        http://localhost:${UI_PORT}"
echo -e "    Database:  PostgreSQL @ ${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
echo -e "    Auth:      ${AUTH_TYPE}"
echo
echo -e "  ${BOLD}Next steps:${NC}"
echo -e "    1. ${CYAN}pnpm run dev${NC}                 Start in development mode"
echo -e "    2. Open ${CYAN}http://localhost:${UI_PORT}${NC}   Configure API keys in Config Center"
echo
