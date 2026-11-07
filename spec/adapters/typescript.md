# typescript adapter

Status: built (`adapters/typescript`, `make test-typescript`; 6 integration tests against the real engine). Spec sign-off: not recorded in DECISIONS.md. Matched to adapters/typescript/README.md on 2026-11-04. Chosen by the lead from the drafts because names `tsc, bundler inputs` as a later adapter. Build recorded in DECISIONS.md, "TypeScript adapter (built)".

## As built

- **Task:** each `tsconfig.json` under the repo, by repo-relative path (`discoverProjects`, `src/project.ts`).
- **Inputs:** the files `tsc -p <config> --listFilesOnly` reports, the `extends` chain of the config, and every `package.json` on the path from those files up to the repo root. All are recorded as `file` inputs with a SHA-256 taken at observation time. Files inside the TypeScript package are not recorded; the runner version in the context covers them.
- **Context:** lockfile, root `tsconfig.json`, hash of all `package.json` files, `runner: typescript@<version>`, Node version, `fmt: 1`, and `caps: {probes: false, dirs: false, env: false}`. Probes, directory listings and environment reads are not observed.
- **Outcome:** `tsc -p <config> --noEmit --incremental false --composite false`. Exit 0 is `pass`; exit 1 or 2 is `fail`; anything else, or a timeout, is `error`.
- **Dirty:** a project is observed as dirty when its config declares `references`, when an `extends` target is a package name, or when a program file is outside the repo. A dirty worktree marks every observation dirty.
- **Loop:** the same as the Vitest adapter : plan, forget deleted projects, check, observe, advance only when every project ran, the worktree is clean and HEAD did not move. Exit 0 ok, 1 a project failed, 2 usage, 4 engine error, 7 not advanced.

## Gaps and their cost (as built)

- **Unrelated edits run everything.** Because `probes` and `dirs` are false, any modified file that no project reads (for example `README.md`) is a P7 `unobserved_input` fallback, and every project runs. This is the sound answer. The test `a type error fails its project...` asserts it. Fixing it means recording module-resolution probes, which needs a tracer or a `tsc` plugin and is not built.
- **No shadow mode.** The Vitest adapter has `--shadow`. This one does not.
- **Projects run one at a time.** Vitest runs files in a pool. This adapter does not.
- **Command-line options are not checked against the config.** `--noEmit`, `--incremental false` and `--composite false` override the config for the check only.

## Task

A TypeScript project: a `tsconfig.json`, or a project reference in a `tsc -b` build. Task id: the repo-relative path of the `tsconfig.json` (D-2).

## What the recorder can observe

- Every input file tsc reads for a project, from `tsc --listFilesOnly` (lists the program's source files, without emitting). Each file is hashed at read time.
- `tsconfig.json` and every `extends` chain. These are declared inputs.
- Type declaration packages under `node_modules`: their version comes from the lockfile, not per-file hashes.

## What it cannot observe

- Outputs (`.js`, `.d.ts`). Not stored . Only inputs are recorded.
- Files outside the program, such as a `tsc` plugin that reads its own config.
- Environment variables that change emit (for example `TSC_*` options set through the environment), unless the env adapter lists them.

## Declared inputs

- `tsconfig*.json`, `package.json`, the lockfile, `typescript` version in the context.

## Conformance cases (to write as adapter tests; adapters are not in the conformance suite, )

- Changing a source file in the program invalidates the project.
- Changing a file that is not in the program does not invalidate it.
- Changing a `typescript` version invalidates every project (context change).

## Open questions

- Whether `--listFilesOnly` matches the set of files tsc actually reads for type checking. The two are the same by design but this needs a test on a real project.
- The relation to the Turborepo and Nx cache keys in COMPETITORS.md. This adapter must not claim to replace them.
