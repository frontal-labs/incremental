#!/bin/sh
# End-to-end runs of the Nx and Bazel adapters on the benchmark fixtures.
#
# For each fixture: clone its committed history into a scratch directory, run the adapter
# once to prime the store (every test runs, and the baseline advances), then commit one edit
# to a leaf package (utils) and one to the shared package. After each commit the adapter must
# select exactly the tests that the import graph says it should:
#   prime:        every project
#   edit utils:   utils only
#   edit shared:  shared, api and web (api and web depend on shared; utils does not)
#
# Requires: make build, the adapters built (adapters/nx, adapters/bazel), and the fixtures'
# dependencies installed (monorepos/nx and monorepos/bazel node_modules).
# Exit 0 when every step selects the expected tasks; exit 1 otherwise.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/incremental-fixture-e2e.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

export GIT_AUTHOR_NAME=fixture-e2e GIT_AUTHOR_EMAIL=e2e@example.com
export GIT_COMMITTER_NAME=fixture-e2e GIT_COMMITTER_EMAIL=e2e@example.com

# check <label> <output file> <expected selected, comma separated>
check() {
  python3 - "$1" "$2" "$3" <<'PY'
import json, sys
label, path, expected = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path).read().strip()
try:
    d = json.loads(text)
except json.JSONDecodeError:
    d = json.loads(text.splitlines()[0])
got = sorted(d.get("selected") or [])
want = sorted(x for x in expected.split(",") if x)
ok = got == want and d.get("exit") == 0 and d.get("advanced") is True
print(f"  {label}: selected={got} expected={want} exit={d.get('exit')} advanced={d.get('advanced')} -> {'ok' if ok else 'FAIL'}")
sys.exit(0 if ok else 1)
PY
}

fail=0
skipped=""

# fixture <name> <adapter run.js> <nx|turbo|bazel>
fixture() {
  name=$1
  adapter=$2
  kind=$3
  src="$ROOT/monorepos/$name"
  repo="$WORK/$name"
  store="$WORK/$name-store"
  # A fixture is a separate git repository. When it is not checked out here (CI does not
  # fetch it), skip it. A fixture that is present must pass.
  if [ ! -e "$src/.git" ]; then
    echo "== $name: SKIP (fixture repository not present at monorepos/$name)"
    skipped="$skipped $name"
    return 0
  fi
  echo "== $name ($kind adapter)"
  git clone -q "$src" "$repo"
  cp -R "$src/node_modules" "$repo/"
  cd "$repo"

  # Nx and Turborepo select packages, Bazel selects test targets. Each JS adapter gets its own
  # task runner from the fixture's node_modules. Bazel gets a placeholder variable.
  extra="INCREMENTAL_NX=unused INCREMENTAL_TURBO=unused"
  if [ "$kind" = nx ]; then
    tests_utils=utils
    tests_all=api,shared,utils,web
    tests_shared=api,shared,web
    extra="INCREMENTAL_NX=$repo/node_modules/.bin/nx"
  elif [ "$kind" = turbo ]; then
    tests_utils=utils
    tests_all=api,shared,utils,web
    tests_shared=api,shared,web
    extra="INCREMENTAL_TURBO=$repo/node_modules/.bin/turbo"
  else
    tests_utils=//packages/utils:utils_test
    tests_all=//packages/api:api_test,//packages/shared:shared_test,//packages/utils:utils_test,//packages/web:web_test
    tests_shared=//packages/api:api_test,//packages/shared:shared_test,//packages/web:web_test
  fi

  # The environment is pinned, so the shell does not change the context hash between runs
  # (variables such as _ and OLDPWD would make the adapter fall back to running everything).
  run_step() {
    out="$WORK/$name-$1.out"
    env -i HOME="$HOME" PATH="$PATH" \
      XDG_DATA_HOME="${XDG_DATA_HOME:-}" XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-}" \
      XDG_STATE_HOME="${XDG_STATE_HOME:-}" XDG_CACHE_HOME="${XDG_CACHE_HOME:-}" \
      "$extra" node "$adapter" run --store "$store" --root "$repo" --json >"$out" 2>"$out.err" || true
    echo "$out"
  }

  out=$(run_step prime)
  check "prime" "$out" "$tests_all" || fail=1

  echo "export const touched_utils = 1;" >>"packages/utils/src/index.ts"
  git commit -qam "edit utils"
  out=$(run_step utils)
  check "edit utils" "$out" "$tests_utils" || fail=1

  echo "export const touched_shared = 1;" >>"packages/shared/src/index.ts"
  git commit -qam "edit shared"
  out=$(run_step shared)
  check "edit shared" "$out" "$tests_shared" || fail=1

  cd "$ROOT"
}

if [ -z "${INCREMENTAL_FIXTURE_E2E_SKIP_NX:-}" ]; then
  fixture nx "$ROOT/adapters/nx/dist/src/run.js" nx
fi
fixture turborepo "$ROOT/adapters/turbo/dist/src/run.js" turbo
fixture bazel "$ROOT/adapters/bazel/dist/src/run.js" bazel

if [ "$fail" -eq 0 ]; then
  if [ -n "$skipped" ]; then
    echo "PASS fixture-e2e (skipped:$skipped)"
  else
    echo "PASS fixture-e2e"
  fi
else
  echo "FAIL fixture-e2e"
  exit 1
fi
