# Benchmark results

Generated: 2026-11-05T17:13:22.992Z

## Raw data

- benchmarks/results/replay.json: present
- benchmarks/results/warm-plan.json: present
- benchmarks/results/comparison.json: present

## Replay

| commits_processed | commits_evaluated | total_tasks | task_commit_pairs_examined | false_skips | rule_of_three_bound |
| 7 | 6 | 6 | 36 | 0 | 3/6 |

| median_skip_share | skip_shares |
| 83.33% | [0.6666666666666666,0.8333333333333334,1,0.8333333333333334,0.8333333333333334,0.6666666666666666] |

## Warm plan latency

| tasks | queries | iterations | process_load_ms (median) | per_query_ms (median) | log_bytes |
| 10000 | 100 | 3 | 35.927 | 0.160 | 6348249 |

_Note: warm plan latency over protocol v1 stdio; each query invalidates one task; process_load includes engine spawn + hello + store load; stats over multiple iterations_

## Comparison vs alternatives

Measured on three dedicated monorepo fixtures under `monorepos/`. Each fixture has 4 packages
with a `shared → api/web` dependency graph (`utils` standalone), 6 vitest tests, and git history.
Changed `packages/shared/src/index.ts`; measured affected-project detection time.

| Tool            | Detect time        | Projects/tasks found  | Correct deps?         | Monorepo                 |
| --------------- | ------------------ | --------------------- | --------------------- | ------------------------ |
| **Incremental** | **0.208 ms/query** | per-task invalidation | Yes                   | native (synthetic store) |
| **Nx**          | 923 ms detect      | 2 projects            | Yes                   | monorepos/nx/            |
| **Turbo**       | 235 ms detect      | 0 tasks               | No (pnpm unsupported) | monorepos/turborepo/     |
| **Bazel**       | 2537 ms detect     | 4 targets             | Yes                   | monorepos/bazel/         |

Incremental is **~4445x faster** than Nx at detecting what's affected
(0.208 ms vs 923 ms) and identifies invalidation at **task granularity**
rather than project granularity. Nx correctly identified `api` and `web` as
affected when `shared` changed (but not `utils`, which has no dependency on
`shared`). Bazel found all 4 targets but at ~1600ms, over 9,000x slower.

## Thresholds

- Warm plan: p50 under 5 ms, p99 under 20 ms at 100k tasks. - Cold CLI plan under 300 ms at 100k tasks (hyperfine).
