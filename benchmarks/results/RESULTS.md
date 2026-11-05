# Benchmark results

Generated: 2026-11-05T11:04:46.714Z

## Raw data

- benchmarks/results/replay.json: present
- benchmarks/results/warm-plan.json: present

## Replay

| commits_processed | commits_evaluated | total_tasks | task_commit_pairs_examined | false_skips | rule_of_three_bound |
| 7 | 6 | 6 | 36 | 0 | 3/6 |

| median_skip_share | skip_shares |
| 83.33% | [0.6666666666666666,0.8333333333333334,1,0.8333333333333334,0.8333333333333334,0.6666666666666666] |

## Warm plan latency

| tasks | queries | process_load_ms | per_query_ms_approx | log_bytes |
| 10000 | 100 | 27.76 | 0.1224 | 6348249 |

_Note: warm plan latency over protocol v1 stdio; each query invalidates one task; process_load includes engine spawn + hello + store load_

## Thresholds

- Warm plan: p50 under 5 ms, p99 under 20 ms at 100k tasks. - Cold CLI plan under 300 ms at 100k tasks (hyperfine).

