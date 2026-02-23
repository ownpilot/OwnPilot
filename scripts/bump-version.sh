#!/usr/bin/env bash
set -euo pipefail

# ─── OwnPilot Version Bump Script ────────────────────────────────────────────
# Usage: ./scripts/bump-version.sh <new-version>
# Example: ./scripts/bump-version.sh 0.2.0
#
# Updates version in ALL locations across the monorepo:
#   - package.json (root + all workspace packages)
#   - Core VERSION constant (packages/core/src/index.ts)
#   - Startup script banners (start.sh, start.ps1)
#   - docs/ARCHITECTURE.md version header
#
# After running, review changes and commit:
#   git add -A && git commit -m "chore: bump version to vX.Y.Z"
#   git tag vX.Y.Z
#   git push origin main --tags
# ──────────────────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info() { echo -e "${CYAN}>${NC} $1"; }
ok()   { echo -e "${GREEN}+${NC} $1"; }
fail() { echo -e "${RED}x${NC} $1"; exit 1; }

# ─── Validate input ──────────────────────────────────────────────────────────
if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <new-version>"
  echo "Example: $0 0.2.0"
  exit 1
fi

NEW_VERSION="$1"

# Validate semver format (basic check)
if ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
  fail "Invalid version format: $NEW_VERSION (expected: X.Y.Z or X.Y.Z-pre.N)"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"

# ─── Detect current version ──────────────────────────────────────────────────
CURRENT_VERSION=$(node -e "console.log(require('./packages/core/package.json').version)")
info "Current version: ${BOLD}${CURRENT_VERSION}${NC}"
info "New version:     ${BOLD}${NEW_VERSION}${NC}"
echo

if [[ "$CURRENT_VERSION" == "$NEW_VERSION" ]]; then
  fail "Version is already $NEW_VERSION"
fi

# ─── Update package.json files ────────────────────────────────────────────────
for pkg in \
  package.json \
  packages/core/package.json \
  packages/gateway/package.json \
  packages/cli/package.json \
  packages/ui/package.json \
  packages/channels/package.json; do

  if [[ -f "$pkg" ]]; then
    sed -i "s/\"version\": \"${CURRENT_VERSION}\"/\"version\": \"${NEW_VERSION}\"/" "$pkg"
    ok "$pkg"
  fi
done

# ─── Update core VERSION constant ────────────────────────────────────────────
CORE_INDEX="packages/core/src/index.ts"
if [[ -f "$CORE_INDEX" ]]; then
  sed -i "s/export const VERSION = '${CURRENT_VERSION}'/export const VERSION = '${NEW_VERSION}'/" "$CORE_INDEX"
  ok "$CORE_INDEX (VERSION constant)"
fi

# ─── Update startup script banners ────────────────────────────────────────────
for script in start.sh start.ps1; do
  if [[ -f "$script" ]]; then
    sed -i "s/Gateway v${CURRENT_VERSION}/Gateway v${NEW_VERSION}/" "$script"
    ok "$script (banner)"
  fi
done

# ─── Update docs/ARCHITECTURE.md version ──────────────────────────────────────
ARCH_DOC="docs/ARCHITECTURE.md"
if [[ -f "$ARCH_DOC" ]]; then
  sed -i "s/\*\*Version:\*\* ${CURRENT_VERSION}/**Version:** ${NEW_VERSION}/" "$ARCH_DOC"
  ok "$ARCH_DOC"
fi

# ─── Summary ──────────────────────────────────────────────────────────────────
echo
echo -e "${GREEN}${BOLD}Version bumped: ${CURRENT_VERSION} -> ${NEW_VERSION}${NC}"
echo
echo "Next steps:"
echo "  1. Update CHANGELOG.md with new version entry"
echo "  2. Review changes: git diff"
echo "  3. Commit:         git add -A && git commit -m \"chore: bump version to v${NEW_VERSION}\""
echo "  4. Tag:            git tag v${NEW_VERSION}"
echo "  5. Push:           git push origin main --tags"
echo "  6. Release workflow will build Docker image and create GitHub Release"
