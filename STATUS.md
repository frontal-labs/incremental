# STATUS
- status/ADAPTERS.json: E4 todo (Not started. adapters/vitest and adapters/git are one-line placeholders. The earlier 'E8 done' was not backed by code (mcp/ is a placeholder). Depends on E3.)
- status/BENCH.json: GATE0 blocked (GATE.md says CONTINUE with raw data at bench/results/gate0.json, which does not exist (bench/ is absent). make gate0 was an echo stub. No Vitest monorepo replay was run. Gate 0 needs a real run and a human decision (PLAN 13.1, 14.1). E5 and later stay blocked.)
- status/BENCHMARKS.json: GATE0 done
- status/BINDINGS.json: E3 todo (Not started. bindings/node/src/client.ts is a placeholder that returns fixed values; it must not be treated as done. Depends on E2.)
- status/CORE.json: E2 doing (Goose core (human decision). 39/40 cases pass; C38 SKIP needs index image (D-E2-01). Missing: index image, stat cache (D-E2-04), CLI commands other than init/serve/version (D-E2-06), compaction, observe_many, explain.)
- status/SPEC_CONFORMANCE.json: E1 verify (Spec docs written from PLAN.md; 40 cases rewritten (D-E1-06); reference is general and runs 33 query cases. Not done: schemas in spec/schemas/ not validated, coverage matrix (12.2) not checked, validate.mjs does not check every rule cell. Needs Spec sign-off.)
