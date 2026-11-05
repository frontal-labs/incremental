# Replay driver (benchmarks/replay)

Replays a sequence of commits through the incremental engine and measures **false skips** against ground truth, using the real adapter (git change source + `@incremental/client` over `core/dist/incremental serve` + `incremental-vitest run`) plus plain vitest runs for ground truth.

Spec: **replay**, benchmark **bench**.

## What it measures

| Metric | Meaning |
|--------|---------|
| `commits_processed` | Commits walked, oldest → newest |
| `commits_evaluated` | Commits whose predecessor's ground truth was green |
| `task_commit_pairs_examined` | `(task, commit)` pairs compared vs ground truth |
| `false_skips` | Task fails in ground truth, is not invalidated, and fails again on two reruns |
| `rule_of_three_bound` | `3 / commits_evaluated` |

The report is written to `--out` (default `benchmarks/results/replay.json`) and printed to stdout.

## Prerequisites

The driver needs the built engine and adapter distributions:

```sh
make build        # builds core/dist/incremental, adapters/vitest/dist/*, bindings/node
```

It then resolves paths relative to the compiled output (`dist/src/`), so run from the built `dist/src/index.js` (or via `make` targets).

## CLI usage

```sh
node dist/src/index.js [--repo <path>] [--commits <n>] [--store <path>] [--out <path>]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--repo` | `adapters/vitest/fixtures/repo` | Fixture repo to copy and replay against |
| `--commits` | `EDIT_SEQUENCE.length` (6) | Number of replayed commits to walk |
| `--store` | `<tmp>/store` | Incremental store directory |
| `--out` | `benchmarks/results/replay.json` | Report output path |

Examples:

```sh
# Default run: 6 commits, default fixture repo and store
node dist/src/index.js

# Smoke run: 3 commits, custom output
node dist/src/index.js --commits 3 --out benchmarks/results/replay-smoke.json

# Custom fixture repo and persistent store
node dist/src/index.js --repo /path/to/repo --store /path/to/store --commits 10
```

## Make targets

Defined at the repo root (`Makefile`):

```sh
make bench-replay   # replay driver: writes benchmarks/results/replay.json
make bench-smoke    # replay with 3 commits + warm-plan timing
make bench          # full replay + warm-plan timing + benchmarks/results/RESULTS.md
```

## Module layout

The driver is split into focused modules, with `src/index.ts` as the entry point:

| Module | Responsibility |
|--------|----------------|
| `src/index.ts` | Entry point (shebang): CLI parsing, replay loop orchestration, report build/write, top-level error handling |
| `src/cli.ts` | `--repo`/`--commits`/`--store`/`--out` argument parsing |
| `src/git.ts` | `git` and `headOf` helpers |
| `src/edits.ts` | Deterministic per-commit edit sequence (`EDIT_SEQUENCE`) and `applyEdit` |
| `src/vitest.ts` | `groundTruth` (plain vitest run), `runOnce` (rerun a task twice), `runRecorded` (adapter loop iteration with recorder) |
| `src/report.ts` | `median`, `buildReport`, `writeReport` |
| `src/paths.ts` | Path constants (`ROOT`, `ENGINE`, `VITEST_RUN`, `VITEST_BIN`, `FIXTURE`) |
| `src/types.ts` | Shared interfaces (`CliArgs`, `GtResult`, `Edit`, `RunReport`, `FalseSkip`, `Flaky`, `ReplayReport`) |

Build:

```sh
cd benchmarks/replay && npx tsc-rs -p tsconfig.json
# or from repo root: make build
```

TypeScript compiles `src/**/*.ts` → `dist/src/` (`rootDir: src`, `outDir: dist/src`, `module: NodeNext`). Relative imports carry `.js` extensions and type imports use `import type` (per `verbatimModuleSyntax`).

## Ground truth vs plan

For each commit `c_i`:

1. Apply one deterministic edit and commit it.
2. Run a **plain vitest** run at `c_i` → ground truth (never touches the store).
3. Run the **recorded adapter** (`runRecorded`) → plan from `c_{i-1}`, run invalid tasks with the recorder, advance to `c_i`.
4. For ground-truth-failing tasks not invalidated by the plan, rerun the task twice (`runOnce`) to confirm a false skip vs. flakiness.

## Output

`benchmarks/results/replay.json`:

```json
{
  "spec": "replay",
  "benchmark": "bench",
  "engine": ".../core/dist/incremental",
  "repo": "/tmp/bp-replay-.../repo",
  "commits": [{ "index": 0, "id": "..." }, ...],
  "commits_processed": 7,
  "commits_evaluated": 6,
  "total_tasks": 12,
  "task_commit_pairs_examined": 60,
  "false_skips": [...],
  "flaky": [...],
  "skip_shares": [0.5, ...],
  "median_skip_share": 0.4,
  "rule_of_three_bound": "3/6"
}
```

See the parent [`benchmarks/README.md`](../README.md) for the full benchmarks suite and results conventions.
