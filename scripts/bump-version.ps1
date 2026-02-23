#Requires -Version 5.1

<#
.SYNOPSIS
    OwnPilot Version Bump Script

.DESCRIPTION
    Updates version in ALL locations across the monorepo:
      - package.json (root + all workspace packages)
      - Core VERSION constant (packages/core/src/index.ts)
      - Startup script banners (start.sh, start.ps1)
      - docs/ARCHITECTURE.md version header

.PARAMETER Version
    The new version number (e.g., 0.2.0)

.EXAMPLE
    .\scripts\bump-version.ps1 -Version 0.2.0
#>

param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Version
)

$ErrorActionPreference = "Stop"

function Write-Ok($msg)   { Write-Host "  +  $msg" -ForegroundColor Green }
function Write-Info($msg)  { Write-Host "  >  $msg" -ForegroundColor Cyan }
function Write-Fail($msg)  { Write-Host "  x  $msg" -ForegroundColor Red; exit 1 }

# Validate semver format
if ($Version -notmatch '^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$') {
    Write-Fail "Invalid version format: $Version (expected: X.Y.Z or X.Y.Z-pre.N)"
}

$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $RootDir

# Detect current version
$corePkg = Get-Content "packages/core/package.json" -Raw | ConvertFrom-Json
$CurrentVersion = $corePkg.version

Write-Info "Current version: $CurrentVersion"
Write-Info "New version:     $Version"
Write-Host ""

if ($CurrentVersion -eq $Version) {
    Write-Fail "Version is already $Version"
}

# Update package.json files
$packageFiles = @(
    "package.json",
    "packages/core/package.json",
    "packages/gateway/package.json",
    "packages/cli/package.json",
    "packages/ui/package.json",
    "packages/channels/package.json"
)

foreach ($pkg in $packageFiles) {
    if (Test-Path $pkg) {
        $content = Get-Content $pkg -Raw
        $content = $content -replace "`"version`": `"$CurrentVersion`"", "`"version`": `"$Version`""
        Set-Content -Path $pkg -Value $content -NoNewline
        Write-Ok $pkg
    }
}

# Update core VERSION constant
$coreIndex = "packages/core/src/index.ts"
if (Test-Path $coreIndex) {
    $content = Get-Content $coreIndex -Raw
    $content = $content -replace "export const VERSION = '$CurrentVersion'", "export const VERSION = '$Version'"
    Set-Content -Path $coreIndex -Value $content -NoNewline
    Write-Ok "$coreIndex (VERSION constant)"
}

# Update startup script banners
foreach ($script in @("start.sh", "start.ps1")) {
    if (Test-Path $script) {
        $content = Get-Content $script -Raw
        $content = $content -replace "Gateway v$CurrentVersion", "Gateway v$Version"
        Set-Content -Path $script -Value $content -NoNewline
        Write-Ok "$script (banner)"
    }
}

# Update docs/ARCHITECTURE.md
$archDoc = "docs/ARCHITECTURE.md"
if (Test-Path $archDoc) {
    $content = Get-Content $archDoc -Raw
    $content = $content -replace "\*\*Version:\*\* $CurrentVersion", "**Version:** $Version"
    Set-Content -Path $archDoc -Value $content -NoNewline
    Write-Ok $archDoc
}

# Summary
Write-Host ""
Write-Host "  Version bumped: $CurrentVersion -> $Version" -ForegroundColor Green
Write-Host ""
Write-Host "  Next steps:"
Write-Host "    1. Update CHANGELOG.md with new version entry"
Write-Host "    2. Review changes: git diff"
Write-Host "    3. Commit:         git add -A && git commit -m `"chore: bump version to v$Version`""
Write-Host "    4. Tag:            git tag v$Version"
Write-Host "    5. Push:           git push origin main --tags"
Write-Host "    6. Release workflow will build Docker image and create GitHub Release"
