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
make bench-smoke   # not implemented yet (fails on purpose per  2.12)
make bench         # not implemented yet (fails on purpose per  2.12)
```

## Status

- Gate 0 (real-repo replay) is done with result **STOP** (a valid outcome): 0 commits evaluated — the replayed repo's own unit suite was red at the sampled commits (2 of 122 files), so no ground-truth commit was green. E5, E7 and E10 do not run. Use the workspace `demo-repo/` for runnable demo work; `INCREMENTAL_BENCH_REPO` may point at `demo-repo/` or another Vitest monorepo. Raw data: `benchmarks/results/gate0.json`. See `status/BENCH.json`, `GATE.md` and `GATE-demo.md`.
- Gate 1 / full benchmarks are blocked: they need a real Vitest monorepo and a human decision. See `status/BENCHMARKS.json` and `STATUS.md`.

Evidence for benchmarks is not yet recorded; see `evidence/` for E1/E2.
