# GATE.md: Gate 1 (PLAN 13.2, E7)

Generated: 2026-11-04T23:31:58.037Z

| Criterion | Measured | Threshold | Result | Raw data |
|-----------|----------|-----------|--------|----------|
| G3 | m1 run failed | < 20 ms (warm plan at 100k tasks) | fail | benchmarks/results/m1.json |
| G2 | 0 false skips over 5 evaluated commits (bound 3/5) | zero observed over >= 50 evaluated commits | fail | benchmarks/results/replay.json |
| G1 | median skip share 78.6% over 5 evaluated commits | >= 50% | pass | benchmarks/results/replay.json |
| G4 | not runnable on this host (strace is Linux-only) | zero gaps | fail | logs/test-oracle.log (via make linux-gate) |
| G5 | conformance suite + differential fuzz all pass | all pass | pass | logs/test-core.log, test-policy.log, test-protocol.log, test-fuzz.log |
| G6 | Node client and CLI produce byte-identical plans for all conformance cases | all identical | pass | logs/test-bindings.log |

Decision: **STOP**

## Stop (PLAN 14.1)

One or more Gate 1 criteria failed. Do not retune thresholds; fix the code or report the stop.

### Options
- A) fix the failing criterion and re-run `make gate`
- B) file a change request if the criterion or its target is wrong
- C) escalate per PLAN 14.3

Recommendation: stop and address the failing criteria per PLAN 14.
