#!/usr/bin/env bash
set -euo pipefail

# OwnPilot version bump wrapper.
# Usage: ./scripts/bump-version.sh <major|minor|patch|prerelease|x.y.z>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"
node scripts/bump-version.mjs "$@"
