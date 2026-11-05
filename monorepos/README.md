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
  otherwise be picked up). Installing may rewrite the `typescript` entries in
  `package.json`; revert those before benchmarking, because Turbo counts uncommitted edits.
- **Nx** config: `nx.json` defines the `production` named input, which `targetDefaults` uses.
  Each package's `test` target has no `dependsOn`: the tests import `src` directly, and a
  `^build` dependency would run `tsc`, which needs a `tsconfig.json` the packages do not have.
- **Bazel** runs offline. The BUILD files are `filegroup` targets. A dependency is a label in
  `srcs`: `//packages/api:api_pkg` lists `//packages/shared:shared_pkg`, so
  `bazel query 'rdeps(//packages/..., //packages/shared:shared_pkg)'` returns `api`, `shared`,
  `web` and their test targets. The benchmark filters with `kind(filegroup, ...)`.
- **Bazel tests**: `defs.bzl` defines `vitest_test`, a `test = True` rule that runs one Vitest
  file from the workspace's `node_modules`. Native `sh_test` needs `rules_shell`, which is
  fetched from the network, so it is not used. The rule has Vitest write the JUnit XML itself
  (`XML_OUTPUT_FILE`), so Bazel skips its own `generate-xml.sh` step, which crashed intermittently
  on this machine. `.bazelrc` passes PATH and the HOME/XDG variables into test actions, because
  `node` is a mise shim. The lockfile `MODULE.bazel.lock` is committed (the Bazel adapter needs it).
- **Turborepo**: `turbo.json` sets `test` without `dependsOn`, for the same reason as Nx.

**Test versions:** the fixtures use Vitest 4.1.12 with Vite 7, the version the recorder is pinned
to. Vitest 2 starts child processes during a run, and the recorder marks such observations dirty.

## Fixtures

| Path                   | Tool          | Affected-detection command (timed by `bench-compare.mjs`) |
| ---------------------- | ------------- | --------------------------------------------------------- |
| `monorepos/nx/`        | Nx            | `nx show projects --affected --base=HEAD~1`               |
| `monorepos/turborepo/` | Turborepo 2.x | `turbo run build --filter=...[HEAD~1] --dry=json`         |
| `monorepos/bazel/`     | Bazel         | `bazel query 'kind(filegroup, rdeps(//packages/..., set(<changed>)))'` |

`--affected=HEAD~1` is not used for Turborepo: on turbo 2.11.10 it selects no
tasks, while the explicit `--filter=...[HEAD~1]` selects the right ones.

## Running

The fixtures' test dependencies are installed with `scripts/fixture-install.sh`, which also reverts the
`typescript` alias that pnpm writes into each `package.json`.

```sh
# Adapters on the fixtures: Nx and Bazel prime, edit a leaf, edit shared, and check the
# selected tests against the import graph
make fixture-e2e

# Install each fixture's test dependencies once (reverts pnpm's package.json rewrite)
sh scripts/fixture-install.sh

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
