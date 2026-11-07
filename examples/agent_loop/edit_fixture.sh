#!/usr/bin/env bash
# Edit a fixture file to simulate agent work. Usage: edit_fixture.sh [repo-dir]
# Appends a unique marker line on every call so each round is a real content
# change to packages/core/src/math.ts (invalidating the test that reads it).
set -euo pipefail
REPO="${1:-.}"
echo "// agent edit $(date +%s%N)" >> "$REPO/packages/core/src/math.ts"
