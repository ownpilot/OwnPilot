#!/usr/bin/env pwsh
<#
.SYNOPSIS
    OwnPilot - Startup Script for Windows

.DESCRIPTION
    Starts the OwnPilot platform with gateway API and optional UI.

.PARAMETER Mode
    Startup mode: 'dev' (default), 'prod', or 'docker'

.PARAMETER NoUI
    Skip starting the UI (gateway only)

.PARAMETER Build
    Force rebuild before starting

.PARAMETER Port
    Gateway API port (default: 8080)

.PARAMETER UIPort
    UI dev server port (default: 5173)

.EXAMPLE
    .\start.ps1
    Starts in development mode with hot reload

.EXAMPLE
    .\start.ps1 -Mode prod
    Builds and starts in production mode

.EXAMPLE
    .\start.ps1 -NoUI
    Starts gateway only, without UI

.EXAMPLE
    .\start.ps1 -Mode docker
    Starts using Docker Compose
#>

param(
    [ValidateSet('dev', 'prod', 'docker')]
    [string]$Mode = 'dev',

    [switch]$NoUI,

    [switch]$Build,

    [int]$Port = 8080,

    [int]$UIPort = 5173
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Colors
function Write-Header { param([string]$msg) Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Write-Success { param([string]$msg) Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Info { param([string]$msg) Write-Host "[INFO] $msg" -ForegroundColor Yellow }
function Write-Err { param([string]$msg) Write-Host "[ERROR] $msg" -ForegroundColor Red }

# Banner
Write-Host @"

   ___                 ____  _ _       _
  / _ \__      ___ __ |  _ \(_) | ___ | |_
 | | | \ \ /\ / / '_ \| |_) | | |/ _ \| __|
 | |_| |\ V  V /| | | |  __/| | | (_) | |_
  \___/  \_/\_/ |_| |_|_|   |_|_|\___/ \__|
                        Gateway v0.1.0

"@ -ForegroundColor Magenta

# Check prerequisites
function Test-Prerequisites {
    Write-Header "Checking Prerequisites"

    # Node.js
    try {
        $nodeVersion = node -v
        if ($nodeVersion -match "v(\d+)") {
            $major = [int]$Matches[1]
            if ($major -lt 22) {
                Write-Err "Node.js 22+ required (found $nodeVersion)"
                exit 1
            }
        }
        Write-Success "Node.js $nodeVersion"
    } catch {
        Write-Err "Node.js not found. Install from https://nodejs.org"
        exit 1
    }

    # pnpm
    try {
        $pnpmVersion = pnpm -v
        Write-Success "pnpm $pnpmVersion"
    } catch {
        Write-Info "pnpm not found, installing..."
        npm install -g pnpm
    }

    # Docker (only for docker mode)
    if ($Mode -eq 'docker') {
        try {
            $dockerVersion = docker -v
            Write-Success "Docker $dockerVersion"
        } catch {
            Write-Err "Docker not found. Install from https://docker.com"
            exit 1
        }
    }
}

# Load environment
function Initialize-Environment {
    Write-Header "Loading Environment"

    $envFile = Join-Path $ScriptDir ".env"
    $envExampleFile = Join-Path $ScriptDir ".env.example"

    if (Test-Path $envFile) {
        Write-Success "Loading .env file"
        Get-Content $envFile | ForEach-Object {
            if ($_ -match "^([^#=]+)=(.*)$") {
                $key = $Matches[1].Trim()
                $value = $Matches[2].Trim()
                [Environment]::SetEnvironmentVariable($key, $value, "Process")
            }
        }
    } elseif (Test-Path $envExampleFile) {
        Write-Info "No .env found. Copy .env.example to .env and configure it."
        Write-Info "Continuing with default/demo settings..."
    }

    # Set defaults
    $env:PORT = $Port
    $env:HOST = "0.0.0.0"
    $env:NODE_ENV = if ($Mode -eq 'prod') { "production" } else { "development" }
}

# Install dependencies
function Install-Dependencies {
    Write-Header "Installing Dependencies"

    Set-Location $ScriptDir

    if (-not (Test-Path "node_modules")) {
        Write-Info "Installing packages..."
        pnpm install --frozen-lockfile
    } else {
        Write-Success "Dependencies already installed"
    }
}

# Build project
function Build-Project {
    Write-Header "Building Project"

    Set-Location $ScriptDir
    pnpm build

    if ($LASTEXITCODE -ne 0) {
        Write-Err "Build failed!"
        exit 1
    }
    Write-Success "Build complete"
}

# Start in development mode
function Start-DevMode {
    Write-Header "Starting Development Mode"

    Write-Info "Gateway API: http://localhost:$Port"
    if (-not $NoUI) {
        Write-Info "UI: http://localhost:$UIPort"
    }
    Write-Info "Press Ctrl+C to stop`n"

    Set-Location $ScriptDir

    # Start gateway in background
    $gatewayJob = Start-Job -ScriptBlock {
        param($dir, $port)
        Set-Location $dir
        $env:PORT = $port
        pnpm --filter @ownpilot/gateway dev
    } -ArgumentList $ScriptDir, $Port

    if (-not $NoUI) {
        # Start UI in background
        $uiJob = Start-Job -ScriptBlock {
            param($dir, $port)
            Set-Location $dir
            $env:VITE_PORT = $port
            pnpm --filter @ownpilot/ui dev
        } -ArgumentList $ScriptDir, $UIPort
    }

    # Wait and show output
    try {
        while ($true) {
            Receive-Job -Job $gatewayJob -ErrorAction SilentlyContinue
            if ($uiJob) {
                Receive-Job -Job $uiJob -ErrorAction SilentlyContinue
            }
            Start-Sleep -Milliseconds 500
        }
    } finally {
        Write-Info "`nStopping services..."
        Stop-Job -Job $gatewayJob -ErrorAction SilentlyContinue
        Remove-Job -Job $gatewayJob -Force -ErrorAction SilentlyContinue
        if ($uiJob) {
            Stop-Job -Job $uiJob -ErrorAction SilentlyContinue
            Remove-Job -Job $uiJob -Force -ErrorAction SilentlyContinue
        }
    }
}

# Start in production mode
function Start-ProdMode {
    Write-Header "Starting Production Mode"

    Write-Info "Gateway API: http://localhost:$Port"
    Write-Info "Press Ctrl+C to stop`n"

    Set-Location $ScriptDir

    # Serve gateway
    $env:PORT = $Port
    pnpm --filter @ownpilot/gateway start
}

# Start with Docker
function Start-DockerMode {
    Write-Header "Starting with Docker"

    Set-Location $ScriptDir

    if ($NoUI) {
        docker-compose up --build gateway
    } else {
        docker-compose --profile ui up --build
    }
}

# Main
try {
    Test-Prerequisites
    Initialize-Environment
    Install-Dependencies

    if ($Build -or $Mode -eq 'prod') {
        Build-Project
    }

    switch ($Mode) {
        'dev' { Start-DevMode }
        'prod' { Start-ProdMode }
        'docker' { Start-DockerMode }
    }
} catch {
    Write-Err $_.Exception.Message
    exit 1
}
