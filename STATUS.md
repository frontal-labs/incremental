# STATUS
- status/ADAPTERS.json: E4 verify (Vitest adapter test-vitest passes (21), V01-V16 end to end. OPEN: CR-002 (V13 vs PLAN 8.7) and CR-003 (V16 vs PLAN 11.2) must be decided before sign-off. E8 MCP server: test-mcp passes (9 incl. 5 scenarios).)
- status/BENCH.json: GATE0 done (Result STOP (valid outcome). 0 commits evaluated: the repo's own unit suite is red at the replayed commits (2 of 122 files), so no ground-truth commit was green. See DECISIONS.md and bench/results/gate0.json. E5, E7 and E10 do not run.)
- status/BENCHMARKS.json: GATE0 blocked (Matches BENCH.json. Needs a real Vitest monorepo (BACKPLANE_BENCH_REPO) and a human decision.)
- status/BINDINGS.json: E3 verify (TypeScript client @backplane/client: 84 pass, 2 intentional skips; 34/34 expressible plans byte-identical to the CLI. Also E9 Python binding: 55 tests pass, 36/36 query cases byte-equal to serve. Needs sign-off.)
- status/CORE.json: E2 verify (All 40 cases pass. Reverse indexes (PLAN 6.5) and binary index image (format 2) built. M2 met on a same-day baseline (cold affected 80 ms at 100k). M1 round-trip met in a scratch harness. Needs Spec sign-off.)
- status/SPEC_CONFORMANCE.json: E1 verify (Spec docs, 40 cases, general reference (34 query cases agree), coverage matrix, schemas written and checked against engine responses. Needs Spec sign-off.)
