# Benchmarks

Benchmark harnesses and results for Incremental. Benchmarks measure whether the engine's invalidation answers match ground truth across replayed commits (replay), and how long a warm plan takes (warm-plan latency). Comparison timings against other tools are in the last section, and they have known validity problems (see Known issues).

## Contents

| Path                        | Description                                                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `benchmarks/replay/`        | Replay driver: replays commits through the engine and measures false skips against ground truth. Built by `make build`. |
| `benchmarks/warm-plan.mjs`  | Warm plan latency over protocol v1 stdio on a synthetic 10k-task store.                                                 |
| `benchmarks/results/`       | Raw benchmark outputs: `replay.json`, `warm-plan.json`, `comparison.json`, and generated `RESULTS.md`.                  |
| `scripts/bench-summary.mjs` | Generates `benchmarks/results/RESULTS.md` from the raw outputs.                                                         |
| `scripts/bench-compare.mjs` | Times affected-detection for Incremental, Nx, Turbo and Bazel on the monorepo fixtures.                                 |
| `monorepos/nx/`             | Nx-based monorepo fixture (4 packages, shared → api/web, utils standalone).                                             |
| `monorepos/turborepo/`      | Turborepo-based monorepo fixture (same package structure).                                                              |
| `monorepos/bazel/`          | Bazel-based monorepo fixture (same package structure).                                                                  |

## Running

Benchmarks require the built engine (`make build`).

```sh
make build                  # engine, adapters/git, bindings/node, benchmarks/replay
make bench-replay           # replay driver: writes benchmarks/results/replay.json
make bench-smoke            # replay with 3 commits + warm-plan timing (overwrites replay.json with the 3-commit run)
make bench                  # replay (6 commits) + warm-plan + bench-compare + benchmarks/results/RESULTS.md
```

Run `make bench` after `make bench-smoke`: the smoke run overwrites `replay.json` with a 3-commit report.

### `make bench-replay` (implemented)

Runs `benchmarks/replay/dist/src/index.js --repo $(INCREMENTAL_BENCH_REPO) --commits 6 --out benchmarks/results/replay.json`.

The replay driver replays commits through the engine and measures false skips against ground truth, using the real adapter (git change source + `@incremental/client` over `core/dist/incremental serve`) plus plain vitest runs for ground truth:

- copies a Vitest repo (`--repo`; the driver's own default is `adapters/vitest/fixtures/repo`, and the Makefile sets `INCREMENTAL_BENCH_REPO` to `fixture/`),
- applies a deterministic edit sequence (file write, dir listing, probe, global input, broken read, deletion),
- for each commit takes ground truth from a plain vitest run, then runs the invalid tasks through the store,
- compares against ground truth and flags false skips (a task that fails in ground truth, is not invalidated, and fails again on two reruns).

Report fields: `commits_processed`, `commits_evaluated`, `total_tasks`, `task_commit_pairs_examined`, `false_skips`, `flaky`, `skip_shares`, `median_skip_share`, `rule_of_three_bound`.

`INCREMENTAL_BENCH_REPO` defaults to the in-repo `fixture/`; override it with another Vitest monorepo (for example `/Users/gabrielfonseca/Desktop/os`).

### `make bench-smoke` and `make bench`

Both targets run the replay step, then `node benchmarks/warm-plan.mjs 10000 100` to produce `benchmarks/results/warm-plan.json`. `bench-smoke` also validates the replay output schema.

`make bench` additionally runs `scripts/bench-compare.mjs 3` (writes `benchmarks/results/comparison.json`) and then `scripts/bench-summary.mjs` (writes `benchmarks/results/RESULTS.md`). The summary step runs after the comparison, so `RESULTS.md` reflects the current `comparison.json`.

## Current results

Last full run: `make bench` on 2026-11-05 on macOS (arm64). Each figure is from that run unless marked otherwise. Timings vary between runs, so the ranges across runs are given where they were observed.

### Replay

`benchmarks/results/replay.json`, against `fixture/` (6 test files, 14 tests, dependency graph `app → core → math/strings`, `utils → formatter`):

| commits_processed | commits_evaluated | total_tasks | task_commit_pairs_examined | false_skips | rule_of_three_bound |
| ----------------- | ----------------- | ----------- | -------------------------- | ----------- | ------------------- |
| 7                 | 6                 | 6           | 36                         | 0           | 3/6                 |

| median_skip_share | skip_shares                       |
| ----------------- | --------------------------------- |
| 83.33%            | [0.667,0.833,1,0.833,0.833,0.667] |

`false_skips` is empty: no task failed in ground truth while being left valid. This is a small sample. Six evaluated commits give a rule-of-three upper bound of 3/6 = 50%, so the zero result does not show a false-skip rate below a few percent. It only shows that none was found in this sequence.

`total_tasks` counts test files, one task per file. The 14 tests inside them are not counted separately.

#### Incremental on each monorepo fixture

Same replay (`--commits 3`, run directly against each fixture on 2026-11-05):

| Monorepo             | Tool        | commits_processed | commits_evaluated | total_tasks | task_commit_pairs_examined | false_skips | rule_of_three_bound | median_skip_share |
| -------------------- | ----------- | ----------------- | ----------------- | ----------- | -------------------------- | ----------- | ------------------- | ----------------- |
| monorepos/nx/        | Incremental | 4                 | 3                 | 4           | 12                         | 0           | 3/3                 | 100%              |
| monorepos/turborepo/ | Incremental | 4                 | 3                 | 4           | 12                         | 0           | 3/3                 | 100%              |
| monorepos/bazel/     | Incremental | 4                 | 3                 | 4           | 12                         | 0           | 3/3                 | 100%              |

The three fixtures give identical numbers. The fixtures are small (4 tasks each) and the 3-commit sequence is short, so this is also weak evidence.

### Warm plan latency

`benchmarks/warm-plan.mjs` builds a store holding `<tasks>` synthetic observations, each reading a **unique** source file (`src/task-<i>.ts`). Each query changes one file, so exactly one task is invalidated per query. The script asserts that exactly one task is returned. It measures:

- `process_load_ms` — engine spawn + hello handshake + store load (one-time cost)
- `per_query_ms` — average time of `<queries>` warm `affected` calls, each invalidating one task
- `log_bytes` — size of the store's `tg.idx` index image

Run with:

```sh
node benchmarks/warm-plan.mjs <tasks> <queries> [iterations] > benchmarks/results/warm-plan.json
```

**Result at 10k tasks / 100 queries / 3 iterations (`make bench`, 2026-11-05):**

| Figure                          | Value                                       |
| ------------------------------- | ------------------------------------------- |
| per-query median (3 iterations) | 0.191 ms (min 0.162 ms, max 0.243 ms)       |
| process load median             | 45.3 ms                                     |
| `tg.idx` size                   | 6,348,249 bytes                             |

Across the runs recorded in this repo the per-query median has ranged from 0.12 to 0.33 ms, so quote a range, not a point value. Every run is well under the 5 ms p50 target. The engine uses path-keyed reverse indexes, so a query touches only the postings of the changed path, not every task.

**The 100k-task target (p50 under 5 ms, p99 under 20 ms) is not measured.** Only the 10k-task point has been run. The cold CLI target (under 300 ms at 100k tasks, hyperfine) is also not measured.

## Comparison vs alternatives

Last run: `node scripts/bench-compare.mjs 3` (2026-11-05). Each tool was timed on its own fixture under `monorepos/`. See Known issues before reading this table.

| Tool            | Timed command                              | Result (median; samples)                                 | Valid as affected-detection? |
| --------------- | ------------------------------------------ | -------------------------------------------------------- | ---------------------------- |
| **Incremental** | warm `affected` query, 10k-task store      | 0.177 ms/query (0.2, 0.2, 0.3 ms)                        | Not like-for-like (synthetic) |
| **Nx**          | `nx show projects --affected --base=HEAD~1` | 1656 ms (1656, 1736, 1598 ms); projects `api`, `web`    | Yes, for 4-package fixture   |
| **Turbo**       | `turbo run build --affected=HEAD~1`        | 513 ms (1072, 332, 513 ms); 0 tasks                      | No (fixture defect)          |
| **Bazel**       | `bazel query //packages/...`               | 1561 ms (2268, 1561, 1495 ms); 4 targets listed          | No (lists all targets)       |

Nx is the only row that times what the name says on a fixture that exercises it. Its single run ranged from 923 to 1736 ms across runs, so the 1–2 s range is the honest figure.

The earlier version of this document said Incremental is "~4445x faster" than Nx. **That ratio is withdrawn.** It divided a warm query on a 10k-task synthetic store by one cold CLI detection on a 4-package fixture, so it does not measure the same thing.

Run the comparison:

```sh
node scripts/bench-compare.mjs 3
```

## Known issues

These were found while re-running the benchmarks on 2026-11-05. None is fixed in the fixtures, because each one changes the fixture's git history.

1. **Turbo fixture has no `pnpm-workspace.yaml`.** The fixture sets `"packageManager": "pnpm@9.0.0"` but has no `pnpm-workspace.yaml`, so `turbo ls` reports `0 no packages (pnpm9)`. Turbo's `--affected` then finds 0 tasks. The earlier "pnpm unsupported" explanation is wrong. A probe in a throwaway clone confirmed it: adding `pnpm-workspace.yaml` (`packages: ["packages/*"]`) makes `turbo run build --affected=HEAD~1` find `api#build`, `shared#build` and `web#build`. Fix: add that file to the fixture's base commit, and re-run.
2. **Bazel fixture declares no dependencies.** Every `packages/*/BUILD.bazel` is a `filegroup` with `glob(["**/*"])` and no `deps`. `bazel query 'rdeps(//packages/..., //packages/shared:shared_pkg)'` returns only `shared` itself. `bench-compare.mjs` times `bazel query //packages/...`, which lists every target and ignores the change. So the Bazel row is not affected detection, and the earlier "Correct deps: Yes" was not established. Fix: add `deps` edges in the BUILD files, switch the timed command to an `rdeps` query, and re-run.
3. **Not like-for-like.** Incremental is timed on a warm query against a synthetic 10k-task store. The other tools are timed as one cold CLI call on a 4-package fixture. No speedup ratio can be drawn between them.
4. **Single-sample variance.** `bench-compare` takes the median of 3 runs of each tool, but the runs vary by up to about 2× (Nx ranged from 923 ms to 1736 ms across runs).
5. **Warm-plan variance.** Per-query medians range from 0.12 to 0.33 ms across runs. Only the 10k-task point has been measured.
6. **Replay sample size.** The replay has 6 evaluated commits. 0 false skips is consistent with a false-skip rate up to about 50%.
7. **Machine-specific paths.** `comparison.json` stores absolute monorepo paths. `bench-compare.mjs` now derives the repo root from its own location (it previously hardcoded a user path, and still accepts `GRAPH_ROOT` as an override).
8. **Nested fixture repos are dirty.** `monorepos/nx` and `monorepos/turborepo` have uncommitted `package.json` changes in their own git repos (`git -C <dir> status`). Those edits can change what `--affected` reports. Re-check them before any new comparison.

## Status

- Replay runs end to end against a real Vitest monorepo (`INCREMENTAL_BENCH_REPO`, defaults to `fixture/`). Last run: `commits_processed=7`, `commits_evaluated=6`, `false_skips=0`, `rule_of_three_bound=3/6`, all 14 fixture tests green. `make bench-replay`, `make bench-smoke` and `make bench` pass.
- Replay on each monorepo fixture (3 commits): `commits_evaluated=3`, `false_skips=0` for Nx, Turbo and Bazel. Verified 2026-11-05.
- Warm plan `benchmarks/warm-plan.mjs` runs at 10k tasks only. Per-query median is in the 0.12–0.33 ms range across runs.
- The strace oracle is Linux-only and does not run on macOS. It is not part of the replay or warm-plan path.
- Comparison rows for Turbo and Bazel are not valid affected-detection results (Known issues 1 and 2).

Evidence for each run is recorded in `evidence/BENCH.txt`. `evidence/README.md` explains the evidence format.
