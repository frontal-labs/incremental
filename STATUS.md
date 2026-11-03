# STATUS
- status/ADAPTERS.json: E4 doing (Git change source done in Goose (adapters/git/src/changes.goose, make test-git). Vitest recorder/planner not started: needs Node and Vitest (see DECISIONS.md).)
- status/BENCH.json: GATE0 blocked (GATE.md says CONTINUE with raw data at bench/results/gate0.json, which does not exist. No Vitest monorepo replay has run. E5 and later stay blocked until a human decides. E7 synthetic measurement exists (bench/m1.mjs, DECISIONS.md): M1 missed about 50x at 100k tasks.)
- status/BENCHMARKS.json: GATE0 done
- status/BINDINGS.json: E3 todo (Node client is a placeholder. It must be JavaScript (DECISIONS.md, components that cannot be Goose). Needs a decision.)
- status/CORE.json: E2 doing (All 40 cases pass through serve; CLI, index image, stat cache, multi-writer refresh, compaction, observe_many, explain built. NOT done: PLAN 6.5 reverse indexes (per-query cost is linear in tasks; M1 missed ~50x at 100k, see DECISIONS.md). E2 step 3 is open.)
- status/SPEC_CONFORMANCE.json: E1 verify (Spec docs, 40 cases, general reference (34 query cases agree), coverage matrix, schemas written and checked against engine responses. Needs Spec sign-off.)
