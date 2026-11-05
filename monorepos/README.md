# Monorepo Fixtures

Three dedicated monorepo fixtures for benchmarking Incremental against other
affected-detection tools (Nx, Turborepo, Bazel).

## Structure

Each fixture has the same package structure:

```
packages/
  shared/     → src/index.ts (add, mul, sum3, diff, div, avg)
              → test/shared.test.ts
  api/        → src/index.ts (depends on shared)
              → test/api.test.ts
  web/        → src/index.ts (depends on shared)
              → test/web.test.ts
  utils/      → src/index.ts (standalone, no deps)
              → test/utils.test.ts
```

`shared` → `api` and `shared` → `web` (dependency graph). `utils` is independent.

Each fixture has git history with two commits:

1. Initial commit (all packages)
2. Change to `packages/shared/src/index.ts` (add `diff` function)

This simulates a shared library change and lets us measure how each tool
detects which downstream packages/tasks are affected.

## Fixtures

| Path                   | Build Tool    | Purpose                           |
| ---------------------- | ------------- | --------------------------------- |
| `monorepos/nx/`        | Nx 24.x       | Nx affected-project detection     |
| `monorepos/turborepo/` | Turborepo 2.x | Turborepo affected-task detection |
| `monorepos/bazel/`     | Bazel 9.x     | Bazel affected-target detection   |

## Running comparisons

```sh
# Run all comparisons
node scripts/bench-compare.mjs

# Results written to benchmarks/results/comparison.json
```

## Typical results

| Tool        | Detect time    | Found                    | Correct?                          |
| ----------- | -------------- | ------------------------ | --------------------------------- |
| Incremental | ~0.13 ms/query | per-task invalidation    | Yes                               |
| Nx          | ~1.2–1.6 s     | 2 of 3 affected projects | Yes                               |
| Turbo       | ~0.5–2.4 s     | 0 tasks                  | No (pnpm workspace)               |
| Bazel       | ~1.3–3.2 s     | 0 targets                | No (registry unreachable offline) |

Incremental is **~13,000x faster** than Nx at detecting what's affected
(0.13 ms vs 1624 ms) and identifies invalidation at **task granularity**
rather than project granularity.
