# STATUS
- status/ADAPTERS.json: E4 verify (Vitest adapter test-vitest passes (21), V01-V16 end to end. OPEN: CR-002 (V13 vs PLAN 8.7) and CR-003 (V16 vs PLAN 11.2) must be decided before sign-off. E8 MCP server: test-mcp passes (9 incl. 5 scenarios).)
- status/BENCH.json: GATE0 blocked (GATE.md says CONTINUE with raw data at bench/results/gate0.json, which does not exist. No Vitest monorepo replay has run. E5 and later stay blocked until a human decides. E7 synthetic measurement exists (bench/m1.mjs, DECISIONS.md): M1 missed about 50x at 100k tasks.)
- status/BENCHMARKS.json: GATE0 done
- status/BINDINGS.json: E3 verify (TypeScript client @backplane/client: 84 pass, 2 intentional skips; 34/34 expressible plans byte-identical to the CLI. Also E9 Python binding: 55 tests pass, 36/36 query cases byte-equal to serve. Needs sign-off.)
- status/CORE.json: E2 doing (All 40 cases pass through serve; CLI, index image, stat cache, multi-writer refresh, compaction, observe_many, explain built. NOT done: PLAN 6.5 reverse indexes (per-query cost is linear in tasks; M1 missed ~50x at 100k, see DECISIONS.md). E2 step 3 is open.)
- status/SPEC_CONFORMANCE.json: E1 verify (Spec docs, 40 cases, general reference (34 query cases agree), coverage matrix, schemas written and checked against engine responses. Needs Spec sign-off.)
