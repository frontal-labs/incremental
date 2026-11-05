#!/usr/bin/env node
// Generates benchmarks/results/RESULTS.md from the raw benchmark outputs
// (results go to benchmarks/results/*.json and a generated RESULTS.md).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RESULTS = path.join(ROOT, "benchmarks", "results");

function load(name) {
  const p = path.join(RESULTS, name);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

function ms(x) { return x == null ? "n/a" : x.toString(); }

function main() {
  const replay = load("replay.json");
  const warmPlan = load("warm-plan.json");
  const now = new Date().toISOString();
  const lines = [
    "# Benchmark results",
    "",
    `Generated: ${now}`,
    "",
    "## Raw data",
    "",
    `- benchmarks/results/replay.json: ${replay ? "present" : "missing"}`,
    `- benchmarks/results/warm-plan.json: ${warmPlan ? "present" : "missing"}`,
    "",
    "## Replay",
    "",
  ];
  if (replay) {
    lines.push(
      `| commits_processed | commits_evaluated | total_tasks | task_commit_pairs_examined | false_skips | rule_of_three_bound |`,
      `| ${replay.commits_processed ?? "-"} | ${replay.commits_evaluated ?? "-"} | ${replay.total_tasks ?? "-"} | ${replay.task_commit_pairs_examined ?? "-"} | ${(replay.false_skips ?? []).length} | ${replay.rule_of_three_bound ?? "-"} |`,
      "",
      `| median_skip_share | skip_shares |`,
      `| ${replay.median_skip_share == null ? "n/a" : (replay.median_skip_share * 100).toFixed(2) + "%"} | ${JSON.stringify(replay.skip_shares ?? [])} |`,
      "",
    );
  }
  lines.push("## Warm plan latency", "");
  if (warmPlan) {
    lines.push(
      `| tasks | queries | process_load_ms | per_query_ms_approx | log_bytes |`,
      `| ${warmPlan.tasks ?? "-"} | ${warmPlan.queries ?? "-"} | ${ms(warmPlan.process_load_ms)} | ${ms(warmPlan.per_query_ms_approx)} | ${ms(warmPlan.log_bytes)} |`,
      "",
      `_Note: ${warmPlan.note || ""}_`,
      "",
    );
  }
  lines.push("## Thresholds", "", "- Warm plan: p50 under 5 ms, p99 under 20 ms at 100k tasks. - Cold CLI plan under 300 ms at 100k tasks (hyperfine).", "");
  writeFileSync(path.join(RESULTS, "RESULTS.md"), lines.join("\n") + "\n");
  console.log("wrote benchmarks/results/RESULTS.md");
}

main();
