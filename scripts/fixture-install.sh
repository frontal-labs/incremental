#!/bin/sh
# Installs the test dependencies of the monorepo fixtures, each in isolation, and reverts the
# package.json rewrite that pnpm makes (it changes `typescript` to an npm alias). Turbo counts
# uncommitted edits, so the revert is part of the install.
#
#   sh scripts/fixture-install.sh [nx turborepo bazel]
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
FIXTURES=${*:-nx turborepo bazel}
for name in $FIXTURES; do
  dir="$ROOT/monorepos/$name"
  echo "== $name"
  (cd "$dir" && pnpm install --ignore-workspace --no-lockfile >/dev/null)
  git -C "$dir" checkout -- package.json
  dirty=$(git -C "$dir" status --porcelain | grep -v '^?? README.md$' || true)
  if [ -n "$dirty" ]; then
    echo "  uncommitted changes remain in monorepos/$name:"
    echo "$dirty"
    exit 1
  fi
  echo "  installed; working tree clean"
done
echo "PASS fixture-install"
