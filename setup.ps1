#Requires -Version 5.1

<#
.SYNOPSIS
    OwnPilot Interactive Setup Wizard for Windows
.DESCRIPTION
    Walks through the full setup interactively: prerequisites, config, .env generation,
    Docker PostgreSQL, dependency install, and build.
#>

$ErrorActionPreference = "Stop"

# ─── Helpers ──────────────────────────────────────────────────────────────────
function Write-Info($msg)  { Write-Host "  i  $msg" -ForegroundColor Blue }
function Write-Ok($msg)    { Write-Host "  +  $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "  !  $msg" -ForegroundColor Yellow }
function Write-Fail($msg)  { Write-Host "  x  $msg" -ForegroundColor Red }

function Write-Section($title) {
    Write-Host ""
    Write-Host "--- $title ---" -ForegroundColor Blue -NoNewline:$false
    Write-Host ""
}

function Ask {
    param(
        [string]$Prompt,
        [string]$Default
    )
    $display = if ($Default) { "[$Default]" } else { "[]" }
    $input = Read-Host "  ?  $Prompt $display"
    if ([string]::IsNullOrWhiteSpace($input)) { return $Default }
    return $input
}

function Ask-Secret {
    param(
        [string]$Prompt,
        [string]$Default
    )
    $display = if ($Default) { "[$Default]" } else { "[]" }
    $secure = Read-Host "  ?  $Prompt $display" -AsSecureString
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    )
    if ([string]::IsNullOrWhiteSpace($plain)) { return $Default }
    return $plain
}

function Ask-Choice {
    param(
        [string]$Prompt,
        [string]$Default,
        [string[]]$Options
    )
    Write-Host "  ?  $Prompt" -ForegroundColor Cyan
    foreach ($opt in $Options) {
        $marker = if ($opt -eq $Default) { " -> " } else { "    " }
        Write-Host "$marker$opt"
    }
    $input = Read-Host "     Choose [$Default]"
    if ([string]::IsNullOrWhiteSpace($input)) { return $Default }
    return $input
}

function Generate-RandomHex([int]$Length = 32) {
    $bytes = New-Object byte[] ($Length / 2)
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return ($bytes | ForEach-Object { $_.ToString("x2") }) -join ''
}

# ─── Banner ───────────────────────────────────────────────────────────────────
Clear-Host
Write-Host @"

   ___                 ____  _ _       _
  / _ \__      ___ __ |  _ \(_) | ___ | |_
 | | | \ \ /\ / / '_ \| |_) | | |/ _ \| __|
 | |_| |\ V  V /| | | |  __/| | | (_) | |_
  \___/  \_/\_/ |_| |_|_|   |_|_|\___/ \__|

"@ -ForegroundColor Cyan

Write-Host "  Privacy-first personal AI assistant" -ForegroundColor White
Write-Host "  Interactive Setup Wizard"
Write-Host ""

# ─── Idempotency check ───────────────────────────────────────────────────────
if (Test-Path ".env") {
    Write-Warn "An existing .env file was found."
    $overwrite = Read-Host "  ?  Overwrite it? (y/N)"
    if ($overwrite -notmatch '^[Yy]$') {
        Write-Info "Setup cancelled. Your .env was not modified."
        exit 0
    }
    Write-Host ""
}

# ─── Prerequisites ────────────────────────────────────────────────────────────
Write-Section "Checking Prerequisites"

$prereqsOk = $true

# Node.js
if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeVersion = (node -v).TrimStart('v')
    $nodeMajor = [int]($nodeVersion.Split('.')[0])
    if ($nodeMajor -ge 22) {
        Write-Ok "Node.js v$nodeVersion"
    } else {
        Write-Fail "Node.js v$nodeVersion found - v22+ required"
        $prereqsOk = $false
    }
} else {
    Write-Fail "Node.js not found - install v22+ from https://nodejs.org"
    $prereqsOk = $false
}

# pnpm
if (Get-Command pnpm -ErrorAction SilentlyContinue) {
    $pnpmVersion = pnpm -v
    $pnpmMajor = [int]($pnpmVersion.Split('.')[0])
    if ($pnpmMajor -ge 9) {
        Write-Ok "pnpm v$pnpmVersion"
    } else {
        Write-Fail "pnpm v$pnpmVersion found - v9+ required"
        $prereqsOk = $false
    }
} else {
    Write-Fail "pnpm not found - install with: npm install -g pnpm"
    $prereqsOk = $false
}

# Docker
$hasDocker = $false
if (Get-Command docker -ErrorAction SilentlyContinue) {
    $dockerVersion = (docker --version) -replace '.*?(\d+\.\d+\.\d+).*', '$1'
    Write-Ok "Docker v$dockerVersion"
    $hasDocker = $true
} else {
    Write-Warn "Docker not found - needed if you want to run PostgreSQL in a container"
}

# Docker Compose
$hasCompose = $false
if ($hasDocker) {
    try {
        $composeOut = docker compose version 2>&1
        if ($LASTEXITCODE -eq 0) {
            $composeVersion = ($composeOut -replace '.*?(\d+\.\d+\.\d+).*', '$1')
            Write-Ok "Docker Compose v$composeVersion"
            $hasCompose = $true
        }
    } catch {
        Write-Warn "Docker Compose not found - needed for containerized PostgreSQL"
    }
} else {
    Write-Warn "Docker Compose not found - needed for containerized PostgreSQL"
}

if (-not $prereqsOk) {
    Write-Host ""
    Write-Fail "Please install the missing prerequisites and re-run this script."
    exit 1
}

# ─── AI Provider Keys ────────────────────────────────────────────────────────
Write-Section "AI Provider Configuration"

Write-Info "You need at least one AI provider API key to use OwnPilot."
Write-Host ""

$openaiKey = Ask-Secret -Prompt "OpenAI API key (Enter to skip)" -Default ""
$anthropicKey = Ask-Secret -Prompt "Anthropic API key (Enter to skip)" -Default ""

if ([string]::IsNullOrWhiteSpace($openaiKey) -and [string]::IsNullOrWhiteSpace($anthropicKey)) {
    Write-Warn "No AI provider keys set. You'll need to add one to .env before using OwnPilot."
}

# ─── Server Configuration ────────────────────────────────────────────────────
Write-Section "Server Configuration"

$port = Ask -Prompt "HTTP port" -Default "8080"
$host_ = Ask -Prompt "Bind address" -Default "0.0.0.0"
$nodeEnv = Ask-Choice -Prompt "Environment" -Default "development" -Options @("development", "production")
$corsOrigins = Ask -Prompt "CORS origins (comma-separated)" -Default "http://localhost:3000,http://localhost:5173"

# ─── Authentication ──────────────────────────────────────────────────────────
Write-Section "Authentication"

$authType = Ask-Choice -Prompt "Auth type" -Default "none" -Options @("none", "api-key", "jwt")

$apiKeys = ""
$jwtSecret = ""

switch ($authType) {
    "api-key" {
        $defaultKey = "change-me-$(Generate-RandomHex 8)"
        $apiKeys = Ask -Prompt "API keys (comma-separated)" -Default $defaultKey
    }
    "jwt" {
        $jwtSecret = Generate-RandomHex 32
        Write-Ok "Generated JWT secret: $($jwtSecret.Substring(0, 8))..."
    }
}

# ─── Database ─────────────────────────────────────────────────────────────────
Write-Section "Database (PostgreSQL)"

$pgHost = Ask -Prompt "PostgreSQL host" -Default "localhost"
$pgPort = Ask -Prompt "PostgreSQL port" -Default "25432"
$pgUser = Ask -Prompt "PostgreSQL user" -Default "ownpilot"
$pgPassword = Ask-Secret -Prompt "PostgreSQL password" -Default "ownpilot_secret"
$pgDb = Ask -Prompt "PostgreSQL database name" -Default "ownpilot"

$useDockerPg = "n"
if ($hasDocker -and $hasCompose) {
    $useDockerPg = Read-Host "  ?  Start PostgreSQL with Docker? [Y/n]"
    if ([string]::IsNullOrWhiteSpace($useDockerPg)) { $useDockerPg = "y" }
}

# ─── Telegram (Optional) ─────────────────────────────────────────────────────
Write-Section "Telegram Bot (Optional)"

Write-Info "Get a bot token from @BotFather on Telegram."
Write-Info "Allowed users/chats are configured in the Config Center UI after setup."
$telegramToken = Ask-Secret -Prompt "Telegram bot token (Enter to skip)" -Default ""

# ─── Generate .env ────────────────────────────────────────────────────────────
Write-Section "Generating .env"

$timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss 'UTC'")

$envContent = @"
# OwnPilot Configuration
# Generated by setup.ps1 on $timestamp

# ===========================================
# AI Provider API Keys
# ===========================================
OPENAI_API_KEY=$openaiKey
ANTHROPIC_API_KEY=$anthropicKey

# ===========================================
# Server Configuration
# ===========================================
PORT=$port
HOST=$host_
NODE_ENV=$nodeEnv
CORS_ORIGINS=$corsOrigins

# ===========================================
# Authentication
# ===========================================
AUTH_TYPE=$authType
API_KEYS=$apiKeys
JWT_SECRET=$jwtSecret

# ===========================================
# Database (PostgreSQL)
# ===========================================
POSTGRES_HOST=$pgHost
POSTGRES_PORT=$pgPort
POSTGRES_USER=$pgUser
POSTGRES_PASSWORD=$pgPassword
POSTGRES_DB=$pgDb
# DATABASE_URL=postgresql://${pgUser}:${pgPassword}@${pgHost}:${pgPort}/${pgDb}

# ===========================================
# Telegram Bot
# ===========================================
TELEGRAM_BOT_TOKEN=$telegramToken

# ===========================================
# Rate Limiting
# ===========================================
RATE_LIMIT_DISABLED=false
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=500

# ===========================================
# Security & Encryption
# ===========================================
ENCRYPTION_KEY=

# ===========================================
# Logging
# ===========================================
LOG_LEVEL=info
DB_VERBOSE=false
"@

$envContent | Set-Content -Path ".env" -Encoding UTF8
Write-Ok ".env file created"

# ─── Start PostgreSQL with Docker ─────────────────────────────────────────────
if ($useDockerPg -match '^[Yy]$') {
    Write-Section "Starting PostgreSQL"

    Write-Info "Running: docker compose -f docker-compose.db.yml up -d"
    docker compose -f docker-compose.db.yml up -d

    Write-Info "Waiting for PostgreSQL to be ready..."
    $retries = 0
    $maxRetries = 30
    $ready = $false

    while (-not $ready -and $retries -lt $maxRetries) {
        try {
            $result = docker compose -f docker-compose.db.yml exec -T postgres pg_isready -U $pgUser -d $pgDb 2>&1
            if ($LASTEXITCODE -eq 0) {
                $ready = $true
            }
        } catch {}

        if (-not $ready) {
            $retries++
            Start-Sleep -Seconds 1
            Write-Host "." -NoNewline
        }
    }
    Write-Host ""

    if ($ready) {
        Write-Ok "PostgreSQL is ready"
    } else {
        Write-Fail "PostgreSQL did not become ready in time. Check: docker compose -f docker-compose.db.yml logs"
        exit 1
    }
}

# ─── Install Dependencies ────────────────────────────────────────────────────
Write-Section "Installing Dependencies"

Write-Info "Running: pnpm install"
pnpm install

Write-Ok "Dependencies installed"

# ─── Build ────────────────────────────────────────────────────────────────────
Write-Section "Building Project"

Write-Info "Running: pnpm run build"
pnpm run build

Write-Ok "Build complete"

# ─── Summary ──────────────────────────────────────────────────────────────────
Write-Section "Setup Complete!"

Write-Host "  OwnPilot is ready to go." -ForegroundColor Green
Write-Host ""
Write-Host "  Configuration:"
Write-Host "    Server:    http://${host_}:${port}"
Write-Host "    Database:  PostgreSQL @ ${pgHost}:${pgPort}/${pgDb}"
if (-not [string]::IsNullOrWhiteSpace($telegramToken)) {
    Write-Host "    Telegram:  configured"
}
Write-Host "    Auth:      $authType"
Write-Host ""
Write-Host "  Quick start:"
Write-Host "    pnpm run dev       " -ForegroundColor Cyan -NoNewline
Write-Host "Start in development mode"
Write-Host "    pnpm run start     " -ForegroundColor Cyan -NoNewline
Write-Host "Start in production mode"
Write-Host ""
Write-Host "  Useful commands:"
Write-Host "    pnpm run test      " -ForegroundColor Cyan -NoNewline
Write-Host "Run test suite"
Write-Host "    pnpm run lint      " -ForegroundColor Cyan -NoNewline
Write-Host "Check for lint errors"
Write-Host ""
