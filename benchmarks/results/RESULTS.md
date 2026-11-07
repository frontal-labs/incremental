# Benchmark results

Generated: 2026-11-05T23:45:25.108Z

## Raw data

- benchmarks/results/replay.json: present
- benchmarks/results/warm-plan.json: present
- benchmarks/results/warm-plan-100k.json: present
- benchmarks/results/comparison.json: present

## Replay

| commits_processed | commits_evaluated | total_tasks | task_commit_pairs_examined | false_skips | rule_of_three_bound |
|---|---|---|---|---|---|
| 11 | 10 | 6 | 60 | 0 | 3/10 |

| median_skip_share | skip_shares |
|---|---|
| 83.33% | [0.6666666666666666,0.8333333333333334,1,0.8333333333333334,0.8333333333333334,0.6666666666666666,0.8333333333333334,1,1,0.8333333333333334] |

### Replay on the monorepo fixtures

| fixture | commits_evaluated | total_tasks | task_commit_pairs_examined | false_skips | rule_of_three_bound | median_skip_share |
|---|---|---|---|---|---|---|
| monorepos/nx | 10 | 4 | 40 | 0 | 3/10 | 75.00% |
| monorepos/turborepo | 10 | 4 | 40 | 0 | 3/10 | 75.00% |
| monorepos/bazel | 10 | 4 | 40 | 0 | 3/10 | 75.00% |

## Warm plan latency

| tasks | queries | iterations | process_load_ms (median) | per_query_ms (median) | per_query_ms (min–max) | per_query_ms p50 / p99 | log_bytes |
|---|---|---|---|---|---|---|---|
| 10000 | 1000 | 3 | 38.137 | 0.131 | 0.130–0.146 | 0.100 / 0.650 (n=3000) | 6348249 |
| 100000 | 1000 | 3 | 393.583 | 0.132 | 0.125–0.148 | 0.093 / 0.661 (n=3000) | 63678262 |

_Note: warm plan latency over protocol v1 stdio; each query invalidates one task; process_load includes engine spawn + hello + store load; stats over multiple iterations_

## Comparison vs alternatives

Measured on three dedicated monorepo fixtures under `monorepos/`. Each fixture has 4 packages
with a `shared → api/web` dependency graph (`utils` standalone), 8 vitest tests, and git history.
The change at HEAD is `packages/shared/src/index.ts`, so the expected affected set is shared, api, web.

| Tool | Detect time | Projects/tasks found | Correct set? | Monorepo |
|---|---|---|---|---|
| **Incremental** | **0.148 ms/query** | per-task invalidation | n/a (synthetic store) | native (synthetic store) |
| **Nx** | 897 ms detect | 3 projects | Yes | monorepos/nx/ |
| **Turbo** | 150 ms detect | 3 tasks (`--filter=...[HEAD~1]`) | Yes | monorepos/turborepo/ |
| **Bazel** | 1147 ms rdeps query | 3 targets | Yes | monorepos/bazel/ |

Not like-for-like: the Incremental figure is a warm query against a 10,000-task synthetic store
(`benchmarks/warm-plan.mjs`). The Nx, Turbo and Bazel figures are each one affected-detection run
against a 4-package fixture, with a cold tool process. Do not read any ratio between these rows as a speedup.

## Thresholds

- Warm plan target at 100k tasks (p50 under 5 ms, p99 under 20 ms): p50 0.093 ms, p99 0.661 ms over 3000 queries. Met.
- Cold CLI plan target (under 300 ms at 100k tasks): proxy only, spawn + hello + store load median 393.583 ms (hyperfine not used). Over target.

