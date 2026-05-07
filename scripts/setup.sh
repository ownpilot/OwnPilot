#!/usr/bin/env bash
#
# OwnPilot Setup Script (Linux/macOS)
# =====================================
# Complete setup: Docker, dependencies, database, and development server
#
# Usage:
#   ./setup.sh              # Full setup with all prompts
#   ./setup.sh --minimal    # Skip Docker, just install deps
#   ./setup.sh --docker-only # Only Docker + database
#   ./setup.sh --skip-install # Skip pnpm install
#

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
NODE_MIN_VERSION=22
POSTGRES_PORT=25432
POSTGRES_USER=ownpilot
POSTGRES_PASSWORD=ownpilot_secret
POSTGRES_DB=ownpilot

# Parse arguments
MODE="full"
while [[ $# -gt 0 ]]; do
    case $1 in
        --minimal)
            MODE="minimal"
            shift
            ;;
        --docker-only)
            MODE="docker-only"
            shift
            ;;
        --skip-install)
            MODE="skip-install"
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [--minimal|--docker-only|--skip-install]"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Helper functions
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check Node.js version
check_node() {
    log_info "Checking Node.js..."

    if ! command_exists node; then
        log_error "Node.js not found. Please install Node.js ${NODE_MIN_VERSION}+"
        echo "  macOS: brew install node@22"
        echo "  Linux: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt-get install -y nodejs"
        return 1
    fi

    NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
    if [[ "$NODE_VERSION" -lt "$NODE_MIN_VERSION" ]]; then
        log_error "Node.js version must be ${NODE_MIN_VERSION}+, found: $(node -v)"
        return 1
    fi

    log_success "Node.js $(node -v)"
    return 0
}

# Check pnpm
check_pnpm() {
    log_info "Checking pnpm..."

    if ! command_exists pnpm; then
        log_warn "pnpm not found. Installing..."
        npm install -g pnpm
    fi

    log_success "pnpm $(pnpm -v)"
}

# Check Docker
check_docker() {
    log_info "Checking Docker..."

    if ! command_exists docker; then
        log_error "Docker not found. Please install Docker Desktop"
        echo "  macOS: brew install --cask docker"
        echo "  Linux: curl -fsSL https://get.docker.com | sh"
        return 1
    fi

    if ! docker info >/dev/null 2>&1; then
        log_error "Docker is not running. Please start Docker Desktop."
        return 1
    fi

    log_success "Docker $(docker --version)"
}

# Check Docker Compose
check_docker_compose() {
    log_info "Checking Docker Compose..."

    if command_exists docker compose; then
        DOCKER_COMPOSE="docker compose"
    elif command_exists docker-compose; then
        DOCKER_COMPOSE="docker-compose"
    else
        log_error "Docker Compose not found."
        return 1
    fi

    log_success "Docker Compose available"
}

# Install dependencies
install_deps() {
    log_info "Installing dependencies with pnpm..."

    if [[ -d "node_modules" ]]; then
        log_warn "node_modules already exists. Skipping install."
    else
        pnpm install --frozen-lockfile || pnpm install
    fi

    log_success "Dependencies installed"
}

# Setup .env file
setup_env() {
    log_info "Setting up environment..."

    if [[ -f ".env" ]]; then
        log_warn ".env already exists. Skipping."
    else
        if [[ -f ".env.example" ]]; then
            cp .env.example .env
            log_success "Created .env from .env.example"
        else
            cat > .env << EOF
# OwnPilot Environment
PORT=8080
UI_PORT=8199
HOST=127.0.0.1
NODE_ENV=development

# Database
# Use 127.0.0.1 instead of "localhost" — on Windows localhost may resolve to ::1
# while Docker publishes the port on IPv4 only, causing silent connection failures.
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=${POSTGRES_PORT}
POSTGRES_USER=${POSTGRES_USER}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=${POSTGRES_DB}

# Authentication (development)
AUTH_TYPE=none

# Logging
LOG_LEVEL=info
EOF
            log_success "Created .env"
        fi
    fi
}

# Start PostgreSQL with Docker
start_postgres() {
    log_info "Starting PostgreSQL with Docker..."

    # Check if container already running
    if docker ps --format '{{.Names}}' | grep -q "^ownpilot-db$"; then
        log_warn "PostgreSQL container already running"
        return 0
    fi

    # Check if container exists but stopped
    if docker ps -a --format '{{.Names}}' | grep -q "^ownpilot-db$"; then
        log_info "Starting existing container..."
        docker start ownpilot-db
    else
        # Create and start new container
        docker run -d \
            --name ownpilot-db \
            --restart unless-stopped \
            -e POSTGRES_USER=${POSTGRES_USER} \
            -e POSTGRES_PASSWORD=${POSTGRES_PASSWORD} \
            -e POSTGRES_DB=${POSTGRES_DB} \
            -p ${POSTGRES_PORT}:5432 \
            -v ownpilot-postgres-data:/var/lib/postgresql/data \
            pgvector/pgvector:pg16

        # Wait for PostgreSQL to be ready
        log_info "Waiting for PostgreSQL to be ready..."
        local attempt=0
        while ! docker exec ownpilot-db pg_isready -U ${POSTGRES_USER} >/dev/null 2>&1; do
            attempt=$((attempt + 1))
            if [[ $attempt -gt 30 ]]; then
                log_error "PostgreSQL failed to start"
                return 1
            fi
            sleep 1
        done

        log_success "PostgreSQL initialized"
    fi

    log_success "PostgreSQL running on port ${POSTGRES_PORT}"
}

# Run database migrations
run_migrations() {
    log_info "Running database migrations..."

    cd packages/gateway

    # Check if there's a seed script
    if [[ -f "src/db/migrations/postgres/001_initial_schema.sql" ]]; then
        log_info "Running initial schema..."
        PGPASSWORD=${POSTGRES_PASSWORD} psql -h localhost -p ${POSTGRES_PORT} -U ${POSTGRES_USER} -d ${POSTGRES_DB} -f src/db/migrations/postgres/001_initial_schema.sql || true
    fi

    # Run seed if available
    if [[ -f "scripts/seed-database.ts" ]]; then
        log_info "Seeding database..."
        pnpm run seed 2>/dev/null || log_warn "Seed script skipped (may require API keys)"
    fi

    cd ../..

    log_success "Database ready"
}

# Build project
build_project() {
    log_info "Building project..."

    pnpm run build

    log_success "Build complete"
}

# Start development server
start_dev() {
    log_info "Starting development server..."

    # Start in background
    pnpm run dev &

    log_success "Development server starting..."
    log_info "Gateway: http://localhost:8080"
    log_info "UI: http://localhost:8199"
}

# Main
main() {
    echo -e "${BLUE}"
    echo "========================================"
    echo "  OwnPilot Setup (Linux/macOS)"
    echo "========================================"
    echo -e "${NC}"

    case $MODE in
        minimal)
            check_node || exit 1
            check_pnpm
            install_deps
            setup_env
            log_success "Minimal setup complete!"
            log_info "Run 'pnpm run dev' to start development"
            ;;

        docker-only)
            check_docker || exit 1
            check_docker_compose
            setup_env
            start_postgres
            run_migrations
            log_success "Docker setup complete!"
            log_info "PostgreSQL: localhost:${POSTGRES_PORT}"
            ;;

        skip-install)
            check_node || exit 1
            check_docker || exit 1
            check_docker_compose
            setup_env
            start_postgres
            run_migrations
            build_project
            start_dev
            ;;

        full|*)
            check_node || exit 1
            check_pnpm
            check_docker || exit 1
            check_docker_compose
            install_deps
            setup_env
            start_postgres
            run_migrations
            build_project
            start_dev
            ;;
    esac

    echo -e "${GREEN}"
    echo "========================================"
    echo "  Setup Complete!"
    echo "========================================"
    echo -e "${NC}"
}

main "$@"