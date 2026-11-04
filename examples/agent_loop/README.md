# Agent Loop Example (M8 Benchmark)

Demonstrates benchmark M8: Agent loop (edit to feedback) with 1, 5 and 20 agents on separate worktrees sharing one store. Target: at least 2x faster than full suite.

Per PLAN.md §12.4 M8 and §1180: "Build `examples/agent_loop/`: edit a fixture file, ask the plan, run the selected tests, print timings."

## Layout

```
examples/agent_loop/
├── README.md              # this file
├── fixture/               # synthetic Vitest monorepo fixture
│   ├── packages/
│   │   ├── core/
│   │   │   ├── src/
│   │   │   │   ├── math.ts
│   │   │   │   └── math.test.ts
│   │   │   └── package.json
│   │   └── app/
│   │       ├── src/
│   │       │   ├── app.ts
│   │       │   └── app.test.ts
│   │       └── package.json
│   └── vitest.config.ts
├── agent_loop.sh          # drives the agent loop: edit → plan → run → time
├── edit_fixture.sh        # edits a fixture file (simulates agent work)
├── run_tests.sh           # runs the selected (invalid) tests
└── results.json           # benchmark results (timings, skip share)
```

## agent_loop.sh

```bash
#!/usr/bin/env bash
# Agent loop: for each agent count (1, 5, 20):
#   1. Edit a fixture file
#   2. Ask the engine for the affected plan
#   3. Run only the invalid tests
#   4. Print timings and skip share
set -euo pipefail

ENGINE=core/dist/backplane
STORE=.backplane-agent-loop
ROOT=$(pwd)

ENGINE=core/dist/backplane
STORE=.backplane-agent-loop

$ENGINE init --store "$STORE"

for agents in 1 5 20; do
  echo "=== Agents: $agents ==="
  start=$(date +%s%N)

  # Simulate agents editing shared fixture
  ./edit_fixture.sh

  # Ask for the plan
  plan=$($ENGINE affected \
    --changes - \
    --baseline "$($ENGINE baseline --store "$STORE")" \
    --context context.json \
    <<'EOF'
{"baseline":"<BASELINE>","head":"<HEAD>","changes":[{"path":"packages/core/src/math.ts","status":"modified"}]}
EOF
  )

  # Count invalid vs total
  invalid=$(echo "$plan" | node -e 'const p=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(p.tasks.length)')
  total=$(echo "$plan" | node -e 'const p=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(p.total_tasks)')
  skipped=$((total - invalid))
  skip_share=$(awk "BEGIN {printf \"%.1f\", $skipped/$total*100}")

  # Run only the invalid tests
  ./run_tests.sh "$plan"

  end=$(date +%s%N)
  elapsed_ms=$(( (end - start) / 1000000 ))

  echo "total=$total invalid=$invalid skipped=$skipped skip_share=${skip_share}% elapsed_ms=$elapsed_ms"
done
```

## edit_fixture.sh

```bash
#!/usr/bin/env bash
# Edit a fixture file to simulate agent work.
echo "export const VERSION = 2;" >> packages/core/src/math.ts
```

## run_tests.sh

```bash
#!/usr/bin/env bash
# Run only the invalid tests from the plan.
set -euo pipefail
PLAN_FILE="${1:-/dev/stdin}"
npx vitest run --reporter=verbose $(node -e '
const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
p.tasks.forEach(t=>console.log(t.id));
' "$PLAN_FILE")
```

## Expected results

| Agents | Total | Invalid | Skipped | Skip Share | Elapsed |
|--------|-------|---------|---------|------------|---------|
| 1      | N     | k       | N-k     | (N-k)/N    | T1 ms   |
| 5      | N     | k       | N-k     | (N-k)/N    | T5 ms   |
| 20     | N     | k       | N-k     | (N-k)/N    | T20 ms  |

Target: skip share >= 70% on leaf edits (M6), and agent loop >= 2x faster than full suite (M8).

## Reference

- `plans/PLAN.md` section 12.4 (M8) and section 1180 (agent loop build step).
- `docs/benchmarks/BENCHMARKS_AND_GATES.md` — benchmark targets and methodology.
- `docs/adapters/ADAPTERS.md` — adapter loop contract (section 10.4).
- `docs/spec/PROTOCOL.md` — affected method and plan shape.
