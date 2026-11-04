#!/usr/bin/env bash
# Agent loop driver for M8 benchmark.
# Usage: ./agent_loop.sh
set -euo pipefail

ENGINE="${BACKPLANE_ENGINE:-core/dist/backplane}"
STORE="${BACKPLANE_STORE:-.backplane-agent-loop}"
ROOT="$(pwd)"

echo "Initializing store at $STORE..."
"$ENGINE" init --store "$STORE"

# Create a simple context file
cat > context.json <<'EOF'
{
  "lockfile": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "tsconfig": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "pkgjson": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "runner": "vitest@4.1.12",
  "node": "22.11.0",
  "fmt": 1,
  "caps": {"probes": true, "dirs": true, "env": true}
}
EOF

for agents in 1 5 20; do
  echo "=== Agents: $agents ==="
  start_ns=$(date +%s%N)

  # Simulate agents editing shared fixture
  bash "$ROOT/edit_fixture.sh"

  # Get current baseline
  baseline=$("$ENGINE" baseline --store "$STORE")

  # Build changeset: the file we just edited
  changeset=$(cat <<JSONEOF
{"baseline":"$baseline","head":"$baseline","changes":[{"path":"packages/core/src/math.ts","status":"modified"}]}
JSONEOF
)

  # Ask for the plan
  plan=$("$ENGINE" affected \
    --changes - \
    --baseline "$baseline" \
    --context context.json \
    <<< "$changeset"
  )

  # Parse plan results
  invalid=$(echo "$plan" | node -e 'const d=require("fs").readFileSync(0,"utf8");const p=JSON.parse(d);console.log(p.tasks.length)' 2>/dev/null || echo 0)
  total=$(echo "$plan" | node -e 'const d=require("fs").readFileSync(0,"utf8");const p=JSON.parse(d);console.log(p.total_tasks)' 2>/dev/null || echo 0)
  skipped=$((total - invalid))
  skip_share="0"
  if [ "$total" -gt 0 ]; then
    skip_share=$(awk "BEGIN {printf \"%.1f\", $skipped/$total*100}")
  fi

  # Run only invalid tests (if vitest is available)
  if command -v npx >/dev/null 2>&1; then
    test_files=$(echo "$plan" | node -e '
      const d=require("fs").readFileSync(0,"utf8");
      const p=JSON.parse(d);
      p.tasks.forEach(t=>console.log(t.id));
    ' 2>/dev/null || true)
    if [ -n "$test_files" ]; then
      echo "$test_files" | xargs -r npx vitest run --reporter=verbose 2>/dev/null || true
    fi
  fi

  end_ns=$(date +%s%N)
  elapsed_ms=$(( (end_ns - start_ns) / 1000000 ))

  echo "total=$total invalid=$invalid skipped=$skipped skip_share=${skip_share}% elapsed_ms=$elapsed_ms"
done