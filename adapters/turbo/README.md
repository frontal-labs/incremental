# @incremental/turbo: the Turborepo adapter

Runs the `test` script of each Turborepo package that has one, and runs only the packages the
engine says are invalid.

## Usage

```sh
npm install
npm run build

incremental-turbo run [--base REF] [--all] [--shadow] [--store DIR] [--root DIR] [--jobs N] [--timeoutMs MS]
```

- `--base REF`: the baseline for a first run (the store's baseline is used afterwards).
- `--all`: run every package with a test script.
- `--shadow`: plan and report only. Nothing runs and nothing is written to the store.
- `INCREMENTAL_TURBO`: the turbo binary to use (default `turbo` on PATH).

## How it works

Every run asks the engine what is invalid, runs only those packages, and records what each one read.

1. Reads the store baseline `B`.
2. Builds the ChangeSet from `B` to the worktree (`incremental-git`).
3. Reads the packages from `turbo ls --output=json`, and their graph from each `package.json` (a dependency on another workspace package is an edge).
4. Asks the engine for the plan, with the packages that have a `test` script as the declared tasks. A fallback runs every package.
5. Runs `turbo run test --filter=<package> --force --env-mode=loose` for each selected package, under the recorder (`adapters/vitest/src/preload.ts`): every file its processes read is traced. `--force` turns off Turborepo's cache, because the adapter decides what to skip; `--env-mode=loose` passes the environment through, so the recorder reaches the test processes.
6. Records one observation per package from its trace, with the plan's environment only.
7. Advances the baseline to HEAD only if every selected package passed, the worktree is clean at the end, and HEAD did not move.

The recorder needs Vitest 4.1.12 (the version it is pinned to); Vitest 2 starts child processes during a run, which the recorder marks dirty.

The context is the real content of the lockfile (pnpm, npm or yarn), the root `tsconfig.json`, the root `package.json`, and the turbo version. A change to any of them falls back to running everything.

Test on the fixture: `make fixture-e2e` (prime, edit `utils`, edit `shared`, checked against the import graph).

## Limits

- A package's test is the `test` script run under turbo. Tasks in `turbo.json` that `test` depends on (for example `^build`) run too, and their reads are not recorded as this package's observation.
- A test that reads a file the recorder cannot see (a worker thread, an untraced `require`) is recorded dirty, so it is re-run, not skipped unsoundly.

## Exit codes

- 0: every selected package passed, and the baseline advanced (or `--shadow`).
- 1: a test failed.
- 2: usage or engine error, or a package whose run was an error (for example, turbo ran no task).
- 7: ran, but the baseline was not advanced.
