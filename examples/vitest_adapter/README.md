# Vitest Adapter Example

Demonstrates the Vitest adapter integration: record → plan → skip unchanged tests.

Per PLAN.md §11.2–11.3 and `docs/adapters/ADAPTERS.md`, the Vitest adapter consists of:
- **Recorder** (preload): wraps `fs` API and `process.env`, records observations per test file.
- **Planner**: maps a plan to Vitest work, runs invalid tests, follows the adapter loop.

## Layout

```
examples/vitest_adapter/
├── README.md              # this file
├── vitest.config.ts       # Vitest config with forks pool
├── backplane.config.json  # backplane configuration
├── src/
│   ├── lib.ts             # library module
│   └── lib.test.ts        # test that reads lib.ts
├── record.sh              # record observations for all tests
├── plan.sh                # ask the engine for the affected plan
└── run.sh                 # full record → plan → run loop
```

## vitest.config.ts

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    pool: 'forks'
  }
});
```

## Recording observations

The recorder preload wraps `fs` and `process.env` via `NODE_OPTIONS`. Each test file runs in its own forked process, so observations belong to exactly one task:

```sh
export BACKPLANE_TRACE_OUT=/tmp/trace.jsonl
export NODE_OPTIONS="--require ./preload.mjs"
npx vitest run
```

Observations are written to `BACKPLANE_TRACE_OUT` at exit, then sent to the engine via `observe`.

## Asking for the plan

```sh
core/dist/backplane affected \
  --changes changeset.json \
  --baseline <BASELINE> \
  --context context.json \
  --verify
```

## Expected behavior

- Editing `src/lib.ts` invalidates `src/lib.test.ts` (P3: `reads:src/lib.ts`).
- Adding a new unread file lists it in `unobserved` (P7) or falls back (no caps).
- Deleting `src/lib.ts` invalidates readers (P5: `removed_read`).

## Reference

- `docs/adapters/ADAPTERS.md` — Vitest adapter recorder contract and planner.
- `docs/spec/PROTOCOL.md` — affected method, plan shape.
- `docs/spec/POLICY.md` — policy rules P0–P11.
- `adapters/vitest/` — the actual Vitest adapter implementation.
