# Agent Loop Example (M8 Benchmark)

Demonstrates benchmark M8: Agent loop (edit to feedback) with 1, 5 and 20 agents on separate worktrees sharing one store. Target: at least 2x faster than full suite.

Per PLAN.md §12.4 M8 and §15.4 E6: "Build `examples/agent_loop/`: edit a fixture file, ask the plan, run the selected tests, print timings." The loop follows the adapter contract (PLAN §10.4): baseline → ChangeSet → plan → run invalid → advance only on a clean complete run.

## Layout

```
examples/agent_loop/
├── README.md              # this file
├── fixture/               # synthetic Vitest fixture (core + app packages)
│   ├── packages/
│   │   ├── core/
│   │   │   ├── src/
│   │   │   │   ├── math.ts
│   │   │   │   └── math.test.ts
│   │   │   └── app/
│   │   │       ├── src/
│   │   │       │   ├── app.ts
│   │   │       │   └── app.test.ts
│   │   └── package.json
│   └── vitest.config.ts   # plain object config, no vitest import (CR-001)
├── agent_loop.sh          # drives the agent loop: edit → plan → run → time
├── edit_fixture.sh        # edits a fixture file (simulates agent work)
└── run_tests.sh           # runs the selected (invalid) tests from a plan
```

## agent_loop.sh

```bash
# for each agent count (1, 5, 20):
#   1. edit a fixture file and commit it (agent work)
#   2. stats → baseline; git change source → ChangeSet baseline→worktree
#   3. engine affected → plan of invalid tests
#   4. run_tests.sh runs only the invalid tests (vitest, forks pool)
#   5. advance baseline to HEAD when the worktree is clean (PLAN 10.4)
#   6. print total/invalid/skipped/skip_share/elapsed_ms
```

## Expected results

| Agents | Total | Invalid | Skipped | Skip Share | Elapsed |
|--------|-------|---------|---------|------------|---------|
| 1      | 2     | 2       | 0       | 0.0%       | T1 ms   |
| 5      | 2     | 1       | 1       | 50.0%      | T5 ms   |
| 20     | 2     | 1       | 1       | 50.0%      | T20 ms  |

Round 1 has no baseline yet, so the plan falls back (`baseline_mismatch`) and runs all 2 tests. Later rounds edit `packages/core/src/math.ts`, which only `math.test.ts` reads, so the plan invalidates one task and skips the other (skip share 50% on this 2-test fixture; a larger suite skips more). Elapsed is wall-clock per round; the skip share demonstrates that agent work is proportional to what changed, not to the whole suite. M6 targets >= 70% skip share on leaf edits for a real corpus; this fixture demonstrates the mechanism.

## Reference

- `plans/PLAN.md` section 10.4 (adapter loop), 12.4 (M8) and 15.4 (E6).
- `docs/benchmarks/BENCHMARKS_AND_GATES.md` — benchmark targets and methodology.
- `adapters/vitest/README.md` — Vitest adapter loop (`backplane vitest run`).
