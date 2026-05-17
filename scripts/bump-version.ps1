#Requires -Version 5.1

<#
.SYNOPSIS
    OwnPilot version bump wrapper.

.DESCRIPTION
    Delegates to scripts/bump-version.mjs so PowerShell, Bash, and pnpm all use
    the same release-safe version update logic.

.PARAMETER Version
    major, minor, patch, prerelease, or an explicit semver version.

.EXAMPLE
    .\scripts\bump-version.ps1 minor

.EXAMPLE
    .\scripts\bump-version.ps1 0.4.1
#>

param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Version
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Push-Location $RootDir
try {
    node scripts/bump-version.mjs $Version
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}
finally {
    Pop-Location
}
