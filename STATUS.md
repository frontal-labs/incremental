# STATUS
- status/ADAPTERS.json: E6 verify (E6 outputs complete: V01-V16 pass end to end (make test-e2e), benchmarks/replay replay driver runs with expected shape and zero false skips (make bench-replay), examples/agent_loop/ is a real adapter-loop run (edit -> plan -> run invalid -> advance, skip share 50% on leaf edits). Blocked by E5 (strace oracle) per PLAN 15.1; E5 is Linux-only and GATE 0 is blocked, so E6 verify runs on this branch's changes.)
- status/BENCH.json: GATE0 blocked (Real repository: STOP (0 commits evaluable; repo's own suite red). Demo repository: STOP on K4 (GATE-demo.md). E5, E7 and E10 do not run (PLAN 14.1).)
- status/BENCHMARKS.json: GATE0 blocked (Matches BENCH.json. Needs a real Vitest monorepo (BACKPLANE_BENCH_REPO) and a human decision.)
- status/BINDINGS.json: E3 done (TypeScript client signed off by the user's instruction. E9 Python binding also signed off (55 tests, 36/36 byte-equal to serve).)
- status/CORE.json: E2 done (Signed off by the user's instruction. All 40 cases; M2 met on a same-day baseline. Fresh-clone verification passed (DECISIONS.md).)
- status/SPEC_CONFORMANCE.json: E1 done (Signed off by the user's instruction (2026-11-03). Fresh-clone verification passed.)
