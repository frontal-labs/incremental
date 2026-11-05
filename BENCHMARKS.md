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

**Result at 10k tasks / 100 queries / 3 iterations (final `make bench`, 2026-11-05):**

| Figure                          | Value                                 |
| ------------------------------- | ------------------------------------- |
| per-query median (3 iterations) | 0.223 ms (min 0.155 ms, max 0.328 ms) |
| process load median             | 45.4 ms                               |
| `tg.idx` size                   | 6,348,249 bytes                       |

Across the runs recorded in this repo the per-query median has ranged from 0.12 to 0.33 ms (about 1.3 ms in one run taken while the machine was under load), so quote a range, not a point value. Every run is well under the 5 ms p50 target. The engine uses path-keyed reverse indexes, so a query touches only the postings of the changed path, not every task.

**The 100k-task target (p50 under 5 ms, p99 under 20 ms) is not measured.** Only the 10k-task point has been run. The cold CLI target (under 300 ms at 100k tasks, hyperfine) is also not measured.

## Comparison vs alternatives

Final run: `node scripts/bench-compare.mjs 3` inside `make bench`, 2026-11-05. Each tool runs its affected-detection command on its own fixture under `monorepos/`. In every fixture the change at HEAD is `packages/shared/src/index.ts`, so the correct answer is `shared`, `api`, `web`. All three tools return that set.

| Tool            | Timed command                                         | Median (samples)                     | Result                |
| --------------- | ----------------------------------------------------- | ------------------------------------ | --------------------- |
| **Incremental** | warm `affected` query, 10k-task synthetic store       | 0.210 ms/query (0.185, 0.210, 0.472) | per-task invalidation |
| **Nx**          | `nx show projects --affected --base=HEAD~1`           | 1930 ms (2181, 1930, 1855)           | 3 projects, correct   |
| **Turbo**       | `turbo run build --filter=...[HEAD~1] --dry=json`     | 506 ms (646, 506, 451)               | 3 tasks, correct      |
| **Bazel**       | `bazel query 'rdeps(//packages/..., set(<changed>))'` | 1871 ms (1921, 1871, 1613)           | 3 targets, correct    |

The comparison is still not like-for-like. Incremental is a warm query on a 10k-task store, and the others are cold CLI runs on 4-package fixtures. Do not read any ratio between these rows as a speedup. The earlier "~4445x faster" claim is withdrawn.

Run the comparison:

```sh
node scripts/bench-compare.mjs 3
```

## Cold end-to-end (`make bench-cold`)

`scripts/cold-e2e.mjs` times one cold run per fixture: the git change source (`incremental-git changes`), then a new `incremental serve` process, hello, and one `affected` query. Each fixture is copied to a scratch repo with a base commit and a HEAD commit that edits its most-depended-on source file. The expected invalid set is the tests whose import closure contains that file. Five runs per fixture, 2026-11-05:

| Fixture                       | Tests | Expected / plan invalid | Matches import graph | Cold e2e median (min-max), ms | change source, ms | spawn + hello, ms | plan, ms |
| ----------------------------- | ----- | ----------------------- | -------------------- | ----------------------------- | ----------------- | ----------------- | -------- |
| monorepos/nx                  | 4     | 3 / 3                   | yes                  | 164.8 (149.0-623.0)           | 157.4             | 6.5               | 0.5      |
| monorepos/turborepo           | 4     | 3 / 3                   | yes                  | 157.7 (145.7-224.4)           | 150.1             | 7.5               | 0.7      |
| monorepos/bazel               | 4     | 3 / 3                   | yes                  | 144.7 (140.7-157.5)           | 137.2             | 6.7               | 0.3      |
| fixture                       | 6     | 2 / 2                   | yes                  | 149.7 (135.5-152.5)           | 142.7             | 6.7               | 0.3      |
| adapters/vitest/fixtures/repo | 14    | 2 / 2                   | yes                  | 146.8 (137.4-212.2)           | 139.7             | 6.4               | 0.3      |

Only `adapters/vitest/fixtures/repo` is an adapter fixture. The other adapters are tools with no fixture repository, so they have no row.

- **The engine is not the cost.** Spawn plus hello is about 7 ms and the plan under 1 ms. The change source is about 95% of the cold path.
- **The change source is slow.** On `monorepos/nx`, plain `git status --porcelain` takes about 19 ms and `git diff --name-status HEAD~1` about 21 ms, while `incremental-git changes` takes about 139 ms. That is the adapter's own cost (a Goose binary that runs git several times, or its startup). It is not investigated yet.
- **Same fixture, same scope (cold vs cold).** Against the cold CLI detection numbers in the comparison above: Nx 1930 ms vs 145 ms is about 12x; Turbo 506 ms vs 158 ms is about 3x; Bazel 1871 ms vs 145 ms is about 13x. This is closer to like-for-like than the warm-query ratios, but these are still single fixtures of 4 packages, and the Nx run may have used its daemon, which the bench did not disable.
- The machine was under load for some runs (a node no-op took 84 ms), which accounts for the outliers in the max column.

## Known issues

Resolved on 2026-11-05 (see the verification pass in `CHANGELOG.md`):

- Turbo fixture had no `pnpm-workspace.yaml`, so Turbo saw 0 packages. Added to the base commit. The earlier "pnpm unsupported" explanation was wrong.
- `--affected=HEAD~1` selects no tasks on turbo 2.11.10. The benchmark now uses `--filter=...[HEAD~1]`.
- Bazel fixture had no dependency edges, and the timed command listed every target. The BUILD files now list dependencies as labels in `srcs`, and the benchmark times an `rdeps` query over the packages changed in HEAD~1..HEAD.
- Nx and Turborepo had a `fix relative imports` commit at HEAD, so their timed change was not `shared`. The commits are reordered so HEAD changes `shared` in all three fixtures.
- `@bazel/rules_nodejs` is not published on npm, so the Bazel fixture could not install. It is removed; the fixture needs no external rules.
- The replay driver failed on fixtures whose working tree was clean, because its base commit had nothing to commit. Fixed with `--allow-empty`.
- Nx's output format changed between runs (JSON array vs one name per line). The benchmark now parses both.

Still open:

1. **Not like-for-like.** See the comparison section.
2. **Variance.** Nx ranged from 923 to 2181 ms and Turbo from 451 to 646 ms across the runs in this repo. Warm-plan medians range from 0.12 to 0.33 ms, and one run reached about 1.3 ms under machine load. Use the ranges.
3. **Only the 10k-task warm-plan point has been measured.** The 100k-task targets are not measured.
4. **Replay sample size.** The replay has 6 evaluated commits. 0 false skips is consistent with a false-skip rate up to about 50%.
5. **Machine-specific paths.** `comparison.json` stores absolute monorepo paths. `bench-compare.mjs` derives the repo root from its own location and accepts `GRAPH_ROOT` as an override.
6. **The fixtures' history was rewritten** (base commits amended, Nx and Turborepo commits reordered). The old commit hashes no longer exist. Backup branches `backup/pre-fixture-repair`, `backup/pre-order-fix` and `backup/pre-deps-fix` hold the previous tips in each nested repo.

## Status

- Replay runs end to end against a real Vitest monorepo (`INCREMENTAL_BENCH_REPO`, defaults to `fixture/`). Final run: `commits_processed=7`, `commits_evaluated=6`, `total_tasks=6`, `false_skips=0`, `rule_of_three_bound=3/6`. The fixture's 6 files and 14 tests pass. `make bench-replay`, `make bench-smoke` and `make bench` pass.
- Replay on each monorepo fixture (3 commits): `commits_evaluated=3`, `false_skips=0` for Nx, Turborepo and Bazel. Verified 2026-11-05 after the fixture repairs.
- Each monorepo fixture's own Vitest suite passes: 4 files, 8 tests.
- Warm plan `benchmarks/warm-plan.mjs` runs at 10k tasks only.
- The strace oracle is Linux-only and does not run on macOS. It is not part of the replay or warm-plan path.
- All three comparison tools return the expected affected set.

Evidence for each run is recorded in `evidence/BENCH.txt`. `evidence/README.md` explains the evidence format.
