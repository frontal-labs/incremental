# Monorepo Fixtures

Three dedicated monorepo fixtures for benchmarking Incremental against other
affected-detection tools (Nx, Turborepo, Bazel). Each is a separate git repository
nested under this directory.

## Structure

Each fixture has the same package structure:

```
packages/
  shared/     → src/index.ts (add, mul, sum3, diff, div, avg)
              → test/shared.test.ts  (2 tests)
  api/        → src/index.ts (depends on shared)
              → test/api.test.ts     (2 tests)
  web/        → src/index.ts (depends on shared)
              → test/web.test.ts     (2 tests)
  utils/      → src/index.ts (standalone, no deps)
              → test/utils.test.ts   (2 tests)
```

`shared` → `api` and `shared` → `web` (dependency graph). `utils` is independent.
Each package has one Vitest file, so each fixture has 4 files and 8 tests.

## Git history

The change that a benchmark measures is always the last commit (HEAD), and it
always touches `packages/shared/src/index.ts`, so the expected affected set is
`shared`, `api`, `web`.

- `monorepos/nx/` and `monorepos/turborepo/`: `initial` → `fix relative imports`
  (api and web) → `add diff to shared` (HEAD).
- `monorepos/bazel/`: `initial` → `add diff to shared` (HEAD).

## Dependency wiring

- **Nx and Turborepo** use pnpm workspaces. The pnpm workspace file
  (`pnpm-workspace.yaml`, `packages: ["packages/*"]`) lives in the base commit.
  Without it, Turborepo sees 0 packages. Run `pnpm install --ignore-workspace --no-lockfile`
  inside each fixture to install its Vitest dependency (the root workspace would
  otherwise be picked up).
- **Bazel** runs offline. The BUILD files are `filegroup` targets. A dependency is
  a label in `srcs`: `//packages/api:api_pkg` lists `//packages/shared:shared_pkg`,
  so `bazel query 'rdeps(//packages/..., //packages/shared:shared_pkg)'` returns
  `api`, `shared` and `web`. The Bazel fixture declares no external rules.

## Fixtures

| Path                   | Tool          | Affected-detection command (timed by `bench-compare.mjs`) |
| ---------------------- | ------------- | --------------------------------------------------------- |
| `monorepos/nx/`        | Nx            | `nx show projects --affected --base=HEAD~1`               |
| `monorepos/turborepo/` | Turborepo 2.x | `turbo run build --filter=...[HEAD~1] --dry=json`         |
| `monorepos/bazel/`     | Bazel         | `bazel query 'rdeps(//packages/..., set(<changed>))'`     |

`--affected=HEAD~1` is not used for Turborepo: on turbo 2.11.10 it selects no
tasks, while the explicit `--filter=...[HEAD~1]` selects the right ones.

## Running

```sh
# Install each fixture's test dependencies once
for m in nx turborepo bazel; do (cd monorepos/$m && pnpm install --ignore-workspace --no-lockfile); done

# Run the fixture tests
for m in nx turborepo bazel; do (cd monorepos/$m && ./node_modules/.bin/vitest run); done

# Run the comparison (writes benchmarks/results/comparison.json)
node scripts/bench-compare.mjs 3
```

## Results

The numbers change from run to run. See `BENCHMARKS.md` for the latest run and
its caveats. The comparison is not like-for-like: Incremental is a warm query on a
synthetic 10k-task store, and the other tools are cold CLI runs on these 4-package
fixtures.
