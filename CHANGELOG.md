# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

- Engine in Goose: log, index image, stat cache, compaction, multi-writer refresh, CLI, protocol v1, reverse indexes.
- Conformance suite: 40 cases; differential fuzz against an independent reference (30,000 queries).
- TypeScript client (`@incremental/client`), Python client (`incremental`), Vitest recorder and planner, MCP server.
- Git change source (`incremental-git changes`).
- Open: CR-002 and CR-003 open (see spec/CHANGE_REQUESTS.md).
- LICENSE: added as an identical copy of LICENSE.md (Apache-2.0). `make release-check` verifies LICENSE.md exists; LICENSE.md is the canonical source.
- Release (E10): not yet cut; no release is cut until the project is unblocked. `make release-check` cannot pass until the blocking items are resolved.

### Verification pass (2026-11-05)

- `make all-tests` passes on macOS (arm64). `test-oracle` is skipped on macOS by design; `linux-gate` was not run (Docker daemon not responding).
- Benchmarks re-run: `make bench`, `make bench-smoke`, per-monorepo replay, `scripts/bench-compare.mjs`. Results in `benchmarks/results/`, evidence appended to `evidence/BENCH.txt`.
- `make bench` now runs `scripts/bench-compare.mjs` before `scripts/bench-summary.mjs`, so `RESULTS.md` is no longer built from a stale `comparison.json`.
- `scripts/bench-summary.mjs`: replay and warm-plan tables get markdown separator rows (they did not render); warm-plan shows min–max; the Turbo and Bazel rows, and the speedup sentence, are no longer hardcoded.
- `scripts/bench-compare.mjs`: repo root derived from the script location instead of a hardcoded user path.
- `BENCHMARKS.md` rewritten: the "~4445x faster than Nx" claim is withdrawn; per-query latency is reported as a range; Known issues added.
- Known benchmark defects, not fixed (they require changing fixture git history): Turbo fixture has no `pnpm-workspace.yaml`; Bazel fixture declares no deps and the timed command lists all targets.
- `.gitignore`: `__pycache__/`, `*.pyc`, `.ruff_cache/`, `target/`. Already-tracked `examples/rust_client/target/` files remain tracked.
- `biome.json`: `**/target` and `benchmarks/results` excluded from Biome.
- Known failing gates, not fixed: `make lint` and `make fmt-check` (Biome lint and format errors in adapter sources; ruff docstring and `TRY003` findings in `bindings/python`).

### Repair pass (2026-11-05, second)

- Lint and format gates now run for real. `make lint` and `make fmt-check` pass. Changes: Biome safe fixes; manual fixes for six Biome errors (explicit types, braced callbacks, `return` after `this.loss`, split assignment in a `while` loop); Python docstrings, a nested-`if` collapse, and a per-file ignore for `TRY003` in `bindings/python/tests`; `ruff format` on one file.
- `package.json`: the non-blocking C, Rust, shell and TOML lint and format-check scripts had `|| true`, so they could never fail. Removed it. The shell glob matched no files; `taplo check --diff` is not a valid format check; now `taplo fmt --check`.
- Fixtures repaired. Turbo: `pnpm-workspace.yaml` in the base commit. Bazel: dependency edges as labels in `srcs`, so `rdeps` works offline; removed the unpublished `@bazel/rules_nodejs` dependency. Nx and Turborepo: the `fix relative imports` commit is reordered before the `shared` change, so HEAD changes `shared` in all three. Each nested repo has a `backup/pre-*` branch with its previous tip.
- Monorepo fixtures installed (`pnpm install --ignore-workspace --no-lockfile`) and their Vitest suites pass: 4 files, 8 tests each.
- `examples/rust_client/target/` untracked (62 files staged as deletions; still on disk; ignored by `target/`).
- `scripts/bench-compare.mjs`: Turbo uses `--filter=...[HEAD~1]` (the `--affected=<ref>` form selects nothing on turbo 2.11.10). Bazel times an `rdeps` query over the packages changed in HEAD~1..HEAD. Nx parses both output formats.
- `scripts/bench-summary.mjs`: correctness is checked against the expected set (`shared`, `api`, `web`).
- `benchmarks/replay/src/index.ts`: base commit uses `--allow-empty`. The replay failed on a fixture whose working tree was clean.
- `examples/agent_loop/README.md`: expected-results table and layout corrected to the measured output.
- `monorepos/README.md` rewritten: commit history, dependency wiring, and the timed commands.
- Not done: Linux gate. The Docker VM does not start (`Docker.raw` returns `input/output error`, and the socket refuses connections after restart). Repair needs Docker's disk reset, which deletes other projects' images and volumes; awaiting approval.
- `scripts/cold-e2e.mjs` and `make bench-cold`: cold end-to-end affected detection (git change source, new engine process, hello, one plan) on the monorepo fixtures, `fixture/` and `adapters/vitest/fixtures/repo`. Plans match the import graph on all five. The git change source is about 95% of the cold path (about 140 ms against about 7 ms for the engine).

### Adapters on the benchmark fixtures (2026-11-05)

- Nx adapter now runs end to end on `monorepos/nx`. It observes each selected project with its declared inputs (the project's files and its transitive dependencies, from `nx graph`), hashed before and after the run, and advances the baseline on a clean run. Before this it only planned and ran. Fixed along the way: `discoverProjects` used `require` in an ES module and returned directories instead of names (removed); fallback runs now select every project; `wouldSkip` is correct on fallbacks.
- Nx fixture: `nx.json` gets the `production` named input (the old file was invalid for Nx 24). Per-package `project.json` `test` targets no longer `dependsOn: ["^build"]`: `build` runs `tsc` without a tsconfig and fails, and the tests read `src` directly. Backup branches `backup/pre-nx-json`, `backup/pre-nx-deps`, `backup/pre-project-json`.
- Bazel fixture: each package has a `vitest_test` target (`defs.bzl`, a `test = True` rule, offline) running its Vitest file. `.bazelrc` passes PATH and the HOME/XDG variables into test actions. `MODULE.bazel.lock` is committed. The `rdeps` benchmark query now uses `kind(filegroup, ...)`, so test targets are excluded.
- `scripts/fixture-e2e.sh` / `make fixture-e2e`: prime, edit `utils`, edit `shared`, each step checked against the import graph. Passes for both adapters. Not in `all-tests` because the Bazel test runner segfaults intermittently (see DECISIONS.md).
- Adapter unit tests: `make test-nx` (4 tests) is in `test-adapters`.
- Bench: `bench-compare` Bazel query filtered to package targets; Turbo count verified after reverting install artifacts.

### Recorder-based Nx and Turborepo adapters, Turbo adapter, fixture repairs (2026-11-05)

- **Turborepo adapter** (`adapters/turbo`, `incremental-turbo run`): packages with a `test` script are the tasks; the package graph comes from `turbo ls` and each `package.json`; each package's test runs under the recorder (`turbo run test --filter=<pkg> --force --env-mode=loose`); the trace is the observation; the baseline advances only on a clean run. Exit codes 0/1/2/7 as documented. `make test-turbo`, and `make fixture-e2e` covers it.
- **Nx adapter now observes.** The test command of each project (its `project.json` `test` target, or the package `test` script) runs directly under the recorder, not through `nx test`: Nx's own processes are subprocesses the recorder cannot tell apart from task processes, which marked every observation dirty. The observation is built from the trace (`buildObservation`) and scoped to the plan's environment.
- **Shared fixes.** The plan's environment and the recorder's snapshot cover the same names (untracked names and shell-volatile names are left out on both sides). The runner version in the context is read from the workspace root (`nx --version` and `turbo --version` report local or global depending on the directory). Context hashes are real file hashes (lockfile, root tsconfig, root package.json), not zeros. Exit code 7 (ran, not advanced) is returned as documented by the Nx adapter too.
- **Fixtures.** Nx and Turborepo pin Vitest 4.1.12 and Vite 7 (the recorder's pinned version; Vitest 2 starts child processes that the recorder marks dirty). Turborepo's `turbo.json` `test` has no `dependsOn`. Backup branches `backup/pre-vitest4`, `backup/pre-turbo-json` in each nested repo.
- **Bazel test rule** writes its JUnit XML through Vitest (`XML_OUTPUT_FILE`), so Bazel does not run its `generate-xml.sh` step, which crashed intermittently. Twenty clean rounds on a clone after the change. Backup branch `backup/pre-junit`.
- **Lockfile drift.** `adapters/typescript` and `adapters/biome` declare `typescript` 5.9.3 (what the code compiles against); the `@tsc-rs` alias is gone from their manifests. `adapters/vitest/fixtures/repo` lock synced.
- `scripts/fixture-install.sh` installs the fixtures' test dependencies and reverts the `typescript` alias pnpm writes into `package.json`.
- Nx CLI: `nx` and `turbo` version reads use the workspace directory.

### Validation run (2026-11-05, third)

- `make all-tests` passes (exit 0). `make bench`, `make bench-cold`, and the three monorepo Vitest suites pass. Results and ranges in `BENCHMARKS.md`; raw output in `benchmarks/results/`.
- Turbo adapter: the default store is `<root>/.incremental` (workspace), not a shared temp path. Found by the security review; `.incremental/` is gitignored.
- `BENCHMARKS.md` updated to this run. The Bazel `rdeps` timed command is written as `kind(filegroup, ...)`, matching `scripts/bench-compare.mjs`. The cold end-to-end section is this run's numbers; the earlier `git status` and `git diff` timings are removed because they were not re-measured.
- Open, found by this run: `monorepos/bazel/` has gitignored `bazel-*` symlinks. The replay copies them and Vitest picks up 22 extra test files (per-fixture replay `total_tasks=26`; `vitest run` in the fixture reports 26 files / 58 tests). Not fixed; it needs a change to the replay copy and the fixture's Vitest config.
