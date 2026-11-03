# playwright adapter (draft, not approved)

Status: draft. PLAN tier: later. Competitor: Playwright `--only-changed` (COMPETITORS.md).

## Task
A Playwright test file, repo-relative (same rule as the Vitest adapter, D-2).

## What the recorder can observe
- Test files and imports: via the same module-loading approach as the Vitest preload (PLAN §11.2). Playwright loads test files through its own runner, so a preload must be checked (open question).
- `playwright.config.ts` and its imports: declared global inputs.
- The page under test is a network resource, not a file. It is not an input the recorder can hash.

## What it cannot observe
- Network responses and server state. The app under test is the real input and it is not a file. A task that depends on a backend is not protected. Mark `dirty` or set capability false.
- Browser binary version: declared through the context (PLAN §8.4).
- Time, randomness, and viewport, unless the test sets them explicitly.

## Declared inputs
- `playwright.config.ts`, `package.json`, the lockfile, and any `webServer` build output directory.

## Conformance cases (to write)
- Changing a test file invalidates that test.
- Changing a shared helper invalidates every test that imports it.
- A test that hits a live server is recorded `dirty`.

## Open questions
- Whether Playwright's runner can take the same preload as Vitest. If not, the adapter needs its own recorder.
- Whether an e2e test against a live backend can ever be safely skipped. The likely answer is no.
