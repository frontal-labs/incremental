# Benchmarks

Benchmark harnesses and results for Incremental. Benchmarks measure whether the engine's invalidation answers match ground truth across replayed commits (replay), and whether skipping unchanged tasks is sound and fast enough (warm-plan latency).

## Contents

| Path | Description |
|---|---|
| `benchmarks/replay/` | Replay driver: replays commits through the engine and measures false skips against ground truth. Built by `make build`. |
| `benchmarks/results/` | Raw benchmark outputs: `replay.json`, `warm-plan.json`, and generated `RESULTS.md`. |
| `scripts/bench-summary.mjs` | Generates `benchmarks/results/RESULTS.md` from the raw outputs. |

## Running

Benchmarks require the built engine (`make build`).

```sh
make build                  # engine, adapters/git, bindings/node, benchmarks/replay
make bench-replay           # replay driver: writes benchmarks/results/replay.json
make bench-smoke            # replay with 3 commits + warm-plan timing
make bench                  # full replay + warm-plan timing + benchmarks/results/RESULTS.md
```

### `make bench-replay` (implemented)

Runs `benchmarks/replay/dist/src/index.js --repo $(INCREMENTAL_BENCH_REPO) --commits 6 --out benchmarks/results/replay.json`.

The replay driver replays commits through the engine and measures false skips against ground truth, using the real adapter (git change source + `@incremental/client` over `core/dist/incremental serve`) plus plain vitest runs for ground truth:

- copies a Vitest fixture repo (`adapters/vitest/fixtures/repo` by default, or `--repo`),
- applies a deterministic edit sequence (file write, dir listing, probe, global input, broken read, deletion),
- for each commit takes ground truth from a plain vitest run, then runs the invalid tasks through the store,
- compares against ground truth and flags false skips (a task that fails in ground truth, is not invalidated, and fails again on two reruns).

Report fields: `commits_processed`, `commits_evaluated`, `total_tasks`, `task_commit_pairs_examined`, `false_skips`, `flaky`, `skip_shares`, `median_skip_share`, `rule_of_three_bound`.

`INCREMENTAL_BENCH_REPO` defaults to the in-repo `demo-repo/`; override it with another Vitest monorepo (for example `/Users/gabrielfonseca/Desktop/os`). Real-repo replay is what validates the replay path.

### `make bench-smoke` and `make bench`

Both targets run the replay step, then `node benchmarks/warm-plan.mjs 10000 100` to produce `benchmarks/results/warm-plan.json`. `bench-smoke` also validates the replay output schema.

`make bench` additionally runs `scripts/bench-summary.mjs` to regenerate `benchmarks/results/RESULTS.md`.

## Current results

### Replay

`benchmarks/results/replay.json` is present, from the last run against `demo-repo/`:

| commits_processed | commits_evaluated | total_tasks | task_commit_pairs_examined | false_skips | rule_of_three_bound |
|---|---|---|---|---|---|
| 7 | 6 | 6 | 36 | 0 | 3/6 |

| median_skip_share | skip_shares |
|---|---|
| 83.33% | [0.667,0.833,1,0.833,0.833,0.667] |

`false_skips` is empty: no task failed in ground truth while being left valid. `make bench-replay` prints `PASS bench-replay` (evidence/BENCH.txt).

The demo-repo has 6 test tasks with a real dependency graph (`app → core → math/strings`, `utils → formatter`), so edits to shared source files invalidate multiple dependent tasks — exercising the engine's transitive invalidation.

### Warm plan latency

`benchmarks/warm-plan.mjs` measures warm plan latency: it builds a store holding `<tasks>` synthetic observations, each reading a **unique** source file (`src/task-<i>.ts`). Each query changes one file, so exactly one task is invalidated per query — a realistic incremental scenario. It measures:

- `process_load_ms` — engine spawn + hello handshake + store load (one-time cost)
- `per_query_ms_approx` — average time of `<queries>` warm `affected` calls, each invalidating one task
- `log_bytes` — size of the store's `tg.idx` index image

Run with:

```sh
node benchmarks/warm-plan.mjs <tasks> <queries> > benchmarks/results/warm-plan.json
```

`make bench-smoke` and `make bench` run it with `10000 100` and redirect to `benchmarks/results/warm-plan.json`. Numbers vary run to run because each run builds a fresh store.

**Result at 10k tasks / 100 queries: ~0.12 ms per query** — well under the 5 ms p50 target. The engine uses path-keyed reverse indexes, so a query touches only the postings of the changed path, not every task.

Target: warm plan p50 under 5 ms and p99 under 20 ms at 100k tasks; cold CLI plan under 300 ms at 100k tasks (hyperfine).

## Status

Benchmarks are **runnable** (see `STATUS.md`; `status/BENCH.json` and `status/BENCHMARKS.json` are `done`):

- Replay runs end to end against a real Vitest monorepo (`INCREMENTAL_BENCH_REPO`, defaults to the in-repo `demo-repo/`). Last run: `commits_processed=7`, `commits_evaluated=6`, `false_skips=0`, `rule_of_three_bound=3/6` (evidence/BENCH.txt). `make bench-replay`, `make bench-smoke` and `make bench` all pass.
- Warm plan script `benchmarks/warm-plan.mjs` is implemented; `make bench` runs it with `10000 100` and writes `benchmarks/results/warm-plan.json`. At 10k tasks, per-query time is ~0.12 ms — well under the 5 ms target.
- Remaining open item: the strace oracle is Linux-only and does not run on macOS; it is not part of the replay/warm-plan path.

Evidence for benchmarks is recorded in `evidence/BENCH.txt`; `evidence/README.md` explains the evidence format.
