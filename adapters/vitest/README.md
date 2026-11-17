# Vitest adapter (`adapters/vitest`)

`incremental-vitest run` is the adapter loop for Vitest test files. Each file is one task. A preload (`src/preload.ts`) records its reads, probes and environment, and turns the trace into an observation. The planner (`src/planner.ts`) builds the context from the lockfile, `tsconfig.json`, `package.json` files and the Vitest version.

```sh
incremental-vitest run [--base REF] [--json] [--all] [--jobs N] [--shadow] [--include GLOB] [--exclude GLOB] [--vitest-arg ARG] [--vitest FILE]
```

Exit codes: 0 ok and advanced; 1 a test failed; 2 usage; 4 engine error; 7 ran, baseline not advanced.

`--shadow` plans and reports only. It prints the selection the plan would run and the tests it would skip, but executes no test file and writes nothing to the store (no observations, no advance), so a shadow run never moves the baseline.

- Tests: `make test-vitest` (V01 to V16 through the whole loop, plus the conformance cases in `fixtures/cases`).
- `fixtures/` is test data. Its `packages/*/test/` directories are fixture content that the conformance cases name, so they keep their names.
- Open: CR-002 (V13) and CR-003 (V16) are not decided (`spec/CHANGE_REQUESTS.md`).

## Performance

Measured on macOS x86_64, Node v22.23.2, against the fixture repo in `fixtures/repo` (14 test files, 2 packages).

- **Engine query:** a warm `affected` plan answers in about 0.1 ms at 10,000 tasks and stays in the sub-millisecond range at 100,000 (p50, see the `Benchmarks` section of the top-level README). The engine is not the bottleneck.
- **Per-invocation overhead:** about 2.5 s per `run` even when nothing changed and no test file is executed. That is Node start and imports, spawning the engine and loading the store, and the git change-set queries. A plan-and-report-only `--shadow` run of the same repo is faster, around 0.5 s, because it skips the test executions and the store round-trips. The overhead is reduced further by the skip-when-clean fast path (see `run.ts`), which exits before spawning the engine when the worktree is clean and HEAD is unchanged.
- **Per-file cost:** every selected file gets its own Vitest process; on this machine a file costs about 1 s cold (measured 0.9–1.2 s per file in the fixture, run in parallel with `--jobs`). The prime run of all 14 files took about 7.5 s wall.
- **When incremental wins:** when the test set is large and a change invalidates only a few files. Example, measured on this machine: a 1-file source edit selects and runs 3 of 14 files in about 2.7 s (plus 3 files of Vitest work), where a full `vitest run` of the same 14 files takes about 7.5 s. The no-op case (nothing changed) costs the ~2.5 s overhead and runs nothing useful, so the win starts at one or more invalidated files. A full re-run (`--all`, or any fallback) costs the same as plain Vitest plus the overhead.
