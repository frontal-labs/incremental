# Incremental Benchmarks

Benchmark harnesses and results for incremental. Benchmarks measure whether the engine's invalidation answers match ground truth across replayed commits, and whether skipping unchanged tasks is sound and faster than re-running everything.

## Contents

| Path                        | Description                                                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `benchmarks/replay/`        | Replay driver: replays commits through the engine and measures false skips against ground truth. Built by `make build`. |
| `benchmarks/warm-plan.mjs`  | Warm plan latency benchmark script.                                                                                     |
| `benchmarks/results/`       | Benchmark outputs: `replay.json`, `warm-plan.json`, and generated `RESULTS.md`.                                         |
| `scripts/bench-summary.mjs` | Generates `benchmarks/results/RESULTS.md` from the raw outputs.                                                         |

## Running

Benchmarks require the built engine (`make build`).

```sh
make bench-replay   # replay driver: writes benchmarks/results/replay.json
make bench-smoke    # replay with 3 commits + warm-plan timing
make bench          # full replay + warm-plan timing + benchmarks/results/RESULTS.md
```

## Status

- Replay runs end to end against a real Vitest monorepo (`INCREMENTAL_BENCH_REPO`, defaults to the in-repo `fixture/` which is runnable out of the box). Raw data: `benchmarks/results/replay.json`. See `status/BENCH.json` and `status/BENCHMARKS.json` (both `done`).
- Full benchmarks run: `make bench-smoke` (3 commits + warm-plan timing) and `make bench` (6 commits + warm-plan timing + `benchmarks/results/RESULTS.md`) both pass.
- Evidence is recorded in `evidence/BENCH.txt`; see `evidence/` for E1/E2.
