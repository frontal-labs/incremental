# vitest adapter (built, v1)

Status: built and tested (E4, `make test-vitest`). This draft only records the rules that the built adapter follows, as the comparison point for the others.

## Task
A Vitest test file, repo-relative (D-2). Built: `adapters/vitest/src/`.

## What the recorder observes
- A preload (`adapters/vitest/src/preload.ts`) records module loads, file reads, directory listings, probes and environment reads during each test file's run (PLAN §11.2).
- Context: the lockfile, `tsconfig.json`, all `package.json` files, the Vitest version, the Node version, and capabilities `probes`, `dirs`, `env` set to true (`contextFor`, `adapters/vitest/src/planner.ts`).

## What it cannot observe
- Reads the preload does not see, such as those done in a child process that is not under the preload.
- Open items: CR-002 (V13) and CR-003 (V16) are not decided (spec/CHANGE_REQUESTS.md).

## Relevance to the other drafts
- It is the only adapter with a working preload. The `fs` and `env` drafts depend on the same kind of observation for non-test tasks.
- Its `--include`, `--exclude`, and `--vitest-arg` options (`adapters/vitest/src/run.ts`) are the model for how the other drafts should take task filters.
