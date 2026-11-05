# @incremental/turbopack

The Turbopack app adapter, drafted in `spec/adapters/turbopack.md`. It is the honest version: entries are tasks, their declared inputs are recorded, and no module graph is claimed. An app is skipped when nothing in the repository changed. The inputs are every file under the repository root, except `node_modules`, `.git`, `.next`, `.incremental` and `.toolchain`, plus the lockfile and the `next` version in the context.

Run: `incremental-turbopack run [--base REF] [--json] [--all] [--store DIR] [--root DIR] [--timeout MS]`. Exit codes match the TypeScript adapter: 0 advanced and all pass, 1 advanced with a failed build, 2 usage, 4 engine or setup error, 7 ran but not advanced.

## Open questions and their answers

Checked against `next@16.4.2` (pinned), its `dist/docs` and its CLI help.

1. **Does Turbopack expose the module graph?** Partly. `next build --analyze --output` (or `next analyze --output --snapshot NAME`) writes analyzer data, and `next analyze export --snapshot NAME` streams it as JSON Lines (`schema_version: 1`, module records with `path` and sync, async and traced dependencies). The docs mark export as available from v16.4. It is not used here, for three reasons:
   - It is a bundle graph of the emitted client and server bundles. It does not list files the build reads without bundling them, such as files that only the type check reads (the log shows `Running TypeScript`). Not tested here, but it is the reason it cannot be the read set.
   - The route records carry coverage flags (`entries` and `groups`) that are `unknown` when the data is missing. An `unknown` coverage cannot be trusted as complete.
   - It needs a second analyzer build, and the docs still ask for feedback on it.
   Revisit when the export covers the read set exactly and the coverage flags are always `exact`. Then the graph becomes a second capability and the adapter can claim the graph.
2. **Is there a public, stable record of the modules read?** No. Turbopack has `--internal-trace`, which is internal. Nothing else lists the files a build read.
3. **Can `next build` run offline?** Yes, in a fixture with `node_modules` installed. The build compiles, type checks and prerenders with no network access, with `NEXT_TELEMETRY_DISABLED=1`. Two requirements found on the way:
   - Turbopack resolves `next` from the app's own `node_modules` inside the workspace root. A `node_modules` symlinked from outside the repo fails with "Could not find the Next.js package". The tests copy `node_modules` instead.
   - The first build rewrites the app's `tsconfig.json` (it adds `plugins`, `include` and `allowJs`, among others). The rewrite changes the worktree, so the run is not advanced (exit 7). Commit the rewritten file once. The tests use a `tsconfig.json` that the build leaves unchanged.

## Task

Each directory with a `package.json` that depends on `next` is one task. The id is its repo-relative path, `.` for the root (`discoverApps`, `src/project.ts`). The build is `next build --turbopack` in that directory, using the app's own `next` package (`nextPackage`).

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
- `caps.probes`, `caps.dirs` and `caps.env` are false. Environment reads at build time (for example `NEXT_PUBLIC_*`) are not observed. Use the env adapter's allowlist to make them declared.
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

## Tests

`npm test` in this directory (builds the binding, then runs `node --test`). The integration tests use a scratch repo with one app at `apps/web` and a non-app package. They cover discovery, the first run advancing, a declared-input edit invalidating the app, a failed build reported as fail with exit 1, and an uncommitted change exiting 7. Each build takes tens of seconds, so the suite is slow.
