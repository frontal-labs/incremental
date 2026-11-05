# INCREMENTAL BENCHMARKS AND GATES

## Benchmark Targets (Hypotheses, fixed before measurement)
| # | Metric | Method | Target |
|---|---|---|---|
| M1 | Warm plan latency (serve, verify off), p50/p99 | In-process timer, 100k tasks, 10M postings, 1-10 changed files | p50 < 5ms, p99 < 20ms |
| M2 | Cold CLI plan (process start, index load, plan) | hyperfine, 30 runs | < 300ms at 100k tasks |
| M3 | RSS per serve process | /usr/bin/time -v | < 100MB at 100k tasks, 10M postings |
| M4 | Full index rebuild from log | Delete index, time it | Report; < 10s at 100k tasks |
| M5 | Vitest recorder overhead | Per-file run with/without preload | < 30% |
| M6 | Skip share per scenario | Harness | >= 70% on leaf edits; near 0% on global changes |
| M7 | False-skip rate | Replay (12.5) | Zero observed; report rule-of-three bound |
| M8 | Agent loop (edit to feedback) 1/5/20 agents on separate worktrees sharing store | examples/agent_loop | >= 2x faster than full suite |
| M9 | First run with no observations | Harness | Report only |
| M10 | Recorder completeness (Node vs strace oracle, fixture) | Comparison | Zero gaps |
| M11 | Verify-mode plan latency | As M1 with verify | Report only |

## Replay (False-Skip Measurement)
1. Take last N commits on main (N>=200 if available, need >=50 evaluated)
2. In git worktree, checkout oldest commit, observe every task (initial graph), advance baseline
3. For each commit in order (process every commit for baseline invariant):
   a. ChangeSet from c_{i-1} to c_i, baseline c_{i-1} (equals store baseline)
   b. Plan. Run invalid tasks while recording. Advance to c_i.
   c. Ground truth = separate plain run of whole suite at c_i with no recorder (doesn't change store)
   d. Evaluate commit only if ground truth at c_{i-1} was green
4. **False skip** = task fails in ground truth at c_i, not invalidated by plan at c_i, fails again on two reruns. Tasks passing on rerun are flaky (counted separately).
5. Report each false skip with commit, task, plan reasons for other tasks in query.
6. Report commits processed/evaluated, task-commit pairs examined, false skips, rule-of-three bound.

## Statistics
- Latency (M1,M2,M11): M1 = 100 queries, M2 = 1 process invocation. 5 warmup, 30 measured runs. Percentiles use all queries in measured runs (3000 for M1).
- Other metrics: 5 warmup, 30 measured repetitions. Report median, p95, min, max.
- Zero events: if rate zero observed in n independent observations, publish 95% upper bound `3/n` next to zero.
- Record CPU, RAM, OS, kernel, Node version, engine version, container image digest, arch for every run. Never compare across architectures. Results go to `benchmarks/results/*.json` (schema-validated) and generated `RESULTS.md`.

## Gates

### Gate 0: Kill Test (after E4, before E5)
Run on real slow Vitest monorepo (`$INCREMENTAL_BENCH_REPO`) using replay for >=50 evaluated commits or as many as exist.

| # | Criterion | Threshold |
|---|---|---|
| K1 | Median skip share on typical commits (<=5 source files changed, no global input) | >= 30% |
| K2 | False skips | Zero observed, rule-of-three bound reported |
| K3 | Plan latency, cold CLI | < 1s |
| K4 | vs repo's existing selection (Vitest --changed or team's affected) | Engine must skip >=10pp more, or explain each extra run avoided (no claim without numbers) |

**Decision**: CONTINUE if K1-K3 pass and K4 shows real gain. STOP otherwise. STOP is valid reported outcome.

### Gate 1: Full Gate (E7)
| # | Criterion | Threshold |
|---|---|---|
| G1 | Typical edits on chosen corpus: median skip share | >= 50% |
| G2 | False skips over replay | Zero observed over >=50 evaluated commits, bound reported |
| G3 | Warm plan p99 at 100k tasks, verify off | < 20ms |
| G4 | Recorder completeness vs strace oracle (fixture) | Zero gaps |
| G5 | Conformance suite + differential fuzz against reference (10k random cases, seeds recorded) | All pass |
| G6 | Binding parity: Node client, CLI, Python binding (if present) produce byte-identical plans for all conformance cases | All identical |

Any failure → stop, don't retune thresholds, write `GATE.md`, report.
