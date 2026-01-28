#!/bin/bash
#
# OwnPilot - Startup Script for Linux/Mac
#
# Usage:
#   ./start.sh              # Development mode with UI
#   ./start.sh --prod       # Production mode
#   ./start.sh --no-ui      # Gateway only
#   ./start.sh --docker     # Using Docker
#   ./start.sh --help       # Show help
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="dev"
NO_UI=false
BUILD=false
PORT=${PORT:-8080}
UI_PORT=${UI_PORT:-5173}

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

# Functions
header() { echo -e "\n${CYAN}=== $1 ===${NC}"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
info() { echo -e "${YELLOW}[INFO]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Banner
banner() {
    echo -e "${MAGENTA}"
    cat << 'EOF'

   ___                 ____  _ _       _
  / _ \__      ___ __ |  _ \(_) | ___ | |_
 | | | \ \ /\ / / '_ \| |_) | | |/ _ \| __|
 | |_| |\ V  V /| | | |  __/| | | (_) | |_
  \___/  \_/\_/ |_| |_|_|   |_|_|\___/ \__|
                        Gateway v0.1.0

EOF
    echo -e "${NC}"
}

# Help
show_help() {
    echo "OwnPilot - Startup Script"
    echo ""
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  --dev           Development mode with hot reload (default)"
    echo "  --prod          Production mode (build & serve)"
    echo "  --docker        Start using Docker Compose"
    echo "  --no-ui         Start gateway only, without UI"
    echo "  --build         Force rebuild before starting"
    echo "  --port PORT     Gateway API port (default: 8080)"
    echo "  --ui-port PORT  UI dev server port (default: 5173)"
    echo "  --help          Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                  # Start dev mode with UI"
    echo "  $0 --prod           # Build and start production"
    echo "  $0 --no-ui          # Gateway only"
    echo "  $0 --docker         # Use Docker Compose"
}

# Parse arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --dev)
                MODE="dev"
                shift
                ;;
            --prod)
                MODE="prod"
                shift
                ;;
            --docker)
                MODE="docker"
                shift
                ;;
            --no-ui)
                NO_UI=true
                shift
                ;;
            --build)
                BUILD=true
                shift
                ;;
            --port)
                PORT="$2"
                shift 2
                ;;
            --ui-port)
                UI_PORT="$2"
                shift 2
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            *)
                error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done
}

# Check prerequisites
check_prerequisites() {
    header "Checking Prerequisites"

    # Node.js
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node -v | sed 's/v//')
        NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
        if [[ $NODE_MAJOR -lt 22 ]]; then
            error "Node.js 22+ required (found v$NODE_VERSION)"
            exit 1
        fi
        success "Node.js v$NODE_VERSION"
    else
        error "Node.js not found. Install from https://nodejs.org"
        exit 1
    fi

    # pnpm
    if command -v pnpm &> /dev/null; then
        success "pnpm $(pnpm -v)"
    else
        info "pnpm not found, installing..."
        npm install -g pnpm
    fi

    # Docker (only for docker mode)
    if [[ "$MODE" == "docker" ]]; then
        if command -v docker &> /dev/null; then
            success "Docker $(docker -v | cut -d' ' -f3 | tr -d ',')"
        else
            error "Docker not found. Install from https://docker.com"
            exit 1
        fi
    fi
}

# Load environment
load_environment() {
    header "Loading Environment"

    if [[ -f "$SCRIPT_DIR/.env" ]]; then
        success "Loading .env file"
        set -a
        source "$SCRIPT_DIR/.env"
        set +a
    elif [[ -f "$SCRIPT_DIR/.env.example" ]]; then
        info "No .env found. Copy .env.example to .env and configure it."
        info "Continuing with default/demo settings..."
    fi

    # Set defaults
    export PORT=$PORT
    export HOST="0.0.0.0"
    export NODE_ENV=$([ "$MODE" = "prod" ] && echo "production" || echo "development")
}

# Install dependencies
install_dependencies() {
    header "Installing Dependencies"

    cd "$SCRIPT_DIR"

    if [[ ! -d "node_modules" ]]; then
        info "Installing packages..."
        pnpm install --frozen-lockfile
    else
        success "Dependencies already installed"
    fi
}

# Build project
build_project() {
    header "Building Project"

    cd "$SCRIPT_DIR"
    pnpm build

    if [[ $? -ne 0 ]]; then
        error "Build failed!"
        exit 1
    fi
    success "Build complete"
}

# Cleanup on exit
cleanup() {
    info "\nStopping services..."
    if [[ -n "$GATEWAY_PID" ]]; then
        kill $GATEWAY_PID 2>/dev/null || true
    fi
    if [[ -n "$UI_PID" ]]; then
        kill $UI_PID 2>/dev/null || true
    fi
    exit 0
}

# Start development mode
start_dev_mode() {
    header "Starting Development Mode"

    info "Gateway API: http://localhost:$PORT"
    if [[ "$NO_UI" != true ]]; then
        info "UI: http://localhost:$UI_PORT"
    fi
    info "Press Ctrl+C to stop"
    echo ""

    cd "$SCRIPT_DIR"

    # Set trap for cleanup
    trap cleanup SIGINT SIGTERM

    # Start gateway
    PORT=$PORT pnpm --filter @ownpilot/gateway dev &
    GATEWAY_PID=$!

    if [[ "$NO_UI" != true ]]; then
        # Wait a bit for gateway to start
        sleep 2

        # Start UI
        VITE_PORT=$UI_PORT pnpm --filter @ownpilot/ui dev &
        UI_PID=$!
    fi

    # Wait for processes
    wait
}

# Start production mode
start_prod_mode() {
    header "Starting Production Mode"

    info "Gateway API: http://localhost:$PORT"
    info "Press Ctrl+C to stop"
    echo ""

    cd "$SCRIPT_DIR"

    # Serve gateway
    PORT=$PORT pnpm --filter @ownpilot/gateway start
}

# Start with Docker
start_docker_mode() {
    header "Starting with Docker"

    cd "$SCRIPT_DIR"

    if [[ "$NO_UI" == true ]]; then
        docker-compose up --build gateway
    else
        docker-compose --profile ui up --build
    fi
}

# Main
main() {
    parse_args "$@"
    banner
    check_prerequisites
    load_environment
    install_dependencies

    if [[ "$BUILD" == true || "$MODE" == "prod" ]]; then
        build_project
    fi

    case $MODE in
        dev)
            start_dev_mode
            ;;
        prod)
            start_prod_mode
            ;;
        docker)
            start_docker_mode
            ;;
    esac
}

main "$@"
