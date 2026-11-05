# Incremental Benchmarks

Benchmark harnesses and results for incremental. Benchmarks measure whether the engine's invalidation answers match ground truth across replayed commits, and whether skipping unchanged tasks is sound and faster than re-running everything.

## Contents

| Path | Description |
|---|---|
| `benchmarks/m1.mjs` | Milestone M1 benchmark script. |
| `benchmarks/results/` | Benchmark outputs. |

## Running

Benchmarks require the built engine (`make build`) and, for replay, a real Vitest monorepo (`INCREMENTAL_BENCH_REPO`) plus a human decision.

```sh
make bench-smoke   # not implemented yet (fails on purpose per  2.12)
make bench         # not implemented yet (fails on purpose per  2.12)
```

## Status

- Replay (real-repo) requires a real Vitest monorepo and a human decision. Use the workspace `demo-repo/` for runnable demo work; `INCREMENTAL_BENCH_REPO` may point at `demo-repo/` or another Vitest monorepo. Raw data: `benchmarks/results/replay.json`. See `status/BENCH.json` and `status/BENCHMARKS.json`.
- Full benchmarks are blocked: they need a real Vitest monorepo and a human decision. See `status/BENCHMARKS.json` and `STATUS.md`.

Evidence for benchmarks is not yet recorded; see `evidence/` for E1/E2.
