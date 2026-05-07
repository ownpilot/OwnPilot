# OwnPilot Setup Guide

This guide covers setting up OwnPilot from scratch, including prerequisites, automated setup, and manual configuration.

## Prerequisites

### Required Software

| Software | Version | Purpose             |
| -------- | ------- | ------------------- |
| Node.js  | 22+     | Runtime             |
| pnpm     | 10+     | Package manager     |
| Docker   | Latest  | PostgreSQL database |
| Git      | Latest  | Version control     |

### OS-Specific Setup

#### Windows

1. Install Node.js 22+: https://nodejs.org/
2. Install Docker Desktop: https://www.docker.com/products/docker-desktop/
3. Install pnpm: `npm install -g pnpm`

#### macOS

```bash
# Install Homebrew (if not installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node.js 22
brew install node@22

# Install Docker Desktop
brew install --cask docker

# Install pnpm
npm install -g pnpm
```

#### Linux (Ubuntu/Debian)

```bash
# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs

# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# pnpm
npm install -g pnpm
```

---

## Automated Setup (Recommended)

### Quick Start

#### Linux/macOS

```bash
git clone https://github.com/ownpilot/ownpilot.git
cd ownpilot
./setup.sh
```

#### Windows PowerShell

```powershell
git clone https://github.com/ownpilot/ownpilot.git
cd ownpilot
.\setup.ps1
```

The interactive wizard will guide you through the complete setup.

### Setup Modes

| Mode             | Description                                                       |
| ---------------- | ----------------------------------------------------------------- |
| `Full` (default) | Complete setup: Docker, dependencies, database, build, dev server |
| `Minimal`        | Only install dependencies and create `.env`                       |
| `DockerOnly`     | Only Docker + PostgreSQL database                                 |
| `SkipInstall`    | Skip pnpm install (for already installed deps)                    |

#### Usage Examples

```bash
# Linux/macOS
./scripts/setup.sh --minimal          # Skip Docker
./scripts/setup.sh --docker-only      # Only database
./scripts/setup.sh --skip-install     # Already have deps

# Windows PowerShell
.\scripts\setup.ps1 -Mode Minimal
.\scripts\setup.ps1 -Mode DockerOnly
.\scripts\setup.ps1 -Mode SkipInstall
```

---

## Manual Setup

If you prefer to set up manually or need more control:

### 1. Clone Repository

```bash
git clone https://github.com/ownpilot/ownpilot.git
cd ownpilot
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Configure Environment

```bash
# Copy example environment file
cp .env.example .env
```

Edit `.env` with your settings. The defaults work with Docker Compose PostgreSQL:

```env
# Server
PORT=8080
UI_PORT=8199
HOST=127.0.0.1
NODE_ENV=development

# Database (Docker Compose defaults)
POSTGRES_HOST=localhost
POSTGRES_PORT=25432
POSTGRES_USER=ownpilot
POSTGRES_PASSWORD=ownpilot_secret
POSTGRES_DB=ownpilot

# Authentication
AUTH_TYPE=none

# Logging
LOG_LEVEL=info
```

### 4. Start PostgreSQL

#### Option A: Docker Compose (Recommended)

```bash
docker compose --profile postgres up -d
```

#### Option B: Manual Docker

```bash
docker run -d \
  --name ownpilot-db \
  --restart unless-stopped \
  -e POSTGRES_USER=ownpilot \
  -e POSTGRES_PASSWORD=ownpilot_secret \
  -e POSTGRES_DB=ownpilot \
  -p 25432:5432 \
  -v ownpilot-postgres-data:/var/lib/postgresql/data \
  pgvector/pgvector:pg16
```

Wait for PostgreSQL to be ready (usually 5-10 seconds):

```bash
docker exec ownpilot-db pg_isready -U ownpilot
```

### 5. Initialize Database

```bash
cd packages/gateway

# Run initial schema (if exists)
psql -h localhost -p 25432 -U ownpilot -d ownpilot -f src/db/migrations/postgres/001_initial_schema.sql

# Or use seed script
pnpm run seed
```

### 6. Build Project

```bash
pnpm build
```

### 7. Start Development Server

```bash
pnpm dev
```

---

## Starting OwnPilot

### Development Mode

```bash
# Linux/macOS
./start.sh

# Windows PowerShell
.\start.ps1
```

### Start Options

| Option           | Description                                |
| ---------------- | ------------------------------------------ |
| `--dev`          | Development mode with hot reload (default) |
| `--prod`         | Production mode (build & serve)            |
| `--docker`       | Start with Docker Compose                  |
| `--no-ui`        | Gateway only, without UI                   |
| `--port PORT`    | Gateway API port (default: 8080)           |
| `--ui-port PORT` | UI dev server port (default: 8199)         |

### Manual Start

```bash
# Install dependencies (if not done)
pnpm install

# Start development servers
pnpm dev
```

---

## Services & URLs

After starting, these services are available:

| Service     | URL                   | Description     |
| ----------- | --------------------- | --------------- |
| Gateway API | http://localhost:8080 | REST API server |
| UI          | http://localhost:8199 | Web interface   |
| PostgreSQL  | localhost:25432       | Database        |

---

## Configuration

### AI Providers

AI provider API keys are configured via:

1. **Web UI**: Config Center (Settings page)
2. **CLI**: `ownpilot config set <provider>-api-key <key>`

Supported providers:

- OpenAI (`OPENAI_API_KEY`)
- Anthropic (`ANTHROPIC_API_KEY`)
- Google (`GOOGLE_API_KEY`)
- Azure OpenAI (`AZURE_OPENAI_*`)
- Ollama (`OLLAMA_BASE_URL`)
- Custom LLM endpoints

### Environment Variables

| Variable        | Default     | Description        |
| --------------- | ----------- | ------------------ |
| `PORT`          | 8080        | Gateway API port   |
| `UI_PORT`       | 8199        | UI dev server port |
| `POSTGRES_HOST` | localhost   | Database host      |
| `POSTGRES_PORT` | 25432       | Database port      |
| `NODE_ENV`      | development | Environment        |
| `LOG_LEVEL`     | info        | Logging level      |

---

## Docker Compose Profiles

| Profile    | Services   | Usage         |
| ---------- | ---------- | ------------- |
| `postgres` | PostgreSQL | Database only |
| (default)  | All        | Full stack    |

```bash
# Database only
docker compose --profile postgres up -d

# Full stack
docker compose up -d
```

---

## Troubleshooting

### Port Already in Use

```bash
# Find process using port 8080
lsof -i :8080    # macOS/Linux
netstat -ano | findstr :8080  # Windows

# Kill process or change PORT in .env
```

### PostgreSQL Connection Failed

```bash
# Check if container is running
docker ps | grep ownpilot

# Check logs
docker logs ownpilot-db

# Restart container
docker restart ownpilot-db
```

### pnpm Install Failed

Close VS Code (locks native .node modules on Windows) and retry:

```bash
pnpm install
```

### Node.js Version Too Old

```bash
# Check version
node --version

# Update via nvm (recommended)
nvm install 22
nvm use 22

# Or reinstall from nodejs.org
```

---

## Additional Resources

- [Architecture Overview](docs/ARCHITECTURE.md)
- [Database Schema](docs/DATABASE.md)
- [API Reference](docs/API.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
- [Contributing Guide](CONTRIBUTING.md)
