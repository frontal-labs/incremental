# Incremental Compute Engine

![Frontal Banner](./banner.jpg)

**High-performance incremental computation engine for building dependency-driven systems.**

An incremental dependency engine. It records what each task reads, lists, probes and writes, stores those observations as content-hashed records, and answers one question: given the changes since the last known-good baseline, which tasks are invalid, and why.

The engine is written in Goose (`core/`). Protocol clients are TypeScript (`bindings/node`, `adapters/vitest`, `mcp`) and Python (`bindings/python`). The specification is in `spec/`, and the conformance suite (40 cases) is in `conformance/`.

**Name status:** the project is named Incremental (renamed from its former name on 2026-11-04; the binary, packages and store follow the new name). The earlier trademark, GitHub and domain checks (DECISIONS.md D-E0-01) covered the former name only. The checks for "Incremental" are not done .

## Quickstart

### Requirements

- Node 22 and pnpm 9.0.0 (the `packageManager` field in `package.json`).
- Python 3.10 or later, for `make test-python`.
- `cargo`, for `make test-rust` (the Rust binding in `bindings/rust`).
- Docker, for `make linux-gate` only.
- The Goose toolchain is not installed by hand. `make setup` runs first and fetches it into `.toolchain/goose/` through `scripts/fetch-goose.sh` when it is missing. This needs network access once.

### Install

```sh
pnpm install                       # root devDependencies (tsc-rs) and the pnpm workspace packages
for d in $(git ls-files '*package.json' | grep -v -e '^package.json$' -e fixture -e '^examples/' | xargs -n1 dirname | sort -u); do (cd "$d" && npm install); done
```

The adapters are not in the pnpm workspace. Each one runs its tests with `npm test` in its own folder, so each needs its own `npm install`. The loop above covers every such folder.

### Build and test

```sh
make build        # engine (core/dist/incremental) and git source (adapters/git/dist/incremental-git)
make all-tests    # check-spec, core, policy, protocol, bindings, vitest, oracle, e2e, adapters, mcp
```

`make all-tests` does not run everything. Also run:

```sh
make test-fuzz test-python test-git
```

The adapter targets run inside `test-adapters`, and each one can be run alone: `make test-bazel`, `test-biome`, `test-clippy`, `test-config`, `test-env`, `test-fs`, `test-playwright`, `test-pnpm`, `test-process`, `test-protobuf`, `test-ruff`, `test-turbopack`, `test-watcher`, plus `test-typescript` and `test-rust`.

Every test target depends on `build`. Pass several targets to one `make` command, such as `make test-core test-policy`, so the engine is built once. Separate `make` commands rebuild it each time.

When a target fails, the terminal shows its last 20 to 30 lines. The full output is in `logs/<target>.log` (git-ignored).

Some targets fail on purpose because the target they check is not built yet; `make bench-smoke` and `make bench` now pass (benchmarks/warm-plan.mjs is implemented and INCREMENTAL_BENCH_REPO defaults to fixture). The strace-oracle target (`make test-oracle`) is Linux-only and is skipped on macOS.

## Using the engine

Record an observation for a task, set the baseline, then ask which tasks are invalid after a change. This uses the example files in `examples/cli_workflow/`. The task `src/math.test.ts` reads `src/math.ts`.

```sh
STORE=.incremental
core/dist/incremental init --store $STORE
core/dist/incremental observe --store $STORE --file examples/cli_workflow/observation.json
core/dist/incremental advance --store $STORE --to abc123 --expected null

# changes.json: {"baseline":"abc123","head":"def456","changes":[{"path":"src/math.ts","status":"modified"}]}
core/dist/incremental affected --store $STORE --changes changes.json --baseline abc123 \
  --context examples/cli_workflow/context.json
```

The last command prints a plan. It lists `src/math.test.ts` with the reason `reads:src/math.ts`, and `skipped` is 0. Two other commands are `stats` (store summary) and `serve` (protocol v1 over stdio). See `examples/cli_workflow/README.md` for the full walkthrough and `spec/PROTOCOL.md` for the protocol.

## Benchmarks

Measured on macOS (arm64), 2026-11-05. Full tables, the methodology and the known issues are in [`BENCHMARKS.md`](./BENCHMARKS.md).

**Warm query latency** (`benchmarks/warm-plan.mjs`, 1,000 queries × 3 iterations, each query invalidates exactly one task):

| Tasks   | Per-query p50 | Per-query p99 | Process load (median)         |
| ------- | ------------- | ------------- | ----------------------------- |
| 10,000  | 0.100 ms      | 0.650 ms      | 38 ms                         |
| 100,000 | 0.093 ms      | 0.661 ms      | 394 ms (before the index fix) |

The warm query target (p50 under 5 ms and p99 under 20 ms at 100k tasks) is met. The cold CLI target (under 300 ms at 100k tasks) is **not yet confirmed**. Loading 100k observations took about 394 ms before the index-load fix. After it, a cold `stats` on the same store took 99 ms wall (hyperfine median, 30 runs) at machine load about 55. That figure is not final: re-measure on an idle machine before quoting it (see BENCHMARKS.md, Known issues).

**Replay accuracy** (`make bench-replay`, 10 commits per fixture): zero false skips across the default fixture and the Nx, Turborepo and Bazel monorepo fixtures. The sample is small: ten commits give a rule-of-three upper bound of 30%, so this shows no false skip was found, not that the rate is low.

**Comparison with other tools** (`node scripts/bench-compare.mjs 10`): affected-detection on the 4-package monorepo fixtures, median of 10 runs.

| Tool  | Median   |
| ----- | -------- |
| Nx    | 897 ms   |
| Turbo | 151 ms   |
| Bazel | 1,147 ms |

These are cold CLI runs on small fixtures. Incremental's warm query is not the same operation, so do not read a ratio between these rows as a speedup.

Reproduce with `make bench` (after `make build`). It writes the raw outputs to `benchmarks/results/`.

## Limits 

- Non-file inputs (time, network, randomness) are not observed. A task that depends on them is not protected by the engine; re-run it when they matter.
- A store is per worktree by default (`<repo>/.incremental`). A store shared between worktrees is safe, but a baseline mismatch falls back to running everything.
- Verify mode hashes every recorded file. It is for audits and shared stores, not the warm path.
- The engine answers from the observations it has. A query on a store with no baseline is a fallback, not a plan.

## Status

Milestones are tracked in `STATUS.md` (generated by `make status`). Open items are in `DECISIONS.md` and `spec/CHANGE_REQUESTS.md`.

## License

Apache 2.0
