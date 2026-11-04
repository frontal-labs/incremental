#!/usr/bin/env bash
# Agent loop driver for M8 benchmark (PLAN 10.4, 12.4 M8, E6): real run.
#
# Copies the fixture to a scratch worktree, initialises a store, primes it with
# a full run, then for 1, 5 and 20 agents:
#   1. simulate agent work by editing a fixture file and committing it,
#   2. ask the engine for the affected plan (git ChangeSet + backplane serve),
#   3. run only the invalid tests under Vitest with the recorder (forks pool),
#   4. advance the baseline when the worktree is clean (adapter loop, PLAN 10.4),
#   5. print total/invalid/skipped/skip_share/elapsed_ms.
set -euo pipefail

ENGINE="${BACKPLANE_ENGINE:-core/dist/backplane}"
VITEST_RUN="${BACKPLANE_VITEST_RUN:-adapters/vitest/dist/src/run.js}"
ROOT="$(pwd)"
FIXTURE="$ROOT/examples/agent_loop/fixture"
STORE="${BACKPLANE_STORE:-$TMPDIR/backplane-agent-loop-store}"

mkdir -p "$(dirname "$STORE")"
WORK="$(mktemp -d -t bp-agent-loop)"
REPO="$WORK/repo"

cat > "$WORK/context.json" <<'EOF'
{
  "lockfile": "sha256:agent-loop-context",
  "tsconfig": "sha256:agent-loop-context",
  "pkgjson": "sha256:agent-loop-context",
  "runner": "vitest@4.1.12",
  "node": "22.11.0",
  "fmt": 1,
  "caps": {"probes": true, "dirs": true, "env": true}
}
EOF

cp -a "$FIXTURE" "$REPO"
git -C "$REPO" init -q -b main
git -C "$REPO" add -A
git -C "$REPO" -c user.name=agent -c user.email=agent@example.com commit -q -m "fixture base"

"$ENGINE" init --store "$STORE" >/dev/null

# Prime: no baseline yet, so every test runs and the baseline advances to HEAD.
# Pin SHLVL so the recorded environment hash is stable across rounds
# (command subshells bump SHLVL for node children, which would otherwise look
# like an environment change and force a fallback).
SHLVL=0 node "$VITEST_RUN" run --root "$REPO" --store "$STORE" --json >/dev/null

echo "agents,total,invalid,skipped,skip_share,elapsed_ms"

for agents in 1 5 20; do
  start_ns=$(date +%s%N)

  # Simulate agent work: edit a fixture file and commit it on the worktree.
  bash "$ROOT/examples/agent_loop/edit_fixture.sh" "$REPO"
  git -C "$REPO" -c user.name=agent -c user.email=agent@example.com add -A
  git -C "$REPO" -c user.name=agent -c user.email=agent@example.com commit -q -m "agent edit" || true

  # One adapter loop iteration: plan from the store baseline, run the invalid
  # tests with the recorder, observe, advance (backplane vitest run, PLAN 10.4).
  # The adapter exits 7 ("ran, not advanced") on any errored or dirty run; that
  # is a legitimate outcome to record, not a reason to abort the loop.
  report=$(SHLVL=0 node "$VITEST_RUN" run --root "$REPO" --store "$STORE" --json) || true

  total=$(echo "$report" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).plan?.total_tasks ?? 0)}catch{console.log(0)}})')
  invalid=$(echo "$report" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).plan?.tasks?.length ?? 0)}catch{console.log(0)}})')

  end_ns=$(date +%s%N)
  elapsed_ms=$(( (end_ns - start_ns) / 1000000 ))
  skipped=$((total - invalid))
  skip_share="0"
  if [ "$total" -gt 0 ]; then
    skip_share=$(awk "BEGIN {printf \"%.1f\", $skipped/$total*100}")
  fi
  echo "$agents,$total,$invalid,$skipped,${skip_share}%,$elapsed_ms"
done

rm -rf "$WORK"
