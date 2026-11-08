# Benchmarks

Benchmark harnesses and results for Incremental. Benchmarks measure whether the engine's invalidation answers match ground truth across replayed commits (replay), and how long a warm plan takes (warm-plan latency). Comparison timings against other tools are in the last section, and they have known validity problems (see Known issues).

## Contents

| Path                        | Description                                                                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `benchmarks/replay/`        | Replay driver: replays commits through the engine and measures false skips against ground truth. Built by `make build`.                                        |
| `benchmarks/warm-plan.mjs`  | Warm plan latency over protocol v1 stdio on a synthetic store (10k and 100k tasks).                                                                            |
| `benchmarks/results/`       | Raw outputs: `replay.json`, `replay-{nx,turborepo,bazel}.json`, `warm-plan.json`, `warm-plan-100k.json`, `comparison.json`, `cold-e2e.json`, and `RESULTS.md`. |
| `scripts/bench-summary.mjs` | Generates `benchmarks/results/RESULTS.md` from the raw outputs.                                                                                                |
| `scripts/bench-compare.mjs` | Times affected-detection for Incremental, Nx, Turbo and Bazel on the monorepo fixtures. Fails if a tool selects the wrong set.                                 |
| `scripts/cold-e2e.mjs`      | Cold end-to-end affected detection (git change source, new engine process, one plan) on the fixtures.                                                          |
| `monorepos/nx/`             | Nx-based monorepo fixture (4 packages, shared → api/web, utils standalone).                                                                                    |
| `monorepos/turborepo/`      | Turborepo-based monorepo fixture (same package structure).                                                                                                     |
| `monorepos/bazel/`          | Bazel-based monorepo fixture (same package structure).                                                                                                         |

## Running

Benchmarks require the built engine (`make build`).

```sh
make build                  # engine, adapters/git, bindings/node, benchmarks/replay
make bench-replay           # replay driver on the default fixture: writes benchmarks/results/replay.json
make bench-smoke            # replay with 3 commits + warm-plan timing (overwrites replay.json with the 3-commit run)
make bench                  # all of the below, then benchmarks/results/RESULTS.md
make bench-cold             # cold end-to-end on each fixture: writes benchmarks/results/cold-e2e.json
```

`make bench` runs: the replay on the default fixture (10 commits), the replay on each monorepo fixture (10 commits each, `replay-<name>.json`), warm plan at 10k and 100k tasks (1000 queries, 3 iterations each), `scripts/bench-compare.mjs 10` (10 iterations per tool), and `scripts/bench-summary.mjs`.

Run `make bench` after `make bench-smoke`: the smoke run overwrites `replay.json` with a 3-commit report.

### Replay

The driver copies a Vitest repo, replays a sequence of commits through the engine, and compares the invalid set with ground truth from a plain Vitest run. It measures false skips: a task that fails in ground truth, is not invalidated, and fails again on two reruns.

- `--repo` picks the repo. The default is `adapters/vitest/fixtures/repo`; the Makefile sets `INCREMENTAL_BENCH_REPO` to `fixture/`.
- The edit sequence depends on the repo layout (`benchmarks/replay/src/edits.ts`, `editSequenceFor`):
  - The default fixture (`fixture/`: packages app, core, utils) has a sequence of writes that change `core`, `app` and `utils` files, with one broken edit at step 10.
  - A monorepo fixture (it has `packages/shared`) gets `MONOREPO_EDIT_SEQUENCE`. Every edit appends one line to one package's `src/index.ts`, and step 10 appends a module that throws on import. The expected selection is `shared` → `shared, api, web`; `api`, `web` or `utils` → only that package.
- The copy skips Bazel's `bazel-*` output symlinks. They are gitignored build products, and copying them lets Vitest pick up test files inside them.

Report fields: `commits_processed`, `commits_evaluated`, `total_tasks`, `task_commit_pairs_examined`, `false_skips`, `flaky`, `skip_shares`, `median_skip_share`, `rule_of_three_bound`.

`commits_evaluated` stops at the first commit whose ground truth is not all green, so a sequence that breaks early is evaluated for fewer commits.

Before the monorepo sequence existed, the monorepo replays wrote files under `packages/core` and `packages/app`, which those fixtures do not have. They tested nothing. The numbers from that version are not valid and are not reported.

## Current results

Validation run on 2026-11-05 on macOS (arm64). Timings vary between runs, so the ranges across runs are given where they were observed.

### Replay

Default fixture (`fixture/`: 6 test files, 14 tests, dependency graph `app → core → math/strings`, `utils → formatter`), 10 commits:

| commits_processed | commits_evaluated | total_tasks | task_commit_pairs_examined | false_skips | rule_of_three_bound | median_skip_share |
| ----------------- | ----------------- | ----------- | -------------------------- | ----------- | ------------------- | ----------------- |
| 11                | 10                | 6           | 60                         | 0           | 3/10                | 83.33%            |

Monorepo fixtures, 10 commits each (monorepo edit sequence):

| Fixture             | commits_evaluated | total_tasks | task_commit_pairs_examined | false_skips | rule_of_three_bound | median_skip_share |
| ------------------- | ----------------- | ----------- | -------------------------- | ----------- | ------------------- | ----------------- |
| monorepos/nx        | 10                | 4           | 40                         | 0           | 3/10                | 75.00%            |
| monorepos/turborepo | 10                | 4           | 40                         | 0           | 3/10                | 75.00%            |
| monorepos/bazel     | 10                | 4           | 40                         | 0           | 3/10                | 75.00%            |

The skip shares show the edits do reach the dependency graph: a `shared` edit skips 1 of 4 tasks (0.25), and a leaf edit skips 3 of 4 (0.75).

`false_skips` is empty in every replay: no task failed in ground truth while being left valid. The sample is small. Ten commits give a rule-of-three upper bound of 3/10 = 30%, so zero false skips shows that none was found in these sequences, not that the false-skip rate is below a few percent.

`total_tasks` counts test files, one task per file. The 14 tests inside the default fixture are not counted separately.

### Warm plan latency

`benchmarks/warm-plan.mjs` builds a store holding `<tasks>` synthetic observations, each reading a **unique** source file (`src/task-<i>.ts`). Each query changes one file, so exactly one task is invalidated per query. The script asserts that exactly one task is returned. It measures:

- `process_load_ms`: engine spawn + hello handshake + store load (one-time cost)
- `per_query_ms`: the average of each iteration's `<queries>` warm `affected` calls, with the median, min, and max over iterations
- `per_query_percentiles_ms`: p50 and p99 over every individual query in every iteration
- `log_bytes`: size of the store's `tg.idx` index image

Run with:

```sh
node benchmarks/warm-plan.mjs <tasks> <queries> [iterations] > benchmarks/results/warm-plan.json
```

| Tasks   | Queries × iterations | Per-query p50 / p99 (ms) | per-query median (min–max) (ms) | process load median (ms) | `tg.idx` size (bytes) |
| ------- | -------------------- | ------------------------ | ------------------------------- | ------------------------ | --------------------- |
| 10,000  | 1000 × 3             | 0.100 / 0.650            | 0.131 (0.130–0.146)             | 38.1                     | 6,348,249             |
| 100,000 | 1000 × 3             | 0.093 / 0.661            | 0.132 (0.125–0.148)             | 393.6                    | 63,678,262            |

**The 100k-task query target is met:** p50 under 5 ms and p99 under 20 ms. The engine uses path-keyed reverse indexes, so a query touches only the postings of the changed path, not every task.

**The cold CLI target is not met.** It asks for under 300 ms at 100k tasks, measured with hyperfine. hyperfine is not used here. The closest measure is process load (spawn, hello, and loading 100k observations), which is 342–398 ms (median 394 ms) across the three iterations. That is the engine's store load, and the cold CLI target is missed on it. This is a real finding, not a measurement artifact, and it is not fixed.

### Comparison vs alternatives

Run: `node scripts/bench-compare.mjs 10`, 2026-11-05. Each tool runs its affected-detection command on its own fixture under `monorepos/`. The change under test is the last commit that touches `packages/shared/src/index.ts`; the base is its parent. The correct answer is `shared`, `api`, `web`, and the script fails if a tool selects another set.

| Tool            | Timed command                                                          | Median (10 samples, ms) | Selected                   |
| --------------- | ---------------------------------------------------------------------- | ----------------------- | -------------------------- |
| **Incremental** | warm `affected` query, 10k-task synthetic store (0.148 ms/query)       | 0.148 ms/query          | per-task invalidation      |
| **Nx**          | `nx show projects --affected --base=<shared commit>^`                  | 897                     | shared, api, web           |
| **Turbo**       | `turbo run build --filter=...[<shared commit>^] --dry=json`            | 151                     | api, shared, web           |
| **Bazel**       | `bazel query 'kind(filegroup, rdeps(//packages/..., set(<changed>)))'` | 1147                    | api, shared, web (targets) |

The Bazel result lists the three `*_pkg` filegroup targets, not the test targets.

The comparison is not like-for-like. Incremental is a warm query on a 10k-task store, and the others are cold CLI runs on 4-package fixtures. Do not read any ratio between these rows as a speedup. The earlier "~4445x faster" claim is withdrawn.

Run the comparison:

```sh
node scripts/bench-compare.mjs 10
```

### Cold end-to-end (`make bench-cold`)

`scripts/cold-e2e.mjs` times one cold run per fixture: the git change source (`incremental-git changes`), then a new `incremental serve` process, hello, and one `affected` query. Each fixture is copied to a scratch repo with a base commit and a HEAD commit that edits its most-depended-on source file. The expected invalid set is the tests whose import closure contains that file. Five runs per fixture, 2026-11-05:

| Fixture                       | Tests | Expected / plan invalid | Matches import graph | Cold e2e median (min-max), ms | change source, ms | spawn + hello, ms | plan, ms |
| ----------------------------- | ----- | ----------------------- | -------------------- | ----------------------------- | ----------------- | ----------------- | -------- |
| monorepos/nx                  | 4     | 3 / 3                   | yes                  | 145.3 (127.7-382.4)           | 138.3             | 6.8               | 0.42     |
| monorepos/turborepo           | 4     | 3 / 3                   | yes                  | 143.3 (136.7-183.6)           | 137.4             | 7.6               | 0.44     |
| monorepos/bazel               | 4     | 3 / 3                   | yes                  | 165.2 (144.1-203.1)           | 148.8             | 6.9               | 0.42     |
| fixture                       | 6     | 2 / 2                   | yes                  | 144.1 (131.9-146.3)           | 136.0             | 6.8               | 0.49     |
| adapters/vitest/fixtures/repo | 14    | 2 / 2                   | yes                  | 148.0 (145.8-157.5)           | 141.1             | 6.5               | 0.37     |

Only `adapters/vitest/fixtures/repo` is an adapter fixture. The other adapters are tools with no fixture repository, so they have no row.

- **The engine is not the cost.** Spawn plus hello is about 7 ms and the plan under 1 ms. The change source is about 95% of the cold path.
- **The change source is the cost.** `incremental-git changes` takes about 135–150 ms here. The split between git calls and the adapter's own startup is not measured.
- **Cold vs cold, same fixture.** The cold Incremental run (about 145 ms) is faster than the cold Nx run (897 ms) and Bazel (1147 ms), and about the same as Turbo (151 ms). These are single fixtures of 4 packages. Treat them as rough, not as a speedup claim.

### End to end: raw vs affected-test selection (`scripts/e2e-compare.mjs`)

One change to `packages/shared/src/index.ts` in each monorepo fixture, then a test run. Wall-clock of the whole command (tool start-up and selection included), 5 timed runs after one warm-up, load about 50 on the machine. Results: `benchmarks/results/e2e-compare.json`.

| Fixture   | Method             | Median ms (min–max) | Packages tested                                    |
| --------- | ------------------ | ------------------- | -------------------------------------------------- |
| nx        | raw (no selection) | 7390 (5004–8236)    | all affected, plus extra (api, shared, utils, web) |
| nx        | Nx affected        | 11285 (7588–12954)  | exact (shared, api, web)                           |
| nx        | Incremental        | 2682 (2434–2906)    | exact (shared, api, web)                           |
| turborepo | raw (no selection) | 4420 (3267–5379)    | all affected, plus extra (api, shared, utils, web) |
| turborepo | Turbo --filter     | 5883 (4266–6987)    | exact (shared, api, web)                           |
| turborepo | Incremental        | 2665 (2392–2934)    | exact (shared, api, web)                           |
| bazel     | raw (no selection) | 2666 (1970–3235)    | all affected, plus extra (api, shared, utils, web) |
| bazel     | Bazel rdeps query  | 4423 (3974–4803)    | misses shared (api, web)                           |
| bazel     | Incremental        | 4287 (3642–6078)    | exact (shared, api, web)                           |

Read these with care:

- **The fixtures are tiny.** Each has four test files and about 1 s of test work, so start-up overhead dominates every method. Differences of a second or two are inside the run-to-run spread here (up to about 50% for one method). Do not read them as a speedup. The point is what each method runs, not how long it takes.
- **Bazel as documented misses a test.** Its query returns `api` and `web`, not `shared`, because `shared_test` reads its sources with `glob` and does not depend on `shared_pkg`. The run skips the test of the package that changed. The fixture README said the query returns all three; that was wrong.
- **Raw runs everything** (utils too). It is always correct and never selective.
- **Incremental** runs exactly the affected three, from a store warmed at the base. Its run includes the Vitest recorder, which adds cost per test file.

### Shared file (`make bench-shared-file`)

`benchmarks/shared-file.mjs` builds a store of 5000 tasks, each reading 120 files (synthetic, seeded read sets: every task reads `src/shared/core.ts`, 70% of the other reads come from its own package and 30% from the whole repo with a Zipf-like skew). It then asks for the plan of two single-file changes. Output: `benchmarks/results/shared-file.json`, run 2026-11-08, 3 iterations of 5 queries per change.

| Measure                                 | Value                                                      |
| --------------------------------------- | ---------------------------------------------------------- |
| Read set per task                       | 120 files (all tasks)                                      |
| Distinct files read                     | 5001                                                       |
| Index size (`tg.idx`)                   | 70.8 MB                                                    |
| Store size (whole directory)            | 151.1 MB                                                   |
| Shared change (`src/shared/core.ts`)    | 5000 of 5000 tasks invalidated, median query 63.4 ms       |
| Leaf change (`src/pkg-33/module-60.ts`) | 65 of 5000 tasks invalidated (the least-read file), 2.0 ms |
| Process load (spawn, hello, store load) | median 1252 ms (range 630 to 1350 ms across iterations)    |

- The index is about 14 KB per task at 120 reads. It scales with the total number of read entries, not with the number of distinct files.
- The plan for the shared change is exact: the script fails if the invalidated count differs from the number of readers.
- The read sets are synthetic. The index size and invalidation counts depend on how many files real tasks read, so the real-repository replay is the number to trust for read-set size. Load times vary a lot between runs on this machine; treat them as rough.

## Known issues

Resolved on 2026-11-05:

- Turbo fixture had no `pnpm-workspace.yaml`, so Turbo saw 0 packages. Added to the base commit. The earlier "pnpm unsupported" explanation was wrong.
- `--affected=HEAD~1` selects no tasks on turbo 2.11.10. The benchmark uses `--filter=...[<base>]`.
- Bazel fixture had no dependency edges, and the timed command listed every target. The BUILD files now list dependencies as labels in `srcs`, and the benchmark times an `rdeps` query over the packages changed in base..HEAD.
- Nx and Turborepo had a `fix relative imports` commit at HEAD, so their timed change was not `shared`. The commits are reordered so the shared change is the last one touching `shared`.
- `@bazel/rules_nodejs` is not published on npm, so the Bazel fixture could not install. It is removed; the fixture needs no external rules.
- The replay driver failed on fixtures whose working tree was clean, because its base commit had nothing to commit. Fixed with `--allow-empty`.
- Nx's output format changed between runs (JSON array vs one name per line). The benchmark now parses both.
- **Bazel build outputs were copied into the replay.** `monorepos/bazel/` has gitignored `bazel-*` symlinks. The replay copy now skips top-level `bazel-*` entries. The Bazel replay reports `total_tasks=4`, where it reported 26 before. Vitest run inside the fixture reports 4 files and 8 tests in the current state.
- **The monorepo replays tested nothing.** They used the default fixture's edit paths, which do not exist in the monorepos. They now use a monorepo edit sequence, and the skip shares show it reaches the dependency graph.
- **`comparison.json` stored absolute monorepo paths.** It now stores paths relative to the graph root.
- **The comparison did not check its answers.** A wrong selection still produced a timing. `bench-compare.mjs` now fails the run when a tool's set is not `api, shared, web`.
- **The comparison used `HEAD~1`.** Fixture repos gained documentation commits after the shared change, so `HEAD~1` was no longer the change under test. The base is now the parent of the last commit that touches `packages/shared/src/index.ts`.

Still open:

1. **Cold CLI at 100k tasks: root cause fixed, wall-clock not yet re-measured.** The 394 ms store load was a full log replay: `tg.idx` was rejected whenever observations carried a context (see DECISIONS.md, index load fix). With the fix and the copy removal, a cold `stats` on the same 100k store takes 99 ms wall and 84 ms CPU (hyperfine median, 30 runs, machine load about 55), against 400 ms wall, 237 ms CPU and 2.66 G instructions before. Wall-clock is still load-sensitive; re-measure on an idle machine before quoting it as a final figure.
2. **Not like-for-like.** See the comparison section. The warm Incremental query and the cold tool runs measure different things.
3. **Variance.** Across the runs recorded in this repo: Nx 837 to 2181 ms, Turbo 107 to 646 ms, Bazel 984 to 1912 ms, warm-plan per-query 0.09 to 0.33 ms (about 1.3 ms in one run under machine load). Each figure uses 10 samples, and the ranges are the honest number.
4. **Replay sample size is still small.** Each replay evaluates 10 commits, so zero false skips is consistent with a false-skip rate up to about 30%.
5. **The fixtures' history was rewritten** (base commits amended, Nx and Turborepo commits reordered). The old commit hashes no longer exist. Backup branches `backup/pre-fixture-repair`, `backup/pre-order-fix` and `backup/pre-deps-fix` hold the previous tips in each nested repo.
6. **Fixture repos gained commits during the validation run.** At 23:29 on 2026-11-05 a README commit was added to `monorepos/nx` and `monorepos/turborepo`, on top of the shared change. Those commits were not made by this validation run. The benchmark now handles them (see Resolved). They are still a change to the fixtures, so the fixture repos should be re-pinned in the root repo and the Nx and Turborepo `README.md` commits either kept or moved below the shared change.

## Status

- `make all-tests`: see `CHANGELOG.md` for the result of this run.
- Replay on the default fixture, the three monorepo fixtures (10 commits each): no false skips.
- Vitest suites: `monorepos/nx`, `monorepos/turborepo` and `monorepos/bazel` each pass 4 files, 8 tests.
- `make bench-cold` passes: all five fixtures' plans match the import graph.
- Warm plan: 10k and 100k tasks. The 100k query target is met; the cold CLI target is not.
- The strace oracle is Linux-only and does not run on macOS. It is not part of the replay or warm-plan path.
- All three comparison tools select the expected set, and the script fails if one does not.

Evidence for each run is recorded in `evidence/BENCH.txt`. `evidence/README.md` explains the evidence format.
