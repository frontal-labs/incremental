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
