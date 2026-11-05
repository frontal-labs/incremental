# Benchmark results

Generated: 2026-11-05T18:16:04.072Z

## Raw data

- benchmarks/results/replay.json: present
- benchmarks/results/warm-plan.json: present
- benchmarks/results/comparison.json: present

## Replay

| commits_processed | commits_evaluated | total_tasks | task_commit_pairs_examined | false_skips | rule_of_three_bound |
|---|---|---|---|---|---|
| 7 | 6 | 6 | 36 | 0 | 3/6 |

| median_skip_share | skip_shares |
|---|---|
| 83.33% | [0.6666666666666666,0.8333333333333334,1,0.8333333333333334,0.8333333333333334,0.6666666666666666] |

## Warm plan latency

| tasks | queries | iterations | process_load_ms (median) | per_query_ms (median) | per_query_ms (min–max) | log_bytes |
|---|---|---|---|---|---|---|
| 10000 | 100 | 3 | 45.325 | 0.191 | 0.162–0.243 | 6348249 |

_Note: warm plan latency over protocol v1 stdio; each query invalidates one task; process_load includes engine spawn + hello + store load; stats over multiple iterations_

## Comparison vs alternatives

Measured on three dedicated monorepo fixtures under `monorepos/`. Each fixture has 4 packages
with a `shared → api/web` dependency graph (`utils` standalone), 6 vitest tests, and git history.
Changed `packages/shared/src/index.ts`; measured affected-project detection time.

| Tool | Detect time | Projects/tasks found | Correct deps? | Monorepo |
|---|---|---|---|---|
| **Incremental** | **0.177 ms/query** | per-task invalidation | Yes | native (synthetic store) |
| **Nx** | 1656 ms detect | 2 projects | Yes | monorepos/nx/ |
| **Turbo** | 513 ms detect | 0 tasks | Not valid (fixture has no pnpm-workspace.yaml) | monorepos/turborepo/ |
| **Bazel** | 1561 ms query (all targets) | 4 targets listed | Not measured (fixture declares no deps) | monorepos/bazel/ |

Not like-for-like: the Incremental figure is a warm query against a 10,000-task synthetic store
(`benchmarks/warm-plan.mjs`). The Nx figure is one affected-detection run against a 4-package fixture.
The Turbo and Bazel rows are not affected-detection results (see BENCHMARKS.md, Known issues).
Do not read any ratio between these rows as a speedup.

## Thresholds

- Warm plan target: p50 under 5 ms and p99 under 20 ms at 100k tasks.
- Cold CLI plan target: under 300 ms at 100k tasks (hyperfine).
- Measured so far: warm plan at 10k tasks only. The 100k-task targets are not measured.

