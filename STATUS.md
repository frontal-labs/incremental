# STATUS
- status/ADAPTERS.json: E5 doing (strace oracle implemented (adapters/strace: oracle.ts, parser unit tests, M10 fixture test, README), test-oracle wired into the Makefile and linux-gate Docker image, fs/process Linux oracle paths added. Awaits `make test-oracle` inside `make linux-gate` (GATE 0 is blocked per STATUS.md, so E5 verify runs on this branch's changes; M10 zero-gaps check runs on Linux only).)
- status/BENCH.json: GATE0 blocked (Real repository: STOP (0 commits evaluable; repo's own suite red). Demo repository: STOP on K4 (GATE-demo.md). E5, E7 and E10 do not run (PLAN 14.1).)
- status/BENCHMARKS.json: GATE0 blocked (Matches BENCH.json. Needs a real Vitest monorepo (BACKPLANE_BENCH_REPO) and a human decision.)
- status/BINDINGS.json: E3 done (TypeScript client signed off by the user's instruction. E9 Python binding also signed off (55 tests, 36/36 byte-equal to serve).)
- status/CORE.json: E2 done (Signed off by the user's instruction. All 40 cases; M2 met on a same-day baseline. Fresh-clone verification passed (DECISIONS.md).)
- status/SPEC_CONFORMANCE.json: E1 done (Signed off by the user's instruction (2026-11-03). Fresh-clone verification passed.)
