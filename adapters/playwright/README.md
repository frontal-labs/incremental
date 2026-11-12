# @frontal-labs/incremental-playwright

Playwright test adapter (spec/adapters/playwright.md, draft). One task is one Playwright test file, repo-relative. The loop follows : baseline, change set, affected, forget deleted files, run each selected file, advance only on a clean, complete run, else exit 7.

    incremental-playwright run [--base REF] [--json] [--all] [--store DIR] [--root DIR] [--timeout MS] [--playwright CLI]

Exit codes: 0 advanced and all passed; 1 advanced and a test failed; 2 usage; 4 engine or setup error; 7 ran but not advanced.

## What is real

- Discovery: `playwright test --list --reporter=json`, so the runner's testMatch and testIgnore decide the task set. No browser is needed.
- Test file input: the file itself, plus the relative imports it reaches (a static scan of `import`, `export from`, `require`, `import` with a literal). Hashed before the run.
- Playwright config and its relative imports are file inputs of every task.
- Context: lockfile, package.json files, tsconfig, runner version (`playwright@<version>`), Node version, and the browser executable path with its presence (the revision is in the path; the binary bytes are not hashed).
- Output goes to a directory outside the worktree (`--output`), so a run leaves no files behind.

## What is declared, and the gaps

- Live servers. The app under test is a network resource the engine cannot hash. A task is recorded `dirty` (and so is never valid next run) when:
  - the config mentions `webServer` or `baseURL` (every task is dirty);
  - its test file or a relative import matches a static pattern for a server: the `page`, `context`, `browser`, `request` or `goto` fixtures, `fetch`, or the `http`, `https`, `net`, `tls` and `undici` modules.
    This is a static guard, not an observation. A test that reaches a backend by a path the pattern does not name (a child process, a dependency that is not a relative import) is recorded clean. That is a gap: do not treat a clean task as protected from backend changes.
- Not hashed: `process.env` (no env capability), directory listings and probes (`caps` are false), and any file reached through a non-relative import (a package is covered by the lockfile only; tsconfig `paths` aliases are not followed and an alias import is treated as a package).
- Unresolved relative imports and dynamic `require`/`import` with a non-literal argument make the task dirty.
- Test files outside the root, or a config in a subdirectory (Playwright only finds the config in the working directory, which is the root), are not supported.
- Browser binary: only the executable path is in the context. A new build with the same revision path is not detected.
- Hashes are taken before the run. A file that changes during the run is seen with its old hash, so the next run reruns it.
- Dirty is per task: a dirty worktree at the end of a run marks every observation dirty and leaves the baseline in place.

## Tests

`npm test` (in this directory) builds the Node binding, type-checks, and runs `test/adapter.test.ts` against a scratch git repository, the real engine, and the pinned `@playwright/test` (1.64.1). The test files use no browser fixture, so no browser is launched. The live test uses the `request` fixture against a server started inside the test.

## Dependencies

- `@playwright/test` 1.64.1 (exact; released 2026-10-14, before the 2-week cutoff of 2026-10-20 for 2026-11-03).
- `typescript` 5.9.3, `@types/node` 22.20.5 (as the other adapters).
- `@incremental/client` as `file:../../bindings/node`.
