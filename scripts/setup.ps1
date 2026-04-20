<#
.SYNOPSIS
    OwnPilot Setup Script (Windows PowerShell)

.DESCRIPTION
    Complete setup: Docker, dependencies, database, and development server

.PARAMETER Mode
    Full - Complete setup with all prompts (default)
    Minimal - Skip Docker, just install deps
    DockerOnly - Only Docker + database
    SkipInstall - Skip pnpm install

.EXAMPLE
    .\setup.ps1

.EXAMPLE
    .\setup.ps1 -Mode DockerOnly
#>

[CmdletBinding()]
param(
    [ValidateSet("Full", "Minimal", "DockerOnly", "SkipInstall")]
    [string]$Mode = "Full"
)

# Configuration
$NODE_MIN_VERSION = 22
$POSTGRES_PORT = 25432
$POSTGRES_USER = "ownpilot"
$POSTGRES_PASSWORD = "ownpilot_secret"
$POSTGRES_DB = "ownpilot"

# Colors (PowerShell doesn't support ANSI natively on all terminals)
function Write-Info { Write-Host "[INFO] " -NoNewline -ForegroundColor Cyan; Write-Host $args[0] }
function Write-Success { Write-Host "[OK] " -NoNewline -ForegroundColor Green; Write-Host $args[0] }
function Write-Warn { Write-Host "[WARN] " -NoNewline -ForegroundColor Yellow; Write-Host $args[0] }
function Write-Error { Write-Host "[ERROR] " -NoNewline -ForegroundColor Red; Write-Host $args[0] }

# Check if command exists
function Test-Command {
    param([string]$Cmd)
    $null = Get-Command $Cmd -ErrorAction SilentlyContinue
    return $?
}

# Check Node.js
function Test-Node {
    Write-Info "Checking Node.js..."

    if (-not (Test-Command node)) {
        Write-Error "Node.js not found. Please install Node.js $NODE_MIN_VERSION+"
        Write-Host "  Download: https://nodejs.org/" -ForegroundColor Gray
        return $false
    }

    $version = node --version
    $versionNum = [int]($version -replace 'v(\d+).+', '$1')
    if ($versionNum -lt $NODE_MIN_VERSION) {
        Write-Error "Node.js version must be $NODE_MIN_VERSION+, found: $version"
        return $false
    }

    Write-Success "Node.js $version"
    return $true
}

# Check pnpm
function Test-Pnpm {
    Write-Info "Checking pnpm..."

    if (-not (Test-Command pnpm)) {
        Write-Warn "pnpm not found. Installing..."
        npm install -g pnpm
    }

    $version = pnpm --version
    Write-Success "pnom $version"
    return $true
}

# Check Docker
function Test-Docker {
    Write-Info "Checking Docker..."

    if (-not (Test-Command docker)) {
        Write-Error "Docker not found. Please install Docker Desktop"
        Write-Host "  Download: https://www.docker.com/products/docker-desktop/" -ForegroundColor Gray
        return $false
    }

    try {
        $null = docker info 2>$null
    } catch {
        Write-Error "Docker is not running. Please start Docker Desktop."
        return $false
    }

    $version = docker --version
    Write-Success "Docker $version"
    return $true
}

# Check Docker Compose
function Get-DockerCompose {
    Write-Info "Checking Docker Compose..."

    if (Test-Command "docker") {
        $composeVersion = docker compose version 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Docker Compose available (v2)"
            return "docker compose"
        }
    }

    if (Test-Command "docker-compose") {
        Write-Success "Docker Compose available (v1)"
        return "docker-compose"
    }

    Write-Error "Docker Compose not found."
    return $null
}

# Install dependencies
function Install-Deps {
    Write-Info "Installing dependencies with pnpm..."

    if (Test-Path "node_modules") {
        Write-Warn "node_modules already exists. Skipping install."
    } else {
        pnpm install --frozen-lockfile 2>$null || pnpm install
    }

    Write-Success "Dependencies installed"
}

# Setup .env file
function Initialize-EnvFile {
    Write-Info "Setting up environment..."

    if (Test-Path ".env") {
        Write-Warn ".env already exists. Skipping."
        return
    }

    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Success "Created .env from .env.example"
    } else {
        $envContent = @"
# OwnPilot Environment
PORT=8080
UI_PORT=5173
HOST=127.0.0.1
NODE_ENV=development

# Database
# Use 127.0.0.1 instead of "localhost" — on Windows localhost may resolve to ::1
# while Docker publishes the port on IPv4 only, causing silent connection failures.
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=$POSTGRES_PORT
POSTGRES_USER=$POSTGRES_USER
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=$POSTGRES_DB

# Authentication (development)
AUTH_TYPE=none

# Logging
LOG_LEVEL=info
"@
        $envContent | Out-File -FilePath ".env" -Encoding UTF8
        Write-Success "Created .env"
    }
}

# Start PostgreSQL with Docker
function Start-Postgres {
    Write-Info "Starting PostgreSQL with Docker..."

    # Check if container already running
    $running = docker ps --format '{{.Names}}' | Where-Object { $_ -eq "ownpilot-db" }
    if ($running) {
        Write-Warn "PostgreSQL container already running"
        return
    }

    # Check if container exists but stopped
    $exists = docker ps -a --format '{{.Names}}' | Where-Object { $_ -eq "ownpilot-db" }
    if ($exists) {
        Write-Info "Starting existing container..."
        docker start ownpilot-db
    } else {
        # Create and start new container
        docker run -d `
            --name ownpilot-db `
            --restart unless-stopped `
            -e POSTGRES_USER=$POSTGRES_USER `
            -e POSTGRES_PASSWORD=$POSTGRES_PASSWORD `
            -e POSTGRES_DB=$POSTGRES_DB `
            -p "${POSTGRES_PORT}:5432" `
            -v ownpilot-postgres-data:/var/lib/postgresql/data `
            pgvector/pgvector:pgvector:pg16

        # Wait for PostgreSQL to be ready
        Write-Info "Waiting for PostgreSQL to be ready..."
        $attempt = 0
        while ($attempt -lt 30) {
            $ready = docker exec ownpilot-db pg_isready -U $POSTGRES_USER 2>$null
            if ($LASTEXITCODE -eq 0) { break }
            Start-Sleep -Seconds 1
            $attempt++
        }

        if ($attempt -ge 30) {
            Write-Error "PostgreSQL failed to start"
            exit 1
        }

        Write-Success "PostgreSQL initialized"
    }

    Write-Success "PostgreSQL running on port $POSTGRES_PORT"
}

# Run database migrations
function Initialize-Database {
    Write-Info "Running database migrations..."

    Push-Location packages/gateway -ErrorAction SilentlyContinue

    # Check if there's a seed script
    if (Test-Path "src\db\migrations\postgres\001_initial_schema.sql") {
        Write-Info "Running initial schema..."
        $env:PGPASSWORD = $POSTGRES_PASSWORD
        psql -h localhost -p $POSTGRES_PORT -U $POSTGRES_USER -d $POSTGRES_DB -f src/db/migrations/postgres/001_initial_schema.sql 2>$null || $true
    }

    # Run seed if available
    if (Test-Path "scripts\seed-database.ts") {
        Write-Info "Seeding database..."
        pnpm run seed 2>$null || Write-Warn "Seed script skipped (may require API keys)"
    }

    Pop-Location

    Write-Success "Database ready"
}

# Build project
function Build-Project {
    Write-Info "Building project..."

    pnpm run build

    Write-Success "Build complete"
}

# Start development server
function Start-Development {
    Write-Info "Starting development server..."

    # Start in background
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PWD'; pnpm run dev"

    Write-Success "Development server starting..."
    Write-Info "Gateway: http://localhost:8080"
    Write-Info "UI: http://localhost:5173"
}

# Main
function Main {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  OwnPilot Setup (Windows PowerShell)" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""

    switch ($Mode) {
        "Minimal" {
            if (-not (Test-Node)) { exit 1 }
            Test-Pnpm
            Install-Deps
            Initialize-EnvFile
            Write-Success "Minimal setup complete!"
            Write-Info "Run 'pnpm run dev' to start development"
        }

        "DockerOnly" {
            if (-not (Test-Docker)) { exit 1 }
            $compose = Get-DockerCompose
            if (-not $compose) { exit 1 }
            Initialize-EnvFile
            Start-Postgres
            Initialize-Database
            Write-Success "Docker setup complete!"
            Write-Info "PostgreSQL: localhost:$POSTGRES_PORT"
        }

        "SkipInstall" {
            if (-not (Test-Node)) { exit 1 }
            if (-not (Test-Docker)) { exit 1 }
            $compose = Get-DockerCompose
            if (-not $compose) { exit 1 }
            Initialize-EnvFile
            Start-Postgres
            Initialize-Database
            Build-Project
            Start-Development
        }

        "Full" {
            if (-not (Test-Node)) { exit 1 }
            Test-Pnpm
            if (-not (Test-Docker)) { exit 1 }
            $compose = Get-DockerCompose
            if (-not $compose) { exit 1 }
            Install-Deps
            Initialize-EnvFile
            Start-Postgres
            Initialize-Database
            Build-Project
            Start-Development
        }
    }

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  Setup Complete!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
}

Main