# playwright adapter

Status: built (adapters/playwright, make test-playwright). Spec sign-off: not recorded in DECISIONS.md. Matched to adapters/playwright/README.md on 2026-11-04.
Competitor: Playwright `--only-changed` (COMPETITORS.md).

## Task
A Playwright test file, repo-relative (same rule as the Vitest adapter, D-2). Discovered with `playwright test --list --reporter=json`, so the runner's testMatch and testIgnore decide the task set. No browser is launched for discovery.

## What the recorder can observe
- Test files and their relative imports: a static scan of `import`, `export from`, `require` and `import` with a literal path. The runner is not preloaded. Non-relative imports are covered by the lockfile only; tsconfig `paths` aliases are not followed, so an alias import is treated as a package.
- `playwright.config.ts` and its relative imports: file inputs of every task.
- Context: lockfile, package.json files, tsconfig, runner version (`playwright@<version>`), Node version, and the browser executable path with whether it exists.
- Output goes to a directory outside the worktree (`--output`), so a run leaves no files behind.

## What it cannot observe
- Network responses and server state. The app under test is a network resource the engine cannot hash. A task that reaches a live server is recorded `dirty`, so it is never valid on the next run and is never skipped. This is a static guard, not an observation:
  - a config that mentions `webServer` or `baseURL` makes every task dirty;
  - a test file or relative import that uses the `page`, `context`, `browser`, `request` or `goto` fixtures, `fetch`, or the `http`, `https`, `net`, `tls` or `undici` modules is dirty.
  - A test that reaches a backend another way (a child process, a dependency that is not a relative import) is recorded clean. Do not treat a clean task as protected from backend changes.
- Browser binary: only the executable path and its presence are in the context. The revision is in the path; the binary bytes are not hashed, so a new build at the same path is not detected.
- Time, randomness, and viewport, unless the test sets them explicitly.
- Process environment and directory listings: not hashed (`caps` are false).
- Unresolved relative imports, and dynamic `require`/`import` with a non-literal argument, make the task dirty.
- Test files outside the root, or a config in a subdirectory (Playwright finds the config in the working directory, which is the root), are not supported.

## Declared inputs
- `playwright.config.ts` and its relative imports, the lockfile, and the `package.json` files, with the tsconfig, runner, Node and browser context above.
- A `webServer` build output directory is not declared. A config that mentions `webServer` makes every task dirty instead.
- Hashes are taken before the run. A file that changes during the run is seen with its old hash, so the next run reruns it. A dirty worktree at the end of a run marks every observation dirty and leaves the baseline in place.

## Cases (not in the conformance suite, )
The adapter is not in the conformance suite. Behaviors to check, tested in `test/adapter.test.ts` against a scratch repository:
- Changing a test file invalidates that test.
- Changing a shared helper invalidates every test that imports it.
- A test that hits a live server (by the static guard above) is recorded `dirty`.

## Open questions
- None. Both questions the spec raised are answered by the build: the runner is not preloaded (a static import scan is used instead), and a live-backend e2e test is recorded `dirty` and never skipped.
