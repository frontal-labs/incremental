# pnpm adapter

Status: built (adapters/pnpm, make test-pnpm). Spec sign-off: not recorded in DECISIONS.md. Matched to adapters/pnpm/README.md on 2026-11-04.
Also a context input: the lockfile is already a global input (docs/spec/CONFIGURATION.md).

## Task
A workspace package, from `pnpm -r list --depth -1 --json`, run with `pnpm --filter <name> run <script>` (a `./<path>` filter when the package has no name). Task id: `<package path>#<script>`, repo-relative. The root package is `.`. pnpm's exit status is `pass` at 0 and `fail` otherwise; a spawn error or timeout is `error`.

## What the recorder can observe
- The workspace graph: `pnpm list -r --depth -1 --json` gives each package and its workspace dependencies. Dependency edges come from manifest names that match a workspace package name, which over-approximates pnpm's links.
- Package manifests: each package's `package.json` is a declared input. The context `pkgjson` hashes every workspace manifest, so any manifest change falls back to every task (P2).
- Root lockfile: `pnpm-lock.yaml`, hashed as the context `lockfile`.
- Each script's outcome and duration.

## What it cannot observe
- The script's own reads. By default every observation is `dirty` and the task reruns every time. A task can be made skippable only by the repository's own statement, in `incremental-pnpm.json` at the root: `{ "confined": ["packages/lib#build"] }`. A confined task's inputs are its package's own files, its manifest, the root manifest and workspace files, and every file of each workspace dependency, transitively. The adapter cannot check that claim; if a confined script reads anything else (a file outside the workspace, a process environment variable), a change to it is missed. Unconfined tasks always rerun. The adapter's ignore list (paths no confined task reads) is dropped before any rule runs, so an edit there selects nothing.
- Install-time side effects (postinstall scripts, `pnpm install` itself). The adapter does not install. Install before running.
- A dependency's `node_modules`, `.git`, `.incremental` and `.toolchain` are not declared. Build output such as `dist` is declared.
- Symlinked packages and symlinks inside dependency directories are not followed.
- A task whose script or package was removed is not forgotten unless the engine reports it in `deleted_tasks`. Packages with duplicate names are ambiguous under `--filter <name>`.
- A pnpm error that exits non-zero before the script runs (for example, a filter that matches nothing) is recorded as `fail`, because pnpm's exit code is not separated from the script's.
- Without a `packageManager` field, corepack may pick another pnpm version. The version used is recorded in the context (`runner`).
- Context: `probes`, `dirs` and `env` are false. `tsconfig` is the constant `absent`, because this adapter reads no tsconfig.

## Declared inputs
- For each task: `pnpm-workspace.yaml`, `.npmrc` and the root `package.json` (hash or `absent`), the task package's own `package.json`, and every file under each workspace dependency's directory, transitively. A change in a dependency reaches its dependents this way.
- For a confined task: its package's own files, its manifest, the root files and every file of each workspace dependency, as above.
- `pnpm-lock.yaml` is the context `lockfile`, not a per-task declared input.

## Cases (not in the conformance suite, )
The adapter is not in the conformance suite. Behaviors to check:
- A dependency version change in the lockfile invalidates every package that uses it (through the `lockfile` context, which falls back to every task).
- A change in a workspace dependency invalidates its dependents.
- A script not listed in `incremental-pnpm.json` is `dirty` and reruns.
- Not covered by its tests, per the README: a lockfile version change, and the `--base` mismatch path.

## Open questions
- None. The spec's question, a separate adapter or a planner over other recorders, is answered by the build: pnpm is a standalone adapter, and a script's reads come from the repository's `confined` declaration, not from a paired recorder (README, DECISIONS 2026-11-04).
