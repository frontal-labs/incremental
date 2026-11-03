# @backplane/pnpm

The pnpm workspace adapter (spec/adapters/pnpm.md, status draft). It runs each workspace package script as a task through the backplane client and the real engine.

    npm test                          # build the client, type-check, run the tests
    node dist/src/run.js run [--base REF] [--json] [--all] [--store DIR] [--root DIR] [--timeout MS]

## Tasks

A task is `<package path>#<script>`, repo-relative. The root package is `.`. Workspace packages come from `pnpm -r list --depth -1 --json`. Each script runs as `pnpm --filter <name> run <script>` (a `./<path>` filter when the package has no name). pnpm exits with the script's status: 0 is `pass`, anything else is `fail`, and a spawn error or timeout is `error`.

## What is real and what is declared

- **Real:** the workspace graph (pnpm list), the package manifests, the root lockfile hash (context `lockfile`), the pnpm version (context `runner`), and each script's outcome and duration.
- **Declared:** for each task, `pnpm-workspace.yaml`, `.npmrc` and the root `package.json` (hash or `absent`), the task package's own `package.json`, and every file under each workspace dependency's directory, transitively. A change in a dependency therefore reaches its dependents through the declared inputs.
- **Not observed:** the script's own reads (see below).

## Recorder and dirty observations

No recorder is paired with this adapter, so every observation is recorded `dirty: true` (spec 11.1, rule 4). The engine reruns a dirty task every time. In practice the adapter skips nothing until a recorder for the script's tools is paired. The declared inputs are recorded now so the graph is ready when that happens.

## Gaps

- The script's own reads are not observed. A script that reads an undeclared file is not protected, and the run is `dirty`.
- Install-time side effects (postinstall scripts, `pnpm install` itself) are not observed. The adapter does not install. Install before running.
- A dependency's `node_modules`, `.git`, `.backplane` and `.toolchain` are not declared. Build output such as `dist` is declared.
- Dependency edges come from manifest names that match a workspace package name. This over-approximates pnpm's links, which is sound but may run more than needed.
- Symlinked packages and symlinks inside dependency directories are not followed.
- A task whose script or package was removed is not forgotten. The engine forgets only the tasks it reports in `deleted_tasks`. Packages with duplicate names are ambiguous under `--filter <name>`.
- A pnpm error that exits non-zero before the script runs (for example, a filter that matches nothing) is recorded as `fail`, because pnpm's exit code is not separated from the script's.
- Context: `probes`, `dirs` and `env` are false. `pkgjson` hashes every workspace manifest, so any manifest change falls back to running every task (P2). `tsconfig` is the constant `absent`, because this adapter reads no tsconfig.
- The `pnpm` binary is taken from `BACKPLANE_PNPM` or `PATH`. Without a `packageManager` field, corepack may pick another version. The version used is recorded in the context.
- Not covered by the tests: a lockfile version change (conformance case), and the `--base` mismatch path.
