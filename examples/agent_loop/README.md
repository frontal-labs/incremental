# Agent Loop Example (M8 Benchmark)

Demonstrates benchmark M8: Agent loop (edit to feedback) with 1, 5 and 20 agents on separate worktrees sharing one store. Target: at least 2x faster than full suite.

Per §12.4 M8 and §15.4 E6: "Build `examples/agent_loop/`: edit a fixture file, ask the plan, run the selected tests, print timings." The loop follows the adapter contract : baseline → ChangeSet → plan → run invalid → advance only on a clean complete run.

## Layout

```
examples/agent_loop/
├── README.md              # this file
├── fixture/               # synthetic Vitest fixture (core + app packages)
│   ├── packages/
│   │   ├── core/
│   │   │   ├── package.json
│   │   │   └── src/
│   │   │       ├── math.ts
│   │   │       └── math.test.ts
│   │   └── app/
│   │       ├── package.json
│   │       └── src/
│   │           ├── app.ts
│   │           └── app.test.ts
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
#   5. advance baseline to HEAD when the worktree is clean 
#   6. print total/invalid/skipped/skip_share/elapsed_ms
```

## Expected results

Measured 2026-11-05 on macOS with `bash examples/agent_loop/agent_loop.sh` (exit 0):

| Agents | Total | Invalid | Skipped | Skip Share | Elapsed |
| ------ | ----- | ------- | ------- | ---------- | ------- |
| 1      | 2     | 1       | 1       | 50.0%      | 2849 ms |
| 5      | 2     | 1       | 1       | 50.0%      | 2588 ms |
| 20     | 2     | 1       | 1       | 50.0%      | 2289 ms |

The script primes the store with a full run before the measured rounds, so no round falls back to `baseline_mismatch`. Each round edits `packages/core/src/math.ts`, which only `math.test.ts` reads, so the plan invalidates one task and skips the other (skip share 50% on this 2-test fixture; a larger suite skips more). The app test imports only `./app`, so it stays valid. Elapsed is wall-clock per round; the skip share demonstrates that agent work is proportional to what changed, not to the whole suite. M6 targets >= 70% skip share on leaf edits for a real corpus; this fixture demonstrates the mechanism.

## Reference

- `` section 10.4 (adapter loop), 12.4 (M8) and 15.4 (E6).
- `docs/benchmarks/BENCHMARKS_AND_GATES.md` — benchmark targets and methodology.
- `adapters/vitest/README.md` — Vitest adapter loop (`incremental vitest run`).
