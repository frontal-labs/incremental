# turbopack adapter

Status: built (`adapters/turbopack`, `make test-turbopack`). Spec sign-off: not recorded in DECISIONS.md. Matched to adapters/turbopack/README.md on 2026-11-04.



## Task
Each directory with a `package.json` that depends on `next` is one task: `next build --turbopack` in that directory, using the app's own `next` package (`nextPackage`). Task id: its repo-relative path, `.` for the root (D-2, `discoverApps`, `src/project.ts`).

## What the recorder can observe
- The real outcome: exit status of `next build --turbopack`, duration, and the worktree and HEAD state checked by the git change source.
- Inputs: every file under the repository root, minus `node_modules`, `.git`, `.next`, `.incremental` and `.toolchain`, hashed before and after each build. For an app, the directories of the other apps are excluded. `next-env.d.ts` is excluded. Any other file the build changes makes the observation dirty.
- Tracked environment: `NEXT_*` variables and `NODE_ENV`.

The module graph is not observed. The adapter does not read Turbopack's output (see Open questions).

## What it cannot observe
- Build outputs are not stored . The adapter records inputs only.
- Environment variables outside the tracked set (`NEXT_*` and `NODE_ENV` are tracked). Use the env adapter's allowlist, or set capability false.
- Remote caches Turbopack may use. A cached build is recorded as a pass; the cache is not trusted as proof of a clean run.
- Files outside the repository root and the `.next` build cache.
- Dynamic imports whose targets are chosen at runtime, and files the build reads outside the app.

## Declared inputs (not observed)

Recorded with kind `declared` and a SHA-256 taken before the build. Absent files are not recorded.
- `next.config.{js,mjs,cjs,ts,mts,cts}` in the app directory.
- `tsconfig.json` and `package.json` in the app directory. The root `package.json` when the app is not the root.
- `.env`, `.env.local`, `.env.production`, `.env.production.local` in the app directory. These are build-time env files.
- The lockfile at the repo root (`package-lock.json`, `pnpm-lock.yaml` or `yarn.lock`).

Context: lockfile, root `tsconfig.json`, hash of all `package.json` files, `runner: next@<version>`, Node version, `fmt: 1`, `caps: {probes: false, dirs: false, env: false}`, and `graph: false`.

## Real versus declared

- **Real:** the outcome (exit status of `next build --turbopack`), the duration, and the worktree and HEAD state checked by the git change source.
- **Declared:** every input above. They are a list of files the build is known to depend on, not a list of files it read.
- **Module graph:** not recorded. Every file in the repository is an input, so a change to `app/page.tsx` selects the app, and so does a change to any other file in the repository. That is a superset of the real dependencies, so it is sound but reruns more than necessary.

## Capabilities and dirty runs

- `graph: false`. No module graph is recorded.
- `caps.probes`, `caps.dirs` and `caps.env` are false. Environment reads outside the tracked set are not observed. Use the env adapter's allowlist to make them declared.
- Inputs are every file under the repository root, minus the skipped directories and minus the directories of the other apps (an app does not import from another app's directory: this is an assumption, not checked). Shared code under `libs/` and the root files are inputs for every app, so an edit there reruns every app. Inputs are hashed before and after each build. The build may write files: `next-env.d.ts` is excluded because its content follows the `next` version, and any other file the build changes makes the observation dirty, because the build did not read the state it recorded.
- Tracked environment: `NEXT_*` variables and `NODE_ENV`, recorded as env inputs. Other variables are not observed.
- Not observed: variables outside the tracked set, files outside the repository root, and the `.next` build cache, which can change how a build behaves without changing any input. A build with an unobserved cache can therefore produce a different result for the same inputs.
- Build outputs (`.next`) are not stored . Remote build caches are not consulted. A `next build` that hits a cache is still recorded as a pass, and the cache is not trusted as proof.

## Gaps

- The app must ignore `.next` and `next-env.d.ts` in git. Otherwise the build dirties the worktree and the run is never advanced.
- A build killed mid-run can leave `.next/lock`. The next build then fails with "A previous build that didn't exit cleanly", which is reported as fail.
- Inputs are hashed before the build. A file changed during the build is not caught except by the worktree check at the end of the run.
- Dynamic imports, runtime-chosen targets and files the build reads outside the app are not observed.
- Apps must all resolve the same `next` version. The context names one runner.
- Runs are sequential. Each app is one `next build`.

## Open questions

Answered in adapters/turbopack/README.md ("Open questions and their answers", checked against `next@16.4.2`). Removed from this spec:
- Whether Turbopack exposes its module graph: partly. The analyzer export is not used, so the graph is not claimed.
- Whether there is a public, stable record of the modules read: no.
- Whether `next build` can run offline: yes, in a fixture with `node_modules` installed.

Still open:
- Whether the analyzer export (`next analyze export`) can cover the read set exactly, with its coverage flags always `exact`. The README's revisit condition. Until then no module graph is recorded.

## Conformance and tests

Adapters are not in the conformance suite . The planned cases for a module graph (change inside or outside the graph, unresolved dynamic import) do not apply, because no graph is recorded.

`npm test` in `adapters/turbopack` (builds the binding, then runs `node --test`). The integration tests use a scratch repo with one app at `apps/web` and a non-app package. They cover discovery, the first run advancing, a declared-input edit invalidating the app, a failed build reported as fail with exit 1, an uncommitted change exiting 7, and the skip. Each build takes tens of seconds, so the suite is slow.
