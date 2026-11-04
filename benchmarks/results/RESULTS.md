# Benchmark results (PLAN 12.4 / 12.5)

Generated: 2026-11-04T18:46:30.789Z

## Raw data

- benchmarks/results/replay.json: present
- benchmarks/results/m1.json: present

## Replay (PLAN 12.5, E6)

| commits_processed | commits_evaluated | total_tasks | task_commit_pairs_examined | false_skips | rule_of_three_bound |
| 7 | 5 | 14 | 70 | 0 | 3/5 |

| median_skip_share | skip_shares |
| 78.57% | [0.7857142857142857,0.8571428571428571,0.8571428571428571,0,0.7857142857142857] |

## M1 warm plan latency (PLAN 12.4)

| tasks | queries | process_load_ms | per_query_ms_approx | log_bytes |
| 10000 | 100 | 34.7 | 0.019 | 5334547 |

_Note: includes refresh stat and process overhead amortized; not the PLAN M1 harness_

## Thresholds (PLAN 12.4)

- M1: p50 under 5 ms, p99 under 20 ms at 100k tasks. - M2: cold CLI under 300 ms at 100k tasks (hyperfine).

