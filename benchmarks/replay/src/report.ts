import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Flaky, FalseSkip, ReplayReport } from "./types.js";

export function median(xs: number[]): number | null {
  const a = [...xs].sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

export function buildReport({
  engine,
  repo,
  commits,
  commitsEvaluated,
  totalTasks,
  taskCommitPairs,
  falseSkips,
  flaky,
  skipShares,
}: {
  engine: string;
  repo: string;
  commits: Array<{ index: number; id: string }>;
  commitsEvaluated: number;
  totalTasks: number;
  taskCommitPairs: number;
  falseSkips: FalseSkip[];
  flaky: Flaky[];
  skipShares: number[];
}): ReplayReport {
  return {
    spec: "replay",
    benchmark: "bench",
    engine,
    repo,
    commits,
    commits_processed: commits.length,
    commits_evaluated: commitsEvaluated,
    total_tasks: totalTasks,
    task_commit_pairs_examined: taskCommitPairs,
    false_skips: falseSkips,
    flaky,
    skip_shares: skipShares,
    median_skip_share: median(skipShares),
    rule_of_three_bound: commitsEvaluated > 0 ? `3/${commitsEvaluated}` : "n/a",
  };
}

export function writeReport(report: ReplayReport, out: string): void {
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
