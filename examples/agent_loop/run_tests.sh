#!/usr/bin/env bash
# Run only the invalid tests from a plan file, under Vitest with the forks pool.
set -euo pipefail

REPO="${1:-.}"
PLAN_FILE="${2:-/dev/stdin}"
ROOT="$(pwd)"
VITEST="$ROOT/adapters/vitest/node_modules/vitest/vitest.mjs"

mapfile -t test_files < <(node -e '
  const fs = require("fs");
  let d = "";
  process.stdin.on("data", c => d += c);
  process.stdin.on("end", () => {
    try {
      const p = JSON.parse(d);
      p.tasks.forEach(t => console.log(t.id));
    } catch { /* no runnable tasks */ }
  });
' < "$PLAN_FILE")

if [ "${#test_files[@]}" -gt 0 ]; then
  printf '%s\n' "${test_files[@]}" | xargs node "$VITEST" run --root "$REPO" --pool=forks --reporter=verbose
else
  echo "no invalid tests to run"
fi
