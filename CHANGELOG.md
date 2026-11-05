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
