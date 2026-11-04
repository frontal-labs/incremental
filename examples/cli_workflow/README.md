# CLI Workflow Example

A minimal repository demonstrating the backplane CLI workflow:
`backplane init` → `backplane serve` → `affected` over a small change set.

## Layout

```
examples/cli_workflow/
├── README.md              # this file
├── backplane.config.json  # repository configuration
├── src/
│   ├── math.ts            # a library module
│   └── math.test.ts       # a test that reads math.ts
├── run.sh                 # end-to-end demo script
└── expected/              # expected outputs (for verification)
    ├── init.json
    ├── stats.json
    └── plan.json
```

## backplane.config.json

```json
{
  "roots": ["."],
  "exclude": ["**/node_modules/**", ".git/**", ".backplane/**"],
  "ignore": [],
  "globalInputs": ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "package.json",
                   "tsconfig*.json", "vitest.config.*", "vite.config.*"],
  "policy": "balanced",
  "fallbackContextKeys": ["lockfile", "tsconfig", "pkgjson", "runner", "node", "fmt", "caps"],
  "adapters": {
    "vitest": { "testGlobs": ["**/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs,mts,cts}"] }
  }
}
```

## Running the demo

Requires the built engine (`make build`):

```sh
# 1. Initialize the store
core/dist/backplane init --store .backplane

# 2. Check stats (no baseline yet)
core/dist/backplane stats --store .backplane --json

# 3. Start the protocol server
core/dist/backplane serve --store .backplane --root . &

# 4. Send an affected query (via the CLI directly)
core/dist/backplane affected \
  --changes - \
  --baseline <BASELINE_SHA> \
  --context <context.json> \
  <<'EOF'
{"baseline":"<BASELINE_SHA>","head":"<HEAD_SHA>","changes":[
  {"path":"src/math.ts","status":"modified"}
]}
EOF

# 5. Stop the server
kill %1
```

## Expected behavior

- `init` creates `<store>/tg.log` with a header and no baseline (`B = null`).
- `stats` reports `tasks: 0`, `observations: 0`, `baseline: null`.
- After recording an observation for `src/math.test.ts` that reads `src/math.ts`, modifying `src/math.ts` should produce a plan with `reads:src/math.ts` and `self_changed` for `src/math.test.ts`.

## Reference

- `docs/spec/PROTOCOL.md` — Protocol v1 methods and errors.
- `docs/spec/POLICY.md` — Policy rules P0–P11.
- `docs/spec/CONFIGURATION.md` — Config file and CLI options.
- `docs/spec/FORMAT.md` — Store format (tg.log, tg.lock, stat.cache, tg.idx).
