# Incremental Benchmarks

Benchmark harnesses and results for incremental. Benchmarks measure whether the engine's invalidation answers match ground truth across replayed commits, and whether skipping unchanged tasks is sound and faster than re-running everything.

## Contents

| Path | Description |
|---|---|
| `benchmarks/m1.mjs` | Milestone M1 benchmark script. |
| `benchmarks/gate0/` | Gate 0 benchmark: `demo/` (demo fixture generation and replay) and `driver/` (JSON generation, probe, replay and setup scripts). |
| `benchmarks/results/` | Benchmark outputs: `gate0.json`, `gate0-demo.json`. |

## Running

Benchmarks require the built engine (`make build`) and, for Gate 0, a real Vitest monorepo (`INCREMENTAL_BENCH_REPO`) plus a human decision.

```sh
make bench-smoke   # not implemented yet (fails on purpose per PLAN.md 2.12)
make bench         # not implemented yet (fails on purpose per PLAN.md 2.12)
```

## Status

- Gate 0 is done with result **STOP** (a valid outcome): 0 commits evaluated — the repo's own unit suite was red at the replayed commits (2 of 122 files), so no ground-truth commit was green. E5, E7 and E10 do not run. `INCREMENTAL_BENCH_REPO` is `/Users/gabrielfonseca/Desktop/os` (`frontal-os`, measured reference `47cd74be`). Raw data: `benchmarks/results/gate0.json`. See `status/BENCH.json`, `GATE.md` and `bench/results/gate0.json`.
- Gate 1 / full benchmarks are blocked: they need a real Vitest monorepo and a human decision. See `status/BENCHMARKS.json` and `STATUS.md`.

Evidence for benchmarks is not yet recorded; see `evidence/` for E1/E2.
