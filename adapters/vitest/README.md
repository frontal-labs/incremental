# Vitest adapter (`adapters/vitest`)

`incremental-vitest run` is the adapter loop for Vitest test files. Each file is one task. A preload (`src/preload.ts`) records its reads, probes and environment, and turns the trace into an observation. The planner (`src/planner.ts`) builds the context from the lockfile, `tsconfig.json`, `package.json` files and the Vitest version.

```sh
incremental-vitest run [--base REF] [--json] [--all] [--jobs N] [--shadow] [--include GLOB] [--exclude GLOB] [--vitest-arg ARG] [--vitest FILE]
```

Exit codes: 0 ok and advanced; 1 a test failed; 2 usage; 4 engine error; 7 ran, baseline not advanced.

- Tests: `make test-vitest` (V01 to V16 through the whole loop, plus the conformance cases in `fixtures/cases`).
- `fixtures/` is test data. Its `packages/*/test/` directories are fixture content that the conformance cases name, so they keep their names.
- Open: CR-002 (V13) and CR-003 (V16) are not decided (`spec/CHANGE_REQUESTS.md`).
